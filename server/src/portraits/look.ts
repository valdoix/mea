import { z } from "zod";
import { all, now, one, parseJson, run } from "../db/db";
import { badRequest } from "../lib/http";
import { getCard } from "../services/characters";
import { getPersona } from "../services/personas";

/**
 * The Look (docs/28 §4.1): how someone looks, kept with them and pasted word for word into every
 * picture of them, so "hazel-green eyes" never drifts to "green" between pictures. Each line says
 * where it came from; your own words always win.
 */

export const LOOK_FIELDS = ["age", "presentation", "build", "height", "face", "skin", "hair", "eyes", "marks", "wears", "signature", "palette", "expression", "never"] as const;
export type LookField = (typeof LOOK_FIELDS)[number];
/** Where a line came from, strongest first. */
/** Lore slots outrank the card: a slot holds one exact value ("hazel-green"), the card is prose. */
export const LOOK_SOURCES = ["you", "lore", "card", "canon", "guess"] as const;
export type LookSource = (typeof LOOK_SOURCES)[number];
export const sourceRank = (s: LookSource | undefined) => (s ? LOOK_SOURCES.indexOf(s) : LOOK_SOURCES.length);

export const STYLES = ["storybook", "painted", "photo", "anime", "oil", "ink"] as const;
export type StyleId = (typeof STYLES)[number];

export const MEDIA = ["live-action", "animated", "drawn", "written", "game", "original"] as const;
export type Medium = (typeof MEDIA)[number];

const line = (n = 300) => z.string().trim().max(n);
const list = z.array(z.string().trim().min(1).max(160)).max(12);

export const lookSchema = z.object({
  /** Who it is. Never sent in a prompt unless `useName` (drawn and animated characters only). */
  name: line(120).default(""),
  /** A known character: the work and what kind of work, which decides the face rules (§5). */
  canon: z.object({ work: line(160), medium: z.enum(MEDIA) }).nullable().default(null),
  /** Always 18 or more once set; null until an adult age is known. */
  age: z.number().int().min(18).max(120).nullable().default(null),
  presentation: line(60).default(""),
  build: line().default(""),
  height: line(60).default(""),
  face: line().default(""),
  skin: line().default(""),
  hair: line().default(""),
  eyes: line(120).default(""),
  marks: list.default([]),
  wears: line(400).default(""),
  signature: list.default([]),
  palette: list.default([]),
  expression: line(160).default(""),
  never: list.default([]),
  source: z.partialRecord(z.enum(LOOK_FIELDS), z.enum(LOOK_SOURCES)).default({}),
  style: z.enum(STYLES).nullable().default(null),
  /** The kept portrait later pictures of them use as a reference (docs/28 §6.2, Part 4). */
  keyImage: z.string().nullable().default(null),
  /** Put the character's name in the prompt: only ever for drawn and animated canon. */
  useName: z.boolean().default(false),
});
export type Look = z.infer<typeof lookSchema>;

export const emptyLook = (): Look => lookSchema.parse({});

export type LookOwner = "character" | "persona" | "variant" | "cast";
export const ownerSchema = z.enum(["character", "persona", "variant", "cast"]);

/** A saved Look, or null. */
export function getLook(ownerType: LookOwner, ownerId: string): Look | null {
  const r = one<{ data: string }>("SELECT data FROM looks WHERE owner_type = ? AND owner_id = ?", ownerType, ownerId);
  if (!r) return null;
  const parsed = lookSchema.safeParse(parseJson(r.data, {}));
  return parsed.success ? parsed.data : null;
}

