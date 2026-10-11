import { z } from "zod";
import { all, one } from "../db/db";
import { badRequest } from "../lib/http";
import { keptOffpage } from "../accuracy/offpage";
import { cleanText } from "../memory/text";
import { mustChat, updateChat } from "../services/chats";
import { enqueue } from "../services/jobs";
import { callJson } from "../services/llm";
import { formatStoryTime, timeOfDay } from "../trackers/clock";
import { exposureFor } from "../trackers/exposure";
import { promisesFor } from "../trackers/promises";
import { currentFold } from "../trackers/store";
import { BIPOLAR_AXES, type WorldState } from "../trackers/types";

/**
 * The Director's Desk (Almanac plan F2): one panel of big buttons for running the story. Reports
 * are read-only views over the fold; Cut to, Bring someone in and the pacing buttons are one-shot
 * cues for the next reply. The top row is context-aware: the three most useful buttons right now.
 */

export interface DeskSuggestion {
  id: string;
  label: string;
  /** What tapping it does, for the client. */
  do: { cue: string } | { report: "bonds" | "threads" | "secrets" } | { dock: "story"; section: string } | { skip: string };
  urgency: number;
}

const stateOf = (chatId: string): WorldState | null => {
  try {
    return currentFold(chatId).result.state;
  } catch {
    return null;
  }
};

/** Where this chapter began (the latest chapter boundary), so reports say "since the chapter began". */
export function chapterStart(chatId: string): number {
  return one<{ s: number | null }>("SELECT MAX(start_seq) AS s FROM summaries WHERE chat_id = ? AND level = 'chapter'", chatId)?.s ?? 1;
}

const nameIn = (st: WorldState, id: string) => (st.chars[id]?.name ?? id);
/** The newest message (the fold's lastSeq only moves when a message changes the records). */
const lastSeq = (chatId: string) => one<{ s: number | null }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0;

/** The top row: promises coming due, stalled threads, nightfall, a secret close to out, a cracking pressure. */
export function deskSuggestions(chatId: string): DeskSuggestion[] {
  const st = stateOf(chatId);
  if (!st) return [];
  const out: DeskSuggestion[] = [];
  try {
    const next = promisesFor(chatId).find((p) => (p.status === "open" || p.status === "due") && p.left != null && p.left > -p.window && p.left <= 180);
    if (next) out.push({ id: `promise:${next.id}`, label: next.left! <= 0 ? `${next.meet ? `Meeting at ${next.meet}` : "Promise"} due now` : `${next.meet ? "Meeting" : "Promise"} due in ${next.left! < 60 ? `${next.left} min` : `${Math.round(next.left! / 60)} h`}`, do: { dock: "story", section: "promises" }, urgency: 3 });
  } catch {
    // promises are optional here
  }
  const last = lastSeq(chatId);
  const stalled = Object.values(st.threads)
    .filter((t) => t.status !== "resolved" && last - t.lastSeq >= 30)
    .sort((a, b) => a.lastSeq - b.lastSeq)[0];
  if (stalled) out.push({ id: `thread:${stalled.id}`, label: `Thread stalled ${last - stalled.lastSeq} msgs`, do: { cue: pushCue(stalled.title, stalled.latest) }, urgency: 2 });
  if (st.time) {
    const tod = timeOfDay(formatStoryTime(st.time));
    const hour = Math.floor((st.time.minutes % 1440) / 60);
    if (hour >= 17 && hour < 20) out.push({ id: "dusk", label: "Night is falling", do: { cue: "Night falls during this scene: the light goes, the place changes with it, and someone reacts." }, urgency: 1 });
    else if (hour >= 23 || hour < 4) out.push({ id: "late", label: "It's late: skip to morning?", do: { skip: "until morning" }, urgency: 1 });
    else if (tod === "dawn") out.push({ id: "dawn", label: "Dawn is coming", do: { cue: "Dawn comes during this scene, and the night's events look different in the light." }, urgency: 1 });
  }
  try {
    const hot = exposureFor(chatId).find((x) => x.cur >= x.max - 1);
    if (hot) out.push({ id: `secret:${hot.key}`, label: `A secret is close to out (${hot.cur}/${hot.max})`, do: { report: "secrets" }, urgency: 2 });
  } catch {
    // no exposure clocks
  }
  const cracking = Object.values(st.chars).find((c) => (c.tier === "spot" || c.tier === "peri") && c.pressure?.stage === "cracking");
  if (cracking) out.push({ id: `pressure:${cracking.id}`, label: `${cracking.name} is close to cracking`, do: { cue: `${cracking.name}'s hidden pressure nearly shows this scene: a slip, a tell, a line cut short.` }, urgency: 2 });
  return out.sort((a, b) => b.urgency - a.urgency).slice(0, 3);
}

