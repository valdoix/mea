import type { EntryExtra } from "./activate";
import { parseDuration } from "../trackers/clock";

/**
 * The detail sheet (docs/15, 3.1): the named kinds of fact each type of entry has, the small
 * things that slip (eye colour, which hand the scar is on, a birthday). A single slot holds one
 * value at a time, so a new value replaces the old one; a list slot (likes, scars, catchphrases)
 * holds many. The normaliser maps how people write a value ("steel-grey", "gray") to one form, so
 * the checks and the quiz can compare them.
 */

export type SlotGroup = "character" | "voice" | "location" | "item" | "group";

export interface SlotDef {
  key: string;
  label: string;
  group: SlotGroup;
  /** The fact kind a value of this slot gets. */
  kind: "attribute" | "never" | "habit" | "voice" | "state";
  /** A list slot holds many values; a single one, one at a time. */
  list?: boolean;
  /** A short example, for the picker's placeholder. */
  hint: string;
}

const S = (group: SlotGroup, key: string, label: string, hint: string, o: { kind?: SlotDef["kind"]; list?: boolean } = {}): SlotDef => ({ key, label, group, hint, kind: o.kind ?? "attribute", ...(o.list ? { list: true } : {}) });

export const SLOTS: SlotDef[] = [
  S("character", "eyes", "Eyes", "grey"),
  S("character", "hair", "Hair", "black, cropped short"),
  S("character", "height", "Height", "5'7\""),
  S("character", "build", "Build", "wiry"),
  S("character", "skin", "Skin", "freckled, sunburnt"),
  S("character", "scar", "Scars and marks", "a scar on her left hand", { list: true }),
  S("character", "handedness", "Handedness", "left-handed"),
  S("character", "voice", "Voice", "low, a little hoarse"),
  S("character", "age", "Age", "24"),
  S("character", "birthday", "Birthday", "19 January"),
  S("character", "clothing", "Clothing habits", "always a blue scarf", { kind: "habit" }),
  S("character", "likes", "Likes", "salt licorice", { list: true }),
  S("character", "dislikes", "Dislikes", "crowds", { list: true }),
  S("character", "fears", "Fears", "deep water", { list: true }),
  S("character", "habits", "Habits", "hums when nervous", { kind: "habit", list: true }),
  S("character", "never", "Never", "can't swim · has never met Arya", { kind: "never", list: true }),
  S("voice", "pet names", "Pet names for {{user}}", "love", { kind: "voice", list: true }),
  S("voice", "catchphrases", "Catchphrases", "Tides willing", { kind: "voice", list: true }),
  S("voice", "swearing", "Swearing", "never swears", { kind: "voice" }),
  S("voice", "greeting", "How they greet", "Oi, you", { kind: "voice" }),
  S("voice", "goodbye", "How they say goodbye", "Fair winds", { kind: "voice" }),
  S("voice", "never says", "Words they'd never use", "babe", { kind: "voice", list: true }),
  S("location", "layout", "Layout", "two floors, the bar downstairs"),
  S("location", "rooms", "Rooms", "the cellar, the loft", { list: true }),
  S("location", "objects", "Notable objects", "a ship's bell over the door", { list: true }),
  S("location", "residents", "Who lives there", "Joss, his daughter", { list: true }),
  S("location", "senses", "Sounds and smells", "tar and frying fish", { list: true }),
  S("location", "routine", "The routine there", "the bell rings at dusk", { kind: "habit" }),
  S("item", "look", "Look", "brass, dented"),
  S("item", "where", "Where it is", "on the mantel", { kind: "state" }),
  S("item", "held by", "Who holds it", "Wren", { kind: "state" }),
  S("item", "can", "What it can do", "lights without oil", { list: true }),
  S("item", "cannot", "What it can't do", "burn in the rain", { kind: "never", list: true }),
  S("item", "origin", "Where it came from", "her mother's"),
  S("group", "leader", "Leader", "the Harbourmaster"),
  S("group", "colours", "Colours", "green and gold"),
  S("group", "rules", "Rules", "no blades in the hall", { list: true }),
  S("group", "enemies", "Enemies", "the Ironborn", { list: true }),
];

const byKey = new Map(SLOTS.map((s) => [s.key, s]));
export const slotDef = (key: string | null | undefined) => (key ? byKey.get(key.toLowerCase().trim()) : undefined);
/** A single slot holds one value at a time: a new value supersedes the old one. */
export const isSingleSlot = (key: string | null | undefined) => Boolean(slotDef(key) && !slotDef(key)!.list);
export const VOICE_SLOTS = SLOTS.filter((s) => s.group === "voice").map((s) => s.key);

/** The slots an entry's type offers (characters get their voice slots too). */
export function slotsFor(type: EntryExtra["type"] | string | undefined): SlotDef[] {
  if (type === "character") return SLOTS.filter((s) => s.group === "character" || s.group === "voice");
  if (type === "location") return SLOTS.filter((s) => s.group === "location");
  if (type === "item") return SLOTS.filter((s) => s.group === "item");
  if (type === "faction") return SLOTS.filter((s) => s.group === "group");
  return [];
}

// ---------- the normaliser ----------

