import type { CardBook } from "../cards/card";
import { fromCardBook, type ImportedBook, importLorebook } from "./convert";
import { defaultEntry, type LoreEntry } from "./types";

/**
 * Lorebook files from other apps, read into Mea's entries. SillyTavern World Info and V2
 * character books were already read by `convert.ts`; this adds whole character cards (V2 and V3),
 * NovelAI, Agnai and RisuAI lorebooks, and a plain list of entries in any of their field names.
 * What a reader doesn't know stays in `extra`, so nothing in the file is lost.
 */

export type LoreFormat = "sillytavern" | "character_book" | "card" | "novelai" | "agnai" | "risu" | "list";

export const FORMAT_LABEL: Record<LoreFormat, string> = {
  sillytavern: "SillyTavern World Info",
  character_book: "Character book (V2)",
  card: "Character card",
  novelai: "NovelAI lorebook",
  agnai: "Agnai memory book",
  risu: "RisuAI lorebook",
  list: "A list of entries",
};

export interface ReadBook extends ImportedBook {
  format: LoreFormat;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const words = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.flatMap((x) => (typeof x === "string" ? [x.trim()] : [])).filter(Boolean)
    : typeof v === "string"
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
const pick = (e: Record<string, unknown>, names: string[]) => names.find((n) => n in e);
const without = (e: Record<string, unknown>, known: Set<string>) => Object.fromEntries(Object.entries(e).filter(([k]) => !known.has(k)));
const isCardBook = (v: unknown) => Array.isArray(obj(v).entries) && (obj(v).entries as unknown[]).every((e) => "keys" in obj(e) && "content" in obj(e));

// ---------- NovelAI ----------

const NAI_KNOWN = new Set(["text", "displayName", "keys", "enabled", "forceActivation", "category", "contextConfig", "id", "lastUpdatedAt"]);

/** NovelAI `.lorebook`: `text`, `displayName`, `forceActivation`, categories as folders; budget priority is the order. */
function fromNovelAi(root: Record<string, unknown>, fallbackName: string): ReadBook {
  const folders = new Map((Array.isArray(root.categories) ? root.categories : []).map((c) => [str(obj(c).id), str(obj(c).name)]));
  const entries = (root.entries as unknown[]).map((raw, i) => {
    const e = obj(raw);
    const cfg = obj(e.contextConfig);
    const folder = folders.get(str(e.category)) ?? "";
    return defaultEntry({
      uid: i,
      comment: str(e.displayName),
      keys: words(e.keys),
      content: str(e.text),
      enabled: e.enabled !== false,
      constant: e.forceActivation === true,
      order: num(cfg.budgetPriority, 400) / 4,
      extra: { ...without(e, NAI_KNOWN), ...(Object.keys(cfg).length ? { contextConfig: cfg } : {}), ...(folder ? { folder } : {}) },
    });
  });
  return { format: "novelai", name: str(root.name) || fallbackName, description: "", settings: {}, entries };
}

// ---------- Agnai ----------

const AGNAI_KNOWN = new Set(["name", "entry", "keywords", "priority", "weight", "enabled"]);

function fromAgnai(root: Record<string, unknown>, fallbackName: string): ReadBook {
  const entries = (root.entries as unknown[]).map((raw, i) => {
    const e = obj(raw);
    return defaultEntry({ uid: i, comment: str(e.name), keys: words(e.keywords), content: str(e.entry), enabled: e.enabled !== false, order: num(e.priority, 100), groupWeight: num(e.weight, 100), extra: without(e, AGNAI_KNOWN) });
  });
  return { format: "agnai", name: str(root.name) || fallbackName, description: str(root.description), settings: {}, entries };
}

// ---------- RisuAI ----------

const RISU_KNOWN = new Set(["key", "secondkey", "content", "comment", "alwaysActive", "selective", "insertorder", "mode", "folder"]);

/** RisuAI: comma-separated `key`/`secondkey`, `alwaysActive`, `insertorder`; a "folder" entry names a folder its children point at. */
function fromRisu(list: unknown[], name: string, fallbackName: string): ReadBook {
  const raws = list.map(obj);
  const folders = new Map(raws.filter((e) => e.mode === "folder").map((e) => [str(e.key), str(e.comment)]));
  const entries = raws
    .filter((e) => e.mode !== "folder")
    .map((e, i) => {
      const folder = folders.get(str(e.folder)) ?? "";
      return defaultEntry({
        uid: i,
        comment: str(e.comment),
        keys: words(e.key),
        secondaryKeys: e.selective ? words(e.secondkey) : [],
        content: str(e.content),
        constant: e.alwaysActive === true,
        order: num(e.insertorder, 100),
        extra: { ...without(e, RISU_KNOWN), ...(folder ? { folder } : {}) },
      });
    });
  return { format: "risu", name: name || fallbackName, description: "", settings: {}, entries };
}

// ---------- any list of entries ----------

const TEXT = ["content", "text", "entry", "value", "description", "body"];
const KEYS = ["keys", "key", "keywords", "triggers", "tags"];
const TITLE = ["comment", "name", "displayName", "title", "label"];

/** A plain list: whatever names the text, the keys and the title go by. */
function fromList(list: unknown[], name: string, fallbackName: string): ReadBook {
  const entries: LoreEntry[] = [];
  list.forEach((raw, i) => {
    const e = obj(raw);
    const t = pick(e, TEXT);
    if (!t || typeof e[t] !== "string") return;
    const k = pick(e, KEYS);
    const n = pick(e, TITLE.filter((x) => x !== t));
    const known = new Set([t, k, n, "enabled", "constant"].filter((x): x is string => Boolean(x)));
    entries.push(defaultEntry({ uid: i, comment: n ? str(e[n]) : "", keys: k ? words(e[k]) : [], content: str(e[t]), enabled: e.enabled !== false, constant: e.constant === true, extra: without(e, known) }));
  });
  if (!entries.length) throw new Error("Not a lorebook file");
  return { format: "list", name: name || fallbackName, description: "", settings: {}, entries };
}

// ---------- detect ----------

/** Reads a lorebook from any app Mea knows, saying which format it was. Throws when it isn't one. */
export function readLorebook(json: unknown, fallbackName = "Imported lorebook"): ReadBook {
  if (Array.isArray(json)) return json.some((e) => "key" in obj(e) && "insertorder" in obj(e)) ? fromRisu(json, "", fallbackName) : fromList(json, "", fallbackName);
  const root = obj(json);
  // A whole character card: its book, named after the character.
  const data = obj(root.data);
  if ((typeof root.spec === "string" && root.spec.startsWith("chara_card")) || ("character_book" in data && "name" in data)) {
    const book = data.character_book;
    if (!book || !Array.isArray(obj(book).entries) || !(obj(book).entries as unknown[]).length) throw new Error("That card has no lorebook in it");
    const name = str(data.name);
    return { ...fromCardBook(book as CardBook, name ? `${name}'s lore` : fallbackName), format: "card" };
  }
  if ("lorebookVersion" in root && Array.isArray(root.entries)) return fromNovelAi(root, fallbackName);
  if (root.kind === "memory" && Array.isArray(root.entries)) return fromAgnai(root, fallbackName);
  if (root.type === "risu" && Array.isArray(root.data)) return fromRisu(root.data, str(root.name), fallbackName);
  if (Array.isArray(root.lorebook)) return fromRisu(root.lorebook, str(root.name), fallbackName);
  if (Array.isArray(root.entries) && !isCardBook(root)) return fromList(root.entries, str(root.name), fallbackName);
  const book = importLorebook(json, fallbackName);
  return { ...book, format: Array.isArray(root.entries) ? "character_book" : "sillytavern" };
}
