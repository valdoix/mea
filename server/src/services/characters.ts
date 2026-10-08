import { type CardData, emptyCard, normalizeCard, permanentFields, temporaryFields } from "../cards/card";
import { buildCharx, buildJsonCard, buildPngCard, parseCardFile } from "../cards/io";
import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest } from "../lib/http";
import { countTokens } from "../lib/tokens";
import { fromCardBook, toCardBook } from "../lore/convert";
import { createLorebook, getLorebook, linkedBooks } from "../lore/service";
import { getImage, imagePalette, readImage, saveImage } from "./images";

export type ChatMode = "companion" | "narrator";

interface CharacterRow {
  id: string;
  name: string;
  card: string;
  avatar_id: string | null;
  gallery: string;
  tags: string;
  folder: string | null;
  favorite: number;
  default_persona_id: string | null;
  mode: ChatMode | null;
  palette: string;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
  deleted_at: number | null;
}

const changed = () => publish({ type: "library.changed", what: "characters" });
const MAX_VERSIONS = 100;

export interface ListOptions {
  q?: string;
  tag?: string;
  folder?: string;
  favorite?: boolean;
  sort?: "recent" | "name" | "created" | "updated";
  deleted?: boolean;
}

export function listCharacters(opts: ListOptions = {}) {
  const where = [opts.deleted ? "c.deleted_at IS NOT NULL" : "c.deleted_at IS NULL"];
  const params: (string | number)[] = [];
  if (opts.q) {
    where.push("(c.name LIKE ? OR c.tags LIKE ? OR json_extract(c.card, '$.creator_notes') LIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  if (opts.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(c.tags) WHERE json_each.value = ?)");
    params.push(opts.tag);
  }
  if (opts.folder) {
    where.push("c.folder = ?");
    params.push(opts.folder);
  }
  if (opts.favorite) where.push("c.favorite = 1");
  const order =
    opts.sort === "name" ? "c.name COLLATE NOCASE" : opts.sort === "created" ? "c.created_at DESC" : opts.sort === "updated" ? "c.updated_at DESC" : "COALESCE(c.last_used_at, c.updated_at) DESC";
  const rows = all<CharacterRow & { chat_count: number }>(
    `SELECT c.*, (SELECT COUNT(*) FROM chats ch WHERE ch.character_id = c.id AND ch.deleted_at IS NULL) AS chat_count
     FROM characters c WHERE ${where.join(" AND ")} ORDER BY c.favorite DESC, ${order}`,
    ...params,
  );
  return rows.map((r) => {
    const card = parseJson<Partial<CardData>>(r.card, {});
    return {
      id: r.id,
      name: r.name,
      avatarId: r.avatar_id,
      tags: parseJson<string[]>(r.tags, []),
      folder: r.folder,
      favorite: Boolean(r.favorite),
      palette: parseJson<string[]>(r.palette, []),
      creatorNotes: (card.creator_notes ?? "").slice(0, 200),
      chatCount: r.chat_count,
      lastUsedAt: r.last_used_at,
      updatedAt: r.updated_at,
      createdAt: r.created_at,
      deletedAt: r.deleted_at,
    };
  });
}

export function getCharacterRow(id: string) {
  return one<CharacterRow>("SELECT * FROM characters WHERE id = ?", id);
}

export function getCard(id: string): CardData | undefined {
  const row = getCharacterRow(id);
  return row ? { ...emptyCard(row.name), ...parseJson<CardData>(row.card, emptyCard(row.name)) } : undefined;
}

