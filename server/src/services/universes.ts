import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { applyMapPatch, type MapPatch, type MapRow, mergeRows } from "../creator/variantcore";
import { createEntry, createLorebook, getLorebook, linkLorebook, unlinkLorebook } from "../lore/service";
import type { LinkKind, VersionKind } from "./linked";

/**
 * Universes (docs/14, part 4): a shared setting for versions. One premise, one map from the
 * originals' worlds to this one, and one world book, which a whole cast (your personas too) can
 * move into. The world book is linked to every member, so it's active in their chats and exports
 * with their cards. Each member keeps its own card, anchors and companion lore.
 */

interface Row {
  id: string;
  name: string;
  premise: string;
  kind: VersionKind | null;
  map: string;
  book_id: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface Universe {
  id: string;
  name: string;
  premise: string;
  kind: VersionKind | null;
  map: MapRow[];
  bookId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Member {
  kind: LinkKind;
  id: string;
  name: string;
  avatarId: string | null;
  label: string;
  originId: string | null;
  originName: string;
}

const TABLE: Record<LinkKind, "characters" | "personas"> = { character: "characters", persona: "personas" };
const out = (r: Row): Universe => ({ id: r.id, name: r.name, premise: r.premise, kind: r.kind, map: parseJson<MapRow[]>(r.map, []), bookId: r.book_id, createdAt: r.created_at, updatedAt: r.updated_at });
const changed = () => {
  publish({ type: "library.changed", what: "characters" });
  publish({ type: "library.changed", what: "personas" });
};

export function getUniverse(id: string | null | undefined): Universe | undefined {
  if (!id) return undefined;
  const r = one<Row>("SELECT * FROM universes WHERE id = ? AND deleted_at IS NULL", id);
  return r ? out(r) : undefined;
}

function mustUniverse(id: string) {
  const u = getUniverse(id);
  if (!u) throw notFound("Universe not found");
  return u;
}

/** Everyone in a universe: the character and persona versions that joined it. */
export function membersOf(id: string): Member[] {
  const list: Member[] = [];
  for (const kind of ["character", "persona"] as const) {
    const t = TABLE[kind];
    for (const r of all<{ id: string; name: string; avatar_id: string | null; variant_label: string | null; variant_of: string | null; origin_name: string | null }>(
      `SELECT v.id, v.name, v.avatar_id, v.variant_label, v.variant_of, o.name AS origin_name FROM ${t} v LEFT JOIN ${t} o ON o.id = v.variant_of WHERE v.universe_id = ? AND v.deleted_at IS NULL ORDER BY v.created_at`,
      id,
    ))
      list.push({ kind, id: r.id, name: r.name, avatarId: r.avatar_id, label: r.variant_label ?? "", originId: r.variant_of, originName: r.origin_name ?? "" });
  }
  return list;
}

export function listUniverses() {
  return all<Row>("SELECT * FROM universes WHERE deleted_at IS NULL ORDER BY updated_at DESC").map((r) => {
    const u = out(r);
    const members = membersOf(u.id);
    return { ...u, map: undefined, rows: u.map.length, members: members.map((m) => ({ kind: m.kind, id: m.id, name: m.name, avatarId: m.avatarId })) };
  });
}

/** A universe with its members and its world book. */
export function universeDetail(id: string) {
  const u = mustUniverse(id);
  const book = u.bookId ? getLorebook(u.bookId) : undefined;
  return { ...u, members: membersOf(id), book: book && !book.deletedAt ? { id: book.id, name: book.name, entries: book.entries.length } : null };
}

export function createUniverse(input: { name: string; premise?: string; kind?: VersionKind | null; map?: MapRow[] }) {
  const id = newId();
  const t = now();
  run("INSERT INTO universes (id, name, premise, kind, map, book_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)", id, input.name.trim() || "A new universe", input.premise?.trim() ?? "", input.kind ?? null, JSON.stringify(input.map ?? []), t, t);
  changed();
  return getUniverse(id)!;
}

export function updateUniverse(id: string, patch: { name?: string; premise?: string; kind?: VersionKind | null; map?: MapPatch[] }) {
  const u = mustUniverse(id);
  run(
    "UPDATE universes SET name = ?, premise = ?, kind = ?, map = ?, updated_at = ? WHERE id = ?",
    patch.name?.trim() || u.name,
    patch.premise ?? u.premise,
    patch.kind !== undefined ? patch.kind : u.kind,
    JSON.stringify(patch.map ? applyMapPatch(u.map, patch.map) : u.map),
    now(),
    id,
  );
  changed();
  return getUniverse(id)!;
}

/**
 * What a member's studio decided goes into the shared map: rows it adds are added, and rows the
 * universe hadn't decided take its decision. Rows already decided stay as the universe has them.
 */
export function mergeIntoUniverse(id: string, rows: MapRow[]) {
  const u = mustUniverse(id);
  const norm = (s: string) => s.trim().toLowerCase();
  const map = u.map.map((r) => {
    if (r.state !== "open") return r;
    const theirs = rows.find((x) => x.from && norm(x.from) === norm(r.from) && x.state !== "open");
    return theirs ? { ...r, state: theirs.state, to: theirs.to, note: theirs.note || r.note } : r;
  });
  const fresh = rows.filter((r) => r.type !== "self").map((r) => ({ ...r, id: newId() }));
  run("UPDATE universes SET map = ?, updated_at = ? WHERE id = ?", JSON.stringify(mergeRows(map, fresh)), now(), id);
  return getUniverse(id)!;
}

/** The universe's world book, made (and linked to every member) the first time it's needed. */
export function ensureWorldBook(id: string) {
  const u = mustUniverse(id);
  if (u.bookId && getLorebook(u.bookId) && !getLorebook(u.bookId)!.deletedAt) return u.bookId;
  const bookId = createLorebook({ name: `${u.name}: the world`, description: `The shared world of ${u.name}: places, groups, ideas and rules every version in it lives with.` });
  run("UPDATE universes SET book_id = ?, updated_at = ? WHERE id = ?", bookId, now(), id);
  for (const m of membersOf(id)) linkLorebook(bookId, m.kind, m.id);
  return bookId;
}

const row = (kind: LinkKind, id: string) => one<{ id: string; variant_of: string | null; universe_id: string | null }>(`SELECT id, variant_of, universe_id FROM ${TABLE[kind]} WHERE id = ?`, id);

/** A version joins a universe: the world book (if it has one yet) is linked to it. */
export function joinUniverse(kind: LinkKind, id: string, universeId: string) {
  const r = row(kind, id);
  if (!r) throw notFound(kind === "character" ? "Character not found" : "Persona not found");
  if (!r.variant_of) throw badRequest("Only a version can join a universe");
  const u = mustUniverse(universeId);
  tx(() => {
    if (r.universe_id && r.universe_id !== u.id) leaveUniverse(kind, id);
    run(`UPDATE ${TABLE[kind]} SET universe_id = ? WHERE id = ?`, u.id, id);
    if (u.bookId && getLorebook(u.bookId)) linkLorebook(u.bookId, kind, id);
  });
  changed();
  return universeDetail(u.id);
}

/**
 * A version leaves its universe and keeps its own copy of the world it lived in: the world book's
 * entries are copied into a book of its own, and the shared book is no longer linked to it.
 */
export function leaveUniverse(kind: LinkKind, id: string) {
  const r = row(kind, id);
  if (!r?.universe_id) return null;
  const u = getUniverse(r.universe_id);
  let copyId: string | null = null;
  tx(() => {
    run(`UPDATE ${TABLE[kind]} SET universe_id = NULL WHERE id = ?`, id);
    const book = u?.bookId ? getLorebook(u.bookId) : undefined;
    if (book && !book.deletedAt) {
      unlinkLorebook(book.id, kind, id);
      if (book.entries.length) {
        copyId = createLorebook({ name: `${u!.name}: the world (own copy)`, description: `A copy of ${u!.name}'s world, kept when this version left it.`, settings: book.settings });
        for (const { id: _id, ...e } of book.entries) createEntry(copyId, e);
        linkLorebook(copyId, kind, id);
      }
    }
  });
  changed();
  return { copyBookId: copyId };
}

/**
 * Deletes a universe. Its members stay versions, and keep the world book linked (it's a plain
 * lorebook now, still shared by them); nothing is lost.
 */
export function deleteUniverse(id: string) {
  mustUniverse(id);
  tx(() => {
    for (const t of Object.values(TABLE)) run(`UPDATE ${t} SET universe_id = NULL WHERE universe_id = ?`, id);
    run("UPDATE universes SET deleted_at = ? WHERE id = ?", now(), id);
  });
  changed();
}
