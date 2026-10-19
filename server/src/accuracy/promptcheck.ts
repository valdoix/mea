import { contentWords } from "../memory/text";
import type { Fact, WorldState } from "../trackers/types";

/**
 * Reliable state 3.1 (docs/16): text in the prompt that says something the trackers say is no
 * longer true. Cards, lore, summaries and recalled memories are written once; the story moves on.
 * Two kinds of claim, by rules only (no model call):
 *
 * - knowledge: "X doesn't know …", "has told no one", "known only to …" about a fact X (or
 *   someone) has since learned;
 * - deaths: someone the trackers have dead, said to be alive, waiting, on their way.
 *
 * Each finding names where it is, the sentence, and what's true now, with the message it changed at.
 */
export interface Finding {
  kind: "knowledge" | "death";
  /** Where in the prompt: "card", "lore", "the Story So Far", "recalled memories". */
  where: string;
  sentence: string;
  /** What's true now, said plainly. */
  now: string;
  /** The message it changed at. */
  seq: number;
  /** The fact or person it's about. */
  ref: string;
}

/** A sentence that says someone doesn't know something, or that something is hidden. */
export const HIDDEN = /\b(?:doesn['’]t (?:yet )?know|does not (?:yet )?know|don['’]t know|has no idea|no one knows|nobody knows|never (?:suspects?|suspecting|knew)|(?:has )?told no ?one|hasn['’]t told|known only to|keeps? (?:it )?(?:a )?secret|secret(?:ly)?|unaware)\b/i;
/** Says who alone knows, rather than who doesn't. */
const EXCLUSIVE = /\b(?:known only to|told no ?one|hasn['’]t told|no one knows|nobody knows|secret(?:ly)?)\b/i;
/** Sentences that already say what changed (our own corrections, "since then" lines). */
const ALREADY = /no longer a secret|since revealed|came out|found out|since then \(#|written before #\d+/i;
/** Said of someone alive. */
const ALIVE = /\b(?:is|are) (?:still )?(?:alive|waiting|fine|safe|at home|on (?:his|her|their) way)\b|\blives (?:in|at|with)\b|\bwill (?:come|return|be back)\b/i;
const DEATH_WORDS = /\b(?:died|dead|death|killed|late|grave|funeral|mourn\w*|ghost|memory of)\b/i;
const MAX = 300;

/**
 * Sentences (and the clauses of a "; "-list, which often say unrelated things), leaving out whole
 * lines that already say what changed (a correction split in two isn't two) and lore secrets
 * ("[Secret — known only to …]"), which follow their linked fact instead (2.1).
 */
export const sentencesOf = (text: string) =>
  text
    .split(/\n+/)
    .filter((line) => !ALREADY.test(line) && !/^\s*\[Secret\b/.test(line))
    .flatMap((line) => line.split(/(?<=[.!?…])\s+|;\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 12);

/** "Jacqueline Taylor, Misty Quigley, Natalie Scatorccio and 11 others" */
const list = (names: string[]) => (names.length > 4 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} others` : names.join(", "));
/** Content words, lightly stemmed so "love" and "loves" (or "keeps", "kept"…) meet. */
const stems = (text: string) => new Set([...contentWords(text)].map((w) => (w.length >= 4 ? w.replace(/(?:ing|ed|es|s|e)$/, "") : w)));

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function findOutdated(st: WorldState | null | undefined, pieces: { where: string; text: string }[]): Finding[] {
  if (!st) return [];
  const everyone = Object.values(st.chars);
  const chars = everyone.filter((c) => !c.isUser);
  // The ways a sentence can name someone: full name, first name, aliases (yours too: a fact can be about you).
  const namesOf = (c: (typeof everyone)[number]) => [...new Set([c.name, c.name.split(/\s+/)[0]!, ...c.aliases].filter((n) => n.length >= 3))];
  // (Someone with no name of three letters or more can't be told apart in a sentence: never matches.)
  const nameRe = new Map(everyone.map((c) => [c.id, namesOf(c).length ? new RegExp(`(?<![\\p{L}])(?:${namesOf(c).map(esc).join("|")})(?![\\p{L}])`, "iu") : /(?!)/]));
  const knows = (f: Fact, id: string) => /knows|believes/.test(f.stances[id]?.status ?? "") && f.stances[id]?.route !== "keeps it";
  // Facts someone has learned: revealed, or known by someone besides the keepers.
  // Words that are only someone's name don't say what a sentence is about.
  const nameWords = new Set(everyone.flatMap((c) => namesOf(c).flatMap((n) => [...stems(n)])));
  const learned = Object.values(st.facts)
    .map((f) => ({ f, knowers: Object.keys(f.stances).filter((id) => knows(f, id) && !f.secret?.keepers.includes(id) && !st.chars[id]?.isUser), words: stems(f.statement) }))
    .filter((x) => x.knowers.length && x.words.size >= 2)
    // Who the fact is about: a sentence about it names them all ("Jackie loves James" isn't "Shauna loves Jackie").
    .map((x) => ({ ...x, people: everyone.filter((c) => nameRe.get(c.id)!.test(x.f.statement)).map((c) => c.id) }));
  /** The person a "doesn't know" is said of: the name just before it ("Jeff doesn't know"). */
  const subjectOf = (s: string) => {
    const m = s.match(/([\p{Lu}][\p{L}'’-]+)\s+(?:still\s+|yet\s+)?(?:doesn['’]t|does not|has no idea|never)/u);
    return m ? chars.find((c) => nameRe.get(c.id)?.test(m[1]!)) : undefined;
  };
  const dead = chars.filter((c) => c.dead);
  const diedAt = (id: string, name: string) => st.milestones.find((m) => m.who.includes(id) && /died/.test(m.text))?.seq ?? st.chars[id]?.lastSeq ?? 0;
  const nm = (id: string) => st.chars[id]?.name ?? id;

  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const piece of pieces) {
    for (const s of sentencesOf(piece.text)) {
      if (out.length >= MAX) return out;
      if (ALREADY.test(s) || seen.has(`${piece.where}|${s}`)) continue;
      // Knowledge: "X doesn't know …" about a fact X (or anyone) has since learned.
      if (HIDDEN.test(s) && learned.length) {
        const T = stems(s);
        let best: { x: (typeof learned)[number]; score: number } | null = null;
        for (const x of learned) {
          const hit = [...x.words].filter((w) => T.has(w));
          const score = hit.length / x.words.size;
          // Names alone match only a secret that came out, by two of its own keepers ("about Jeff and Shauna").
          const byNames = hit.every((w) => nameWords.has(w)) && (!x.f.revealed.length || (x.f.secret?.keepers ?? []).filter((id) => nameRe.get(id)?.test(s)).length < 2);
          const allNamed = x.people.every((id) => nameRe.get(id)!.test(s));
          if (hit.length >= 2 && score >= 0.5 && !byNames && allNamed && score > (best?.score ?? 0)) best = { x, score };
        }
        if (best) {
          const { f, knowers } = best.x;
          // "Jeff doesn't know" of a keeper, or of someone who still doesn't: it's about something else.
          const subject = EXCLUSIVE.test(s) ? undefined : subjectOf(s);
          if (subject && !knowers.includes(subject.id)) continue;
          // "X doesn't know": those it names who know now (else everyone who has learned it).
          // "known only to A, B" / "told no one": those who know now that it doesn't name.
          // (A name that's part of the fact itself, "loves James", isn't someone said not to know.)
          const mentioned = knowers.filter((id) => nameRe.get(id)?.test(s));
          const named = mentioned.filter((id) => !nameRe.get(id)?.test(f.statement));
          const who = EXCLUSIVE.test(s) ? knowers.filter((id) => !mentioned.includes(id)) : named.length ? named : knowers.filter((id) => !mentioned.includes(id));
          if (!who.length) continue;
          const seq = Math.max(...who.map((id) => f.stances[id]!.seq), ...f.revealed.map((r) => r.seq));
          seen.add(`${piece.where}|${s}`);
          out.push({ kind: "knowledge", where: piece.where, sentence: s, now: `${list(who.map(nm))} ${who.length === 1 ? "knows" : "know"} now: ${f.statement.replace(/\.$/, "")}`, seq, ref: f.key });
          continue;
        }
      }
      // Deaths: someone the trackers have dead, said to be alive.
      if (ALIVE.test(s) && !DEATH_WORDS.test(s)) {
        const c = dead.find((d) => nameRe.get(d.id)?.test(s));
        if (c) {
          seen.add(`${piece.where}|${s}`);
          out.push({ kind: "death", where: piece.where, sentence: s, now: `${c.name} is dead`, seq: diedAt(c.id, c.name), ref: c.id });
        }
      }
    }
  }
  return out;
}