const pushCue = (title: string, latest?: string) => `Push the thread "${title}" forward this scene${latest ? ` (where it stands: ${latest})` : ""}: a new fact, a choice or a cost. Don't resolve it yet.`;

/** Report: Bonds — every bond's change since the chapter began, with arrows. */
export function bondsReport(chatId: string) {
  const st = stateOf(chatId);
  if (!st) return { since: 1, bonds: [] };
  const since = chapterStart(chatId);
  const bonds = Object.values(st.bonds)
    .map((b) => {
      const moved = b.history.filter((h) => h.seq >= since);
      const delta: Record<string, number> = {};
      for (const h of moved) delta[h.axis] = (delta[h.axis] ?? 0) + h.delta;
      return {
        from: nameIn(st, b.from),
        to: nameIn(st, b.to),
        label: b.label ?? null,
        axes: Object.fromEntries(Object.entries(b.axes).filter(([, v]) => v)),
        changes: Object.entries(delta)
          .filter(([, d]) => d)
          .map(([axis, d]) => ({ axis, delta: d, now: b.axes[axis as keyof typeof b.axes] ?? 0, bipolar: (BIPOLAR_AXES as readonly string[]).includes(axis) })),
        why: moved.at(-1)?.cause ?? null,
      };
    })
    .filter((b) => b.changes.length || Object.keys(b.axes).length)
    .sort((a, b) => b.changes.reduce((n, c) => n + Math.abs(c.delta), 0) - a.changes.reduce((n, c) => n + Math.abs(c.delta), 0));
  return { since, bonds };
}

/** Report: Threads — open, stalled and ripe, each with Push this one. */
export function threadsReport(chatId: string) {
  const st = stateOf(chatId);
  if (!st) return { threads: [] };
  const last = lastSeq(chatId);
  const threads = Object.values(st.threads)
    .filter((t) => t.status !== "resolved")
    .map((t) => {
      const quiet = last - t.lastSeq;
      const built = t.history.filter((h) => h.op === "advance" || h.op === "complicate").length;
      const state = t.status === "stalled" || quiet >= 30 ? "stalled" : built >= 3 ? "ripe" : "open";
      return { id: t.id, title: t.title, state, latest: t.latest ?? null, blocker: t.blocker ?? null, quiet, push: pushCue(t.title, t.latest) };
    })
    .sort((a, b) => ["ripe", "stalled", "open"].indexOf(a.state) - ["ripe", "stalled", "open"].indexOf(b.state) || b.quiet - a.quiet);
  return { threads };
}

/** Report: Secrets — exposure clocks, who's closest, and the secrets kept off the page. */
export function secretsReport(chatId: string) {
  let clocks: ReturnType<typeof exposureFor> = [];
  try {
    clocks = exposureFor(chatId);
  } catch {
    clocks = [];
  }
  return {
    clocks: clocks.map((x) => ({ key: x.key, statement: x.statement, cur: x.cur, max: x.max, near: x.near.slice(0, 3).map((n) => ({ name: n.name, why: n.why.at(-1) ?? null })) })),
    offpage: keptOffpage(chatId).map((o) => ({ id: o.id, label: o.label, due: Boolean(o.due), hints: o.hints })),
  };
}

