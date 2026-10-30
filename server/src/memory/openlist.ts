import { all, parseJson } from "../db/db";
import { topicCounts } from "../trackers/topics";
import type { WorldState } from "../trackers/types";

/**
 * What a summary left open was open then. The Story So Far only moves when an arc closes, so at
 * #629 it still said the "I love you" was "still unsaid, due tonight", 87 messages after Buffy said
 * it, and the planner set it for that night. The scene records knew: each lists what it closed
 * ("Buffy's promise to say 'I love you' tonight… fulfilled"), but only what it left open reached a
 * prompt. So a record says what closed in it, its open list reads as of its last message, and an
 * item a later record clearly closed comes off that list. All at render time: nothing stored
 * changes, and a rewind or a swipe takes the closure with it.
 */

export interface Done {
  /** What was finished, in the words of the record that says so. */
  text: string;
  seq: number;
  /** A kept promise: a scene says when a thing really closed, and a promise's few words ("offer him the hills house") fit other threads. */
  strict?: boolean;
}

export type DoneMatch = (text: string, after: number) => Done | null;

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
  for (const o of Object.values(st?.obligations ?? {})) {
    if ((o.status === "kept" || o.status === "paid") && o.settled != null) out.push({ text: `${o.status === "kept" ? "Promise kept" : "Paid"}: ${o.what}`, seq: o.settled, strict: true });
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
  return (text, after) => {
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

/** Every open item a later record closed, in its own words: what a plan built on a stale list repeats. */
export function closedItems(chatId: string, match: DoneMatch): (Done & { closed: Done })[] {
  const out = new Map<string, Done & { closed: Done }>();
  for (const r of all<{ end_seq: number; data: string }>("SELECT end_seq, data FROM summaries WHERE chat_id = ? AND end_seq IS NOT NULL AND TRIM(content) != ''", chatId)) {
    const d = parseJson<{ threadsOpened?: string[]; openThreads?: string[] }>(r.data, {});
    for (const text of [...(d.threadsOpened ?? []), ...(d.openThreads ?? [])]) {
      const closed = match(text, r.end_seq);
      if (closed && !out.has(text)) out.set(text, { text, seq: closed.seq, closed });
    }
  }
  return [...out.values()];
}

const OPEN_LINE = /^(Left open|Still open): (.*)$/m;

/**
 * A record as it reads now: what closed in it (a chapter or a scene, from `start`), its open list
 * "as of" its last message, and what later records closed off that list, each said once (`shown`).
 */
export function openAsOf(content: string, end: number, done: Done[], match: DoneMatch, shown = new Set<string>(), start?: number) {
  const fresh = (d: Done) => !shown.has(d.text) && Boolean(shown.add(d.text));
  const here = start == null ? [] : done.filter((d) => !d.strict && d.seq >= start && d.seq <= end).slice(-CLOSED_MAX).filter(fresh);
  const closed = here.length ? `Closed here: ${here.map((d) => d.text).join("; ")}` : "";
  const m = content.match(OPEN_LINE);
  if (!m) return closed ? `${content}\n${closed}` : content;
  const since = new Map<string, Done>();
  const left = m[2]!.split(/;\s+/).filter((item) => {
    const d = match(item, end);
    if (d) since.set(d.text, d);
    return !d;
  });
  const told = [...since.values()].filter(fresh);
  const lines = [closed, left.length ? `${m[1]} as of #${end}: ${left.join("; ")}` : "", told.length ? `Done since: ${told.map((d) => `${d.text} (#${d.seq})`).join("; ")}` : ""].filter(Boolean);
  return content.replace(OPEN_LINE, () => lines.join("\n")).trim();
}
