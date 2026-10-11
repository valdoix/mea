import { all, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest } from "../lib/http";
import { type ChatSettings, getMessageRow, mustChat, updateChat } from "../services/chats";
import { fileItem, type Filing, registerFilingKind } from "../services/filings";
import { parseStoryTime } from "../trackers/clock";
import { userEditAt } from "../trackers/service";
import { currentFold, deleteEvent, invalidate, linesToOps, writeEvents } from "../trackers/store";

/**
 * Selection asides (Almanac plan F3), replacing typed "((truth: …))": select text in any message
 * and file it as a story truth, a running bit, a day on the calendar, the story's clock, a plant
 * or someone's belonging. Each lands where Mea already keeps it (truths in the chat's settings,
 * the rest as your ledger lines at that message) and shows as a chip with Undo. Facts stated in
 * your own messages are still read on their own, each a chip with Undo and "That's not what I meant".
 */

export type AsideKind = "truth" | "motif" | "calendar" | "clock" | "plant" | "owner";
export interface AsideInput {
  kind: AsideKind;
  text: string;
  messageId?: string | null;
  /** calendar / clock: when ("19 January", "Day 3 21:00"). */
  when?: string;
  /** calendar: birthday, anniversary, holiday… */
  eventKind?: string;
  /** owner: whose it is. */
  owner?: string;
}

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE = new RegExp(`\\b(\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})|(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?)\\b`, "i");
const WEEKDAY = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const CLOCK = /\b(\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)|noon|midnight|dawn|dusk|sunrise|sunset)\b/i;
const DAYWORD = /\b(?:the\s+)?(next morning|next day|tonight|tomorrow(?: morning| night| evening)?|that evening|that night)\b/i;

