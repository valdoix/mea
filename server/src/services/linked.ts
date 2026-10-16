import { z } from "zod";
import type { CardData } from "../cards/card";
import { all, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { linkedBooks, linkLorebook } from "../lore/service";
import { createCharacter, getCard, getCharacterRow } from "./characters";
import { createPersona, getPersona, type PersonaData } from "./personas";
import { leaveUniverse } from "./universes";
import { originChanges, snapshotBasis } from "./versionsync";

/**
 * Linked versions (docs/14-linked-variants.md, part 1). A version is a whole card or persona of its own
 * (an alternate universe, another era, a time skip, a what-if) that remembers the original it came from.
 * It stores its own text, so it chats, edits and exports like any card; the link only adds knowledge.
 * Not to be confused with a card's History (`character_versions`, saved snapshots of one card).
 */

export type LinkKind = "character" | "persona";
export const VERSION_KINDS = ["au", "era", "skip", "whatif"] as const;
export type VersionKind = (typeof VERSION_KINDS)[number];
export const versionKind = z.enum(VERSION_KINDS);

const TABLE: Record<LinkKind, "characters" | "personas"> = { character: "characters", persona: "personas" };

interface LinkRow {
  id: string;
  name: string;
  avatar_id: string | null;
  variant_of: string | null;
  variant_kind: VersionKind | null;
  variant_label: string | null;
  universe_id: string | null;
  anchors: string;
  updated_at: number;
  deleted_at: number | null;
}

const row = (kind: LinkKind, id: string) =>
  one<LinkRow>(`SELECT id, name, avatar_id, variant_of, variant_kind, variant_label, universe_id, anchors, updated_at, deleted_at FROM ${TABLE[kind]} WHERE id = ?`, id);

const changed = (kind: LinkKind) => publish({ type: "library.changed", what: kind === "character" ? "characters" : "personas" });

export interface VersionSummary {
  id: string;
  name: string;
  avatarId: string | null;
  kind: VersionKind | null;
  label: string;
  updatedAt: number;
}

const summary = (r: LinkRow): VersionSummary => ({ id: r.id, name: r.name, avatarId: r.avatar_id, kind: r.variant_kind, label: r.variant_label ?? "", updatedAt: r.updated_at });

/** The versions made from this original (not in the trash). */
export function listLinkedVersions(kind: LinkKind, originId: string): VersionSummary[] {
  return all<LinkRow>(
    `SELECT id, name, avatar_id, variant_of, variant_kind, variant_label, universe_id, anchors, updated_at, deleted_at FROM ${TABLE[kind]}
     WHERE variant_of = ? AND deleted_at IS NULL ORDER BY created_at`,
    originId,
  ).map(summary);
}

/** What a card or persona knows about its family: the original it came from, and its own versions. */
export function linkInfo(kind: LinkKind, id: string) {
  const r = row(kind, id);
  if (!r) return null;
  const origin = r.variant_of ? row(kind, r.variant_of) : undefined;
  const universe = r.universe_id ? one<{ id: string; name: string }>("SELECT id, name FROM universes WHERE id = ? AND deleted_at IS NULL", r.universe_id) : undefined;
  return {
    origin: origin ? { id: origin.id, name: origin.name, avatarId: origin.avatar_id, inTrash: origin.deleted_at !== null } : null,
    kind: r.variant_kind,
    label: r.variant_label ?? "",
    anchors: parseJson<string[]>(r.anchors, []),
    universeId: universe?.id ?? null,
    universe: universe ?? null,
    versions: listLinkedVersions(kind, id),
    /** Part 5: how many changes from the original wait for this version. */
    changes: origin && origin.deleted_at === null ? originChanges(kind, id).length : 0,
  };
}

/** For library lists: id → its original's name and the version's label, for every version of this kind. */
export function versionLabels(kind: LinkKind) {
  const rows = all<{ id: string; variant_of: string; variant_kind: VersionKind | null; variant_label: string | null; origin_name: string | null }>(
    `SELECT v.id, v.variant_of, v.variant_kind, v.variant_label, o.name AS origin_name FROM ${TABLE[kind]} v LEFT JOIN ${TABLE[kind]} o ON o.id = v.variant_of WHERE v.variant_of IS NOT NULL`,
  );
  return new Map(rows.map((r) => [r.id, { originId: r.variant_of, originName: r.origin_name ?? "", kind: r.variant_kind, label: r.variant_label ?? "" }]));
}

/** True when `ancestor` is `id` or one of the originals above it (so linking would make a loop). */
function isAncestor(kind: LinkKind, ancestor: string, id: string) {
  let cur: string | null = ancestor;
  for (let i = 0; cur && i < 50; i++) {
    if (cur === id) return true;
    cur = row(kind, cur)?.variant_of ?? null;
  }
  return false;
}

export interface LinkInput {
  kind?: VersionKind | null;
  label?: string;
  anchors?: string[];
}

/** Links an existing card or persona to an original as its version. */
export function linkVersion(kind: LinkKind, id: string, originId: string, input: LinkInput = {}) {
  if (!row(kind, id)) throw notFound(kind === "character" ? "Character not found" : "Persona not found");
  if (!row(kind, originId)) throw notFound("Original not found");
  if (isAncestor(kind, originId, id)) throw badRequest("A version can't be the original of its own original");
  run(
    `UPDATE ${TABLE[kind]} SET variant_of = ?, variant_kind = ?, variant_label = ?, anchors = ? WHERE id = ?`,
    originId,
    input.kind ?? null,
    input.label?.trim() || null,
    JSON.stringify((input.anchors ?? []).map((a) => a.trim()).filter(Boolean)),
    id,
  );
  // Part 5: what each field was written from, so later changes to the original show.
  snapshotBasis(kind, id);
  changed(kind);
}

/** Changes a version's label, kind or anchors. */
export function updateLink(kind: LinkKind, id: string, input: LinkInput) {
  const r = row(kind, id);
  if (!r) throw notFound(kind === "character" ? "Character not found" : "Persona not found");
  if (!r.variant_of) throw badRequest("This isn't a version");
  run(
    `UPDATE ${TABLE[kind]} SET variant_kind = ?, variant_label = ?, anchors = ? WHERE id = ?`,
    input.kind !== undefined ? input.kind : r.variant_kind,
    input.label !== undefined ? input.label.trim() || null : r.variant_label,
    input.anchors !== undefined ? JSON.stringify(input.anchors.map((a) => a.trim()).filter(Boolean)) : r.anchors,
    id,
  );
  changed(kind);
}

/** Cuts the link: the version becomes an ordinary card or persona. */
export function detachVersion(kind: LinkKind, id: string) {
  const r = row(kind, id);
  if (!r) throw notFound(kind === "character" ? "Character not found" : "Persona not found");
  // An ordinary card can't be in a universe: it leaves, keeping its own copy of the world.
  if (r.universe_id) leaveUniverse(kind, id);
  run(`UPDATE ${TABLE[kind]} SET variant_of = NULL, variant_kind = NULL, variant_label = NULL, universe_id = NULL, anchors = '[]' WHERE id = ?`, id);
  changed(kind);
  return { originId: r.variant_of };
}

/**
 * Makes a version by copying the original as it is now: the card (or persona), its portrait and gallery,
 * tags, folder, mode, default persona and per-character settings, and its lorebooks (shared for now; a
 * version's own lorebook is written in part 3). You then change it by hand or in the studio.
 */
export function copyAsVersion(kind: LinkKind, originId: string, input: LinkInput & { name?: string } = {}) {
  return tx(() => {
    let id: string;
    if (kind === "character") {
      const src = getCharacterRow(originId);
      const card = getCard(originId);
      if (!src || !card) throw notFound("Character not found");
      const copy: CardData = { ...card, name: input.name?.trim() || card.name };
      id = createCharacter(copy, {
        avatarId: src.avatar_id,
        gallery: parseJson<string[]>(src.gallery, []),
        tags: parseJson<string[]>(src.tags, []),
        folder: src.folder,
        mode: src.mode,
        defaultPersonaId: src.default_persona_id,
      });
      const settings = one<{ settings: string }>("SELECT settings FROM characters WHERE id = ?", originId)?.settings;
      const trackers = one<{ trackers: string }>("SELECT trackers FROM characters WHERE id = ?", originId)?.trackers;
      run("UPDATE characters SET settings = ?, trackers = ? WHERE id = ?", settings ?? "{}", trackers ?? "{}", id);
    } else {
      const src = getPersona(originId);
      if (!src) throw notFound("Persona not found");
      id = createPersona({ name: input.name?.trim() || src.name, data: { ...src.data } as PersonaData, avatarId: src.avatarId, isDefault: false });
    }
    for (const b of linkedBooks(kind, originId)) linkLorebook(b.id, kind, id);
    linkVersion(kind, id, originId, input);
    return id;
  });
}

// ---------- compare ----------

const CHARACTER_FIELDS: [keyof CardData, string][] = [
  ["name", "Name"],
  ["description", "Description"],
  ["personality", "Personality"],
  ["scenario", "Scenario"],
  ["first_mes", "Greeting"],
  ["alternate_greetings", "Alternate greetings"],
  ["mes_example", "Example dialogue"],
  ["system_prompt", "System prompt"],
  ["post_history_instructions", "Rules"],
  ["creator_notes", "Creator notes"],
  ["tags", "Tags"],
];

const PERSONA_FIELDS: [keyof PersonaData | "name", string][] = [
  ["name", "Name"],
  ["pronouns", "Pronouns"],
  ["description", "Description"],
  ["appearance", "Appearance"],
  ["personality", "Personality"],
  ["background", "Background"],
];

const asText = (v: unknown, sep: string) => (Array.isArray(v) ? v.map(String).filter((s) => s.trim()).join(sep) : typeof v === "string" ? v : "");

/** A version next to its original, field by field, plus which lorebooks each uses. */
export function compareWithOriginal(kind: LinkKind, id: string) {
  const r = row(kind, id);
  if (!r) throw notFound(kind === "character" ? "Character not found" : "Persona not found");
  if (!r.variant_of || !row(kind, r.variant_of)) throw badRequest("This version has no original to compare with");
  const originId = r.variant_of;
  let fields: { key: string; label: string; original: string; version: string; same: boolean }[];
  if (kind === "character") {
    const a = getCard(originId)!;
    const b = getCard(id)!;
    fields = CHARACTER_FIELDS.map(([key, label]) => {
      const sep = key === "tags" ? ", " : "\n\n---\n\n";
      const original = asText(a[key], sep);
      const version = asText(b[key], sep);
      return { key: String(key), label, original, version, same: original.trim() === version.trim() };
    });
  } else {
    const a = getPersona(originId)!;
    const b = getPersona(id)!;
    fields = PERSONA_FIELDS.map(([key, label]) => {
      const original = key === "name" ? a.name : a.data[key];
      const version = key === "name" ? b.name : b.data[key];
      return { key, label, original, version, same: original.trim() === version.trim() };
    });
  }
  const mine = linkedBooks(kind, id);
  const theirs = linkedBooks(kind, originId);
  const has = (list: { id: string }[], bookId: string) => list.some((x) => x.id === bookId);
  return {
    originId,
    fields: fields.filter((f) => f.original.trim() || f.version.trim()),
    books: {
      shared: mine.filter((b) => has(theirs, b.id)),
      originalOnly: theirs.filter((b) => !has(mine, b.id)),
      versionOnly: mine.filter((b) => !has(theirs, b.id)),
    },
  };
}
