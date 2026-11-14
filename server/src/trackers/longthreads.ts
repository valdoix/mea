import { all } from "../db/db";
import { badRequest } from "../lib/http";
import { memState, setMemState } from "../memory/store";
import { hashText } from "../memory/text";
import { mustChat } from "../services/chats";
import { formatStoryTime, shortStoryTime, weekdayOf } from "./clock";
import { openLoops } from "./loops";
import { currentFold } from "./store";
import type { Loop, WorldState } from "./types";

/**
 * Long threads (docs/33 Part 9). In Buffy × Gabriel the parents' visit "next week", the rings "this
 * week", the audit, Willow's apology and the heaven secret were all still open at #900, and none of
 * them was in a plan: errands are many and small, and the newest won. This is the short list beside
 * them: promises and plans with a day, open conflicts, secrets still kept, and what you pin. The
 * planner sees it every turn, the state block shows its top few, and on the day a dated one comes
 * due it goes into the plan's threads whether the planner picked it or not.
 */

const DAY = 1440;
/** A dated thread that has passed stays on the list this long, asking whether it happened. */
const PASSED_FOR = 2 * DAY;
/** How close a dated thread's day has to be to count as coming up. */
const SOON = 3 * DAY;
const MAX = 10;
/** No one kind crowds out the rest. */
const PER_KIND: Partial<Record<LongKind | LongWhen, number>> = {
  conflict: 3,
  secret: 2,
  passed: 2,
};
const DAYWORDS =
  /^(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|tonight|tomorrow|morning|night|evening|afternoon|school|week|weekend|next|this|after|before|with|from|their|they|them|then|that|there|every|starting|first|again|must|will|have|been|when|what|said|about|into|only|some|more|just|like|over|without|nothing|eventually|always|never|still|back|come|comes|make|takes?|tell|gets?)$/;

export interface Window {
  from: number;
  to: number;
  /** The words it was dated by ("next week", "Saturday night"). */
  text: string;
}

export type LongKind = "promise" | "plan" | "conflict" | "secret" | "pinned";
export type LongWhen = "today" | "passed" | "soon" | "later" | "open";

export interface LongThread {
  /** A loop's id ("L1a2b3"), a secret's ("S…") or a pin's ("P…"): a plan can name it. */
  id: string;
  kind: LongKind;
  text: string;
  when: LongWhen;
  due?: Window;
  /** The message it was said at. */
  seq: number;
  /** For a secret: who it's still kept from. */
  from?: string[];
}

export interface LongPin {
  id: string;
  text: string;
  seq: number;
  /** When you said it's for ("Friday", "next week"), dated from when you pinned it. */
  due?: string;
}

const WEEKDAY = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const WEEKDAY_RE =
  /\b(next\s+|this\s+|on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/i;
const NUM: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  ten: 10,
  fourteen: 14,
};

/**
 * The days some words point to, said at `anchor` (story minutes): "tonight", "tomorrow", "Saturday
 * night", "next Sunday", "this week", "next week", "this weekend", "in three days". A calendar
 * clock knows weekdays; a day-count clock ("Day 3") only the rest. "Every Friday" is a routine, not
 * a day, and gets none.
 */