/** What the selection could be: a date for the calendar, a time for the clock. */
export function asideHints(text: string) {
  const date = text.match(DATE)?.[1]?.replace(/\s+of\s+/i, " ").replace(/(\d)(st|nd|rd|th)/i, "$1");
  const kind = /\bbirthday\b/i.test(text) ? "birthday" : /\banniversar/i.test(text) ? "anniversary" : /\b(feast|festival|holiday)\b/i.test(text) ? "holiday" : null;
  const clock = [text.match(WEEKDAY)?.[1], text.match(DAYWORD)?.[1], text.match(CLOCK)?.[1]].filter(Boolean).join(" ").trim() || null;
  // A title for the calendar: the words before the date ("her birthday, 19 January" → "her birthday").
  const title = (date ? text.slice(0, text.search(DATE)).replace(/[,;:–—-]\s*$/, "") : text).trim().replace(/^(?:on|it'?s|is)\s+/i, "").slice(0, 80) || null;
  return { date: date ?? null, kind, clock, title };
}

/** Files one aside and its chip; returns the filing. */
export function fileAside(chatId: string, a: AsideInput): Filing {
  const chat = mustChat(chatId);
  const text = a.text.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text) throw badRequest("Select some text first");
  const at = a.messageId ? getMessageRow(a.messageId) : null;
  if (a.messageId && (!at || at.chat_id !== chatId)) throw badRequest("That message isn't in this chat");
  if (a.kind === "truth") {
    const s = parseJson<ChatSettings>(chat.settings, {});
    const truths = [...(s.truths ?? [])];
    if (!truths.includes(text)) truths.push(text);
    updateChat(chatId, { settings: { truths: truths.slice(-30) } });
    return fileItem(chatId, { messageId: a.messageId, kind: "truth", label: text.slice(0, 120), data: { text } });
  }
  const hints = asideHints(text);
  let line: string;
  let label: string;
  if (a.kind === "motif") {
    line = `motif ${text.slice(0, 160)}`;
    label = `Running bit: ${text.slice(0, 80)}`;
  } else if (a.kind === "plant") {
    line = `plant ${text.slice(0, 160)}`;
    label = `Planted: ${text.slice(0, 80)}`;
  } else if (a.kind === "calendar") {
    const when = a.when?.trim() || hints.date;
    if (!when) throw badRequest("Pick the day");
    const title = (hints.title || text).replace(/[|:]/g, " ").slice(0, 80);
    const kind = a.eventKind || hints.kind;
    line = `event ${title}: ${when}${kind ? ` | ${kind}` : ""}`;
    label = `${title} · ${when}`;
  } else if (a.kind === "clock") {
    const when = a.when?.trim() || hints.clock;
    if (!when) throw badRequest("Say the time or day");
    line = clockLine(chatId, when);
    label = `Clock: ${when}`;
  } else {
    if (!a.owner?.trim()) throw badRequest("Whose is it?");
    line = `item ${text.slice(0, 80)}: owner ${a.owner.trim()}`;
    label = `${text.slice(0, 60)}: ${a.owner.trim()}'s`;
  }
  const ops = linesToOps([line]).ops;
  if (!ops.length) throw badRequest("Mea couldn't read that as a story record");
  const ids = userEditAt(chatId, ops, a.messageId ?? null);
  publish({ type: "trackers.changed", chatId });
  return fileItem(chatId, { messageId: a.messageId, kind: a.kind, label, data: { ids, line } });
}

const WORD_HOURS: Record<string, number> = { noon: 12, midnight: 24, dawn: 6, sunrise: 6, dusk: 19, sunset: 19 };

/** "21:00", "9pm", "the next morning", "tomorrow at noon" → a clock line from the story's time (forward only). */
export function clockLine(chatId: string, when: string): string {
  if (parseStoryTime(when)) return `clock: ${when}`;
  const now = currentFold(chatId).result.state.time?.minutes ?? null;
  if (now == null) throw badRequest("The story has no time yet: give a full time, like “Day 1 21:00”");
  const t = when.toLowerCase();
  const next = /\b(tomorrow|next (?:day|morning))\b/.test(t) ? 1 : 0;
  const hm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  const word = Object.keys(WORD_HOURS).find((w) => new RegExp(`\\b${w}\\b`).test(t));
  let min: number | null = null;
  if (hm) {
    let h = Number(hm[1]) % 24;
    if (hm[3] === "pm" && h < 12) h += 12;
    if (hm[3] === "am" && h === 12) h = 0;
    min = h * 60 + Number(hm[2] ?? 0);
  } else if (word) min = WORD_HOURS[word]! * 60;
  else if (/\bmorning\b/.test(t)) min = 8 * 60;
  else if (/\b(evening|tonight)\b/.test(t)) min = 19 * 60;
  else if (/\bnight\b/.test(t)) min = 22 * 60;
  else if (next) min = now % 1440;
  if (min == null) throw badRequest("Mea couldn't read that time");
  let target = Math.floor(now / 1440) * 1440 + next * 1440 + min;
  if (target <= now) target += 1440;
  return `clock: +${target - now}m`;
}

// Undo: the truth comes off the chat; the ledger lines come out of the story's records.
registerFilingKind("truth", {
  undo: (f) => {
    const s = parseJson<ChatSettings>(mustChat(f.chatId).settings, {});
    updateChat(f.chatId, { settings: { truths: (s.truths ?? []).filter((t) => t !== f.data.text) } });
  },
});
for (const kind of ["motif", "calendar", "clock", "plant", "owner"] as const) {
  registerFilingKind(kind, {
    undo: (f) => {
      for (const id of (f.data.ids as string[] | undefined) ?? []) deleteEvent(f.chatId, id);
      // Facts read from your own message (Mea's guesses) are engine lines on that message.
      if (f.data.guess && f.messageId && f.data.line) {
        run("DELETE FROM tracker_events WHERE message_id = ? AND source = 'engine' AND json_extract(op, '$.raw') = ?", f.messageId, String(f.data.line));
        invalidate(f.chatId);
        publish({ type: "trackers.changed", chatId: f.chatId });
      }
    },
  });
}

// ---------- facts in your own messages ----------

const NOT_THINGS = /^(feeling|idea|question|plan|doubt|headache|minute|moment|sense|thought|problem|right|reason|chance|choice|lot|bit|way|point|hunch|favou?r|request|confession)\b/i;
const HAVE = /\bI(?:'ve got| have got| have| carry| am carrying|'m carrying| keep| still have)\s+(?:a|an|my|the|this|that)\s+([a-z][a-z' -]{2,36}?)(?=\s+(?:in|on|with|from|that|which|and|but|here|under|tucked)\b|[.,;!?]|$)/gi;
const BIRTHDAY = new RegExp(`\\bmy birthday(?:'s| is)\\s+(?:on\\s+)?(?:the\\s+)?(${DATE.source.slice(3, -3)})`, "i");

/** What your message states about you: things you have, your birthday. Lines for the ledger, with chip labels. */
export function ownFacts(text: string, userName: string): { line: string; label: string; kind: "owner" | "calendar" }[] {
  const out: { line: string; label: string; kind: "owner" | "calendar" }[] = [];
  for (const m of text.matchAll(HAVE)) {
    const thing = m[1]!.trim().replace(/\s+/g, " ");
    if (NOT_THINGS.test(thing) || thing.split(" ").length > 4) continue;
    out.push({ line: `item ${thing}: +${userName}`, label: `You have ${thing}`, kind: "owner" });
  }
  const b = text.match(BIRTHDAY);
  if (b) {
    const when = b[1]!.replace(/\s+of\s+/i, " ").replace(/(\d)(st|nd|rd|th)/i, "$1");
    out.push({ line: `event ${userName}'s birthday: ${when} | birthday | who: ${userName}`, label: `Your birthday · ${when}`, kind: "calendar" });
  }
  const seen = new Set<string>();
  return out.filter((x) => !seen.has(x.line) && seen.add(x.line)).slice(0, 4);
}

/**
 * After the trackers read a reply (an onTrackerUpdate hook): what your message just before it
 * stated about you becomes Mea's lines on your message, each a chip with Undo and "That's not what
 * I meant". A guess you turned down isn't made again.
 */
export function asidesAfterReply(chatId: string, messageId: string) {
  const m = getMessageRow(messageId);
  if (!m || m.deleted_at || m.role !== "assistant") return;
  const prev = one<{ id: string; active_swipe: number }>("SELECT id, active_swipe FROM messages WHERE chat_id = ? AND seq < ? AND role = 'user' AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1", chatId, m.seq);
  if (!prev) return;
  if (one("SELECT 1 FROM filings WHERE message_id = ? AND json_extract(data, '$.guess') = 1 LIMIT 1", prev.id)) return;
  const text = one<{ content: string }>("SELECT content FROM swipes WHERE message_id = ? AND idx = ?", prev.id, prev.active_swipe)?.content ?? "";
  let st;
  try {
    st = currentFold(chatId).result.state;
  } catch {
    return;
  }
  const user = Object.values(st.chars).find((c) => c.isUser);
  if (!user) return;
  const facts = ownFacts(text, user.name).filter((f) => {
    // Already known (you already have it).
    if (f.kind === "owner") {
      const thing = f.line.slice(5, f.line.indexOf(":")).toLowerCase();
      return !Object.values(st.items).some((i) => i.name.toLowerCase() === thing && i.holder === user.id && !i.gone);
    }
    return true;
  });
  const turnedDown = new Set(all<{ label: string }>("SELECT label FROM filings WHERE message_id = ? AND status = 'undone'", prev.id).map((r) => r.label));
  for (const f of facts) {
    if (turnedDown.has(f.label)) continue;
    const ops = linesToOps([f.line]).ops;
    if (!ops.length) continue;
    writeEvents(chatId, { messageId: prev.id, swipeIdx: -1 }, ops, "engine");
    fileItem(chatId, { messageId: prev.id, kind: f.kind, label: f.label, data: { guess: true, line: ops[0]!.raw } });
  }
}