export function getCharacter(id: string) {
  const row = getCharacterRow(id);
  if (!row) return undefined;
  const card = getCard(id)!;
  return {
    id: row.id,
    name: row.name,
    card,
    avatarId: row.avatar_id,
    gallery: parseJson<string[]>(row.gallery, []),
    tags: parseJson<string[]>(row.tags, []),
    folder: row.folder,
    favorite: Boolean(row.favorite),
    defaultPersonaId: row.default_persona_id,
    mode: row.mode,
    palette: parseJson<string[]>(row.palette, []),
    lorebooks: linkedBooks("character", id),
    tokens: tokenCounts(card),
    versionCount: one<{ n: number }>("SELECT COUNT(*) AS n FROM character_versions WHERE character_id = ?", id)?.n ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/** Per-field token counts plus permanent vs temporary totals (CHAR-03). */
export function tokenCounts(card: CardData) {
  const fields: Record<string, number> = {};
  for (const f of [...permanentFields, ...temporaryFields, "creator_notes"] as const) fields[f] = countTokens(card[f] ?? "");
  fields.alternate_greetings = card.alternate_greetings.reduce((n, g) => n + countTokens(g), 0);
  const permanent = permanentFields.reduce((n, f) => n + (fields[f] ?? 0), 0);
  const temporary = (fields.first_mes ?? 0) + (fields.mes_example ?? 0);
  return { fields, permanent, temporary };
}

export interface CharacterMeta {
  tags?: string[];
  folder?: string | null;
  favorite?: boolean;
  defaultPersonaId?: string | null;
  mode?: ChatMode | null;
  avatarId?: string | null;
  gallery?: string[];
}

export function createCharacter(card: CardData, meta: CharacterMeta = {}): string {
  const id = newId();
  const t = now();
  const avatarId = meta.avatarId ?? null;
  run(
    `INSERT INTO characters (id, name, card, avatar_id, gallery, tags, folder, favorite, default_persona_id, mode, palette, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    card.name,
    JSON.stringify(card),
    avatarId,
    JSON.stringify(meta.gallery ?? (avatarId ? [avatarId] : [])),
    JSON.stringify(meta.tags ?? card.tags ?? []),
    meta.folder ?? null,
    meta.favorite ? 1 : 0,
    meta.defaultPersonaId ?? null,
    meta.mode ?? null,
    JSON.stringify(imagePalette(avatarId)),
    t,
    t,
  );
  changed();
  return id;
}

/** Saves a card. The previous card is kept as a version (CHAR-04). */
export function updateCharacter(id: string, input: { card?: CardData; note?: string } & CharacterMeta) {
  const row = getCharacterRow(id);
  if (!row) return false;
  tx(() => {
    if (input.card) {
      const { data } = normalizeCard({ spec: "chara_card_v3", data: input.card });
      if (row.card !== JSON.stringify(data)) {
        run("INSERT INTO character_versions (id, character_id, card, note, created_at) VALUES (?, ?, ?, ?, ?)", newId(), id, row.card, input.note ?? null, now());
        run(
          `DELETE FROM character_versions WHERE character_id = ? AND id NOT IN
           (SELECT id FROM character_versions WHERE character_id = ? ORDER BY created_at DESC LIMIT ?)`,
          id,
          id,
          MAX_VERSIONS,
        );
        run("UPDATE characters SET card = ?, name = ? WHERE id = ?", JSON.stringify(data), data.name, id);
      }
    }
    if (input.tags) run("UPDATE characters SET tags = ? WHERE id = ?", JSON.stringify([...new Set(input.tags.map((t) => t.trim()).filter(Boolean))]), id);
    if (input.folder !== undefined) run("UPDATE characters SET folder = ? WHERE id = ?", input.folder || null, id);
    if (input.favorite !== undefined) run("UPDATE characters SET favorite = ? WHERE id = ?", input.favorite ? 1 : 0, id);
    if (input.defaultPersonaId !== undefined) run("UPDATE characters SET default_persona_id = ? WHERE id = ?", input.defaultPersonaId, id);
    if (input.mode !== undefined) run("UPDATE characters SET mode = ? WHERE id = ?", input.mode, id);
    if (input.gallery) run("UPDATE characters SET gallery = ? WHERE id = ?", JSON.stringify(input.gallery), id);
    if (input.avatarId !== undefined) {
      run("UPDATE characters SET avatar_id = ?, palette = ? WHERE id = ?", input.avatarId, JSON.stringify(imagePalette(input.avatarId)), id);
      if (input.avatarId) {
        const gallery = parseJson<string[]>(getCharacterRow(id)!.gallery, []);
        if (!gallery.includes(input.avatarId)) run("UPDATE characters SET gallery = ? WHERE id = ?", JSON.stringify([input.avatarId, ...gallery]), id);
      }
    }
    run("UPDATE characters SET updated_at = ? WHERE id = ?", now(), id);
  });
  changed();
  return true;
}

export function listVersions(id: string) {
  return all<{ id: string; card: string; note: string | null; created_at: number }>(
    "SELECT * FROM character_versions WHERE character_id = ? ORDER BY created_at DESC",
    id,
  ).map((v) => {
    const card = parseJson<Partial<CardData>>(v.card, {});
    return { id: v.id, name: card.name ?? "", note: v.note, createdAt: v.created_at, card };
  });
}

export function restoreVersion(id: string, versionId: string) {
  const v = one<{ card: string }>("SELECT card FROM character_versions WHERE id = ? AND character_id = ?", versionId, id);
  if (!v) return false;
  return updateCharacter(id, { card: parseJson<CardData>(v.card, emptyCard()), note: "Before restoring an older version" });
}

export function softDeleteCharacter(id: string) {
  run("UPDATE characters SET deleted_at = ? WHERE id = ?", now(), id);
  changed();
}

export function restoreCharacter(id: string) {
  run("UPDATE characters SET deleted_at = NULL WHERE id = ?", id);
  changed();
}

export function touchCharacter(id: string) {
  run("UPDATE characters SET last_used_at = ? WHERE id = ?", now(), id);
}

/** Imports a PNG/JSON/CHARX card. An embedded character_book becomes a linked lorebook. */
export async function importCharacterFile(bytes: Uint8Array, filename: string) {
  let parsed;
  try {
    parsed = parseCardFile(bytes, filename);
  } catch (e) {
    throw badRequest(`Couldn't read this card: ${(e as Error).message}`);
  }
  const { character_book, ...card } = parsed.data;
  let avatarId: string | null = null;
  if (parsed.image) avatarId = await saveImage(parsed.image.bytes);
  const gallery = avatarId ? [avatarId] : [];
  for (const extra of parsed.extraImages) gallery.push(await saveImage(extra.bytes));
  const id = createCharacter(card as CardData, { avatarId, gallery, tags: card.tags });
  let lorebookId: string | null = null;
  if (character_book && character_book.entries.length > 0) {
    const book = fromCardBook(character_book, `${card.name} — lore`);
    lorebookId = createLorebook({
      name: book.name,
      description: book.description,
      settings: book.settings,
      entries: book.entries,
      links: [{ target_type: "character", target_id: id }],
    });
  }
  return { id, name: card.name, spec: parsed.spec, lorebookId };
}

/** Builds an export file. Linked character lorebooks are embedded as character_book. */
export async function exportCharacter(id: string, format: "png" | "json" | "charx", spec: "v2" | "v3" = "v3") {
  const row = getCharacterRow(id);
  if (!row) return undefined;
  const card: CardData = { ...getCard(id)! };
  const books = linkedBooks("character", id).map((b) => getLorebook(b.id)!);
  if (books.length) {
    const entries = books.flatMap((b) => b.entries.map(({ id: _id, ...e }) => e));
    entries.forEach((e, i) => (e.uid = i));
    card.character_book = toCardBook(books[0]!.name, books[0]!.description, books[0]!.settings, entries);
  }
  const avatar = row.avatar_id ? await readImage(row.avatar_id) : undefined;
  const safe = card.name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "character";
  if (format === "json") return { bytes: new TextEncoder().encode(buildJsonCard(card, spec)), mime: "application/json", filename: `${safe}.json` };
  if (format === "charx") return { bytes: buildCharx(card, avatar), mime: "application/zip", filename: `${safe}.charx` };
  const png = avatar && getImage(row.avatar_id!)?.mime === "image/png" ? avatar.bytes : undefined;
  return { bytes: buildPngCard(card, png), mime: "image/png", filename: `${safe}.png` };
}

export function allTags(): string[] {
  return all<{ value: string }>(
    "SELECT DISTINCT json_each.value AS value FROM characters, json_each(characters.tags) WHERE characters.deleted_at IS NULL ORDER BY value COLLATE NOCASE",
  ).map((r) => r.value);
}

export function allFolders(): string[] {
  return all<{ folder: string }>("SELECT DISTINCT folder FROM characters WHERE folder IS NOT NULL AND deleted_at IS NULL ORDER BY folder COLLATE NOCASE").map((r) => r.folder);
}
