import { one } from "../db/db";
import { cleanText } from "../memory/text";
import { getMessageRow } from "../services/chats";
import { describeWhen } from "../trackers/calendars";
import { describeMinutes } from "../trackers/clock";
import { currentFold, eventsOf, foldAt, trackerConfig } from "../trackers/store";
import type { Issue } from "./checker";
import { guardsFor } from "./guards";

/**
 * Timeline sanity (CON-12): once the trackers have read a reply, the story clock before and after
 * it is compared. The clock running backwards, a big jump the reply never mentions, or a reply
 * that moves to the next day while the clock barely moved are flagged with the clock as the citation.
 */

const SKIP = /\b(later|hours? (?:pass|passed|later|go by|went by)|(?:next|following) (?:morning|day|evening|night|week|month)|the following|by (?:dawn|morning|nightfall|evening|noon)|at dawn|overnight|days? (?:later|passed|go by|went by)|weeks? (?:later|passed)|months? (?:later|passed)|years? (?:later|passed)|time skip|time passes|after a (?:while|long while)|slept|wakes?|woke|sunrise|sunset|tomorrow)\b/i;
const NEXT_DAY = /\b((?:the )?(?:next|following) (?:morning|day)|days? later|weeks? later|months? later|the morning after|the day after)\b/i;
const FLASHBACK = /\b(remember(?:s|ed)?|years ago|back then|flashback|memory of|once,? long ago|as a child|in the past)\b/i;

export function timelineIssues(chatId: string, messageId: string): Omit<Issue, "id">[] {
  const cfg = guardsFor(chatId);
  if (!cfg.timeline) return [];
  const m = getMessageRow(messageId);
  if (!m || m.deleted_at || m.role === "system") return [];
  const sw = one<{ content: string; meta: string }>("SELECT content, meta FROM swipes WHERE message_id = ? AND idx = ?", messageId, m.active_swipe);
  if (!sw?.content.trim()) return [];
  let before: number | null = null;
  let after: number | null = null;
  let form: "day" | "date" = "day";
  try {
    before = foldAt(chatId, { uptoSeq: m.seq - 1 }).state.time?.minutes ?? null;
    const t = foldAt(chatId, { uptoSeq: m.seq }).state.time;
    after = t?.minutes ?? null;
    form = t?.form ?? form;
  } catch {
    return [];
  }
  if (before == null || after == null) return [];
  // M27: in the chat's own calendar ("Thu, 14 March 2026 · 21:40"), not "day 739,685".
  const calendar = trackerConfig(chatId).calendar;
  const clock = (minutes: number) => describeWhen({ minutes, form }, calendar).label;
  const text = cleanText(sw.content);
  const delta = after - before;
  const cite = (label: string) => [{ ref: "T", type: "tracker" as const, label, messageId, seq: m.seq }];
  const out: Omit<Issue, "id">[] = [];
  // The trackers refuse to run the clock backwards; a refused clock line means the reply went back in time.
  const verdicts = currentFold(chatId).result.verdicts;
  const refused = eventsOf(chatId, messageId).find((ev) => (ev.swipeIdx === m.active_swipe || ev.swipeIdx === -1) && ev.op.op === "clock" && verdicts[ev.id] && !verdicts[ev.id]!.ok && /backwards/.test(verdicts[ev.id]!.reason ?? ""));
  if (refused && !FLASHBACK.test(text))
    out.push({
      kind: "timeline",
      severity: "major",
      claim: `The reply's time (${String(refused.op.args.set ?? refused.op.raw).replace(/^clock:\s*/i, "")}) is earlier than the story clock (${clock(before)}).`,
      conflict: "Time can't run backwards, and the reply doesn't read as a flashback. The clock kept its time.",
      citations: cite(`story clock before this reply: ${clock(before)}`),
      fix: `It's ${clock(before)} or later; time doesn't go back.`,
      by: "rules",
    });
  else if (delta < 0 && !FLASHBACK.test(text))
    out.push({
      kind: "timeline",
      severity: "major",
      claim: `The clock went from ${clock(before)} back to ${clock(after)}.`,
      conflict: `Time ran backwards by ${describeMinutes(-delta)}, and the reply doesn't read as a flashback.`,
      citations: cite(`story clock before this reply: ${clock(before)}`),
      fix: `Time can't go backwards: it's ${clock(before)} or later.`,
      // M27: only the clock moves; a memory about the time would bury true ones on a shared word.
      canon: { trackerLine: `clock: +${-delta}m` },
      by: "rules",
    });
  else if (delta > cfg.maxJumpHours * 60 && !SKIP.test(text))
    out.push({
      kind: "timeline",
      severity: "minor",
      claim: `The clock jumped ${describeMinutes(delta)} (${clock(before)} → ${clock(after)}).`,
      conflict: `Nothing in the reply says that much time passed.`,
      citations: cite(`story clock before this reply: ${clock(before)}`),
      fix: `Only a little time passes in this scene; it's still around ${clock(before)}.`,
      by: "rules",
    });
  else if (delta >= 0 && delta < 180) {
    const said = text.match(NEXT_DAY)?.[0];
    if (said)
      out.push({
        kind: "timeline",
        severity: "minor",
        claim: said,
        conflict: `The reply moves on ("${said}"), but the story clock only moved ${delta ? describeMinutes(delta) : "not at all"} (${clock(after)}).`,
        citations: cite(`story clock after this reply: ${clock(after)}`),
        fix: `It's still ${clock(after)}; don't skip ahead to another day.`,
        canon: { trackerLine: `clock: +${1440 - (((after % 1440) + 1440) % 1440) + 8 * 60}m` },
        by: "rules",
      });
  }
  // A clock the prose reads aloud ("the kitchen clock ticks toward 16:50") against the story clock.
  const read = out.length || FLASHBACK.test(text) ? null : misreadClock(text, before, after);
  if (read)
    out.push({
      kind: "timeline",
      severity: "minor",
      claim: read.said,
      conflict: `The reply reads the time as ${read.time}, but the story clock says ${clock(after)}.`,
      citations: cite(`story clock after this reply: ${clock(after)}`),
      fix: `It's ${clock(after)}.`,
      by: "rules",
    });
  return out;
}

