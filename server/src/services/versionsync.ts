import { z } from "zod";
import type { CardData } from "../cards/card";
import { shortHash } from "../creator/smarts";
import { findLeaks } from "../creator/variantcore";
import { all, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { linkedBooks, updateEntry } from "../lore/service";
import { planFor } from "../lore/versionlore";
import { getCard, updateCharacter } from "./characters";
import { type LinkKind, linkInfo } from "./linked";
import { callJson } from "./llm";
import { getPersona, type PersonaData, updatePersona } from "./personas";
import { stashRestore } from "./undo";

/**
 * Changes from the original (docs/14, part 5). A version remembers, per field and per lore entry,
 * a fingerprint of the original it was written from. When the original moves on, what the version
 * kept the same can be taken straight across, and what it changed can be translated again through
 * its map. Whatever you edit in the version yourself becomes its own and is never overwritten.
 * Worked out when asked (so it's always current); auto-sync takes kept changes after a save.
 */

export type SyncState = "kept" | "changed" | "own";

interface FieldBasis {
  state: SyncState;
  /** The original's text when the version last matched it, and its fingerprint. */
  from: string;
  text: string;
  /** The version's own text then: if it differs now, you edited it. */
  mine: string;
}

interface SyncData {
  auto?: boolean;
  fields?: Record<string, FieldBasis>;
}

/** What a version's lore entry remembers (part 3 writes the first four). */
interface EntrySource {
  entryId: string | null;
  bookId: string | null;
  state: "kept" | "changed" | "new" | "own";
  basis: string;
  text?: string;
  mine?: string;
}

export interface OriginChange {
  key: string;
  target: "field" | "entry";
  label: string;
  state: "kept" | "changed";
  /** The original's text the version was written from, and what it says now. */
  was: string;
  now: string;
  /** The version's text as it is. */
  mine: string;
}

const TABLE: Record<LinkKind, "characters" | "personas"> = { character: "characters", persona: "personas" };
const SEP = "\n\n---\n\n";

const CHARACTER_FIELDS: [keyof CardData, string][] = [
  ["description", "Description"],
  ["personality", "Personality"],
  ["scenario", "Scenario"],
  ["first_mes", "Greeting"],
  ["alternate_greetings", "Alternate greetings"],
  ["mes_example", "Example dialogue"],
  ["system_prompt", "System prompt"],
  ["post_history_instructions", "Rules"],
  ["creator_notes", "Creator notes"],
];
const PERSONA_FIELDS: [keyof PersonaData, string][] = [
  ["pronouns", "Pronouns"],
  ["description", "Description"],
  ["appearance", "Appearance"],
  ["personality", "Personality"],
  ["background", "Background"],
];
const fieldsOf = (kind: LinkKind): [string, string][] => (kind === "character" ? CHARACTER_FIELDS : PERSONA_FIELDS) as [string, string][];

const norm = (s: string) => s.trim().replace(/\s+/g, " ");
const hash = (s: string) => shortHash(norm(s));
const entryHash = (e: { content: string; keys: string[] }) => shortHash(`${e.content}\n${e.keys.join(",")}`);

function readFields(kind: LinkKind, id: string): Record<string, string> | null {
  if (kind === "character") {
    const c = getCard(id);
    if (!c) return null;
    return Object.fromEntries(CHARACTER_FIELDS.map(([k]) => [k, Array.isArray(c[k]) ? (c[k] as string[]).join(SEP) : String(c[k] ?? "")]));
  }
  const p = getPersona(id);
  if (!p) return null;
  return Object.fromEntries(PERSONA_FIELDS.map(([k]) => [k, String(p.data[k] ?? "")]));
}

function writeFields(kind: LinkKind, id: string, patch: Record<string, string>) {
  if (!Object.keys(patch).length) return;
  if (kind === "character") {
    const card = { ...getCard(id)! };
    for (const [k, v] of Object.entries(patch)) (card as Record<string, unknown>)[k] = k === "alternate_greetings" ? v.split(SEP).map((x) => x.trim()).filter(Boolean) : v;
    updateCharacter(id, { card, note: "From the original" });
  } else updatePersona(id, { data: patch as Partial<PersonaData> });
}

const readSync = (kind: LinkKind, id: string) => parseJson<SyncData>(one<{ version_sync: string }>(`SELECT version_sync FROM ${TABLE[kind]} WHERE id = ?`, id)?.version_sync, {});
const writeSync = (kind: LinkKind, id: string, data: SyncData) => run(`UPDATE ${TABLE[kind]} SET version_sync = ? WHERE id = ?`, JSON.stringify(data), id);

const originOf = (kind: LinkKind, id: string) => {
  const r = one<{ variant_of: string | null; deleted_at: number | null }>(`SELECT variant_of, deleted_at FROM ${TABLE[kind]} WHERE id = ?`, id);
  if (!r?.variant_of) return null;
  const o = one<{ id: string; name: string; deleted_at: number | null }>(`SELECT id, name, deleted_at FROM ${TABLE[kind]} WHERE id = ?`, r.variant_of);
  return o && o.deleted_at === null ? o : null;
};

const fresh = (o: string, v: string, was?: FieldBasis): FieldBasis => ({ state: norm(o) === norm(v) ? "kept" : was?.state === "own" ? "own" : "changed", from: hash(o), text: o, mine: hash(v) });

/**
 * Remembers what each field was written from: kept when it reads the same as the original, changed
 * when it doesn't (a field you made the version's own stays its own). Called when a version is linked
 * and every time the studio saves one.
 */
export function snapshotBasis(kind: LinkKind, id: string) {
  const origin = originOf(kind, id);
  const mine = readFields(kind, id);
  const theirs = origin ? readFields(kind, origin.id) : null;
  if (!mine || !theirs) return;
  const data = readSync(kind, id);
  const fields: Record<string, FieldBasis> = {};
  for (const [k] of fieldsOf(kind)) fields[k] = fresh(theirs[k] ?? "", mine[k] ?? "", data.fields?.[k]);
  writeSync(kind, id, { ...data, fields });
}

/** The version's lore entries that came from one of its original's lorebooks. */
function sourcedEntries(kind: LinkKind, id: string, originId: string) {
  const theirs = new Set(linkedBooks(kind, originId).map((b) => b.id));
  const out: { entry: ReturnType<typeof entriesOf>[number]; source: EntrySource; original: { id: string; content: string; keys: string[]; comment: string } }[] = [];
  for (const b of linkedBooks(kind, id)) {
    if (theirs.has(b.id)) continue;
    for (const e of entriesOf(b.id)) {
      const s = (e.extra ?? {}).source as EntrySource | undefined;
      if (!s?.entryId || !s.bookId || s.state === "new" || !theirs.has(s.bookId)) continue;
      const row = one<{ data: string }>("SELECT data FROM lorebook_entries WHERE id = ? AND lorebook_id = ?", s.entryId, s.bookId);
      if (!row) continue;
      const o = parseJson<{ content: string; keys: string[]; comment: string }>(row.data, { content: "", keys: [], comment: "" });
      out.push({ entry: e, source: s, original: { id: s.entryId, content: o.content ?? "", keys: o.keys ?? [], comment: o.comment ?? "" } });
    }
  }
  return out;
}

function entriesOf(bookId: string) {
  return all<{ id: string; data: string }>("SELECT id, data FROM lorebook_entries WHERE lorebook_id = ? ORDER BY sort", bookId).map((r) => ({ id: r.id, ...parseJson<{ content: string; keys: string[]; comment: string; extra: Record<string, unknown> }>(r.data, { content: "", keys: [], comment: "", extra: {} }) }));
}

function saveEntrySource(entryId: string, patch: Partial<EntrySource>, content?: { content: string; keys: string[] }) {
  const row = one<{ data: string }>("SELECT data FROM lorebook_entries WHERE id = ?", entryId);
  if (!row) return;
  const data = parseJson<Record<string, unknown> & { extra?: Record<string, unknown>; content: string; keys: string[] }>(row.data, { content: "", keys: [] });
  const next = { ...data, ...(content ?? {}) };
  next.extra = { ...(data.extra ?? {}), source: { ...((data.extra?.source as object) ?? {}), ...patch } };
  updateEntry(entryId, next as never);
}

/**
 * What changed in the original since the version was written from it. Fields and entries you edited
 * in the version become its own on the way (and drop out), so a later Take never overwrites them.
 */
export function originChanges(kind: LinkKind, id: string): OriginChange[] {
  const origin = originOf(kind, id);
  if (!origin) return [];
  const mine = readFields(kind, id);
  const theirs = readFields(kind, origin.id);
  if (!mine || !theirs) return [];
  const data = readSync(kind, id);
  const fields = { ...(data.fields ?? {}) };
  let dirty = false;
  const out: OriginChange[] = [];
  for (const [k, label] of fieldsOf(kind)) {
    const o = theirs[k] ?? "";
    const v = mine[k] ?? "";
    let b = fields[k];
    if (!b) {
      // A version from before this part: from now on.
      fields[k] = fresh(o, v);
      dirty = true;
      continue;
    }
    if (b.state === "own") continue;
    if (hash(v) !== b.mine) {
      fields[k] = norm(v) === norm(o) ? fresh(o, v) : { ...b, state: "own" };
      dirty = true;
      continue;
    }
    if (hash(o) === b.from) continue;
    if (norm(o) === norm(v)) {
      fields[k] = fresh(o, v);
      dirty = true;
      continue;
    }
    b = fields[k]!;
    out.push({ key: `field:${k}`, target: "field", label, state: b.state as "kept" | "changed", was: b.text, now: o, mine: v });
  }
  if (dirty) writeSync(kind, id, { ...data, fields });
  for (const { entry: e, source: s, original: o } of sourcedEntries(kind, id, origin.id)) {
    if (s.state === "own") continue;
    const vh = entryHash(e);
    // Written before its own fingerprint was kept: as written is as it is now (part 3 saved the original's).
    if (!s.mine) saveEntrySource(e.id, { mine: vh });
    else if (vh !== s.mine) {
      saveEntrySource(e.id, { state: "own" });
      continue;
    }
    if (entryHash(o) === s.basis) continue;
    out.push({ key: `entry:${e.id}`, target: "entry", label: e.comment || e.keys[0] || "An entry", state: s.state === "kept" ? "kept" : "changed", was: s.text ?? "", now: o.content, mine: e.content });
  }
  return out;
}

/** What the page shows: auto-sync, and what changed. */
export function syncInfo(kind: LinkKind, id: string) {
  const origin = originOf(kind, id);
  return { origin: origin ? { id: origin.id, name: origin.name } : null, auto: Boolean(readSync(kind, id).auto), changes: originChanges(kind, id) };
}

export function setAutoSync(kind: LinkKind, id: string, auto: boolean) {
  if (!originOf(kind, id)) throw badRequest("This isn't a version of anything");
  writeSync(kind, id, { ...readSync(kind, id), auto });
  if (auto) autoSync();
  return syncInfo(kind, id);
}

/** A card's original name stays out of a kept entry's keys when the version goes by another name. */
function keysFor(kind: LinkKind, id: string, originName: string, keys: string[]) {
  const name = (kind === "character" ? getCard(id)?.name : getPersona(id)?.name) ?? "";
  if (norm(name).toLowerCase() === norm(originName).toLowerCase()) return keys;
  return keys.filter((k) => norm(k).toLowerCase() !== norm(originName).toLowerCase());
}

/** Snapshot for Undo: the version's fields, its sync data, and the entries about to change. */
function snapshot(kind: LinkKind, id: string, entryIds: string[]) {
  const fields = readFields(kind, id)!;
  const sync = readSync(kind, id);
  const entries = entryIds.map((eid) => ({ id: eid, data: one<{ data: string }>("SELECT data FROM lorebook_entries WHERE id = ?", eid)?.data }));
  return () => {
    writeFields(kind, id, fields);
    writeSync(kind, id, sync);
    for (const e of entries) if (e.data) updateEntry(e.id, JSON.parse(e.data));
  };
}

/**
 * Takes changes into the version: a kept one copied straight across, a changed one with the text
 * you approved (from Translate). Returns a token for Undo.
 */
export function takeChanges(kind: LinkKind, id: string, keys: string[], texts: Record<string, string> = {}) {
  const origin = originOf(kind, id);
  if (!origin) throw badRequest("This isn't a version of anything");
  const pending = new Map(originChanges(kind, id).map((c) => [c.key, c]));
  const picked = keys.map((k) => pending.get(k)).filter((c): c is OriginChange => Boolean(c));
  if (!picked.length) throw notFound("Nothing to take: the original hasn't changed there, or the version made it its own.");
  for (const c of picked) if (c.state === "changed" && !texts[c.key]?.trim()) throw badRequest(`${c.label} was changed for this version: translate it first`);
  const restore = snapshot(kind, id, picked.filter((c) => c.target === "entry").map((c) => c.key.slice(6)));
  tx(() => {
    const patch: Record<string, string> = {};
    for (const c of picked.filter((x) => x.target === "field")) patch[c.key.slice(6)] = c.state === "kept" ? c.now : texts[c.key]!.trim();
    writeFields(kind, id, patch);
    if (Object.keys(patch).length) {
      const data = readSync(kind, id);
      const fields = { ...(data.fields ?? {}) };
      const after = readFields(kind, id)!;
      for (const c of picked.filter((x) => x.target === "field")) {
        const k = c.key.slice(6);
        fields[k] = { state: c.state, from: hash(c.now), text: c.now, mine: hash(after[k] ?? "") };
      }
      writeSync(kind, id, { ...data, fields });
    }
    const byId = new Map(sourcedEntries(kind, id, origin.id).map((x) => [x.entry.id, x]));
    for (const c of picked.filter((x) => x.target === "entry")) {
      const x = byId.get(c.key.slice(6));
      if (!x) continue;
      const next = c.state === "kept" ? { content: x.original.content, keys: keysFor(kind, id, origin.name, x.original.keys) } : { content: texts[c.key]!.trim(), keys: x.entry.keys };
      saveEntrySource(x.entry.id, { basis: entryHash(x.original), text: x.original.content, mine: entryHash(next) }, next);
    }
  });
  publish({ type: "inbox.changed" });
  return { undo: stashRestore(`Took ${picked.length === 1 ? picked[0]!.label : `${picked.length} changes`} from ${origin.name}`, restore, kind === "character" ? "characters" : "personas"), taken: picked.length };
}

/** "Not for this version": the field or entry becomes the version's own. */
export function skipChanges(kind: LinkKind, id: string, keys: string[]) {
  const origin = originOf(kind, id);
  if (!origin) throw badRequest("This isn't a version of anything");
  const pending = new Map(originChanges(kind, id).map((c) => [c.key, c]));
  const picked = keys.map((k) => pending.get(k)).filter((c): c is OriginChange => Boolean(c));
  if (!picked.length) throw notFound("Nothing to skip");
  const restore = snapshot(kind, id, picked.filter((c) => c.target === "entry").map((c) => c.key.slice(6)));
  tx(() => {
    const data = readSync(kind, id);
    const fields = { ...(data.fields ?? {}) };
    for (const c of picked) {
      if (c.target === "field") fields[c.key.slice(6)] = { ...fields[c.key.slice(6)]!, state: "own" };
      else saveEntrySource(c.key.slice(6), { state: "own" });
    }
    writeSync(kind, id, { ...data, fields });
  });
  publish({ type: "inbox.changed" });
  return { undo: stashRestore(`Kept this version's ${picked.length === 1 ? picked[0]!.label : `${picked.length} fields`}`, restore, kind === "character" ? "characters" : "personas"), skipped: picked.length };
}

const translateSchema = z.object({ text: z.string().default("") });

/**
 * "Translate the new part": only what changed in the original goes through the version's map,
 * and the rest of the version's text stays word for word. Nothing is saved until you take it.
 */
export async function translateChange(kind: LinkKind, id: string, key: string) {
  const origin = originOf(kind, id);
  if (!origin) throw badRequest("This isn't a version of anything");
  const c = originChanges(kind, id).find((x) => x.key === key);
  if (!c) throw notFound("The original hasn't changed there");
  const link = linkInfo(kind, id)!;
  const plan = planFor(kind, id, origin, link);
  const map = plan.map.filter((r) => r.type !== "self" && r.from.trim());
  const r = await callJson({
    task: "helper",
    kind: "version:translate",
    name: "version_translate",
    schema: translateSchema,
    system: [
      `You keep a version of ${origin.name} up to date: ${link.label || "an alternate version"}. The original's ${c.target === "field" ? `"${c.label}" field` : `lore entry "${c.label}"`} changed. The version's text was translated from the original before it changed.`,
      "Carry ONLY what changed between the original's old and new text into the version, translated into the version's world. Keep every other word of the version's text as it is. Don't add anything the change didn't.",
      plan.premise.trim() ? `THE VERSION'S PREMISE:\n${plan.premise.trim()}` : "",
      map.length ? `THE MAP (use the version's names; never use an original name the map changed or dropped):\n${map.map((m) => `- ${m.from} → ${m.state === "dropped" ? "(not in this version)" : m.to || m.from} [${m.state}]`).join("\n")}` : "",
      'Reply with JSON only: {"text": "the version\'s whole new text"}',
    ]
      .filter(Boolean)
      .join("\n\n"),
    user: [`THE ORIGINAL, BEFORE:\n${c.was || "(not recorded)"}`, `THE ORIGINAL, NOW:\n${c.now}`, `THE VERSION, NOW:\n${c.mine}`].join("\n\n"),
    maxTokens: 2400,
    temperature: 0.4,
  });
  const text = r.data.text.trim() || c.mine;
  const leaks = findLeaks(plan.map, [{ where: "field", key, label: c.label, text }]);
  return { key, before: c.mine, text, leaks: [...new Set(leaks.map((l) => l.term))] };
}

/** Every version with auto-sync on takes its kept changes (a few passes, so a version of a version follows). */
export function autoSync() {
  let taken = 0;
  for (let pass = 0; pass < 3; pass++) {
    let moved = 0;
    for (const kind of ["character", "persona"] as const)
      for (const r of all<{ id: string }>(`SELECT id FROM ${TABLE[kind]} WHERE variant_of IS NOT NULL AND deleted_at IS NULL AND json_extract(version_sync, '$.auto') = 1`)) {
        const keys = originChanges(kind, r.id).filter((c) => c.state === "kept").map((c) => c.key);
        if (keys.length) moved += takeChanges(kind, r.id, keys).taken;
      }
    taken += moved;
    if (!moved) break;
  }
  return taken;
}

/** After an original is saved: auto-sync, and the Inbox counts again. Never fails the save. */
export function afterOriginSave() {
  try {
    autoSync();
  } catch (e) {
    console.error("[mea] version auto-sync failed:", e);
  }
  publish({ type: "inbox.changed" });
}

/** Every version with changes waiting, for the Inbox. */
export function versionsWithChanges() {
  const out: { kind: LinkKind; id: string; name: string; label: string; originName: string; changes: OriginChange[] }[] = [];
  for (const kind of ["character", "persona"] as const)
    for (const r of all<{ id: string; name: string; variant_label: string | null; origin_name: string }>(
      `SELECT v.id, v.name, v.variant_label, o.name AS origin_name FROM ${TABLE[kind]} v JOIN ${TABLE[kind]} o ON o.id = v.variant_of WHERE v.deleted_at IS NULL AND o.deleted_at IS NULL`,
    )) {
      const changes = originChanges(kind, r.id);
      if (changes.length) out.push({ kind, id: r.id, name: r.name, label: r.variant_label ?? "", originName: r.origin_name, changes });
    }
  return out;
}
