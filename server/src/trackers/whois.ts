/**
 * docs/30 Part 0: telling a person from a place, a group or a field name, before the fold makes
 * someone of it. Pure helpers over the words; the fold adds what it knows (the cast, the factions,
 * the places visited).
 */

/**
 * docs/30 3.1: a name that's a description, not a name: "woman in brown cardigan", "the bartender",
 * "Zapatos Dorothea worker". An article or a lower-case start, or a role noun at the end after no
 * proper name ("Coach Martinez" and "Officer Dan" are names).
 */
const ROLE =
  "worker|woman|women|man|men|guy|girl|boy|lady|kid|child|clerk|cashier|waiter|waitress|server|bartender|barista|guard|bouncer|officer|cop|nurse|doctor|driver|cabbie|stranger|customer|shopper|patron|teen|teenager|student|teacher|salesgirl|salesman|saleswoman|assistant|attendant|receptionist|manager|employee|staffer|vendor|janitor|security|paramedic|reporter|tourist|passerby|neighbou?r|mother|father|mom|dad|couple|figure|voice|someone|somebody|person|people|vampire|demon|thug|goon|henchman|minion|cook|chef|maid|butler|porter|mechanic|delivery guy|courier|pharmacist|librarian|priest";
const ROLE_START = new RegExp(String.raw`^(?:${ROLE})s?$`, "i");
const DESCRIPTION_END = new RegExp(String.raw`\b(?:${ROLE})s?$`, "i");
export function passingName(name: string): boolean {
  const n = name.replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();
  if (!n) return false;
  if (/^(?:a|an|the|some|one|another|that|this|two|three|several)\s/i.test(n)) return true;
  if (/^\p{Ll}/u.test(n)) return true;
  // "Zapatos Dorothea worker": capitalised words, then a lower-case role noun. "Coach Martinez" ends in a name.
  const words = n.split(" ");
  // "Woman in brown cardigan", "Man with the umbrella": a role noun, then words about them ("Officer Dan" is a name).
  if (words.length >= 2 && ROLE_START.test(words[0]!) && words.slice(1).some((w) => /^\p{Ll}/u.test(w))) return true;
  return words.length >= 2 && /^\p{Ll}/u.test(words.at(-1)!) && DESCRIPTION_END.test(n);
}

/**
 * docs/30 3.1: a passing face: a description for a name, in fewer than three scenes, not pinned. Kept
 * apart from the cast (a line under People), with no pressure and no subplots off the page.
 */
export const passingFace = (c: { name: string; isUser: boolean; isMain: boolean; scenes?: number }, pinned?: boolean) => !c.isUser && !c.isMain && !pinned && (c.scenes ?? 0) < 3 && passingName(c.name);

/** Field names written where a name goes ("cast: … · traits@spot"): never a person. */
export const FIELD_WORD = /^(?:traits?|moods?|notes?|cast|looks?|body|drives?|knows?|items?|threads?|places?|scenes?|bonds?|none|n\/a|unknown|tbd|\?+)$/i;

const GROUP_NOUN =
  "friends|family|families|household|crew|gang|people|circle|kids|children|parents|folks|group|pack|team|squad|clique|band|siblings|sisters|brothers|cousins|roommates|housemates|classmates|coworkers|colleagues|neighbou?rs|guests|clan";

/**
 * A group by its shape: "Dawn's friends", "the household", "the Winters family", "her parents",
 * "the whole crew". One or two words may come before the group word.
 */
const GROUP_SHAPE = new RegExp(String.raw`^(?:(?:the|all the|whole|the whole|all of the|her|his|their|our|my)\s+)?(?:[\p{L}'.-]+\s+){0,2}(?:${GROUP_NOUN})$`, "iu");

const tidy = (s: string) =>
  s
    .replace(/[’‘]/g, "'")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const isGroupShape = (name: string) => GROUP_SHAPE.test(tidy(name).toLowerCase());

/** "the Summerses", "the Winters", "the Winters family": the surname a family is named by. */
export function familySurname(name: string): string[] {
  const n = tidy(name).toLowerCase();
  const fam = n.match(/^(?:the\s+)?(\p{L}[\p{L}'-]*)\s+(?:family|household|clan)$/u);
  if (fam) return [fam[1]!];
  const plural = n.match(/^the\s+(\p{L}[\p{L}'-]*)$/u);
  if (!plural) return [];
  const w = plural[1]!;
  return [w, ...(w.endsWith("es") ? [w.slice(0, -2)] : []), ...(w.endsWith("s") ? [w.slice(0, -1)] : [])];
}

const NAMEISH = /^\p{Lu}[\p{L}'.-]*(?:\s+\p{Lu}[\p{L}'.-]*){0,2}$/u;

/**
 * "Dawn's friends (Melissa, Kara, Jamie)": a group with its people named in brackets. `isGroup`
 * says whether the part before the brackets is a group (by shape, or a faction the fold knows).
 */
export function bracketGroup(name: string, isGroup: (head: string) => boolean): { group: string; names: string[] } | null {
  const m = tidy(name).match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!m) return null;
  const head = m[1]!.trim();
  if (!isGroup(head)) return null;
  const names = m[2]!
    .split(/\s*(?:,|&|\+|\/|·|;|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length && names.every((n) => NAMEISH.test(n)) ? { group: head, names } : null;
}

/** The last word of a place's name ("Downstairs Kitchen"). Words that are also surnames (Hall, Park, House, Lane, Church) aren't here. */
const PLACE_NOUN =
  /\b(?:kitchen|kitchenette|pantry|bedroom|bathroom|en-suite|room|hallway|corridor|foyer|landing|stairs|stairwell|porch|patio|balcony|terrace|deck|garage|driveway|basement|cellar|attic|loft|closet|office|study|den|nursery|parlou?r|residence|apartment|flat|pool|shower|lobby|diner|cafe|café|restaurant|hotel|motel|hospital|station|cemetery|graveyard|mall|store|shop|school|yard|backyard|garden|barn|shed|street|road|avenue|drive|alley|parking lot|bar|pub|club|library|gym|warehouse)$/i;

/** Whether a name reads as a place: two words or more, ending in a place word, or written as a path. */
export function looksLikePlace(name: string): boolean {
  const n = tidy(name);
  if (/\s*(?:›|»)\s*/.test(n)) return true;
  return n.split(" ").length >= 2 && PLACE_NOUN.test(n);
}

/** A `room` body that reads as a sentence about the place, not a path to it. */
export function sentenceNotPath(parts: string[]): boolean {
  if (parts.length !== 1) return false;
  const words = parts[0]!.replace(/\([^)]*\)/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length > 5;
}
