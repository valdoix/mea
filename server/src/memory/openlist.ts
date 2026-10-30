import { all, parseJson } from "../db/db";
import { formatStoryTime, shortStoryTime } from "../trackers/clock";
import { doneLoops } from "../trackers/loops";
import { trackerConfig } from "../trackers/store";
import { topicCounts } from "../trackers/topics";
import type { WorldState } from "../trackers/types";
import type { AtomRow } from "./atoms";
import { TimeIndex } from "./format";
import type { SummaryRow } from "./store";

/**
 * What a summary left open was open then. The Story So Far only moves when an arc closes, so at
 * #629 it still said the "I love you" was "still unsaid, due tonight", 87 messages after Buffy said
 * it, and the planner set it for that night. The scene records knew: each lists what it closed
 * ("Buffy's promise to say 'I love you' tonight… fulfilled"), but only what it left open reached a
 * prompt. So a record says what closed in it, its open list reads as of its last message, and an
 * item a later record clearly closed comes off that list. All at render time: nothing stored
 * changes, and a rewind or a swipe takes the closure with it.
 *
 * This is the door: a model reads a summary through `summaryText` and a plan or promise memory
 * through `memoryText`, however it got there (doors.test.ts holds every other reader to a reason).
 */

export interface Done {
  /** What was finished, in the words of the record that says so. */
  text: string;
  seq: number;
  /** A closed loop: a scene says when a thing really closed, and a promise's few words ("offer him the hills house") fit other threads. */
  strict?: boolean;
  /** Wordings known to be it, so no matching is needed for them. */
  items?: string[];
}

export type DoneMatch = (text: string, after: number) => Done | null;

/** How a record reads as of now: what's been done since it, and which day a message fell on. */
export interface Lens {
  done: Done[];
  match: DoneMatch;
  /** The day of a message, or the one `plus` days after it: "Thu", "Day 3". */
  day: (seq: number, plus?: number) => string | null;
}

/** Records read as they were written, for where nothing is known yet. */
export const PLAIN: Lens = { done: [], match: () => null, day: () => null };

/** How many closed threads a chapter or scene lists: it has its own account of the rest. */
const CLOSED_MAX = 6;

/** Words every open thread has; sharing them says nothing about which one it is. */
const GENERIC = new Set("promise promised plan question answer need still open left unresolved pending finally done complete completed resolved fulfilled settled talk visit trip thing whether during".split(" "));
const PROMISED = /\b(?:promis|vow)/i;

/** What a text is about, for matching: hyphens split, the cast and the generic left out. */
function aboutWords(st: WorldState | null | undefined, text: string) {
  const out = new Set<string>();
  for (const raw of topicCounts({ chars: st?.chars ?? {} } as WorldState, text.replace(/[-‐–]/g, " ")).keys()) {
    const w = raw.replace(/ie$/, "y");
    if (!GENERIC.has(w)) out.add(w);
  }
  return out;
}

