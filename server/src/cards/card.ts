/**
 * Character card normalization (CHAR-01). Mea stores cards as V3-shaped data and
 * keeps every unknown field so cards round-trip untouched.
 */

export interface CardBookEntry {
  keys: string[];
  content: string;
  extensions: Record<string, unknown>;
  enabled: boolean;
  insertion_order: number;
  case_sensitive?: boolean;
  use_regex?: boolean;
  constant?: boolean;
  name?: string;
  priority?: number;
  id?: number | string;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  position?: "before_char" | "after_char" | string;
  [k: string]: unknown;
}

export interface CardBook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: CardBookEntry[];
  [k: string]: unknown;
}

export interface CardData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  group_only_greetings: string[];
  tags: string[];
  creator: string;
  character_version: string;
  nickname?: string;
  source?: string[];
  creation_date?: number;
  modification_date?: number;
  assets?: { type: string; uri: string; name: string; ext: string }[];
  character_book?: CardBook;
  extensions: Record<string, unknown>;
  [k: string]: unknown;
}

export type CardSpec = "v1" | "v2" | "v3";

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function emptyCard(name = "New character"): CardData {
  return {
    name,
    description: "",
    personality: "",
    scenario: "",
    first_mes: "",
    mes_example: "",
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: [],
    group_only_greetings: [],
    tags: [],
    creator: "",
    character_version: "",
    extensions: {},
  };
}

/** Accepts V1 (flat), V2, V3, or SillyTavern hybrid JSON and returns normalized V3-shaped data. */
export function normalizeCard(input: unknown): { data: CardData; spec: CardSpec } {
  const root = obj(input);
  let spec: CardSpec = "v1";
  let src: Record<string, unknown> = root;
  if (root.spec === "chara_card_v3" && root.data) {
    spec = "v3";
    src = obj(root.data);
  } else if (root.spec === "chara_card_v2" && root.data) {
    spec = "v2";
    src = obj(root.data);
  } else if (root.data && typeof obj(root.data).name === "string") {
    spec = "v2";
    src = { ...root, ...obj(root.data) };
  }

  const name = str(src.name ?? root.char_name).trim();
  if (!name) throw new Error("Card has no name");

  const known = new Set([
    "name", "description", "personality", "scenario", "first_mes", "mes_example", "creator_notes",
    "system_prompt", "post_history_instructions", "alternate_greetings", "group_only_greetings", "tags",
    "creator", "character_version", "nickname", "source", "creation_date", "modification_date", "assets",
    "character_book", "extensions",
  ]);
  const unknown: Record<string, unknown> = {};
  if (spec !== "v1") for (const [k, v] of Object.entries(src)) if (!known.has(k)) unknown[k] = v;

  const data: CardData = {
    ...unknown,
    name,
    description: str(src.description),
    personality: str(src.personality),
    scenario: str(src.scenario),
    first_mes: str(src.first_mes),
    mes_example: str(src.mes_example),
    creator_notes: str(src.creator_notes ?? root.creatorcomment),
    system_prompt: str(src.system_prompt),
    post_history_instructions: str(src.post_history_instructions),
    alternate_greetings: strArr(src.alternate_greetings),
    group_only_greetings: strArr(src.group_only_greetings),
    tags: strArr(src.tags ?? root.tags),
    creator: str(src.creator),
    character_version: str(src.character_version),
    extensions: obj(src.extensions),
  };
  if (typeof src.nickname === "string" && src.nickname) data.nickname = src.nickname;
  if (Array.isArray(src.source)) data.source = strArr(src.source);
  if (typeof src.creation_date === "number") data.creation_date = src.creation_date;
  if (typeof src.modification_date === "number") data.modification_date = src.modification_date;
  if (Array.isArray(src.assets)) data.assets = src.assets as CardData["assets"];
  const book = normalizeBook(src.character_book);
  if (book) data.character_book = book;
  return { data, spec };
}

export function normalizeBook(input: unknown): CardBook | undefined {
  const b = obj(input);
  if (!Array.isArray(b.entries)) return undefined;
  return {
    ...b,
    extensions: obj(b.extensions),
    entries: (b.entries as unknown[]).map((e, i) => {
      const x = obj(e);
      return {
        ...x,
        keys: strArr(x.keys),
        content: str(x.content),
        extensions: obj(x.extensions),
        enabled: x.enabled !== false,
        insertion_order: typeof x.insertion_order === "number" ? x.insertion_order : 100,
        id: (x.id as number | string | undefined) ?? i,
      } as CardBookEntry;
    }),
  };
}

export function toV3(data: CardData) {
  return { spec: "chara_card_v3", spec_version: "3.0", data: { ...data } };
}

/** V2 export: drops V3-only fields but keeps them in extensions so nothing is lost. */
export function toV2(data: CardData) {
  const { nickname, source, creation_date, modification_date, assets, group_only_greetings, ...rest } = data;
  const v3only: Record<string, unknown> = {};
  if (nickname) v3only.nickname = nickname;
  if (source?.length) v3only.source = source;
  if (group_only_greetings.length) v3only.group_only_greetings = group_only_greetings;
  const extensions = Object.keys(v3only).length ? { ...rest.extensions, mea_v3: v3only } : rest.extensions;
  return { spec: "chara_card_v2", spec_version: "2.0", data: { ...rest, extensions } };
}

/** Fields that are always in the prompt vs only sometimes (CHAR-03). */
export const permanentFields = ["description", "personality", "scenario", "system_prompt", "post_history_instructions"] as const;
export const temporaryFields = ["first_mes", "mes_example"] as const;
