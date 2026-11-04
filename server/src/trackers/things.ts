import type { Item, WorldState } from "./types";

/**
 * Things and where they are (docs/26 Part 6). In the real chat Joyce's daisy mug had three records,
 * "daisy mug", "daisy mug (Joyce's, cream ceramic, faded daisy)" and one with more words again, each
 * on its own trail, and "at counter" didn't say whose counter. So at #742 it came down from a shelf in
 * another house, and at #736 the checker put the BALLET! album in the wrong kitchen.
 */

const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}'’]+/gu) ?? []);
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The thing itself, without what's said about it: "daisy mug (Joyce's, faded)" is a daisy mug. */
export function thingCore(name: string) {
  return norm(name.replace(/\s*[(\[].*$/, ""));
}

const detail = (name: string) => words(name.match(/[(\[](.*)$/)?.[1] ?? "");
const within = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w));

/**
 * The record a name refers to, when it isn't the same words. Only when it can't be another thing:
 * "pint (O negative, empty)" and "pint (O negative, full)" are two pints, and a bare "phone" or "plate"
 * could be anyone's, so one word and no description never joins. Something gone stays gone.
 */
export function sameThing(items: Record<string, Item>, name: string): Item | undefined {
  const core = thingCore(name);
  if (!core) return undefined;
  const mine = detail(name);
  const named = core.split(" ").length >= 2;
  const fits = Object.values(items).filter((i) => {
    if (i.gone || thingCore(i.name) !== core) return false;
    const theirs = detail(i.name);
    // A description only ever adds: one is the other with more said.
    // With a one-word name it takes two words in common: "phone (Gabriel's)" isn't "phone (new, matching Gabriel's)".
    if (mine.size && theirs.size) return (within(mine, theirs) || within(theirs, mine)) && (named || Math.min(mine.size, theirs.size) >= 2);
    return named;
  });
  return fits.length === 1 ? fits[0] : undefined;
}

/** Words that say a thing was put down somewhere fixed. */
const RESTING = /\b(?:counter|table|shelf|shelves|floor|sofa|couch|fridge|bed|nightstand|windowsill|sill|rack|banister|cabinet|drawer|stove|sink|closet|hook|mantel|hallway|(?:living|bed|bath|dining)\s?room|kitchen)\b/i;
/** Words that say it's on the move, or on someone: wherever they go, it goes. The tracker writes these as places too. */
const TRAVELLING = /\b(?:worn|wearing|carr(?:y|ying|ied)|basket|bag|bags|cart|trunk|car|backpack|pocket|arm|lap|grip|ear)\b|→|\+/i;
/** In someone's hands: a moment, not a move. A mug in Spike's hands in that kitchen is still in that house. */
const IN_HANDS = /^[\p{L}' ’-]+['’]s hands$/iu;

/**
 * Where it was set down, when no one's holding it: the place the story was at when it last moved. Only
 * when the record says it rests somewhere; the tracker's "places" are free text, and "still worn by
 * Buffy" or "Gabriel's basket" say nothing about where it is by now.
 */
export function thingPlace(i: Item): string | null {
  if (i.gone || !i.holder?.startsWith("place:")) return null;
  const held = i.holder.slice(6).trim();
  if (TRAVELLING.test(held) || !(RESTING.test(held) || IN_HANDS.test(held))) return null;
  // The line named the place itself ("→ Winters Residence › shelf"), which may not be where the story was.
  if (held.includes("›")) return held.replace(/^(?:at\s+)+/i, "");
  return [...i.custody].reverse().find((c) => c.at)?.at ?? null;
}

/** Whose home a place is, by its owner in the records or its name: "Gabriel's House", "Winters Residence". */
function ownersOf(st: WorldState, path: string[]) {
  const owners = new Set<string>();
  const people = Object.values(st.chars);
  const whole = norm(path.join(" "));
  for (const p of Object.values(st.places)) if (p.owner && norm(p.path.join(" ")) === whole) owners.add(p.owner);
  for (const part of path) {
    const home = part.match(/^(?:the\s+)?(.+?)(?:['’]s)?\s+(?:residence|house|home|place|apartment|flat|crypt|room|bedroom)\b/i)?.[1];
    if (!home) continue;
    const who = norm(home);
    for (const c of people) if (norm(c.name) === who || c.name.split(/\s+/).some((w) => norm(w) === who)) owners.add(c.id);
  }
  return owners;
}

export interface ElsewhereThing {
  item: Item;
  place: string;
  sentence: string;
  seq: number;
}

/** Remembering it, wishing for it or fetching it isn't having it here. */
const NOT_HERE = /\b(remember(?:s|ed)?|recall(?:s|ed)?|back (?:at|in|home|there|when)|at home|left (?:it|them)|still (?:at|in|on)|would|could|might|if|wish(?:es|ed)?|used to|bring(?:s|ing)?|brought|fetch(?:es|ed)?|pack(?:s|ed|ing)?|carr(?:y|ies|ied)|move[sd]?|moving|took|taken|take|grab(?:s|bed)?|on the (?:phone|call)|another|one like)\b/i;

/**
 * A thing in this passage that the records have left in someone else's home. Only a thing with a name
 * of its own ("daisy mug", not "mug"), and only home against home: place names in a long story are
 * written many ways, and a false alarm costs more than a miss.
 */
export function thingsElsewhere(st: WorldState | null | undefined, text: string, split: (t: string) => string[]): ElsewhereThing[] {
  if (!st?.place.length) return [];
  const here = ownersOf(st, st.place);
  if (!here.size) return [];
  const out: ElsewhereThing[] = [];
  const lower = text.toLowerCase();
  for (const i of Object.values(st.items)) {
    const core = thingCore(i.name);
    if (core.split(" ").length < 2 || !lower.includes(core) || out.some((o) => thingCore(o.item.name) === core)) continue;
    const at = thingPlace(i);
    if (!at) continue;
    const theirs = ownersOf(st, at.split(/\s*›\s*/));
    if (!theirs.size || [...theirs].some((o) => here.has(o))) continue;
    // A plan's step names ("MOVE —") aren't the sentence's words.
    const sentence = split(text).find((s) => s.toLowerCase().includes(core) && !NOT_HERE.test(s.replace(/^\s*[A-Z]{3,}\s*[—:–-]\s*/, "")));
    if (sentence) out.push({ item: i, place: at, sentence: sentence.trim(), seq: i.lastSeq });
  }
  return out.slice(0, 2);
}
