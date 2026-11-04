/**
 * Occasions (docs/25-rooms-of-the-keep.md §4): an event under way, as a layer over whatever place the
 * story is in. This file only reads them; the painting is in occasionscenes.ts. The first signal found
 * wins: your correction, the tracker's `occasion` line, the place's own words, a calendar entry with a
 * time, a finished scene's title.
 */
import { readPlace, placeNamed, type ReadOptions } from "./places";

export type Occasion = "birthday" | "wedding" | "reception" | "party" | "dinnerparty" | "funeral" | "anniversary" | "ball" | "festival" | "coronation" | "contest" | "execution";

export const OCCASIONS: { id: Occasion; label: string }[] = [
  { id: "birthday", label: "Birthday or name day" },
  { id: "wedding", label: "Wedding" },
  { id: "reception", label: "Wedding feast" },
  { id: "party", label: "Party or revel" },
  { id: "dinnerparty", label: "Dinner or banquet" },
  { id: "funeral", label: "Funeral" },
  { id: "anniversary", label: "Anniversary or date" },
  { id: "ball", label: "Ball or gala" },
  { id: "festival", label: "Festival or fair" },
  { id: "coronation", label: "Coronation" },
  { id: "contest", label: "Tourney or big game" },
  { id: "execution", label: "Execution" },
];
export const isOccasion = (s: string | null | undefined): s is Occasion => OCCASIONS.some((o) => o.id === s);

/** How a plate shows an occasion: over the place, or as a full scene of its own. */
export interface SceneOccasion {
  id: Occasion;
  stage: boolean;
}

/** Most specific first. "the party" alone is a group of adventurers as often as an event, so it needs a place name to count. */
const WORDS: [Occasion, RegExp][] = [
  ["anniversary", /anniversary|date night|romantic dinner/],
  ["reception", /wedding (?:feast|reception|breakfast|party|banquet)|marriage feast/],
  ["birthday", /birthday(?: party)?|name ?day(?: party| feast)?|sweet sixteen|quincea/],
  ["wedding", /\bwedding\b|nuptials|handfasting|\bvows\b|marriage ceremony/],
  ["funeral", /\bfuneral|memorial service|\bburial\b|\bvigil\b|\bwake for\b|^(?:the )?wake$/],
  ["party", /(?:house|frat|office|costume|garden|new year'?s?|bachelor(?:ette)?|hen|stag|dance|pool|christmas|engagement|surprise|victory) party|bachelorette|\brevels?\b|\bkegger\b/],
  ["coronation", /coronation|\bcrowning\b|inauguration|swearing[- ]in/],
  ["execution", /execution|beheading|public hanging/],
  ["contest", /tourney|tournament|\bjoust|\bmelee\b|big game|championship|football game|homecoming game/],
  ["ball", /\bball\b(?! ?(?:game|park|field|room|pit))|masquerade|\bgala\b|\bprom\b|debutante/],
  ["festival", /festival|carnival|fairground|county fair|^(?:the |a )?fair$|maiden'?s day/],
  ["dinnerparty", /dinner party|\bbanquet\b|\bfeast\b|thanksgiving|state dinner/],
];
const BARE_PARTY = /\bparty\b/;
/** A title about the time around an event isn't the event. */
const AROUND = /\b(?:after|before|planning|aftermath|eve of|night before|morning after|invitations?|news of|talk of|until|dreading|preparing|preparations?)\b/;

const clean = (t: string) => t.toLowerCase().trim().replace(/[’ʼ]/g, "'");

/** The occasion some words name. A title speaks loosely, so it has to name one outright. */
export function readOccasion(text: string | null | undefined, from: "place" | "tracker" | "title" = "tracker"): Occasion | null {
  const t = clean(text ?? "");
  if (!t || (from === "title" && AROUND.test(t))) return null;
  const hit = WORDS.find(([, re]) => re.test(t))?.[0];
  if (hit) return hit;
  return from !== "title" && BARE_PARTY.test(t) ? "party" : null;
}

/** A place's name with the event taken out of it: "the birthday party at Jackie's house" → "at jackie's house". */
function withoutOccasion(part: string): string {
  let t = clean(part);
  for (const [, re] of WORDS) t = t.replace(re, " ");
  return t.replace(BARE_PARTY, " ").replace(/\s+/g, " ").trim().replace(/^(?:the|a|an)\s+/, "");
}
/** Whether anything but the event, an article or someone's name is left. */
const saysNothing = (rest: string) => !rest.replace(/\b(?:the|a|an|at|in|on|of|for|to)\b/g, " ").replace(/\b[\w-]+'s?\b(?=\s|$)/g, " ").trim();

/** A path without the event's name in it, for reading the place underneath. */
export function placeUnder(path: string[]): string[] {
  const last = path.at(-1);
  if (!last || !readOccasion(last, "place")) return path;
  const rest = withoutOccasion(last);
  return saysNothing(rest) ? path.slice(0, -1) : [...path.slice(0, -1), rest];
}

export interface OccasionSignals extends ReadOptions {
  place: string[];
  /** Your correction: an occasion's id, or "none". */
  fix?: string | null;
  /** What the tracker says is under way. */
  tracked?: string | null;
  /** The scene's title, once it has one. */
  title?: string | null;
  /** Calendar entries with a time, and the story's time now. */
  dated?: { title: string; at: number }[] | null;
  minutes?: number | null;
}

/** A calendar entry counts from an hour before it to six hours after. */
function fromCalendar(dated: OccasionSignals["dated"], minutes: number | null | undefined): Occasion | null {
  if (!dated?.length || minutes == null) return null;
  for (const e of dated) {
    const d = minutes - e.at;
    const hit = d >= -60 && d <= 360 ? readOccasion(e.title, "title") : null;
    if (hit) return hit;
  }
  return null;
}

/** What occasion a scene is, if any, and whether it gets a full scene of its own. */
export function sceneOccasion(s: OccasionSignals): SceneOccasion | null {
  if (s.fix === "none") return null;
  const last = s.place.at(-1) ?? "";
  const inName = readOccasion(last, "place");
  const id = (isOccasion(s.fix) ? s.fix : null) ?? readOccasion(s.tracked, "tracker") ?? inName ?? fromCalendar(s.dated, s.minutes) ?? readOccasion(s.title, "title");
  if (!id) return null;
  const under = placeUnder(s.place);
  const nameIsAll = Boolean(inName) && under.length < s.place.length;
  const stage = nameIsAll || !placeNamed(under, s) || readPlace(under, s) === "castle";
  return { id, stage };
}
