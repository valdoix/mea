import { aboutWords, doneMatcher } from "../memory/openlist";
import { contentWords } from "../memory/text";
import { doneLoops, openLoops } from "../trackers/loops";
import type { Fact, Loop, WorldState } from "../trackers/types";

/**
 * Reliable state 3.1 (docs/16): text in the prompt that says something the trackers say is no
 * longer true. Cards, lore, summaries and recalled memories are written once; the story moves on.
 * Two kinds of claim, by rules only (no model call):
 *
 * - knowledge: "X doesn't know …", "has told no one", "known only to …" about a fact X (or
 *   someone) has since learned;
 * - deaths: someone the trackers have dead, said to be alive, waiting, on their way.
 * - time (findOpening): the card's "tonight", "right now" and scenario are the story's opening,
 *   which the clock may be most of a day past.
 * - done (docs/22 3.1): something finished, said to be still to come. However it got into the text,
 *   this is the last place it can be caught.
 *
 * Each finding names where it is, the sentence, and what's true now, with the message it changed at.
 */
export interface Finding {
  kind: "knowledge" | "death" | "time" | "done";
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
const ALREADY = /no longer a secret|since revealed|came out|found out|since then \(#|written before #\d+|^closed here:|done since:/i;
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

/** A line with something still to come, and one that knows it's past. */
export const AHEAD = /\b(?:tonight|tomorrow|still|due|pending|waiting|waits|unsaid|not yet|hasn['’]t)\b/i;
export const PAST = /\b(?:already|again|since|anymore|no longer)\b/i;

/** Words of a sentence saying it's still to come, rather than a mood that lasts ("the fridge still hums"). */
const COMING = /\b(?:tonight|tomorrow|pending|due|unsaid|not yet|hasn['’]t)\b/i;
/** A to-do around a word: "Then groceries.", "she needs the groceries", "the grocery run". */
const BEFORE = String.raw`(?:then|needs?|gotta|go get|go buy|have to|has to|time to)\s+(?:[\p{L}'’-]+\s+)?`;
const AFTER = String.raw`\s+(?:run|trip)`;

/** The word as it's written: "grocery" meets "groceries", "sock" meets "socks". */
const written = (w: string) => (w.endsWith("y") ? `${esc(w.slice(0, -1))}(?:y|ies)` : `${esc(w)}(?:e?s)?`);

/**
 * What a done loop goes by: the words only it has, in at least two of its wordings and most of them.
 * Nine ways of saying the groceries agree on "grocery". A loop worded once has none: one line's words
 * say too little ("clothes outside the guest-room door" isn't every "clothes").
 */
function anchorsOf(st: WorldState | null | undefined, loops: Loop[]) {
  const wordings = loops.map((l) => [...new Set([l.what, ...l.from])].map((t) => aboutWords(st, t)));
  const seen = new Map<string, number>();
  for (const ws of wordings) for (const w of new Set(ws.flatMap((x) => [...x]))) seen.set(w, (seen.get(w) ?? 0) + 1);
  return wordings.map((ws) =>
    [...new Set(ws.flatMap((x) => [...x]))].filter((w) => {
      const n = ws.filter((x) => x.has(w)).length;
      return seen.get(w) === 1 && n >= 2 && n * 2 >= ws.length;
    }),
  );
}

/**
 * The done loop a sentence sets up as still to come, if any. It says most of a wording the loop has
 * had, with a word for what's coming: a stale line repeats its own. With `lists`, for what's being
 * written now (a reply, a plan), a to-do around what the loop goes by counts too ("Then groceries."),
 * since a list only says one word. A card or a persona is timeless: "someone needs to laugh" is who
 * he is. Sharing words isn't enough: on 145 real replies that made 175 flags, nearly all wrong.
 * What's still open and also fits keeps the sentence, and a loop that repeats is never done.
 */
export function doneAhead(st: WorldState | null | undefined, { lists = false } = {}): (sentence: string) => Loop | null {
  const loops = doneLoops(st);
  if (!loops.length) return () => null;
  const of = new Map(loops.flatMap((l) => [l.what, ...l.from].map((text) => [text, l] as const)));
  const match = doneMatcher(st, [...of].map(([text, l]) => ({ text, seq: l.closed!, strict: true })));
  const open = doneMatcher(st, openLoops(st).map((l) => ({ text: l.what, seq: 1 })));
  const live = new Set(openLoops(st).flatMap((l) => [...aboutWords(st, l.what)]));
  const todos = (lists ? anchorsOf(st, loops) : []).flatMap((words, i) => {
    const alive = words.filter((w) => !live.has(w)).map(written);
    return alive.length ? [{ loop: loops[i]!, re: new RegExp(`\\b(?:${BEFORE}(?:${alive.join("|")})\\b|(?:${alive.join("|")})${AFTER}\\b)`, "iu") }] : [];
  });
  return (s) => {
    if (PAST.test(s) || open(s, 0)) return null;
    const hit = COMING.test(s) ? match(s, 0) : null;
    return (hit ? of.get(hit.text) : undefined) ?? todos.find((t) => t.re.test(s))?.loop ?? null;
  };
}

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

  const ahead = doneAhead(st);

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
          continue;
        }
      }
      const loop = ahead(s);
      if (loop) {
        seen.add(`${piece.where}|${s}`);
        out.push({ kind: "done", where: piece.where, sentence: s, now: `Already happened: ${loop.what}`, seq: loop.closed!, ref: loop.id });
      }
    }
  }
  return out;
}

/** Words that put an event at the moment the card was written ("right now" isn't one: "what she wants right now" is who she is). */
// Opening a sentence or clause ("Tonight she clawed out…"), not "what's on TV tonight".
const PRESENT = /(?:(?:^|[,;:—–]\s*|\b(?:and|but|then|when|until|since)\s+)(?:tonight|today|this (?:morning|afternoon|evening|night)|a little (?:past|after) (?:midnight|noon|dawn|dusk))|\bjust now|\b(?:has|have) just)\b/i;
const DAY = 1440;

/** How long ago the opening was, as people say it: "last night", "earlier today", "three days ago". */
export function agoPhrase(start: number, now: number): string {
  const hour = (m: number) => Math.floor((((m % DAY) + DAY) % DAY) / 60);
  const day = (m: number) => Math.floor(m / DAY);
  const night = (m: number) => hour(m) < 6 || hour(m) >= 18;
  // The evening a night belongs to: 00:15 on the 10th is the night of the 9th.
  const evening = (m: number) => day(m) - (hour(m) < 6 ? 1 : 0);
  const n = night(start) ? evening(now) - evening(start) : day(now) - day(start);
  if (n <= 0) return night(start) ? "earlier tonight" : "earlier today";
  if (n === 1) return night(start) ? "last night" : "yesterday";
  if (n === 2) return night(start) ? "the night before last" : "the day before yesterday";
  return `${n} days ago`;
}

const hoursAgo = (m: number) => (m < 48 * 60 ? `about ${Math.round(m / 60)} hours ago` : `${Math.round(m / DAY)} days ago`);

/**
 * The card is written at the story's opening: its "tonight she clawed out of her grave" and its
 * scenario ("a little past midnight on the cemetery road") stay in the prompt while the clock runs
 * on, and a reply a day later says "three hours ago". Once the clock is three hours or more past
 * where it started, the card's present-tense sentences (and the scenario's first) are corrected
 * with when that really was. Card pieces only: memory and lore carry their own times.
 */
export function findOpening(st: WorldState | null | undefined, pieces: { where: string; text: string; scenario?: boolean }[]): Finding[] {
  const start = st?.start;
  const now = st?.time;
  if (!start || !now || start.form !== now.form || now.minutes - start.minutes < 180) return [];
  const when = `that is the story's opening, ${agoPhrase(start.minutes, now.minutes)} (${hoursAgo(now.minutes - start.minutes)}), not now`;
  const out: Finding[] = [];
  for (const piece of pieces) {
    if (piece.where !== "card") continue;
    const all = sentencesOf(piece.text);
    const said = all.filter((s) => PRESENT.test(s)).slice(0, 2);
    const hit = said.length ? said : piece.scenario && all[0] ? [all[0]] : [];
    for (const s of hit) if (out.length < 3 && !out.some((f) => f.sentence === s)) out.push({ kind: "time", where: piece.where, sentence: s, now: when, seq: 1, ref: "opening" });
  }
  return out;
}
