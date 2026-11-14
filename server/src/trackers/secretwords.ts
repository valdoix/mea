import { contentWords } from "../memory/text";

/**
 * docs/35: what a secret's words are, and whether another sentence says the same thing.
 * Shared by the leak rule and the fold (a `know` line in other words reaching an open secret).
 */

/** Words about telling and knowing: every secret has them and so does ordinary talk, so they don't mark a secret's content ("asks", "tell"). */
export const TELLING = /^(?:asks?|asked|asking|tells?|told|telling|says?|said|saying|knows?|knew|known|knowing|keeps?|kept|keeping|hides?|hid|hidden|hiding|secret\w*|promis\w*|swears?|swore|sworn|learn\w*|finds?|found|thinks?|thought|believ\w*|mention\w*|whisper\w*|reveal\w*|admit\w*|confess\w*|wants?|wanted)$/;

/** A rough stem, so "clawed" meets "claws" and "stolen" meets "steal"s neighbours: endings off, never below four letters. */
export function stem(w: string) {
  let s = w.toLowerCase().replace(/['’]s$/, "");
  for (const end of ["ingly", "edly", "ing", "ed", "es", "s", "ly"]) {
    if (s.length - end.length >= 4 && s.endsWith(end)) {
      s = s.slice(0, -end.length);
      break;
    }
  }
  return s;
}

/** The words that carry a statement, stemmed, each with the word it came from: four letters or more, no names, no telling words. */
export function carryingWords(statement: string, names: Set<string> = new Set()): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of contentWords(statement, 4)) if (!names.has(w) && !TELLING.test(w)) out.set(stem(w), w);
  return out;
}

/** The stems that carry a statement. */
export function carrying(statement: string, names: Set<string> = new Set()) {
  return new Set(carryingWords(statement, names).keys());
}

/**
 * How much of a secret another statement says: the share of the secret's carrying words in it.
 * `strong` is half or more, with at least two; `some` is two words, or one long one (six letters or
 * more as the secret has it: "clawed", never "hand").
 */
export function secretMatch(secret: string, other: string, names: Set<string> = new Set()): { score: number; hits: string[]; strong: boolean; some: boolean } {
  const S = carryingWords(secret, names);
  const O = carrying(other, names);
  const hits = [...S.keys()].filter((w) => O.has(w));
  const score = S.size ? hits.length / S.size : 0;
  return { score, hits, strong: hits.length >= 2 && score >= 0.5, some: hits.length >= 2 || hits.some((h) => (S.get(h) ?? h).length >= 6) };
}