/** Scene records' closed threads, and promises kept or debts paid, oldest first. */
export function doneRecords(chatId: string, st: WorldState | null | undefined): Done[] {
  const out: Done[] = [];
  for (const s of all<{ end_seq: number; data: string }>("SELECT end_seq, data FROM summaries WHERE chat_id = ? AND level = 'scene' AND closed = 1 AND end_seq IS NOT NULL", chatId)) {
    for (const t of parseJson<{ threadsClosed?: string[] }>(s.data, {}).threadsClosed ?? []) if (t?.trim()) out.push({ text: t.trim(), seq: s.end_seq });
  }
  for (const l of doneLoops(st)) {
    const o = l.obligation ? st?.obligations[l.obligation] : undefined;
    out.push({ text: o ? `${o.status === "paid" ? "Paid" : "Promise kept"}: ${l.what}` : l.what, seq: l.closed!, strict: true, items: l.from });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

/**
 * Finds what closed an open item, after a message. A word counts for how few records have it. Most
 * of a thread's words is enough, or three of them, nearly half; less only when both sides name a
 * promise. Measured on 558 open items: below that, "the filing system" reads as a match.
 */
export function doneMatcher(st: WorldState | null | undefined, done: Done[]): DoneMatch {
  const words = done.map((d) => aboutWords(st, d.text));
  const df = new Map<string, number>();
  for (const ws of words) for (const w of ws) df.set(w, (df.get(w) ?? 0) + 1);
  const weight = (w: string) => 1 / Math.sqrt(df.get(w) ?? 1);
  const sum = (ws: Iterable<string>) => [...ws].reduce((n, w) => n + weight(w), 0);
  const known = new Map(done.flatMap((d) => (d.items ?? []).map((t) => [t, d] as const)));
  return (text, after) => {
    const sure = known.get(text);
    if (sure) return sure.seq > after ? sure : null;
    const item = aboutWords(st, text);
    const promised = PROMISED.test(text);
    let best: Done | null = null;
    let top = 0;
    done.forEach((d, i) => {
      if (d.seq <= after) return;
      const own = words[i]!;
      const shared = [...own].filter((w) => item.has(w));
      if (shared.length < (d.strict ? 3 : 2)) return;
      const score = sum(shared) / Math.min(sum(own), sum(item));
      const enough = score >= 0.5 || (shared.length >= 3 && score >= 0.4) || (promised && PROMISED.test(d.text) && score >= 0.33);
      if (enough && score > top) {
        top = score;
        best = d;
      }
    });
    return best;
  };
}

/** The lens for this chat, on the branch `st` is from. A calendar of the story's own has its own weekdays, so it goes undated. */
export function lensOf(chatId: string, st: WorldState | null | undefined, times = new TimeIndex(chatId)): Lens {
  const done = doneRecords(chatId, st);
  const form = st?.time?.form;
  const named = form === "day" || trackerConfig(chatId).calendar === "gregorian";
  const day = (seq: number, plus = 0) => {
    const at = times.at(seq);
    return at == null || !form || !named ? null : shortStoryTime(formatStoryTime({ minutes: at + plus * 1440, form })).replace(/\s*[· ]\s*\d{1,2}:\d{2}$/, "");
  };
  return { done, match: doneMatcher(st, done), day };
}

/** Every open item a later record closed, in its own words: what a plan built on a stale list repeats. */
export function closedItems(chatId: string, st: WorldState | null | undefined, match: DoneMatch): (Done & { closed: Done })[] {
  const out = new Map<string, Done & { closed: Done }>();
  for (const l of doneLoops(st)) for (const text of l.from) out.set(text, { text, seq: l.closed!, closed: { text: l.what, seq: l.closed! } });
  for (const r of all<{ end_seq: number; data: string }>("SELECT end_seq, data FROM summaries WHERE chat_id = ? AND end_seq IS NOT NULL AND TRIM(content) != ''", chatId)) {
    const d = parseJson<{ threadsOpened?: string[]; openThreads?: string[] }>(r.data, {});
    for (const text of [...(d.threadsOpened ?? []), ...(d.openThreads ?? [])]) {
      const closed = match(text, r.end_seq);
      if (closed && !out.has(text)) out.set(text, { text, seq: closed.seq, closed });
    }
  }
  return [...out.values()];
}

const RELATIVE = /\b(?:tonight|today|tomorrow|this (?:morning|afternoon|evening))\b(?!\s*\()/gi;

/** "Tonight" says which night: a stored "tonight" is the night it was written, and it reads as this one. */
function dated(text: string, seq: number, lens: Lens) {
  return text.replace(RELATIVE, (w) => {
    const day = lens.day(seq, /^tomorrow/i.test(w) ? 1 : 0);
    return day ? `${w} (${day})` : w;
  });
}

const OPEN_LINE = /^(Left open|Still open): (.*)$/m;

/**
 * A summary as a model reads it: what closed in it (a chapter or a scene), its open list "as of" its
 * last message and dated, and what later records closed off that list, each said once (`shown`).
 */
export function summaryText(r: Pick<SummaryRow, "content" | "level" | "start_seq" | "end_seq">, lens: Lens, shown = new Set<string>()) {
  const { done, match } = lens;
  const content = r.content.trim();
  const end = r.end_seq ?? 0;
  const fresh = (d: Done) => !shown.has(d.text) && Boolean(shown.add(d.text));
  const detailed = r.level === "scene" || r.level === "chapter";
  const here = detailed ? done.filter((d) => !d.strict && d.seq >= r.start_seq && d.seq <= end).slice(-CLOSED_MAX).filter(fresh) : [];
  const closed = here.length ? `Closed here: ${here.map((d) => d.text).join("; ")}` : "";
  const m = content.match(OPEN_LINE);
  if (!m) return closed ? `${content}\n${closed}` : content;
  const since = new Map<string, Done>();
  const left = m[2]!.split(/;\s+/).filter((item) => {
    const d = match(item, end);
    if (d) since.set(d.text, d);
    return !d;
  }).map((item) => dated(item, end, lens));
  const told = [...since.values()].filter(fresh);
  const lines = [closed, left.length ? `${m[1]} as of #${end}: ${left.join("; ")}` : "", told.length ? `Done since: ${told.map((d) => `${d.text} (#${d.seq})`).join("; ")}` : ""].filter(Boolean);
  return content.replace(OPEN_LINE, () => lines.join("\n")).trim();
}

/** A memory as a model reads it: a plan or a promise says which day it meant, and if it's been done since. */
export function memoryText(a: Pick<AtomRow, "content" | "type" | "max_seq">, lens: Lens) {
  if (a.type !== "plan" && a.type !== "promise") return a.content;
  const seq = a.max_seq ?? 0;
  const d = lens.match(a.content, seq);
  return `${dated(a.content, seq, lens)}${d ? ` (done since: ${d.text}, #${d.seq})` : ""}`;
}
