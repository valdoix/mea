import { hashText } from "../memory/text";
import type { Loop, Op, WorldState } from "./types";

/**
 * A loop is something the story expects to happen: a promise, a plan, an errand, a question someone
 * owes an answer to (docs/22 Part 1). One commitment used to be many strings: at #629 "say the word"
 * was a promise, 17 open-list items and 16 memories, none pointing at another, so closing one closed
 * nothing, and of 25 times a promise was marked kept, 12 were you, by hand. A loop has one id, and
 * closing it happens once. Threads stay as they are: most carry a mood, and never end.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/** From the words it was opened with, so a swipe or an edit elsewhere can never renumber it. */
export const loopId = (what: string) => `L${hashText(norm(what)).slice(0, 5)}`;

/** "Tacos every Friday": one instance closes, and the loop stays open. */
export const repeats = (what: string) => /\b(?:every|each|weekly|daily|nightly)\b/i.test(what);

/** What's open, the newest last. */
export const openLoops = (st: WorldState | null | undefined): Loop[] =>
  Object.values(st?.loops ?? {})
    .filter((l) => l.status === "open")
    .sort((a, b) => a.opened - b.opened);

/** What's done and over: a loop that repeats is never done. */
export const doneLoops = (st: WorldState | null | undefined): Loop[] =>
  Object.values(st?.loops ?? {})
    .filter((l) => l.status === "done" && !l.repeats && l.closed != null)
    .sort((a, b) => a.closed! - b.closed!);

/** What's open and past its time on the clock. One that repeats just comes round again. */
export const pastDue = (st: WorldState | null | undefined): Loop[] => {
  const now = st?.time?.minutes;
  return now == null ? [] : openLoops(st).filter((l) => !l.repeats && l.due?.minutes != null && l.due.minutes < now);
};

const plain = (s: string) => s.toLowerCase().replace(/&nbsp;/g, " ").replace(/[*_~"“”'‘’«»`]/g, "").replace(/[—–-]+/g, " ").replace(/\s+/g, " ").trim();

/** Whether a closing line is really in the text: quote marks, emphasis and spacing aside. */
export const quoted = (text: string, quote: string | undefined) => {
  const q = plain(quote ?? "");
  return q.length >= 6 && plain(text).includes(q);
};

/** A loop closes on the words that close it, or it stays open. */
export const closingOps = (ops: Op[], text: string) => ops.filter((op) => op.op !== "loop" || op.args.action !== "done" || quoted(text, op.args.how));
