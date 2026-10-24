import { contentWords } from "../memory/text";
import type { WorldState } from "./types";

/**
 * What a text is about, for matching it to the records (docs/19): FACTS IN PLAY and the plan check.
 * Words weigh by how rare they are among the records, so "socks" picks the socks and "bought"
 * alone (in every errand) picks nothing, times how often the text says them.
 */

/** Words of talk and narration that never say what a message is about. */
const PROSE = new Set(
  "actually really maybe okay yeah wait asks asked tells told tell says know knows knew think thinks thought want wants wanted every something anything nothing everything always thing things look looks looked back right well gonna going come comes came gets take takes took make makes made give gives gave first last next today tonight".split(" "),
);

/** Content words with how often each comes up, plurals folded ("socks" meets "sock"), names of the cast left out. */
export function topicCounts(st: WorldState, text: string) {
  const names = new Set(Object.values(st.chars).flatMap((c) => [c.name, ...c.aliases].flatMap((n) => n.toLowerCase().split(/\s+/))));
  const out = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []) {
    const w = raw.replace(/'s$/, "").replace(/['-]+$/, "");
    if (!contentWords(w, 4).size || names.has(w) || PROSE.has(w)) continue;
    const k = w.length > 4 ? w.replace(/s$/, "") : w;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

export const topicWords = (st: WorldState, text: string) => new Set(topicCounts(st, text).keys());

/**
 * Scores texts against a set of records (their texts). A hit needs a word in at most three of
 * the records, or several commoner ones (`enough`).
 */
export function topicScorer(st: WorldState, records: string[]) {
  const words = records.map((t) => topicWords(st, t));
  const df = new Map<string, number>();
  for (const ws of words) for (const w of ws) df.set(w, (df.get(w) ?? 0) + 1);
  const n = Math.max(1, records.length);
  return {
    /** Each record's words, in the order given. */
    words,
    enough: Math.log(n / 3),
    /** How much `want` (a text's topic counts) is about a record with these words. */
    score(want: Map<string, number>, of: Set<string>) {
      let s = 0;
      for (const w of of) if (want.has(w)) s += Math.log(n / (df.get(w) ?? 1)) * want.get(w)!;
      return s;
    },
  };
}