/** Who and where for Cut to and Bring someone in. */
export function deskView(chatId: string) {
  mustChat(chatId);
  const st = stateOf(chatId);
  const people = st ? Object.values(st.chars).filter((c) => !c.isUser && !c.dead) : [];
  return {
    suggestions: deskSuggestions(chatId),
    here: people.filter((c) => c.tier === "spot" || c.tier === "peri").map((c) => c.name),
    away: people.filter((c) => !(c.tier === "spot" || c.tier === "peri")).map((c) => ({ name: c.name, where: c.place ?? null })),
    places: st ? Object.values(st.places).sort((a, b) => b.lastSeq - a.lastSeq).map((p) => ({ name: p.name, path: p.path.join(" › ") })).slice(0, 30) : [],
    since: chapterStart(chatId),
  };
}

export const CUES = {
  raise: "Raise the stakes this scene: something the characters care about is now at risk, or a choice gets harder. Make it come from what's already in play.",
  breathe: "Let this scene breathe: a quieter beat, room for the characters to talk, notice, or recover. No new threat.",
};
export type DeskCue = { kind: "cut"; to: string } | { kind: "bring"; who: string } | { kind: "raise" } | { kind: "breathe" } | { kind: "push"; thread: string };

/** One-shot cues for the next reply. */
export function deskCue(chatId: string, c: DeskCue) {
  mustChat(chatId);
  let cue: string;
  if (c.kind === "cut") cue = `Cut to ${c.to}: the next reply opens there (or on them), wherever they are and whatever they're doing now, as a clean scene cut. Keep to what that viewpoint could know.`;
  else if (c.kind === "bring") cue = `Bring ${c.who} into the scene: they arrive or are found, for a reason that fits where they've been and what they want.`;
  else if (c.kind === "push") {
    const t = threadsReport(chatId).threads.find((x) => x.id === c.thread || x.title === c.thread);
    if (!t) throw badRequest("No such open thread");
    cue = t.push;
  } else cue = CUES[c.kind];
  updateChat(chatId, { settings: { cue } });
  return { cue };
}

/** Story audit: every check over the last N replies, then Story health shows the result. */
export function storyAudit(chatId: string, n = 20) {
  mustChat(chatId);
  const rows = all<{ id: string; active_swipe: number }>("SELECT id, active_swipe FROM messages WHERE chat_id = ? AND role = 'assistant' AND deleted_at IS NULL ORDER BY seq DESC LIMIT ?", chatId, Math.max(1, Math.min(100, n)));
  for (const r of rows) enqueue("accuracy.check", { chatId, messageId: r.id, swipeIdx: r.active_swipe }, { chatId, dedupeKey: `accuracy.check:${r.id}:${r.active_swipe}` });
  return { queued: rows.length };
}

/** Previously on…, since I was away: what happened since you last read (a few messages, not the whole story). */
export async function recapSince(chatId: string, since: number) {
  mustChat(chatId);
  const rows = all<{ seq: number; role: string; name: string | null; content: string }>(
    `SELECT m.seq, m.role, m.name, s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.role != 'system' AND m.created_at > ? ORDER BY m.seq`,
    chatId,
    since,
  );
  if (!rows.length) return { recap: "Nothing new since you were last here.", count: 0 };
  let text = rows.map((r) => `#${r.seq} ${r.name ?? r.role}: ${cleanText(r.content)}`).join("\n\n");
  if (text.length > 12_000) text = text.slice(-12_000);
  const res = await callJson({
    task: "summarizer",
    kind: "recap",
    chatId,
    name: "recap",
    schema: z.object({ recap: z.string() }),
    system: 'Write a short "since you were away" recap of these roleplay messages for the player coming back: what happened, in order, and where things stand now. One or two short paragraphs. Use only what the messages say. Reply with JSON only: {"recap": "…"}',
    user: `MESSAGES SINCE THE PLAYER LAST READ:\n${text}`,
    maxTokens: 600,
  });
  return { recap: res.data.recap.trim(), count: rows.length };
}