export function dateWindow(
  text: string,
  anchor: number,
  form: "date" | "day" = "date",
): Window | null {
  const t = text.toLowerCase();
  const day0 = Math.floor(anchor / DAY) * DAY;
  const days = (from: number, n = 1, said = "") => ({
    from: day0 + from * DAY,
    to: day0 + (from + n) * DAY - 1,
    text: said,
  });
  const said = (re: RegExp) => text.match(re)?.[0]?.trim() ?? "";
  if (
    /\b(?:every|each)\s+(?:\w+\s+)?(?:day|night|morning|week|weekend|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(
      t,
    )
  )
    return null;
  if (/\btonight\b|\bthis (?:evening|afternoon)\b/.test(t))
    return days(0, 1, said(/\btonight\b|\bthis (?:evening|afternoon)\b/i));
  if (/\btomorrow\b/.test(t))
    return days(
      1,
      1,
      said(/\btomorrow(?:\s+(?:morning|night|evening|afternoon))?\b/i),
    );
  const inN = t.match(
    /\bin\s+(a|an|one|two|three|four|five|six|seven|ten|fourteen|\d{1,2})\s+(day|week)s?\b/,
  );
  if (inN) {
    const n = (NUM[inN[1]!] ?? Number(inN[1])) * (inN[2] === "week" ? 7 : 1);
    return days(n, 1, inN[0]);
  }
  // Weeks run Monday to Sunday.
  const wd = form === "date" ? weekdayOf(anchor) : null;
  const toSunday = wd == null ? 6 : (7 - wd) % 7;
  if (
    /\bthis week\b|\bby the end of the week\b|\bend of (?:the|this) week\b/.test(
      t,
    )
  )
    return {
      from: anchor,
      to: day0 + (toSunday + 1) * DAY - 1,
      text: said(
        /\bthis week\b|\b(?:by )?(?:the )?end of (?:the|this) week\b/i,
      ),
    };
  if (/\bnext week\b/.test(t)) return days(toSunday + 1, 7, "next week");
  if (wd != null && /\b(?:this|the) weekend\b/.test(t)) {
    const toSat = (6 - wd + 7) % 7;
    return wd === 0
      ? days(0, 1, "this weekend")
      : days(toSat, 2, said(/\b(?:this|the) weekend\b/i));
  }
  if (wd != null && /\bnext weekend\b/.test(t))
    return days(toSunday + 6, 2, "next weekend");
  const w = wd != null ? t.match(WEEKDAY_RE) : null;
  if (w && wd != null) {
    const target = WEEKDAY.indexOf(w[2]!);
    let ahead = (target - wd + 7) % 7;
    // "next Sunday" said on a Saturday is the one after tomorrow's.
    if (/next/.test(w[1] ?? "") && ahead <= 1) ahead += 7;
    return days(
      ahead,
      1,
      said(
        new RegExp(
          `\\b(?:next\\s+|this\\s+|on\\s+)?${w[2]}s?(?:\\s+(?:morning|night|evening|afternoon|after school))?\\b`,
          "i",
        ),
      ),
    );
  }
  return null;
}

/** Where a dated thread stands now. */
export function whenOf(w: Window, now: number): LongWhen | null {
  // A day (or a week) comes due on its last day: "this week" isn't nagged about from Monday.
  if (now > w.to) return now - w.to <= PASSED_FOR ? "passed" : null;
  if (now >= Math.max(w.from, w.to - DAY + 1)) return "today";
  return w.from - now <= SOON ? "soon" : "later";
}

/** Fights, grudges and reckonings still open: Willow's apology, the Council's anger, the audit. */
const CONFLICT =
  /\b(?:apologi[sz]e[sd]?|apology|angry|anger|unhappy|furious|fight|fought|feud|betray\w*|grudge|wronged|blame[sd]?|confront\w*|audit|lawsuit|sue[sd]?|threat\w*|broken|estranged|revenge|unforgiv\w*|rift|falling[- ]out|reckoning|resent\w*)\b/i;

/** The story minute of each message, latest first known at or before a seq. */
function clockAt(chatId: string): (seq: number) => number | null {
  let times: Record<string, string | null> = {};
  try {
    times = currentFold(chatId).times;
  } catch {
    return () => null;
  }
  const seqs: number[] = [];
  const mins: number[] = [];
  for (const r of all<{ id: string; seq: number }>(
    "SELECT id, seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY seq",
    chatId,
  )) {
    const t = times[r.id];
    if (t) {
      seqs.push(r.seq);
      mins.push(Number(t.split(":")[0]));
    }
  }
  return (seq: number) => {
    let lo = 0;
    let hi = seqs.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (seqs[mid]! <= seq) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best >= 0 ? mins[best]! : null;
  };
}

const pinsOf = (chatId: string): LongPin[] => memState(chatId).longPins ?? [];

/** A loop's day: its own due time, else the words it was said with, read from when it was said. */
function loopWindow(
  l: Loop,
  at: (seq: number) => number | null,
  form: "date" | "day",
): Window | null {
  if (l.repeats) return null;
  if (l.due?.minutes != null) {
    const d = l.due.minutes;
    return { from: Math.floor(d / DAY) * DAY, to: d + 120, text: l.due.text };
  }
  const anchor = at(l.opened);
  if (anchor == null) return null;
  return (
    (l.due?.text ? dateWindow(l.due.text, anchor, form) : null) ??
    dateWindow(l.what, anchor, form)
  );
}

/**
 * The story's long threads as they stand in `st`, most pressing first: what's due today, what has
 * just passed, what you pinned, what's coming up, then open conflicts and kept secrets, then the
 * rest that has a day. At most eight.
 */
export function longThreads(chatId: string, st: WorldState): LongThread[] {
  const now = st.time?.minutes ?? null;
  const form = st.time?.form ?? "day";
  const at = clockAt(chatId);
  const out: LongThread[] = [];
  for (const l of openLoops(st)) {
    const w = now != null ? loopWindow(l, at, form) : null;
    const when = w && now != null ? whenOf(w, now) : null;
    if (w && when) {
      out.push({
        id: l.id,
        kind: l.kind === "promise" ? "promise" : "plan",
        text: l.what,
        when,
        due: w,
        seq: l.opened,
      });
    } else if (!w && CONFLICT.test(l.what) && !l.repeats) {
      out.push({
        id: l.id,
        kind: "conflict",
        text: l.what,
        when: "open",
        seq: l.opened,
      });
    }
  }
  for (const [key, f] of Object.entries(st.facts)) {
    if (!f.secret || f.secret.out) continue;
    const told = new Set(f.revealed.flatMap((r) => r.to));
    const from = [...new Set(f.secret.from)].filter((id) => {
      const c = st.chars[id];
      const s = f.stances[id]?.status;
      return (
        c &&
        !c.isUser &&
        !told.has(id) &&
        s !== "knows" &&
        s !== "believes" &&
        s !== "heard"
      );
    });
    if (!from.length) continue;
    out.push({
      id: `S${hashText(key).slice(0, 5)}`,
      kind: "secret",
      text: f.statement,
      when: "open",
      seq: f.firstSeq,
      from: from.map((id) => st.chars[id]!.name),
    });
  }
  for (const p of pinsOf(chatId)) {
    const anchor = at(p.seq);
    const w = p.due && anchor != null ? dateWindow(p.due, anchor, form) : null;
    const when = w && now != null ? whenOf(w, now) : null;
    // A pin stays until you take it off, even after its day.
    out.push({
      id: p.id,
      kind: "pinned",
      text: p.text,
      when: when ?? "open",
      ...(w ? { due: w } : {}),
      seq: p.seq,
    });
  }
  const rank = (t: LongThread) => {
    if (t.when === "today") return 0;
    if (t.when === "passed") return 1;
    if (t.kind === "pinned") return 2;
    if (t.when === "soon") return 3;
    if (t.kind === "conflict") return 4;
    if (t.kind === "secret") return 5;
    return 6;
  };
  // Within a rank: the sooner day first, else the newer; a promise before a plan of the same day.
  // A secret kept from more people weighs more.
  out.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.due && b.due ? a.due.to - b.due.to : 0) ||
      (b.from?.length ?? 0) - (a.from?.length ?? 0) ||
      Number(b.kind === "promise") - Number(a.kind === "promise") ||
      b.seq - a.seq,
  );
  // One thing said three ways on one day ("cooking lessons Monday", "watch Dawn's first lesson
  // Monday", "teaches Buffy to cook too, starting Monday") is one thread; so are two lines about one audit.
  const names = new Set(
    Object.values(st.chars).flatMap((c) => c.name.toLowerCase().split(/\s+/)),
  );
  const stems = (t: string) =>
    new Set(
      (t.toLowerCase().match(/\p{L}{4,}/gu) ?? [])
        .filter((w) => !DAYWORDS.test(w) && !names.has(w))
        .map((w) => w.slice(0, 4)),
    );
  const kept: LongThread[] = [];
  const count: Record<string, number> = {};
  for (const t of out) {
    const alike = (k: LongThread) =>
      t.due
        ? Boolean(k.due && k.due.from === t.due.from && k.due.to === t.due.to)
        : t.kind === "conflict" && k.kind === "conflict";
    const same = kept.some(
      (k) => alike(k) && [...stems(k.text)].some((w) => stems(t.text).has(w)),
    );
    const cap = PER_KIND[t.when === "passed" ? "passed" : t.kind];
    const key = t.when === "passed" ? "passed" : t.kind;
    if (same || (cap != null && (count[key] ?? 0) >= cap)) continue;
    count[key] = (count[key] ?? 0) + 1;
    kept.push(t);
  }
  return kept.slice(0, MAX);
}

