import type { EntryExtra } from "./activate";
import type { SlotGroup } from "./slots";
import type { BookRole, LoreEntry, LorePosition } from "./types";

/**
 * Lorebook categories (Almanac plan I1). Each entry can carry a category (in `extra.category`);
 * a category sets a sensible default position and priority, and tells the Codex what kind of
 * thing the entry is about. Auto-sort guesses the category from the title and the words, with a
 * confidence the editor shows as a dot, and you correct it in one tap.
 *
 * docs/17 calls them kinds: 28 of them on five shelves, each with the parts it covers, what fires
 * it and who it's about, so the Lore Studio can plan, write and check every kind to its purpose.
 *
 * Dream Weaver books (rules, NPCs, depth and lore books) are recognised by their names, so every
 * entry in one starts from that book's category.
 */

export const CATEGORIES = [
  "timeline", "rule", "power", "ooc",
  "character", "voice", "relationship", "family", "moment", "reaction", "belief", "secret",
  "location", "faction", "species", "item", "faith", "customs", "lexicon", "money", "climate",
  "history", "current", "upcoming", "hook", "mystery", "routine",
  "scene",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** The picker's groups (docs/17): what's always true, people, the world, time, and scenes. */
export type Shelf = "ground" | "people" | "world" | "time" | "scenes";
export const SHELVES: { id: Shelf; label: string }[] = [
  { id: "ground", label: "Ground truth" },
  { id: "people", label: "People" },
  { id: "world", label: "World" },
  { id: "time", label: "Time" },
  { id: "scenes", label: "Scenes" },
];

/**
 * What fires an entry of this kind: always on; its names (and its entity in the scene); its
 * meaning; its subject being in the scene (a voice); or its topic's words (a reaction, a term).
 */
export type Fires = "always" | "names" | "meaning" | "subject" | "topic";

export interface CategoryInfo {
  id: Category;
  label: string;
  shelf: Shelf;
  /** Where it goes and how strongly it's kept (lower order goes first, as in SillyTavern). */
  position: LorePosition;
  order: number;
  depth?: number;
  /** Always in the prompt (rules, the timeline boundary). */
  constant?: boolean;
  /** What the Codex calls the thing it's about. */
  type?: NonNullable<EntryExtra["type"]>;
  hint: string;
  /** A one-line example, for the picker. */
  example: string;
  /** The parts an entry of this kind covers, in order (its shape, and the editor's template). */
  fields: string[];
  fires: Fires;
  /** Who it's about: nobody in particular, one person (a voice), or two (a relationship). */
  subject: "none" | "one" | "two";
  /** How long it runs against the chosen entry length (a reaction is short, a lexicon long). */
  lengthScale: number;
  /** The detail-sheet slots it fills (lore/slots.ts). */
  slots?: SlotGroup;
}

type Info = Omit<CategoryInfo, "id">;

const INFO = {
  // Ground truth
  timeline: { label: "Timeline boundary", shelf: "ground", position: "before_char", order: 5, constant: true, type: "rule", hint: "where the story stands; what hasn't happened yet", example: "After the siege of Harlow Pier; the Guild hasn't fallen yet", fields: ["As of", "Already happened", "Not yet"], fires: "always", subject: "none", lengthScale: 0.8 },
  rule: { label: "Rule", shelf: "ground", position: "before_char", order: 10, constant: true, type: "rule", hint: "how the world works, always", example: "No ship sails past the lamp after dark", fields: ["The rule", "Why", "Exceptions"], fires: "always", subject: "none", lengthScale: 0.6 },
  power: { label: "Power", shelf: "ground", position: "before_char", order: 20, type: "concept", hint: "a magic system, technology or abilities: what it does, costs and can't do", example: "Tidecalling: drawn from the moon, paid for in memory", fields: ["Source", "What it can do", "What it can't do", "The cost", "Who has it"], fires: "names", subject: "none", lengthScale: 1 },
  ooc: { label: "Writer's notes (OOC)", shelf: "ground", position: "depth", order: 15, depth: 4, hint: "notes to the writer: style, pacing, point of view, limits", example: "Slow pacing; no time skips without asking", fields: ["Style", "Pacing", "Limits"], fires: "always", subject: "none", lengthScale: 0.5 },
  // People
  character: { label: "Character", shelf: "people", position: "after_char", order: 100, type: "character", hint: "a person", example: "Mira Vell, the lighthouse keeper's daughter", fields: ["Looks", "Manner", "History", "Wants", "Fears"], fires: "names", subject: "none", lengthScale: 1, slots: "character" },
  voice: { label: "Voice", shelf: "people", position: "after_char", order: 115, type: "character", hint: "how someone talks", example: "Voice: Mira (low, short, harbour words)", fields: ["Register", "Rhythm", "Vocabulary", "Pet names", "Catchphrases", "Swearing", "Greeting", "Goodbye", "Never says", "How it shifts", "Sample lines"], fires: "subject", subject: "one", lengthScale: 0.9, slots: "voice" },
  relationship: { label: "Relationship", shelf: "people", position: "after_char", order: 110, type: "concept", hint: "what's between two people", example: "Mira & Joss", fields: ["How they met", "What each is to the other", "The tension", "History", "Where it stands now"], fires: "names", subject: "two", lengthScale: 0.9 },
  family: { label: "Family", shelf: "people", position: "after_char", order: 105, type: "faction", hint: "a household or bloodline: members, roles, how they get on", example: "The Vells: three generations of keepers", fields: ["Members", "Head", "Dynamics", "Feuds", "Home"], fires: "names", subject: "none", lengthScale: 1 },
  moment: { label: "Shared moment", shelf: "people", position: "after_char", order: 118, type: "event", hint: "one remembered moment between two people", example: "The night of the dark lamp", fields: ["When", "Where", "What happened", "What was said", "What it means to each"], fires: "topic", subject: "two", lengthScale: 0.8 },
  reaction: { label: "Reaction", shelf: "people", position: "depth", order: 116, depth: 2, type: "concept", hint: "how someone reacts when a topic comes up", example: "Mira, when her mother comes up", fields: ["Trigger", "What they do", "What they say", "Why"], fires: "topic", subject: "one", lengthScale: 0.5 },
  belief: { label: "Belief", shelf: "people", position: "after_char", order: 125, type: "concept", hint: "what someone holds true (true or not)", example: "The docks believe the lamp is haunted", fields: ["Who believes", "What", "How strongly", "The truth"], fires: "meaning", subject: "one", lengthScale: 0.7 },
  secret: { label: "Secret", shelf: "people", position: "after_char", order: 130, type: "concept", hint: "kept from someone; can be kept off the page", example: "The second key", fields: ["The open part", "The truth", "Kept from", "If it comes out"], fires: "topic", subject: "one", lengthScale: 0.7 },
  // World
  location: { label: "Location", shelf: "world", position: "after_char", order: 170, type: "location", hint: "a place", example: "The lighthouse at Saltpans", fields: ["Looks", "Atmosphere", "Who's there", "Features", "Dangers"], fires: "names", subject: "none", lengthScale: 1, slots: "location" },
  faction: { label: "Faction", shelf: "world", position: "after_char", order: 140, type: "faction", hint: "a group, house, guild or side", example: "The Harbour Guild", fields: ["Who they are", "Goals", "Leaders", "Methods", "Allies and enemies"], fires: "names", subject: "none", lengthScale: 1, slots: "group" },
  species: { label: "Species", shelf: "world", position: "after_char", order: 145, type: "concept", hint: "a people, race or creature: body, mind, culture, dangers", example: "Selkies of the outer reefs", fields: ["Body", "Mind", "Culture", "How others see them", "Dangers"], fires: "names", subject: "none", lengthScale: 1 },
  item: { label: "Item", shelf: "world", position: "after_char", order: 160, type: "item", hint: "an object that matters", example: "The second key", fields: ["Looks", "What it does", "History", "Who has it"], fires: "names", subject: "none", lengthScale: 0.8, slots: "item" },
  faith: { label: "Faith", shelf: "world", position: "before_char", order: 72, type: "concept", hint: "gods, churches, rites, and what people swear by", example: "The Drowned Mother and her keepers", fields: ["What's worshipped", "Clergy", "Rites", "Oaths and curses", "Heresies"], fires: "names", subject: "none", lengthScale: 1 },
  customs: { label: "Customs", shelf: "world", position: "before_char", order: 70, type: "rule", hint: "manners, rites, food, festivals, how people do things", example: "Salt on the doorstep at a death", fields: ["The custom", "When", "Who", "What breaking it means"], fires: "meaning", subject: "none", lengthScale: 0.8 },
  lexicon: { label: "Lexicon", shelf: "world", position: "before_char", order: 74, type: "concept", hint: "the world's words: slang, titles, terms, how to address people", example: "Harbour slang: little fish, dark lamp, keeper", fields: ["Terms", "Who says them"], fires: "topic", subject: "none", lengthScale: 1.4 },
  money: { label: "Money and trade", shelf: "world", position: "before_char", order: 76, type: "concept", hint: "currency, prices, what's scarce, who trades what", example: "Crowns and bits; lamp oil costs a crown a cask", fields: ["Coins and worth", "What things cost", "What's scarce", "Markets"], fires: "topic", subject: "none", lengthScale: 1.2 },
  climate: { label: "Climate and seasons", shelf: "world", position: "before_char", order: 78, type: "concept", hint: "weather, seasons, and what they do to life here", example: "Fog all autumn; winter storms close the harbour", fields: ["The seasons", "Now", "What the weather changes", "Dangers"], fires: "meaning", subject: "none", lengthScale: 0.8 },
  // Time
  history: { label: "History", shelf: "time", position: "before_char", order: 60, type: "event", hint: "what happened before", example: "The siege of Harlow Pier", fields: ["What happened", "When", "Who", "What it left behind"], fires: "names", subject: "none", lengthScale: 1 },
  current: { label: "Current", shelf: "time", position: "depth", order: 120, depth: 2, type: "event", hint: "how things stand right now", example: "Raiders Burn the Docks", fields: ["What's happening", "Who", "Where", "What each side wants", "What happens next if nobody acts"], fires: "always", subject: "none", lengthScale: 0.9 },
  upcoming: { label: "Upcoming", shelf: "time", position: "depth", order: 150, depth: 3, type: "event", hint: "what's coming, foreshadowed", example: "The Guild's fleet returns at midwinter", fields: ["What", "When", "Signs to drop", "Who knows"], fires: "meaning", subject: "none", lengthScale: 0.8 },
  hook: { label: "Hook", shelf: "time", position: "depth", order: 155, depth: 3, type: "event", hint: "an opening a scene can pick up: a job, a rumour, a stranger in need", example: "A Guild inspection at dawn", fields: ["Setup", "Who offers it", "Stakes", "Where it leads"], fires: "meaning", subject: "none", lengthScale: 0.7 },
  mystery: { label: "Mystery", shelf: "time", position: "after_char", order: 135, type: "concept", hint: "an open question the story is built around", example: "Who relit the lamp?", fields: ["The question", "The truth", "Clues", "Red herrings", "Who's hiding what"], fires: "topic", subject: "none", lengthScale: 1.1 },
  routine: { label: "Routine", shelf: "time", position: "after_char", order: 175, type: "event", hint: "who is where, when: a day at the inn, the guard's rounds", example: "A day on the quay", fields: ["Schedule", "What breaks it"], fires: "names", subject: "none", lengthScale: 1 },
  // Scenes
  scene: { label: "Scene", shelf: "scenes", position: "depth", order: 200, depth: 1, type: "event", hint: "for one kind of scene, while it lasts", example: "A storm at sea", fields: ["When it applies", "How to write it", "What to track", "How it ends"], fires: "meaning", subject: "none", lengthScale: 0.8 },
} satisfies Record<Category, Info>;

export const CATEGORY_INFO = Object.fromEntries(CATEGORIES.map((id) => [id, { id, ...INFO[id] } as CategoryInfo])) as Record<Category, CategoryInfo>;

/** The kinds on each shelf, in picker order. */
export const kindsOn = (shelf: Shelf) => CATEGORIES.filter((c) => CATEGORY_INFO[c].shelf === shelf);

/** A skeleton for a new entry of this kind: its fields as labelled lines. */
export const kindTemplate = (c: Category, name = "") => `${name ? `${name}. ` : ""}${CATEGORY_INFO[c].fields.map((f) => `${f}: `).join("\n")}`;

const NAME = "[A-Z][\\w'’.-]*(?:\\s+[A-Z][\\w'’.-]*)*";
/** A title tagged with its kind ("Reaction: Mira, when…", "Lexicon - harbour slang"). */
const TAGGED: [Category, string][] = [
  ["voice", "voice|speech"], ["reaction", "reactions?|triggers?"], ["moment", "moments?|memory|memories"], ["family", "family|families|household"],
  ["power", "powers?|magic|abilit(?:y|ies)"], ["species", "species|races?|creatures?"], ["faith", "faith|religion|gods?"], ["lexicon", "lexicon|glossary|slang"],
  ["money", "money|trade|economy|currency"], ["climate", "climate|weather|seasons?"], ["hook", "hooks?|quests?"], ["mystery", "myster(?:y|ies)"], ["routine", "routines?|schedule"],
];
const tag = (words: string) => new RegExp(`^\\s*(?:${words})\\s*[:\\-–—|]\\s*\\S`, "i");

/** Strongest signals first: a title shaped like "A & B", an explicit tag, then the words. */
const RULES: { cat: Category; title?: RegExp; text?: RegExp; weight: number }[] = [
  { cat: "relationship", title: new RegExp(`^${NAME}\\s*(?:&|and|\\+|x|\\/|×)\\s*${NAME}\\b`), weight: 0.9 },
  { cat: "ooc", title: /\b(ooc|author'?s note|note to (?:the )?(?:ai|writer|model)|instructions?)\b/i, text: /^\s*[[(]\s*ooc\b/i, weight: 0.9 },
  { cat: "timeline", title: /\b(timeline|canon (?:point|cutoff)|as of|current arc|story so far|where (?:we|the story) (?:are|stands))\b/i, weight: 0.85 },
  { cat: "scene", title: /^\s*scene\s*[:\-–—]|\bscene (?:rules?|guide)\b/i, weight: 0.85 },
  ...TAGGED.map(([cat, words]) => ({ cat, title: tag(words), weight: 0.9 })),
  { cat: "reaction", title: /\bwhen (?:\w+ )*(?:comes? up|is mentioned|mentions|brings? up|asks? about)\b|\bif (?:someone|anyone) (?:mentions|asks about)\b/i, text: /\b(whenever (?:someone|anyone|people) (?:mentions?|brings? up|asks? about)|if (?:someone|anyone) (?:mentions|brings up|asks about))\b/i, weight: 0.85 },
  { cat: "upcoming", title: /\b(upcoming|coming|future|planned|foreshadow\w*|next arc|prophecy)\b/i, text: /\b(will (?:soon|eventually)|is going to|in the coming)\b/i, weight: 0.8 },
  { cat: "mystery", title: /\b(myster(?:y|ies)|who killed|whodunn?it|unsolved|riddle of|disappearance of)\b|^\s*(?:who|what|why|where)\b.*\?\s*$/i, text: /\b(no one knows who|nobody knows who|it is unknown who|remains unsolved)\b/i, weight: 0.8 },
  { cat: "secret", title: /\b(secrets?|hidden|true identity|the truth about)\b/i, text: /\b(no one knows|nobody knows|keeps (?:it )?secret|unaware that|hides? (?:the fact|that))\b/i, weight: 0.8 },
  { cat: "moment", title: /\b(the (?:night|day|time) (?:we|they|of the)|remember when|first (?:kiss|meeting|met)|when we met)\b/i, text: /\b(the (?:night|day|time) (?:we|they) (?:first )?(?:met|kissed)|remembers? the (?:night|day) (?:when|that))\b/i, weight: 0.8 },
  { cat: "lexicon", title: /\b(glossary|lexicon|slang|terminology|vocabulary|jargon|dialects?|languages?|forms? of address)\b/i, weight: 0.8 },
  { cat: "voice", title: /\b(voice|speech|dialogue|how .* talks|speaking style|catchphrases?|mannerisms)\b/i, text: /\b(speaks (?:in|with)|talks (?:in|like)|says things like|verbal tic)\b/i, weight: 0.8 },
  { cat: "routine", title: /\b(routines?|schedules?|timetable|daily life|a day (?:at|in|on))\b/i, weight: 0.75 },
  { cat: "current", title: /\b(current|currently|now|status|state of|present day)\b/i, text: /^\s*(?:currently|right now|at present)\b/i, weight: 0.7 },
  { cat: "belief", title: /\b(beliefs?|rumou?rs?|myths?|legends?|superstitions?|what .* thinks?)\b/i, text: /\b(believes? that|is convinced that|rumou?r has it|legend says)\b/i, weight: 0.7 },
  { cat: "hook", title: /\b(hooks?|quests?|jobs?|bount(?:y|ies)|commissions?|plot seeds?)\b/i, weight: 0.7 },
  { cat: "customs", title: /\b(customs?|traditions?|etiquette|festivals?|holidays?|rites?|rituals?|manners|ceremon(?:y|ies))\b/i, weight: 0.75 },
  { cat: "climate", title: /\b(climate|weather|seasons?|monsoon|rainy season|dry season)\b/i, weight: 0.75 },
  { cat: "power", title: /\b(magic|sorcery|spells?|powers?|abilit(?:y|ies)|bending|psionics?|technology|cybernetics)\b/i, text: /\b(draws? (?:power|magic) from|the price of (?:using|casting))\b/i, weight: 0.7 },
  { cat: "rule", title: /\b(rules?|laws?|how .* works|mechanics|limits?|constraints?)\b/i, text: /^\s*(?:always|never)\b|\b(must always|can never|is forbidden)\b/i, weight: 0.7 },
  { cat: "species", title: /\b(species|races?|creatures?|monsters?|beasts?|bestiary)\b/i, weight: 0.7 },
  { cat: "faith", title: /\b(gods?|goddess(?:es)?|deit(?:y|ies)|pantheon|church|faith|religions?|saints?|oaths?|priesthood|worship)\b/i, weight: 0.7 },
  { cat: "family", title: /\b(family|families|household|bloodline|lineage|dynasty|family tree|kin)\b/i, weight: 0.7 },
  { cat: "history", title: /\b(history|war of|the fall of|founding|era|age of|ancient|past|backstory of the)\b/i, text: /\b(years ago|centuries ago|long ago|was founded)\b/i, weight: 0.7 },
  { cat: "faction", title: /\b(factions?|guilds?|house|clan|order|gang|cult|company|corporation|council|army|court|kingdom)\b/i, weight: 0.65 },
  { cat: "money", title: /\b(currency|money|coins?|coinage|prices?|economy|trade|wages|taxes)\b/i, text: /\b\d+\s*(?:coins?|crowns?|gold|silver|copper|credits)\b/i, weight: 0.65 },
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
