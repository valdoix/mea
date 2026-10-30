import { all, one, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { getMessageRow, mustChat } from "../services/chats";
import { fileItem, registerFilingKind } from "../services/filings";
import { registerStatusTile } from "../services/status";
import { formatStoryTime, shortStoryTime } from "./clock";
import { pastDue } from "./loops";
import { currentFold, invalidate, linesToOps, writeEvents } from "./store";
import { userEditAt } from "./service";
import type { Loop, Obligation, Op, WorldState } from "./types";

/**
 * Promises on the clock (Almanac plan E3). Promises and meetings carry a time window; the fold
 * decides kept or broken from who was there and when (fold.ts promiseChecks), and moves the bond
 * by how much it mattered. This file finds them in what was said (the reply's dialogue and your
 * own message), files each as a chip with Undo, and gives you the last word: Kept, Broken, They had
 * a reason, Forgive.
 */

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const TIME = /\b(?:at|by|around|before)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*o'?clock)?\b/i;

/** A time said in passing ("at nine tonight", "tomorrow by noon") as a due the fold can read. */
export function spokenDue(s: string): string | undefined {
  const t = s.toLowerCase();
  const day = /\btomorrow\b/.test(t) ? "tomorrow " : "";
  const m = s.match(TIME);
  if (!m) return /\btomorrow\b/.test(t) ? "tomorrow" : /\btonight\b/.test(t) ? "tonight" : undefined;
  const raw = m[1]!.toLowerCase();
  if (raw === "noon" || raw === "midnight") return `${day}${raw}`;
  const hm = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  let h = hm ? Number(hm[1]) : (WORDS[raw] ?? 0);
  const min = hm?.[2] ?? "00";
  const ap = hm?.[3];
  if (ap === "pm" && h < 12) h += 12;
  else if (ap === "am" && h === 12) h = 0;
  else if (!ap && h < 12 && /\b(tonight|evening|night)\b/.test(t)) h += 12;
  else if (!ap && h < 12 && !day) return `around ${h}:${min}`;
  return `${day}${String(h).padStart(2, "0")}:${min}`;
}

export interface Spoken {
  what: string;
  meet?: string;
  due?: string;
  importance: number;
  /** The narration either side of the quote ("…” Nat threatens."), to tell who said it. */
  near?: { after: string; before: string };
}

/** Each quote in a reply, with the narration just after it and just before it. */
const quoted = (s: string) =>
  [...s.matchAll(/[“"]([^”"]{3,400})[”"]/g)].map((m) => {
    const after = s.slice(m.index! + m[0].length).split(/[“"\n]|(?<=[.!?])\s/)[0] ?? "";
    const before = (s.slice(0, m.index).split(/[”"\n]/).pop() ?? "").trimEnd().split(/(?<=[.!?])\s+/).pop() ?? "";
    return { text: m[1]!, near: { after, before } };
  });
const PLACE = /\b(?:[Mm]eet (?:me|us|you)|[Ss]ee you|[Bb]e|[Ww]ait(?: for you)?|[Ff]ind me)\s+(?:at|by|in|outside|behind)\s+((?:the\s+)?[A-Z][\w'’-]*(?:\s+(?:of\s+the\s+|of\s+)?[A-Z][\w'’-]*)*)/;
const VOW = /\bI\s+(promise|swear|vow|give you my word)\b(.*)$/i;
// The oath around a promise ("to god", "on my life", "you", "that"), not the promise itself.
const OATH = /^(?:[\s,;:—–-]*(?:to\s+(?:god|christ|heaven|the gods|you)|on\s+(?:my|our)\s+(?:life|honou?r|soul|word|name|mother'?s?\s+grave|father'?s?\s+grave)|you|that)\b)*[\s,;:—–-]*/i;
const WILL = /^(?:I|we)(?:'ll|’ll|\s+will|\s+shall|\s+am going to|'m going to|’m going to|'m gonna|’m gonna|\s+won'?t|\s+won’t|\s+will not|\s+shall not)\s+/i;
// A vow to hurt the one listening is a threat, not a promise.
const THREAT = /\b(?:kill|murder|gut|strangle|hurt|bury|destroy|ruin|make you (?:pay|sorry|regret)|regret it|wish you)\b/i;

/**
 * What a vow commits the speaker to: "I swear I'll find him" → "find him". Nothing when there's no
 * commitment in it ("I swear, you're impossible", "I swear to god if you…"), when it's a threat,
 * or when the line is cut off before it got there ("one more time -").
 */
export function vowed(sentence: string): { what: string; vital: boolean } | null {
  const m = sentence.match(VOW);
  if (!m) return null;
  const rest = m[2]!.replace(OATH, "");
  const will = rest.match(WILL);
  let what: string;
  if (will) what = (/n[o'’]?t\s+$/i.test(will[0]) ? "not " : "") + rest.slice(will[0].length);
  else if (/^to\s+[a-z]/i.test(rest) && !/^swear$/i.test(m[1]!)) what = rest.replace(/^to\s+/i, "");
  else return null;
  // Up to the sentence's end; single stops only, so a trailing "..." stays to show it trailed off.
  what = what.split(/(?<!\.)\.(?!\.)|[!?”"]/)[0]!;
  if (/(?:[-–—]|…|\.\.\.)\s*$/.test(what)) return null;
  what = what.trim().replace(/[,;:]$/, "");
  if (what.length < 3 || what.length > 90) return null;
  if (/\byou\b/i.test(what) && THREAT.test(what)) return null;
  return { what, vital: /swear|word|vow/i.test(m[1]!) };
}

/** Who spoke a quote, by the narration around it ("…” Nat threatens." or "Nat says, “…"). */
export function speakerOf(near: Spoken["near"], chars: { name: string; aliases?: string[] }[]): string | undefined {
  if (!near) return undefined;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = chars.flatMap((c) => [c.name, c.name.split(/\s+/)[0]!, ...(c.aliases ?? [])].filter((n) => n.length > 1).map((n) => ({ re: new RegExp(`\\b${esc(n)}\\b`, "gi"), who: c.name })));
  // The first name after the quote is its tag; failing that, the last one before it.
  const pick = (s: string, last: boolean) => {
    let best: { i: number; who: string } | undefined;
    for (const { re, who } of names) for (const x of s.matchAll(re)) if (!best || (last ? x.index! > best.i : x.index! < best.i)) best = { i: x.index!, who };
    return best?.who;
  };
  return pick(near.after, false) ?? pick(near.before, true);
}

/** Promises and meetings in what someone said (their dialogue, or your whole message). */
export function spokenPromises(text: string, mine: boolean): Spoken[] {
  const out: Spoken[] = [];
  const parts: { text: string; near?: Spoken["near"] }[] = mine ? [{ text }, ...quoted(text).map((q) => ({ text: q.text }))] : quoted(text);
  for (const { text: part, near } of parts) {
    for (const sentence of part.split(/(?<=[.!?])\s+/)) {
      const meet = sentence.match(PLACE);
      const due = spokenDue(sentence);
      const vital = /\b(on my life|no matter what|swear)\b/i.test(sentence);
      if (meet && due && /\b(meet|see you|I'?ll be|I will be|I'?ll wait|wait for you|find me|be there)\b/i.test(sentence)) {
        const place = meet[1]!.replace(/^the\s+/i, "the ").trim();
        out.push({ what: `be at ${place}`, meet: place, due, importance: vital ? 3 : 2, near });
        continue;
      }
      const v = vowed(sentence);
      if (v) out.push({ what: v.what, due, importance: vital || v.vital ? 3 : 2, near });
    }
  }
  const seen = new Set<string>();
  return out.filter((x) => !seen.has(x.what.toLowerCase()) && seen.add(x.what.toLowerCase())).slice(0, 3);
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 2).slice(0, 4).join(" ");
const textOf = (messageId: string, idx: number) => one<{ content: string }>("SELECT content FROM swipes WHERE message_id = ? AND idx = ?", messageId, idx)?.content ?? "";
const PROMISE_OP = `op LIKE '%"op":"promise"%'`;

/**
 * After the trackers read a reply (an onTrackerUpdate hook): promises said in the reply's dialogue
 * or in your message just before it become ledger lines (Mea's, tied to the reply), and every new
 * promise on this reply, the tracker's or Mea's, files a chip with Undo.
 */
export function promisesAfterReply(chatId: string, messageId: string, swipeIdx?: number) {
  const m = getMessageRow(messageId);
  if (!m || m.deleted_at || m.role !== "assistant") return;
  const idx = swipeIdx ?? m.active_swipe;
  run(`DELETE FROM tracker_events WHERE message_id = ? AND swipe_idx = ? AND source = 'engine' AND ${PROMISE_OP}`, messageId, idx);
  invalidate(chatId);
  let st: WorldState;
  try {
    st = currentFold(chatId).result.state;
  } catch {
    return;
  }
  const user = Object.values(st.chars).find((c) => c.isUser);
  const speaker = (m.name && Object.values(st.chars).find((c) => !c.isUser && c.name.toLowerCase() === m.name!.toLowerCase())) || Object.values(st.chars).find((c) => c.isMain);
  if (!user || !speaker) return;
  const prev = one<{ id: string; active_swipe: number; seq: number }>("SELECT id, active_swipe, seq FROM messages WHERE chat_id = ? AND seq < ? AND role = 'user' AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1", chatId, m.seq);
  const cast = Object.values(st.chars);
  const said: { who: string; whom: string; s: Spoken; seq: number }[] = [
    // A quote is whoever the narration says spoke it, not the card the reply came from.
    ...spokenPromises(textOf(messageId, idx), false).map((s) => {
      const who = speakerOf(s.near, cast) ?? speaker.name;
      return { who, whom: who === user.name ? speaker.name : user.name, s, seq: m.seq };
    }),
    ...(prev ? spokenPromises(textOf(prev.id, prev.active_swipe), true).map((s) => ({ who: user.name, whom: speaker.name, s, seq: prev.seq })) : []),
  ];
  const undone = new Set(all<{ what: string }>("SELECT json_extract(data, '$.what') AS what FROM filings WHERE message_id = ? AND kind = 'promise' AND status = 'undone'", messageId).map((r) => key(String(r.what ?? ""))));
  const open = Object.values(st.obligations).filter((o) => o.kind === "promise" && (o.status === "open" || o.status === "due"));
  const lines: string[] = [];
  for (const { who, whom, s, seq } of said) {
    const whoId = Object.values(st.chars).find((c) => c.name === who)?.id;
    if (undone.has(key(s.what))) continue;
    // The tracker already wrote it (the same meeting place, or much the same words).
    if (open.some((o) => o.who === whoId && ((s.meet && o.meet && o.meet.toLowerCase() === s.meet.toLowerCase()) || key(o.what) === key(s.what)))) continue;
    const meta = [...(s.meet ? [`meet @ ${s.meet}`] : []), ...(s.importance >= 3 ? ["vital"] : [])];
    lines.push(`promise ${who}>${whom}: ${s.what}${meta.length ? ` | ${meta.join(" · ")}` : ""}${s.due ? ` [due ${s.due}]` : ""} — said in #${seq}`);
  }
  if (lines.length) writeEvents(chatId, { messageId, swipeIdx: idx }, linesToOps(lines).ops, "engine");
  // Chips: every promise this reply made (Mea's or the tracker's), once.
  const filed = new Set(all<{ what: string }>("SELECT json_extract(data, '$.what') AS what FROM filings WHERE message_id = ? AND kind = 'promise'", messageId).map((r) => key(String(r.what ?? ""))));
  const made = all<{ op: string }>(`SELECT op FROM tracker_events WHERE message_id = ? AND swipe_idx IN (?, -1) AND ${PROMISE_OP}`, messageId, idx);
  for (const r of made) {
    const op = JSON.parse(r.op) as { subject?: string; object?: string; args: { what?: string; status?: string; meet?: string; due?: string } };
    if (!op.args.what || (op.args.status && op.args.status !== "open") || filed.has(key(op.args.what))) continue;
    filed.add(key(op.args.what));
    fileItem(chatId, { messageId, kind: "promise", label: `${op.subject} promised ${op.object ?? "someone"}: ${op.args.what}`, data: { what: op.args.what, swipeIdx: idx } });
  }
}

// Undo takes the promise back off the reply (the tracker's line or Mea's).
registerFilingKind("promise", {
  undo: (f) => {
    if (!f.messageId) return;
    const what = String(f.data.what ?? "");
    run(`DELETE FROM tracker_events WHERE message_id = ? AND ${PROMISE_OP} AND json_extract(op, '$.args.what') = ?`, f.messageId, what);
    invalidate(f.chatId);
    publish({ type: "trackers.changed", chatId: f.chatId });
  },
});

// ---------- the list and your word ----------

export interface PromiseView {
  id: string;
  who: string;
  whom: string | null;
  what: string;
  meet: string | null;
  status: Obligation["status"];
  auto: boolean;
  importance: number;
  due: string | null;
  /** Story minutes until it's due (negative: overdue). */
  left: number | null;
  window: number;
  seq: number;
}

export function promisesFor(chatId: string): PromiseView[] {
  const st = currentFold(chatId).result.state;
  const now = st.time?.minutes ?? null;
  const nm = (id?: string) => (id ? (st.chars[id]?.name ?? id) : null);
  return Object.values(st.obligations)
    .filter((o) => o.kind === "promise")
    .map((o) => ({
      id: o.id,
      who: nm(o.who)!,
      whom: nm(o.whom),
      what: o.what,
      meet: o.meet ?? null,
      status: o.status,
      auto: Boolean(o.auto),
      importance: o.importance ?? 2,
      due: o.due?.minutes != null ? shortStoryTime(formatStoryTime({ minutes: o.due.minutes, form: st.time?.form ?? "day" })) : (o.due?.text ?? null),
      left: o.due?.minutes != null && now != null ? o.due.minutes - now : null,
      window: o.window ?? (o.meet ? 60 : 1440),
      seq: o.seq,
    }))
    .sort((a, b) => Number(b.status === "open" || b.status === "due") - Number(a.status === "open" || a.status === "due") || (a.left ?? 1e9) - (b.left ?? 1e9) || b.seq - a.seq);
}

export type PromiseVerdict = "kept" | "broken" | "excused" | "forgiven" | "open";

/** Kept, Broken, They had a reason (the bond doesn't move), Forgive (resentment goes), or reopen. */
export function setPromise(chatId: string, id: string, verdict: PromiseVerdict) {
  const st = currentFold(chatId).result.state;
  const o = st.obligations[id];
  if (!o || o.kind !== "promise") throw notFound("No such promise");
  if ((verdict === "excused" || verdict === "forgiven") && o.status !== "broken") throw badRequest("Only a broken promise can be excused or forgiven");
  const nm = (cid?: string) => (cid ? (st.chars[cid]?.name ?? cid) : "someone");
  const why = { kept: "you marked it kept", broken: "you marked it broken", excused: "they had a reason", forgiven: "forgiven", open: "you reopened it" }[verdict];
  const ids = userEditAt(chatId, linesToOps([`promise ${nm(o.who)}>${nm(o.whom)}: ${o.what} | ${verdict} — ${why}`]).ops);
  publish({ type: "trackers.changed", chatId });
  return { ids, promise: promisesFor(chatId).find((p) => p.id === id) ?? null };
}

/** docs/22 5.1: every loop for the panel, what's open first, each newest first. */
export function loopsFor(chatId: string) {
  const st = currentFold(chatId).result.state;
  const late = new Set(pastDue(st).map((l) => l.id));
  const view = (l: Loop) => ({
    id: l.id,
    what: l.what,
    kind: l.kind,
    status: l.status,
    who: l.obligation ? (st.chars[st.obligations[l.obligation]?.who ?? ""]?.name ?? null) : null,
    opened: l.opened,
    closed: l.closed ?? null,
    how: l.how ?? null,
    byHand: Boolean(l.byHand),
    repeats: Boolean(l.repeats),
    last: l.last ?? null,
    late: late.has(l.id),
    due: l.due?.minutes != null ? shortStoryTime(formatStoryTime({ minutes: l.due.minutes, form: st.time?.form ?? "day" })) : (l.due?.text ?? null),
  });
  const of = (l: Loop) => (l.status === "open" ? l.opened : (l.closed ?? l.opened));
  return Object.values(st.loops ?? {})
    .sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || of(b) - of(a) || Number(Boolean(b.byHand)) - Number(Boolean(a.byHand)))
    .map(view);
}

export type LoopAction = "done" | "dropped" | "open";

/** One tap: it happened, it's off, or it's open again. It holds, and reopening undoes either. */
export function setLoop(chatId: string, id: string, action: LoopAction) {
  const l = currentFold(chatId).result.state.loops?.[id];
  if (!l) throw notFound("No such loop");
  const op: Op = { op: "loop", subject: id, args: { action, hand: true }, raw: `loop ${id}: ${action}` };
  const ids = userEditAt(chatId, [op]);
  publish({ type: "trackers.changed", chatId });
  return { ids, loop: loopsFor(chatId).find((x) => x.id === id) ?? null };
}

const inWords = (min: number) => (min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`);

registerStatusTile((chatId) => {
  mustChat(chatId);
  const next = promisesFor(chatId).find((p) => (p.status === "open" || p.status === "due") && p.left != null && p.left > -p.window);
  if (!next || next.left! > 2 * 1440) return null;
  const soon = next.left! <= 120;
  return { id: "promise", n: soon ? 1 : 0, value: next.left! <= 0 ? "now" : inWords(next.left!), label: next.meet ? `meeting at ${next.meet}` : `promise to ${next.whom ?? "someone"}`, tone: soon ? "amber" : "blue", open: { dock: "story", section: "promises" }, order: 25, title: `${next.who}: ${next.what}` };
});