export function saveLook(ownerType: LookOwner, ownerId: string, look: unknown): Look {
  const parsed = lookSchema.safeParse(look);
  if (!parsed.success) throw badRequest("That Look isn't valid", z.treeifyError(parsed.error));
  run(
    `INSERT INTO looks (owner_type, owner_id, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(owner_type, owner_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ownerType,
    ownerId,
    JSON.stringify(parsed.data),
    now(),
  );
  return parsed.data;
}

export function deleteLook(ownerType: LookOwner, ownerId: string) {
  run("DELETE FROM looks WHERE owner_type = ? AND owner_id = ?", ownerType, ownerId);
}

/**
 * Sets a line, unless a stronger source already holds it. `you` always replaces; a list is set
 * whole. Empty values are ignored.
 */
export function setLine(look: Look, field: LookField, value: unknown, source: LookSource): void {
  const empty = value == null || value === "" || (Array.isArray(value) && !value.length);
  if (empty) return;
  const held = look.source[field];
  const has = field === "age" ? look.age != null : Array.isArray(look[field]) ? (look[field] as string[]).length > 0 : Boolean(look[field]);
  if (has && held && sourceRank(held) < sourceRank(source)) return;
  if (field === "age") {
    const n = typeof value === "number" ? value : Number(String(value).match(/\d+/)?.[0]);
    if (!Number.isFinite(n) || n < 18 || n > 120) return;
    look.age = Math.round(n);
  } else if (Array.isArray(look[field])) {
    const items = (Array.isArray(value) ? value : String(value).split(/\s*[;·]\s*/)).map((v) => String(v).trim()).filter(Boolean);
    (look[field] as string[]) = [...new Set(items)].slice(0, 12);
  } else {
    (look as Record<string, unknown>)[field] = String(value).trim().slice(0, 400);
  }
  look.source[field] = source;
}

/** Lore slots that are about how someone looks, and the Look line each fills. */
const SLOT_TO_FIELD: Record<string, LookField> = { eyes: "eyes", hair: "hair", height: "height", build: "build", skin: "skin", scar: "marks", age: "age", clothing: "wears" };

/** The appearance facts the lore holds for a name (canon facts, not one chat's), as Look lines. */
export function loreLines(name: string): Partial<Record<LookField, string | string[]>> {
  const n = name.trim().toLowerCase();
  if (!n) return {};
  const rows = all<{ slot: string; value: string }>(
    `SELECT f.slot, f.value FROM lore_facts f JOIN lorebook_entries e ON e.id = f.entry_id JOIN lorebooks b ON b.id = e.lorebook_id
     WHERE f.chat_id IS NULL AND f.deleted_at IS NULL AND b.deleted_at IS NULL AND f.status IN ('active', 'invented') AND f.slot IN (${Object.keys(SLOT_TO_FIELD).map(() => "?").join(", ")})
       AND (lower(COALESCE(json_extract(e.data, '$.comment'), '')) = ? OR lower(COALESCE(json_extract(e.data, '$.extra.entity'), '')) = ?)
     ORDER BY f.created_at`,
    ...Object.keys(SLOT_TO_FIELD),
    n,
    n,
  );
  const out: Partial<Record<LookField, string | string[]>> = {};
  for (const r of rows) {
    const field = SLOT_TO_FIELD[r.slot]!;
    if (field === "marks") out.marks = [...((out.marks as string[]) ?? []), r.value];
    else out[field] = r.value; // a newer fact replaces an older one
  }
  return out;
}

/** What Mea already has about an owner: their name, the text that describes them, and their lore lines. */
export function ownerText(ownerType: LookOwner, ownerId: string): { name: string; text: string; lore: Partial<Record<LookField, string | string[]>>; source: LookSource } | null {
  if (ownerType === "character") {
    const card = getCard(ownerId);
    if (!card) return null;
    const text = [card.description, card.personality].filter(Boolean).join("\n\n").slice(0, 5000);
    return { name: card.name, text, lore: loreLines(card.name), source: "card" };
  }
  if (ownerType === "persona") {
    const p = getPersona(ownerId);
    if (!p) return null;
    const text = [p.data.appearance && `Appearance: ${p.data.appearance}`, p.data.pronouns && `Pronouns: ${p.data.pronouns}`, p.data.description].filter(Boolean).join("\n\n").slice(0, 5000);
    return { name: p.name, text, lore: loreLines(p.name), source: "card" };
  }
  return null;
}