const WHEN: Record<LongWhen, string> = {
  today: "due today",
  passed: "its day passed and nothing on the page closed it",
  soon: "coming up",
  later: "later",
  open: "",
};

/** One line of the list, as the planner and the writer read it. */
export function longLine(t: LongThread, form: "date" | "day" = "date") {
  const day = t.due
    ? `${t.due.text || shortStoryTime(formatStoryTime({ minutes: t.due.to, form }))}`
    : "";
  const label = [
    t.kind === "pinned" ? "pinned by the player" : t.kind,
    day && t.when !== "open" ? `${day}, ${WHEN[t.when]}` : WHEN[t.when],
  ]
    .filter(Boolean)
    .join(", ");
  const from = t.from?.length
    ? ` (kept from ${t.from.slice(0, 5).join(", ")}${t.from.length > 5 ? ", …" : ""})`
    : "";
  return `[${t.id}] ${label}: ${t.text}${from}`;
}

/** The ids due today, as plan threads read them (the loop's words, or the pin's or secret's). */
export function dueToday(threads: LongThread[]) {
  return threads.filter((t) => t.when === "today");
}

/** Every id the list holds, with its words: a plan may name any of them. */
export function longIds(threads: LongThread[]) {
  return new Map(threads.map((t) => [t.id, t.text]));
}

