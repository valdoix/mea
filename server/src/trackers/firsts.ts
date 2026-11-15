import type { Character, Milestone } from "./types";

/**
 * Firsts that stay first. Buffy × Gabriel had the first "I love you" on record nine times (#249 to
 * #986): the ledger helper only saw the last ten milestones, and the fold only dropped a milestone
 * worded nearly the same. A milestone that claims a first is the same first as an earlier milestone
 * when it quotes the same words ("I love you", "love you") or is about the same thing in other
 * words ("the first night sharing a bed" after "their first full night in one bed"), between the
 * same people: "Dawn's first cooking lesson" and "Buffy's first cooking lesson, taught by Dawn" are two.
 */

/** A milestone that says it's a first. */
export const CLAIMS_FIRST = /\bfirst\b/i;

/** Words that say how a first happened, not what it was. */
const FILLER = new Set(
  "the and for with from that this was were has have had her his their them she they you are not but into onto over about first time ever real full one ones said says say spoken aloud out loud own both each other between together very whole truly finally".split(" "),
);

const words = (s: string) => (s.toLowerCase().replace(/['’]s\b/g, "").match(/[a-z]+/g) ?? []).filter((w) => w.length > 2);

/** The words a milestone quotes ("I love you"), lowercased; straight and curly quotes, double or single. */
export function quoted(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/["“]([^"“”]{2,60})["”]|(?:^|[\s(])['‘]([^'‘’]{2,60})['’](?=[\s,.;:!?)]|$)/g)) {
    const q = (m[1] ?? m[2] ?? "").toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();
    if (q) out.push(q);
  }
  return out;
}

/** Whole-word "love you" inside "i love you", either way round. */
const within = (a: string, b: string) => ` ${b} `.includes(` ${a} `) || ` ${a} `.includes(` ${b} `);

/** The named people a milestone is about: names in its text, or its who list. */
function people(m: { text: string; who?: string[] }, chars: Character[]): Set<string> {
  const out = new Set<string>();
  const text = ` ${m.text.toLowerCase().replace(/[^a-z'’ ]+/g, " ")} `;
  for (const c of chars) {
    const names = [c.name, c.name.split(/\s+/)[0]!, ...c.aliases].filter((n) => n && n.length > 2);
    if (names.some((n) => text.includes(` ${n.toLowerCase()} `) || text.includes(` ${n.toLowerCase()}'`) || text.includes(` ${n.toLowerCase()}’`))) out.add(c.id);
  }
  for (const w of m.who ?? []) if (chars.some((c) => c.id === w)) out.add(w);
  return out;
}

/** What the first is about: its words without names or how it happened. */
function about(text: string, chars: Character[]): Set<string> {
  const names = new Set(chars.flatMap((c) => [c.name, ...c.aliases].flatMap(words)));
  return new Set(words(text).filter((w) => !FILLER.has(w) && !names.has(w)));
}

/**
 * The earlier milestone a new first repeats, if any. Nobody named means the leads (the user's
 * character and the main one), so "the first 'I love you', hers then his" covers "between Gabriel
 * and Buffy". A first is the same only when everyone it names was in the earlier one.
 */
export function repeatsFirst(text: string, who: string[], earlier: Milestone[], chars: Character[]): Milestone | null {
  if (!CLAIMS_FIRST.test(text)) return null;
  const leads = new Set(chars.filter((c) => c.isUser || c.isMain).map((c) => c.id));
  const whom = (m: { text: string; who?: string[] }) => {
    const p = people(m, chars);
    return p.size ? p : leads;
  };
  const mine = whom({ text, who });
  const sameFolk = (m: Milestone) => {
    const theirs = whom(m);
    return [...mine].every((id) => theirs.has(id));
  };
  const q = quoted(text);
  const what = about(text, chars);
  for (const m of earlier) {
    if (!sameFolk(m)) continue;
    // The same quoted words, or (two words or more) the same words written out.
    const theirs = quoted(m.text);
    const plain = ` ${m.text.toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ")} `;
    if (q.some((x) => theirs.some((y) => within(x, y)) || (x.split(" ").length > 1 && plain.includes(` ${x} `)))) return m;
    if (q.length) continue;
    // In other words: most of what the new first is about, and at least one word besides "first".
    const other = about(m.text, chars);
    if (!what.size || !other.size) continue;
    let n = 0;
    for (const w of what) if (other.has(w)) n++;
    if (n / Math.min(what.size, other.size) >= 0.75 && n >= Math.min(2, what.size)) return m;
  }
  return null;
}

/** The firsts on record, for the ledger helper: older ones than the last few it already sees. */
export function firstsOnRecord(milestones: Milestone[], skipLast: number, max = 30): Milestone[] {
  const older = milestones.slice(0, Math.max(0, milestones.length - skipLast));
  return older.filter((m) => CLAIMS_FIRST.test(m.text) || quoted(m.text).length).slice(-max);
}
