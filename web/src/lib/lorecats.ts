/** I1 / docs/17: lore kinds (mirrors server/src/lore/format.ts), grouped on shelves, for pickers. */
export type Shelf = "ground" | "people" | "world" | "time" | "scenes";

export const SHELVES: { id: Shelf; label: string }[] = [
  { id: "ground", label: "Ground truth" },
  { id: "people", label: "People" },
  { id: "world", label: "World" },
  { id: "time", label: "Time" },
  { id: "scenes", label: "Scenes" },
];

export const LORE_CATEGORIES = [
  { id: "timeline", label: "Timeline boundary", shelf: "ground", hint: "where the story stands; what hasn't happened yet" },
  { id: "rule", label: "Rule", shelf: "ground", hint: "how the world works, always" },
  { id: "power", label: "Power", shelf: "ground", hint: "a magic system, technology or abilities: what it does, costs and can't do" },
  { id: "ooc", label: "Writer's notes (OOC)", shelf: "ground", hint: "notes to the writer: style, pacing, point of view, limits" },
  { id: "character", label: "Character", shelf: "people", hint: "a person" },
  { id: "voice", label: "Voice", shelf: "people", hint: "how someone talks" },
  { id: "relationship", label: "Relationship", shelf: "people", hint: "what's between two people" },
  { id: "family", label: "Family", shelf: "people", hint: "a household or bloodline: members, roles, how they get on" },
  { id: "moment", label: "Shared moment", shelf: "people", hint: "one remembered moment between two people" },
  { id: "reaction", label: "Reaction", shelf: "people", hint: "how someone reacts when a topic comes up" },
  { id: "belief", label: "Belief", shelf: "people", hint: "what someone holds true (true or not)" },
  { id: "secret", label: "Secret", shelf: "people", hint: "kept from someone; can be kept off the page" },
  { id: "location", label: "Location", shelf: "world", hint: "a place" },
  { id: "faction", label: "Faction", shelf: "world", hint: "a group, house, guild or side" },
  { id: "species", label: "Species", shelf: "world", hint: "a people, race or creature: body, mind, culture, dangers" },
  { id: "item", label: "Item", shelf: "world", hint: "an object that matters" },
  { id: "faith", label: "Faith", shelf: "world", hint: "gods, churches, rites, and what people swear by" },
  { id: "customs", label: "Customs", shelf: "world", hint: "manners, rites, food, festivals, how people do things" },
  { id: "lexicon", label: "Lexicon", shelf: "world", hint: "the world's words: slang, titles, terms, how to address people" },
  { id: "money", label: "Money and trade", shelf: "world", hint: "currency, prices, what's scarce, who trades what" },
  { id: "climate", label: "Climate and seasons", shelf: "world", hint: "weather, seasons, and what they do to life here" },
  { id: "history", label: "History", shelf: "time", hint: "what happened before" },
  { id: "current", label: "Current", shelf: "time", hint: "how things stand right now" },
  { id: "upcoming", label: "Upcoming", shelf: "time", hint: "what's coming, foreshadowed" },
  { id: "hook", label: "Hook", shelf: "time", hint: "an opening a scene can pick up: a job, a rumour, a stranger in need" },
  { id: "mystery", label: "Mystery", shelf: "time", hint: "an open question the story is built around" },
  { id: "routine", label: "Routine", shelf: "time", hint: "who is where, when: a day at the inn, the guard's rounds" },
  { id: "scene", label: "Scene", shelf: "scenes", hint: "for one kind of scene, while it lasts" },
] as const satisfies readonly { id: string; label: string; shelf: Shelf; hint: string }[];

export type LoreCategory = (typeof LORE_CATEGORIES)[number]["id"];

export const categoryLabel = (id: string | null | undefined) => LORE_CATEGORIES.find((c) => c.id === id)?.label ?? "";

/** The kinds on each shelf, for `<optgroup>`s and the new-entry picker. */
export const kindsByShelf = SHELVES.map((s) => ({ ...s, kinds: LORE_CATEGORIES.filter((c) => c.shelf === s.id) }));