/** For the panel beside the open loops. */
export function longThreadsFor(chatId: string) {
  mustChat(chatId);
  const st = currentFold(chatId).result.state;
  const form = st.time?.form ?? "day";
  return longThreads(chatId, st).map((t) => ({
    id: t.id,
    kind: t.kind,
    text: t.text,
    when: t.when,
    due: t.due
      ? t.due.text ||
        shortStoryTime(formatStoryTime({ minutes: t.due.to, form }))
      : null,
    seq: t.seq,
    from: t.from ?? [],
  }));
}

/** Pins a thread of your own ("the rings", due "this week") so it stays on the list until you take it off. */
export function pinLong(chatId: string, text: string, due?: string) {
  mustChat(chatId);
  const what = text.replace(/\s+/g, " ").trim();
  if (!what) throw badRequest("Write what the thread is");
  const seq =
    all<{ s: number | null }>(
      "SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL",
      chatId,
    )[0]?.s ?? 0;
  const pin: LongPin = {
    id: `P${hashText(what.toLowerCase()).slice(0, 5)}`,
    text: what.slice(0, 300),
    seq,
    ...(due?.trim() ? { due: due.trim().slice(0, 60) } : {}),
  };
  setMemState(chatId, {
    longPins: [...pinsOf(chatId).filter((p) => p.id !== pin.id), pin],
  });
  return longThreadsFor(chatId);
}

export function unpinLong(chatId: string, id: string) {
  mustChat(chatId);
  setMemState(chatId, { longPins: pinsOf(chatId).filter((p) => p.id !== id) });
  return longThreadsFor(chatId);
}
