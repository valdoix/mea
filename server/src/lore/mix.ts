import { CATEGORIES, CATEGORY_INFO, type Category } from "./format";
import type { EntryExtra } from "./activate";

/**
 * The mix (docs/17, 2.1): how many of each kind of entry a Lore Studio plan aims for. "few" is a
 * handful; "each" is one per subject (a voice for every core person, a relationship for every core
 * pair); "all" is every one the material supports. A kind left out isn't planned, except the
 * people, places, groups and things the census finds, which every plan keeps. An empty mix leaves
 * it to the planner, as before.
 */

export type MixLevel = "few" | "each" | "all";
export type Mix = Partial<Record<Category, MixLevel>>;
export const MIX_LEVELS: MixLevel[] = ["few", "each", "all"];

export interface Recipe {
  id: string;
  label: string;
  blurb: string;
  mix: Mix;
}

export const RECIPES: Recipe[] = [
  { id: "companion", label: "Companion", blurb: "one person, their voice, your history", mix: { character: "each", voice: "each", relationship: "few", moment: "few", reaction: "each", routine: "few", current: "few", ooc: "few", location: "few" } },
  { id: "adventure", label: "Adventure world", blurb: "places, powers, people to meet", mix: { location: "all", faction: "each", species: "few", power: "few", item: "few", hook: "few", money: "few", climate: "few", history: "few", current: "few", character: "each", rule: "few" } },
  { id: "fandom", label: "Fandom AU", blurb: "canon, where it stands, what's changed", mix: { timeline: "few", character: "all", voice: "each", relationship: "each", secret: "few", current: "few", upcoming: "few", lexicon: "few", location: "few" } },
  { id: "mystery", label: "Mystery", blurb: "a question, clues, who hides what", mix: { character: "each", secret: "each", mystery: "few", location: "each", routine: "few", belief: "few", hook: "few", timeline: "few" } },
  { id: "slice", label: "Slice of life", blurb: "days, habits, small places", mix: { character: "each", voice: "each", relationship: "few", routine: "few", customs: "few", location: "each", climate: "few", moment: "few" } },
  { id: "court", label: "Court intrigue", blurb: "houses, oaths, whispers", mix: { faction: "each", family: "few", character: "each", secret: "few", belief: "few", customs: "few", lexicon: "few", faith: "few", upcoming: "few" } },
];

/** What the census finds is always planned, whatever the mix. */
export const WORLD_KINDS: Category[] = ["character", "location", "faction", "item"];

/** Kinds that hang off a person (a voice, a bond, a reaction…). */
export const isSatellite = (c: Category) => CATEGORY_INFO[c].subject !== "none";

/** The mix from an old draft's types (character → characters for each person, concept → powers and customs…). */
export function mixFromTypes(types: NonNullable<EntryExtra["type"]>[]): Mix {
  const by: Record<NonNullable<EntryExtra["type"]>, Mix> = {
    character: { character: "each" },
    location: { location: "each" },
    item: { item: "few" },
    faction: { faction: "each" },
    concept: { power: "few", customs: "few" },
    event: { history: "few" },
    rule: { rule: "few" },
  };
  return Object.assign({}, ...types.map((t) => by[t] ?? {}));
}

/** Only real kinds and levels. */
export function cleanMix(m: unknown): Mix {
  if (!m || typeof m !== "object") return {};
  return Object.fromEntries(Object.entries(m as Record<string, unknown>).filter(([k, v]) => (CATEGORIES as readonly string[]).includes(k) && MIX_LEVELS.includes(v as MixLevel))) as Mix;
}

/** The kinds a plan may use: the mix's, plus the census's people, places, groups and things. */
export const allowedKinds = (mix: Mix): Category[] => {
  const keys = Object.keys(mix) as Category[];
  return keys.length ? CATEGORIES.filter((c) => keys.includes(c) || WORLD_KINDS.includes(c)) : [...CATEGORIES];
};

/** About how many entries a mix makes (for the summary line). */
export const mixEstimate = (mix: Mix) => Object.values(mix).reduce((n, l) => n + ({ few: 2, each: 4, all: 7 } as const)[l!], 0);

/** When a scene needs one: the planner's brief for each kind. */
export const PLAN_WHEN: Record<Category, string> = {
  timeline: "where the story stands at the opening, and the named events that haven't happened yet (one entry)",
  rule: "a law of the world that must always hold",
  power: "a magic system, technology or set of abilities: what it does, what it costs, what it can't do",
  ooc: "notes to the writer: prose style, pacing, point of view, content limits (one entry)",
  character: "a person a scene can meet",
  voice: "how one person talks, titled \"Voice: <Name>\"",
  relationship: "what's between two people, titled \"<A> & <B>\"",
  family: "a household or bloodline with its members and how they get on",
  moment: "one remembered moment two people share, titled \"Moment: <what it's called>\"",
  reaction: "how one person reacts when a topic comes up, titled \"Reaction: <Name>, when <topic>\"",
  belief: "what someone holds true, true or not",
  secret: "something kept from someone, titled \"Secret: <what it's called>\"",
  location: "a place a scene can happen in",
  faction: "a group, house, guild or side",
  species: "a people, race or creature",
  item: "an object that matters",
  faith: "gods, a church, rites, oaths people swear",
  customs: "manners, rites, food, festivals",
  lexicon: "the world's words: slang, titles, terms of address (one entry per register)",
  money: "currency, prices, what's scarce (one entry)",
  climate: "weather and seasons and what they do to life here",
  history: "something that happened before and still matters",
  current: "a situation already under way when the story opens; never backstory or what comes later",
  upcoming: "something coming that scenes can foreshadow; never backstory",
  hook: "an opening a scene can pick up: a job, a rumour, a stranger who needs something",
  mystery: "an open question the story is built around",
  routine: "who is where, when: a day at a place, a guard's rounds",
  scene: "a guide for one kind of scene: combat, court, a heist, a quiet night",
};

const LEVEL: Record<MixLevel, string> = { few: "a few", each: "one per core subject", all: "as many as the material supports" };

/** The planner's line for a mix: which kinds, how many, and what each is for. */
export function mixBrief(mix: Mix, kinds: Category[] = allowedKinds(mix)): string {
  const keys = Object.keys(mix) as Category[];
  return kinds.map((c) => `- ${c}: ${PLAN_WHEN[c]}${keys.includes(c) ? ` (${LEVEL[mix[c]!]})` : ""}`).join("\n");
}