/** Colour words by family: what a reader would call the same colour. */
const COLOUR_FAMILIES: Record<string, string[]> = {
  grey: ["grey", "gray", "steel", "steel-grey", "steel-gray", "slate", "ash", "ashen", "silver", "silvery", "pewter", "storm", "stormy", "smoke", "smoky"],
  blue: ["blue", "azure", "sapphire", "cobalt", "ice-blue", "sky-blue", "navy", "cerulean"],
  green: ["green", "emerald", "jade", "moss", "olive", "sea-green"],
  brown: ["brown", "chestnut", "chocolate", "hazel", "umber", "coffee", "mahogany", "bronze", "tawny", "amber", "honey"],
  black: ["black", "jet", "raven", "ebony", "inky", "coal"],
  blonde: ["blonde", "blond", "golden", "gold", "flaxen", "fair", "straw", "platinum", "honey-blonde", "sandy"],
  red: ["red", "auburn", "ginger", "copper", "russet", "crimson", "scarlet", "rust"],
  white: ["white", "snowy", "snow-white"],
  violet: ["violet", "purple", "lilac", "lavender", "amethyst"],
  pink: ["pink", "rose", "rosy"],
};
const COLOUR_OF = new Map(Object.entries(COLOUR_FAMILIES).flatMap(([fam, ws]) => ws.map((w) => [w, fam] as const)));
export const COLOUR_WORDS = [...COLOUR_OF.keys()].sort((a, b) => b.length - a.length);

/** The colour family a phrase names ("steel-grey eyes" → grey), or null. */
export function colourOf(text: string): string | null {
  const t = text.toLowerCase();
  for (const w of COLOUR_WORDS) if (new RegExp(`(?<![\\p{L}-])${w.replace(/-/g, "[- ]?")}(?![\\p{L}-])`, "u").test(t)) return COLOUR_OF.get(w)!;
  return null;
}

/** Which side a phrase names ("her left hand" → left), or null. */
export function sideOf(text: string): "left" | "right" | null {
  const l = /\bleft\b/i.test(text);
  const r = /\bright\b/i.test(text);
  return l && !r ? "left" : r && !l ? "right" : null;
}

/** A height in centimetres ("5'7\"", "five foot seven", "170 cm", "1.7 m"). */
export function heightCm(text: string): number | null {
  const t = text.toLowerCase();
  let m = t.match(/(\d)\s*(?:'|’|ft|foot|feet)\s*(\d{1,2})?\s*(?:"|”|in|inches)?/);
  if (m) return Math.round((Number(m[1]) * 12 + Number(m[2] ?? 0)) * 2.54);
  m = t.match(/(\d{2,3})\s*cm/);
  if (m) return Number(m[1]);
  m = t.match(/(\d)[.,](\d{1,2})\s*m\b/);
  if (m) return Math.round(Number(`${m[1]}.${m[2]}`) * 100);
  return null;
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
/** A number in digits or words ("twenty-four" → 24), or null. */
export function numberOf(text: string): number | null {
  const d = text.match(/\b(\d{1,4})\b/);
  if (d) return Number(d[1]);
  const m = text.toLowerCase().match(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](one|two|three|four|five|six|seven|eight|nine))?\b|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/);
  if (!m) return null;
  return m[3] ? NUMBER_WORDS[m[3]]! : NUMBER_WORDS[m[1]!]! + (m[2] ? NUMBER_WORDS[m[2]]! : 0);
}

/**
 * One form for a slot's value, for comparing: a colour family for eyes and hair, a side and a
 * part for scars, centimetres for height, a number for age, else the words lowercased.
 */
export function normalizeValue(slot: string | null | undefined, value: string): string {
  const s = (slot ?? "").toLowerCase();
  const v = value.trim();
  if (s === "eyes" || s === "hair" || s === "skin" || s === "colours") return colourOf(v) ?? v.toLowerCase();
  if (s === "height") return heightCm(v)?.toString() ?? v.toLowerCase();
  if (s === "age") return numberOf(v)?.toString() ?? v.toLowerCase();
  if (s === "handedness") return /\bleft/i.test(v) ? "left" : /\bright/i.test(v) ? "right" : /ambi|both/i.test(v) ? "both" : v.toLowerCase();
  return v.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
}

const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, few: 3, couple: 2 };

/**
 * 5.2: how long a state says it lasts ("arm in a sling, about six weeks" → 6 weeks in minutes), or null.
 * A moon counts as a month.
 */
export function durationIn(text: string): number | null {
  const m = text.toLowerCase().match(/\b(?:for |about |around |roughly |some )?(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|few|couple)\s+(?:of\s+)?(minutes?|hours?|days?|weeks?|months?|moons?|years?)\b/);
  if (!m) return null;
  const n = WORD_NUM[m[1]!] ?? Number(m[1]);
  return Number.isFinite(n) && n > 0 ? parseDuration(`${n} ${m[2]!.replace(/^moons?$/, "months")}`) : null;
}

/** Whether two values of a slot say the same thing ("gray" and "steel-grey" eyes do). */
export const sameValue = (slot: string | null | undefined, a: string, b: string) => normalizeValue(slot, a) === normalizeValue(slot, b);
