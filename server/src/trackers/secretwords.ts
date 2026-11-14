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

/** A name as the tracker writes one: one to three capitalised words ("Walter", "Dawn Summers"), or a word for everyone. */
const WHO = String.raw`(?:\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*){0,2}|anyone|everyone|everybody|nobody)`;
const ONE = String.raw`(\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*){0,2})`;
const WHOM = String.raw`(${WHO}(?:(?:\s*,\s*|\s+(?:and|or|&)\s+)${WHO})*)`;
const SHAPES: { re: RegExp; keep: number[]; from: number; what: number; teller: number }[] = [
  // "Buffy asks Gabriel not to tell Walter she is alive", "Buffy makes Gabriel promise never to tell Dawn that …"
  { re: new RegExp(String.raw`^${ONE}\s+(?:asks?|asked|begs?|begged|tells?|told|makes?|made|gets?|got|swears?|swore)\s+${ONE}\s+(?:to\s+)?(?:promise\s+|swear\s+)?(?:not\s+to|to\s+not|never\s+to)\s+(?:tell|say\s+(?:anything\s+)?to|let\s+on\s+to|mention\s+(?:it\s+)?to)\s+${WHOM}\s+(?:that\s+|about\s+)?(.+)$`, "u"), keep: [1, 2], from: 3, what: 4, teller: 1 },
  // "Mira hides the ledger from Joss", "Buffy is keeping it from Dawn that she was in heaven"
  { re: new RegExp(String.raw`^${ONE}\s+(?:is\s+|has\s+been\s+)?(?:hides?|hid|hiding|keeps?|kept|keeping)\s+(?:it\s+)?(?:a\s+secret\s+)?(?:that\s+)?(.+?)\s+from\s+${WHOM}$`, "u"), keep: [1], from: 3, what: 2, teller: 1 },
  { re: new RegExp(String.raw`^${ONE}\s+(?:is\s+|has\s+been\s+)?(?:hiding|keeping)\s+(?:it\s+)?from\s+${WHOM}\s+that\s+(.+)$`, "u"), keep: [1], from: 2, what: 3, teller: 1 },
  // "Buffy hasn't told Dawn she was in heaven", "Buffy doesn't want Walter to know she is alive"
  { re: new RegExp(String.raw`^${ONE}\s+(?:hasn['’]t|has\s+not|has\s+never|never|didn['’]t|did\s+not)\s+(?:told|tell)\s+${WHOM}\s+(?:that\s+|about\s+)?(.+)$`, "u"), keep: [1], from: 2, what: 3, teller: 1 },
  { re: new RegExp(String.raw`^${ONE}\s+(?:doesn['’]t|does\s+not|don['’]t|won['’]t|will\s+not)\s+(?:want\s+${WHOM}\s+to\s+know|let\s+${WHOM}\s+know)\s+(?:that\s+|about\s+)?(.+)$`, "u"), keep: [1], from: 2, what: 4, teller: 1 },
];

export interface SecretShape {
  /** The hidden truth, in a plain sentence: "Buffy is alive". */
  statement: string;
  keepers: string[];
  from: string[];
  /** The sentence it was written as, kept as the reason. */
  said: string;
}

/**
 * docs/35 1.2: a secret written as what happened ("Buffy asks Gabriel not to tell Walter she is alive,
 * not yet") as the secret it is (Buffy is alive | kept by Buffy, Gabriel · from Walter). Null when the
 * sentence isn't one of these shapes; then it's stored as written.
 */
export function secretShape(sentence: string): SecretShape | null {
  const s = sentence.trim().replace(/[.!]+$/, "");
  for (const [i, shape] of SHAPES.entries()) {
    const m = shape.re.exec(s);
    if (!m) continue;
    const teller = m[shape.teller]!;
    // The last shape has two places for whom ("want X to know", "let X know"): whichever matched.
    const whom = m[shape.from] ?? (i === SHAPES.length - 1 ? m[3] : undefined);
    let what = (m[shape.what] ?? "")
      .trim()
      .replace(/[,;]?\s*(?:not yet|yet|for now|for the moment|just yet|until [^,]+|at least not yet)\s*$/i, "")
      .trim();
    if (!whom || !what) continue;
    if (!CLAUSE.test(what)) {
      // "hides the ledger from Joss": a thing, not a sentence. Hiding a thing is the secret; anything else is stored as written.
      if (i !== 1) return null;
      what = `${teller} is hiding ${what}`;
    }
    // "her sister" after "tell Dawn": whose sister isn't clear, so it's stored as written.
    if (/^(?:her|his|their)\b/i.test(what)) return null;
    what = what.replace(/^(?:she|he|they)\b/i, teller);
    return { statement: what.charAt(0).toUpperCase() + what.slice(1), keepers: shape.keep.map((k) => m[k]!).filter(Boolean), from: splitNames(whom), said: sentence.trim() };
  }
  return null;
}

/** Whether words say something (a verb) rather than name a thing: "she is alive", "Dawn died twice", not "the heaven thing". */
const CLAUSE = /\b(?:is|was|are|were|am|has|had|have|did|does|do|can|could|will|would|isn['\u2019]t|wasn['\u2019]t|can['\u2019]t|won['\u2019]t|died|lied|\w{2,}ed)\b|^(?:she|he|they|it)\s+\w+/i;

const splitNames = (s: string) => s.split(/\s*,\s*|\s+(?:and|or|&)\s+/).map((x) => x.trim()).filter(Boolean);

/** docs/35 1.3: the person a statement is said of, when it opens with their name ("Buffy is alive"), never "Buffy's mother …". */
export function subjectName(statement: string, names: string[]): string | undefined {
  const s = statement.trim();
  return names
    .filter((n) => n.length > 1)
    .sort((a, b) => b.length - a.length)
    .find((n) => s.toLowerCase().startsWith(`${n.toLowerCase()} `) && !/^['’]s\b/.test(s.slice(n.length)));
}