const READING = /\b(?:clocks?|watch|phone|display)\b[^.!?\n]{0,120}?\b(\d{1,2}):(\d{2})\b|\bit(?:'s|’s| is)\s+(?:already\s+|nearly\s+|almost\s+|just\s+)?(?:past\s+)?(\d{1,2}):(\d{2})\b/gi;
/** How far a clock reading may sit outside the reply's span of story time before it's a slip. */
const READ_SLACK = 15;

/** The first clock reading in the prose that sits more than a quarter hour outside the reply's span of story time. */
export function misreadClock(text: string, before: number, after: number): { said: string; time: string } | null {
  const lo = Math.min(before, after) - READ_SLACK;
  const hi = Math.max(before, after) + READ_SLACK;
  for (const m of text.matchAll(READING)) {
    const h = Number(m[1] ?? m[3]);
    const min = Number(m[2] ?? m[4]);
    // A timer or a countdown shows how long, not what time it is.
    if (h > 23 || min > 59 || /\b(?:timer|countdown|stopwatch)\b/i.test(m[0])) continue;
    // "5:50" may be the afternoon's; read a 12-hour time both ways.
    const day = [h * 60 + min, ...(h <= 12 ? [((h + 12) % 24) * 60 + min] : [])];
    let off = Infinity;
    for (let d = Math.floor(lo / 1440) - 1; d <= Math.floor(hi / 1440) + 1; d++)
      for (const c of day) {
        const at = d * 1440 + c;
        off = Math.min(off, at < lo ? lo - at : at > hi ? at - hi : 0);
      }
    if (off > 0) return { said: m[0].trim(), time: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` };
  }
  return null;
}
