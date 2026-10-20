import type { EntryExtra } from "./activate";
import type { BookRole, LoreEntry, LorePosition } from "./types";

/**
 * Lorebook categories (Almanac plan I1). Each entry can carry a category (in `extra.category`);
 * a category sets a sensible default position and priority, and tells the Codex what kind of
 * thing the entry is about. Auto-sort guesses the category from the title and the words, with a
 * confidence the editor shows as a dot, and you correct it in one tap.
 *
 * Dream Weaver books (rules, NPCs, depth and lore books) are recognised by their names, so every
 * entry in one starts from that book's category.
 */

export const CATEGORIES = [
  "timeline", "rule", "ooc", "character", "relationship", "voice", "current", "belief",
  "secret", "faction", "upcoming", "item", "location", "history", "customs", "scene",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface CategoryInfo {
  id: Category;
  label: string;
  /** Where it goes and how strongly it's kept (lower order goes first, as in SillyTavern). */
  position: LorePosition;
  order: number;
  depth?: number;
  /** Always in the prompt (rules, the timeline boundary). */
  constant?: boolean;
  /** What the Codex calls the thing it's about. */
  type?: NonNullable<EntryExtra["type"]>;
  hint: string;
}

export const CATEGORY_INFO: Record<Category, CategoryInfo> = {
  timeline: { id: "timeline", label: "Timeline boundary", position: "before_char", order: 5, constant: true, type: "rule", hint: "where the story stands; what hasn't happened yet" },
  rule: { id: "rule", label: "Rule", position: "before_char", order: 10, constant: true, type: "rule", hint: "how the world works, always" },
  ooc: { id: "ooc", label: "OOC", position: "depth", order: 15, depth: 4, hint: "notes to the writer, out of character" },
  character: { id: "character", label: "Character", position: "after_char", order: 100, type: "character", hint: "a person" },
  relationship: { id: "relationship", label: "Relationship", position: "after_char", order: 110, type: "concept", hint: "what's between two people" },
  voice: { id: "voice", label: "Voice", position: "after_char", order: 115, type: "character", hint: "how someone talks" },
  current: { id: "current", label: "Current", position: "depth", order: 120, depth: 2, type: "event", hint: "how things stand right now" },
  belief: { id: "belief", label: "Belief", position: "after_char", order: 125, type: "concept", hint: "what someone holds true (true or not)" },
  secret: { id: "secret", label: "Secret", position: "after_char", order: 130, type: "concept", hint: "kept from someone; can be kept off the page" },
  faction: { id: "faction", label: "Faction", position: "after_char", order: 140, type: "faction", hint: "a group, house, guild or side" },
  upcoming: { id: "upcoming", label: "Upcoming", position: "depth", order: 150, depth: 3, type: "event", hint: "what's coming, foreshadowed" },
  item: { id: "item", label: "Item", position: "after_char", order: 160, type: "item", hint: "an object that matters" },
  location: { id: "location", label: "Location", position: "after_char", order: 170, type: "location", hint: "a place" },
  history: { id: "history", label: "History", position: "before_char", order: 60, type: "event", hint: "what happened before" },
  customs: { id: "customs", label: "Customs", position: "before_char", order: 70, type: "rule", hint: "manners, rites, how people do things" },
  scene: { id: "scene", label: "Scene", position: "depth", order: 200, depth: 1, type: "event", hint: "for one kind of scene, while it lasts" },
};

const NAME = "[A-Z][\\w'’.-]*(?:\\s+[A-Z][\\w'’.-]*)*";
/** Strongest signals first: a title shaped like "A & B", an explicit tag, then the words. */
const RULES: { cat: Category; title?: RegExp; text?: RegExp; weight: number }[] = [
  { cat: "relationship", title: new RegExp(`^${NAME}\\s*(?:&|and|\\+|x|\\/|×)\\s*${NAME}\\b`), weight: 0.9 },
  { cat: "ooc", title: /\b(ooc|author'?s note|note to (?:the )?(?:ai|writer|model)|instructions?)\b/i, text: /^\s*[[(]\s*ooc\b/i, weight: 0.9 },
  { cat: "timeline", title: /\b(timeline|canon (?:point|cutoff)|as of|current arc|story so far|where (?:we|the story) (?:are|stands))\b/i, weight: 0.85 },
  { cat: "scene", title: /^\s*scene\s*[:\-–—]|\bscene (?:rules?|guide)\b/i, weight: 0.85 },
  { cat: "upcoming", title: /\b(upcoming|coming|future|planned|foreshadow\w*|next arc|prophecy)\b/i, text: /\b(will (?:soon|eventually)|is going to|in the coming)\b/i, weight: 0.8 },
  { cat: "secret", title: /\b(secrets?|hidden|true identity|the truth about)\b/i, text: /\b(no one knows|nobody knows|keeps (?:it )?secret|unaware that|hides? (?:the fact|that))\b/i, weight: 0.8 },
  { cat: "voice", title: /\b(voice|speech|dialogue|how .* talks|speaking style|catchphrases?|mannerisms)\b/i, text: /\b(speaks (?:in|with)|talks (?:in|like)|says things like|verbal tic)\b/i, weight: 0.8 },
  { cat: "current", title: /\b(current|currently|now|status|state of|present day)\b/i, text: /^\s*(?:currently|right now|at present)\b/i, weight: 0.7 },
  { cat: "belief", title: /\b(beliefs?|rumou?rs?|myths?|legends?|superstitions?|what .* thinks?)\b/i, text: /\b(believes? that|is convinced that|rumou?r has it|legend says)\b/i, weight: 0.7 },
  { cat: "customs", title: /\b(customs?|traditions?|etiquette|festivals?|holidays?|rites?|rituals?|manners|ceremon(?:y|ies))\b/i, weight: 0.75 },
  { cat: "rule", title: /\b(rules?|laws?|magic system|how .* works|mechanics|limits?|constraints?)\b/i, text: /^\s*(?:always|never)\b|\b(must always|can never|is forbidden)\b/i, weight: 0.7 },
  { cat: "history", title: /\b(history|war of|the fall of|founding|era|age of|ancient|past|backstory of the)\b/i, text: /\b(years ago|centuries ago|long ago|was founded)\b/i, weight: 0.7 },
  { cat: "faction", title: /\b(factions?|guilds?|house|clan|order|gang|cult|company|corporation|council|army|court|kingdom)\b/i, weight: 0.65 },
  { cat: "item", title: /\b(sword|ring|amulet|book|key|blade|staff|artifact|artefact|relic|weapon|necklace|map|letter|potion)\b/i, weight: 0.6 },
  { cat: "location", title: /\b(city|town|village|castle|tavern|inn|forest|river|mountain|street|district|palace|keep|tower|harbou?r|port|island|school|house of)\b/i, weight: 0.6 },
];

export interface CategoryGuess {
  category: Category;
  /** 0..1: the editor shows it as a dot (high, medium, low). */
  confidence: number;
  why: string;
}

/** Auto-sort: the likeliest category from the title, the words, and (as a fallback) the entry's type. */
export function guessCategory(e: Pick<LoreEntry, "comment" | "content" | "keys" | "constant"> & { extra?: Record<string, unknown> }, bookName = "", role?: BookRole): CategoryGuess {
  const title = (e.comment || e.keys[0] || "").trim();
  const text = e.content ?? "";
  const dw = (role && ROLE_CATEGORY[role]) || dreamWeaverCategory(bookName);
  // Nothing in a depth book is a live situation, whatever its title says ("Her status in the clan").
  const rules = isDepthBook(bookName, role) ? RULES.filter((r) => r.cat !== "current") : RULES;
  for (const r of rules) {
    if (r.title?.test(title)) return { category: r.cat, confidence: r.weight, why: `the title ("${title.slice(0, 40)}")` };
  }
  for (const r of rules) {
    if (r.text?.test(text)) return { category: r.cat, confidence: r.weight - 0.2, why: "the words in it" };
  }
  if (dw) return { category: dw, confidence: 0.75, why: "a Dream Weaver book" };
  const type = (e.extra as EntryExtra | undefined)?.type;
  const byType: Partial<Record<NonNullable<EntryExtra["type"]>, Category>> = { character: "character", location: "location", item: "item", faction: "faction", event: "history", rule: "rule" };
  if (type && byType[type]) return { category: byType[type]!, confidence: 0.6, why: `its type (${type})` };
  // A proper name for a title, about someone (pronouns, a body, a mind): a character.
  if (new RegExp(`^${NAME}$`).test(title) && /\b(she|he|they|her|his|their)\b/i.test(text) && /\b(eyes|hair|years? old|personality|wants|fears|loves|hates)\b/i.test(text)) return { category: "character", confidence: 0.55, why: "a name, written about a person" };
  if (e.constant) return { category: "rule", confidence: 0.35, why: "it's always on" };
  return { category: "character", confidence: 0.2, why: "a guess" };
}

/** Dream Weaver books by their fixed names ("DW Rules", "Dream Weaver – NPCs", "…Depth…", "…Lore…"). */
export function dreamWeaverCategory(bookName: string): Category | null {
  // Lumiverse's Weaver (and Mea's creator) name bound books "<Name> rules book", "<Name> NPC book"…
  const bound = bookName.match(/\b(rules|npc|people|depth|lore) book$/i)?.[1]?.toLowerCase();
  if (bound) return ROLE_CATEGORY[bound === "npc" ? "people" : (bound as BookRole)] ?? null;
  if (!/\b(dream\s*weaver|dw)\b/i.test(bookName)) return null;
  if (/\brules?\b/i.test(bookName)) return "rule";
  if (/\bnpcs?\b|\bcharacters?\b/i.test(bookName)) return "character";
  // A Weaver depth book is a character's inner material, never what's happening now.
  if (/\bdepth\b/i.test(bookName)) return null;
  if (/\blore\b|\bworld\b/i.test(bookName)) return "history";
  return null;
}

/**
 * A book's role sets the category its entries start from. Depth books have none: their entries are a
 * character's inner life and past, and Current (always in the scene, a running subplot in the sim)
 * would put every one of them in every prompt.
 */
export const ROLE_CATEGORY: Partial<Record<BookRole, Category>> = { rules: "rule", people: "character", lore: "history" };

/** A depth book by its role or its name ("Marisol depth book", "DW Depth"). */
export const isDepthBook = (bookName: string, role?: BookRole) => role === "depth" || /\bdepth book$/i.test(bookName) || (/\b(dream\s*weaver|dw)\b/i.test(bookName) && /\bdepth\b/i.test(bookName));

export const categoryOf = (e: { extra?: Record<string, unknown> }): Category | null => {
  const c = (e.extra as { category?: unknown } | undefined)?.category;
  return typeof c === "string" && (CATEGORIES as readonly string[]).includes(c) ? (c as Category) : null;
};

/** An entry's title without a merged book's "[source] " prefix. */
export const loreTitle = (e: { comment: string; keys: string[] }) => (e.comment || e.keys[0] || "").replace(/^\s*\[[^\]]*\]\s*/, "").trim();

const CURRENT_TAG = /^current\s*[:\-–—|]\s*/i;

/**
 * How things stand right now ("CURRENT - Hellions Raid Sunnydale", or the Current category): true
 * from the first message, so it's in the scene whether or not anyone names it.
 */
export const isCurrent = (e: { comment: string; keys: string[]; extra?: Record<string, unknown> }) => categoryOf(e) === "current" || CURRENT_TAG.test(loreTitle(e));

/** A current entry's situation, without its tag ("Hellions Raid Sunnydale"). */
export const currentTitle = (e: { comment: string; keys: string[] }) => loreTitle(e).replace(CURRENT_TAG, "").trim();

/**
 * Sets an entry's category; with `defaults`, also the category's position, priority and depth
 * (and "always on" for rules and the timeline boundary). The Codex type follows when it isn't set.
 */
export function withCategory<T extends LoreEntry>(e: T, category: Category, opts: { defaults?: boolean; confidence?: number } = {}): T {
  const info = CATEGORY_INFO[category];
  const extra: Record<string, unknown> = { ...(e.extra ?? {}), category, ...(opts.confidence != null ? { categoryConfidence: Math.round(opts.confidence * 100) / 100 } : { categoryConfidence: 1 }) };
  if (info.type && !(e.extra as EntryExtra)?.type) extra.type = info.type;
  if (!opts.defaults) return { ...e, extra };
  return { ...e, extra, position: info.position, order: info.order, ...(info.depth != null ? { depth: info.depth } : {}), ...(info.constant ? { constant: true } : {}) };
}
