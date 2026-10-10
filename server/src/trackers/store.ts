import type { CalendarId } from "./calendars";
import { all, dbGeneration, newId, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { getSetting } from "../lib/settings";
import { getCard, getCharacterRow } from "../services/characters";
import { type ChatSettings, mustChat, type TrackerConfig } from "../services/chats";
import { storyDials } from "../services/layers";
import { getDefaultPersona, getPersona } from "../services/personas";
import { detectStamina } from "./drift";
import { parseLine } from "./dsl";
import { type FoldConfig, type FoldResult, Folder, type TrackerEvent } from "./fold";
import type { Section } from "./note";
import { STARTER_TEMPLATES, type Template, templateInput, type TemplateSchema } from "./schema";
import type { EventSource, Op } from "./types";

// ---------- configuration ----------

export const ALL_SECTIONS: Section[] = ["scene", "cast", "body", "bonds", "romance", "knowledge", "items", "threads", "stakes", "calendar", "motifs", "persona", "custom", "world"];

export interface ResolvedTrackerConfig {
  mode: "helper" | "inline" | "off";
  cadence: "every" | "everyN" | "scene" | "manual";
  everyN: number;
  gate: boolean;
  sections: Record<Section, boolean>;
  templates: string[];
  romance: "off" | "slow" | "measured" | "fast" | "established";
  sealed: boolean;
  strictness: "strict" | "lenient";
  limits: boolean;
  budget: number;
  quietAfter: number;
  nudges: boolean;
  calendar: CalendarId;
  season: string;
  /** Settings the chat's preset controls decide (the tracker settings show them as set by the preset). */
  dialed?: ("sealed" | "romance")[];
}

export const DEFAULT_TRACKERS: ResolvedTrackerConfig = {
  // §0.1 #6 maximum accuracy: every message, a helper model, nothing skipped.
  mode: "helper",
  cadence: "every",
  everyN: 3,
  gate: false,
  sections: Object.fromEntries(ALL_SECTIONS.map((s) => [s, true])) as Record<Section, boolean>,
  templates: [],
  romance: "slow",
  sealed: true,
  strictness: "lenient",
  limits: true,
  budget: 700,
  quietAfter: 40,
  nudges: true,
  calendar: "gregorian",
  season: "",
};

export function characterTrackerDefaults(characterId: string | null): TrackerConfig {
  if (!characterId) return {};
  const r = one<{ trackers: string }>("SELECT trackers FROM characters WHERE id = ?", characterId);
  return parseJson<TrackerConfig>(r?.trackers, {});
}

export function setCharacterTrackerDefaults(characterId: string, cfg: TrackerConfig) {
  run("UPDATE characters SET trackers = ? WHERE id = ?", JSON.stringify(cfg), characterId);
}

export function trackerConfig(chatId: string): ResolvedTrackerConfig {
  const chat = mustChat(chatId);
  const own = parseJson<ChatSettings>(chat.settings, {}).trackers ?? {};
  const char = characterTrackerDefaults(chat.character_id);
  const global = getSetting("trackers.defaults") as TrackerConfig;
  const merged = { ...DEFAULT_TRACKERS, ...strip(global), ...strip(char), ...strip(own) } as ResolvedTrackerConfig;
  merged.sections = { ...DEFAULT_TRACKERS.sections, ...(global.sections ?? {}), ...(char.sections ?? {}), ...(own.sections ?? {}) } as Record<Section, boolean>;
  // The preset's Persona and Romance pace controls, when it has them, decide these (one source of truth).
  const dials = storyDials(chat);
  if (dials.persona) merged.sealed = dials.persona === "sealed" || dials.persona === "continuity";
  if (dials.romance) merged.romance = dials.romance;
  merged.dialed = [...(dials.persona ? ["sealed" as const] : []), ...(dials.romance ? ["romance" as const] : [])];
  // Narrator chats lean on the cast; companion chats leave possessions-heavy sections on too (max accuracy).
  return merged;
}

const strip = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;

// ---------- templates (TRK-01, TRK-32) ----------

interface TemplateRow {
  id: string;
  key: string;
  name: string;
  description: string;
  schema: string;
  created_at: number;
  updated_at: number;
}

export function listTemplates(): Template[] {
  const rows = all<TemplateRow>("SELECT * FROM tracker_templates WHERE deleted_at IS NULL ORDER BY name");
  return [...STARTER_TEMPLATES, ...rows.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, schema: parseJson<TemplateSchema>(r.schema, { fields: [] }), builtin: false }))];
}

export function getTemplate(id: string) {
  return listTemplates().find((t) => t.id === id);
}

export function saveTemplate(input: unknown, id?: string) {
  const t = templateInput.parse(input);
  if (STARTER_TEMPLATES.some((s) => s.key === t.key)) throw badRequest(`"${t.key}" is a starter template's key; pick another`);
  const clash = one<{ id: string }>("SELECT id FROM tracker_templates WHERE key = ? AND deleted_at IS NULL", t.key);
  if (clash && clash.id !== id) throw badRequest(`A template with the key "${t.key}" already exists`);
  const ts = now();
  if (id) {
    if (!one("SELECT 1 FROM tracker_templates WHERE id = ? AND deleted_at IS NULL", id)) throw notFound("Template not found");
    run("UPDATE tracker_templates SET key = ?, name = ?, description = ?, schema = ?, updated_at = ? WHERE id = ?", t.key, t.name, t.description, JSON.stringify(t.schema), ts, id);
  } else {
    id = newId();
    run("INSERT INTO tracker_templates (id, key, name, description, schema, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, t.key, t.name, t.description, JSON.stringify(t.schema), ts, ts);
  }
  invalidateAll();
  return getTemplate(id)!;
}

export function deleteTemplate(id: string) {
  run("UPDATE tracker_templates SET deleted_at = ? WHERE id = ?", now(), id);
  invalidateAll();
}

export function templatesFor(cfg: ResolvedTrackerConfig): Template[] {
  if (!cfg.sections.custom) return [];
  const all = listTemplates();
  return cfg.templates.map((id) => all.find((t) => t.id === id)).filter(Boolean) as Template[];
}

// ---------- cast profiles (CHAT-26, CHAT-27) ----------

export interface CastProfile {
  name: string;
  description?: string;
  voice?: string;
  pinned?: boolean;
  avatarId?: string | null;
  stamina?: string;
  color?: string;
  /** For the world simulation: where they are and whether they can act. */
  standing?: string;
  where?: string;
  base?: string;
  routine?: string;
  role?: string;
  /** Don't simulate them off the page. */
  out?: boolean;
}

export const castKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export function castProfiles(chatId: string): Record<string, CastProfile> {
  const rows = all<{ name_key: string; name: string; data: string }>("SELECT name_key, name, data FROM cast_profiles WHERE chat_id = ?", chatId);
  return Object.fromEntries(rows.map((r) => [r.name_key, { ...parseJson<CastProfile>(r.data, { name: r.name }), name: r.name }]));
}

export function saveCastProfile(chatId: string, name: string, patch: Partial<CastProfile>) {
  const key = castKey(name);
  const cur = castProfiles(chatId)[key] ?? { name };
  const next = { ...cur, ...patch, name: patch.name?.trim() || cur.name };
  run(
    "INSERT INTO cast_profiles (chat_id, name_key, name, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chat_id, name_key) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at",
    chatId,
    key,
    next.name,
    JSON.stringify(next),
    now(),
  );
  invalidate(chatId);
  return next;
}

/** A profile follows its person to a new name, or into the person they turned out to be (fields already set there win). */
export function moveCastProfile(chatId: string, from: string, to: string) {
  const all = castProfiles(chatId);
  const src = all[castKey(from)];
  if (!src || castKey(from) === castKey(to)) return;
  const dst = all[castKey(to)];
  const merged = { ...src, ...Object.fromEntries(Object.entries(dst ?? {}).filter(([, v]) => v !== "" && v != null)), name: dst?.name ?? to.trim() };
  run("DELETE FROM cast_profiles WHERE chat_id = ? AND name_key = ?", chatId, castKey(from));
  saveCastProfile(chatId, to, merged);
}

export function deleteCastProfile(chatId: string, name: string) {
  run("DELETE FROM cast_profiles WHERE chat_id = ? AND name_key = ?", chatId, castKey(name));
  invalidate(chatId);
}

// ---------- events ----------

interface EventRow {
  id: string;
  chat_id: string;
  message_id: string | null;
  swipe_idx: number;
  source: EventSource;
  ord: number;
  op: string;
  created_at: number;
}

/** Writes ops for a message (replacing that message+swipe's earlier ops from the same sources). */
export function writeEvents(chatId: string, anchor: { messageId: string | null; swipeIdx: number }, ops: Op[], source: EventSource, opts: { replace?: EventSource[] } = {}) {
  const t = now();
  tx(() => {
    if (opts.replace?.length) {
      run(
        `DELETE FROM tracker_events WHERE chat_id = ? AND message_id IS ? AND swipe_idx = ? AND source IN (${opts.replace.map(() => "?").join(",")})`,
        chatId,
        anchor.messageId,
        anchor.swipeIdx,
        ...opts.replace,
      );
    }
    let ord = (one<{ o: number | null }>("SELECT MAX(ord) AS o FROM tracker_events WHERE chat_id = ? AND message_id IS ?", chatId, anchor.messageId)?.o ?? 0) + 1;
    for (const op of ops) {
      run(
        "INSERT INTO tracker_events (id, chat_id, message_id, swipe_idx, source, ord, op, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        newId(),
        chatId,
        anchor.messageId,
        anchor.swipeIdx,
        source,
        ord++,
        JSON.stringify(op),
        t,
      );
    }
  });
  // M20: fold snapshots before this message stay good; the base state (no message) changes them all.
  invalidate(chatId, anchor.messageId ? { messageId: anchor.messageId } : undefined);
  publish({ type: "trackers.changed", chatId });
}

export function deleteEvent(chatId: string, id: string) {
  run("DELETE FROM tracker_events WHERE chat_id = ? AND id = ?", chatId, id);
  invalidate(chatId);
  publish({ type: "trackers.changed", chatId });
}

export function clearEvents(chatId: string, sources?: EventSource[]) {
  if (sources?.length) run(`DELETE FROM tracker_events WHERE chat_id = ? AND source IN (${sources.map(() => "?").join(",")})`, chatId, ...sources);
  else run("DELETE FROM tracker_events WHERE chat_id = ?", chatId);
  invalidate(chatId);
  publish({ type: "trackers.changed", chatId });
}

export function hasEvents(chatId: string, messageId: string, swipeIdx: number, sources: EventSource[] = ["model", "inline"]) {
  return Boolean(
    one(`SELECT 1 FROM tracker_events WHERE chat_id = ? AND message_id = ? AND swipe_idx = ? AND source IN (${sources.map(() => "?").join(",")})`, chatId, messageId, swipeIdx, ...sources),
  );
}

export function hasBase(chatId: string) {
  return Boolean(one("SELECT 1 FROM tracker_events WHERE chat_id = ? AND message_id IS NULL", chatId));
}

/** The events of the chat's current branch, in story order (TRK-04): active swipes only, deleted (and purged, H7) messages left out. */
export function branchEvents(chatId: string, opts: { uptoSeq?: number; excludeMessageId?: string; afterSeq?: number } = {}): TrackerEvent[] {
  // `afterSeq` (M20): only the messages after a fold snapshot, so the base state (no message) is left out too;
  // read from those messages (by seq), not by scanning the whole chat's events.
  const rows = opts.afterSeq != null
    ? all<EventRow & { seq: number | null }>(
        `SELECT e.*, m.seq FROM messages m JOIN tracker_events e ON e.message_id = m.id
         WHERE m.chat_id = ? AND m.seq > ? ${opts.uptoSeq != null ? "AND m.seq <= ?" : ""} AND m.deleted_at IS NULL
           AND e.chat_id = m.chat_id AND (e.swipe_idx = -1 OR e.swipe_idx = m.active_swipe)
         ORDER BY m.seq, e.ord, e.rowid`,
        chatId,
        opts.afterSeq,
        ...(opts.uptoSeq != null ? [opts.uptoSeq] : []),
      )
    : all<EventRow & { seq: number | null }>(
        `SELECT e.*, m.seq FROM tracker_events e LEFT JOIN messages m ON m.id = e.message_id
         WHERE e.chat_id = ? AND (e.message_id IS NULL OR (m.id IS NOT NULL AND m.deleted_at IS NULL AND (e.swipe_idx = -1 OR e.swipe_idx = m.active_swipe)))
         ${opts.uptoSeq != null ? "AND (m.seq IS NULL OR m.seq <= ?)" : ""}
         ORDER BY COALESCE(m.seq, 0), e.ord, e.rowid`,
        chatId,
        ...(opts.uptoSeq != null ? [opts.uptoSeq] : []),
      );
  return rows
    .filter((r) => r.message_id !== opts.excludeMessageId)
    .map((r) => ({ id: r.id, messageId: r.message_id, seq: r.seq ?? 0, source: r.source, op: parseJson<Op>(r.op, { op: "clock", args: {}, raw: "" }) }));
}

export function eventsOf(chatId: string, messageId: string) {
  return all<EventRow>("SELECT * FROM tracker_events WHERE chat_id = ? AND message_id = ? ORDER BY swipe_idx, ord", chatId, messageId).map((r) => ({
    id: r.id,
    swipeIdx: r.swipe_idx,
    source: r.source,
    op: parseJson<Op>(r.op, { op: "clock", args: {}, raw: "" }),
    createdAt: r.created_at,
  }));
}

// ---------- folding ----------

export function foldConfigFor(chatId: string, cfg = trackerConfig(chatId)): FoldConfig {
  const chat = mustChat(chatId);
  const card = chat.character_id ? getCard(chat.character_id) : undefined;
  const persona = getPersona(chat.persona_id) ?? getDefaultPersona();
  const profiles = castProfiles(chatId);
  const stamina: Record<string, string> = {};
  const seedTraits: Record<string, string[]> = {};
  if (card) {
    const s = detectStamina(`${card.description} ${card.personality}`);
    if (s) stamina[card.name.toLowerCase()] = s;
    seedTraits[card.name.toLowerCase()] = cardTraits(`${card.description}\n${card.personality}`);
  }
  if (persona) {
    const text = `${persona.data.description ?? ""} ${persona.data.appearance ?? ""}`;
    const s = detectStamina(text);
    if (s) stamina.user = s;
    seedTraits.user = cardTraits(text);
  }
  for (const [k, p] of Object.entries(profiles)) if (p.stamina) stamina[k] = p.stamina;
  return {
    userName: persona?.name ?? "You",
    mainName: card?.name ?? "",
    sealedPersona: cfg.sealed,
    romance: cfg.romance,
    strictness: cfg.strictness,
    limits: cfg.limits,
    templates: templatesFor(cfg),
    stamina,
    seedTraits,
  };
}

/** Eye and hair colour, scars and the like, stated in a description (they hold against the story). */
export function cardTraits(text: string): string[] {
  const out: string[] = [];
  const eyes = text.match(/\b((?:light |dark |pale |deep |bright )?(?:blue|green|brown|hazel|grey|gray|amber|violet|black|golden|silver|red)(?:[- ](?:blue|green|brown|grey|gray))?) eyes\b/i);
  if (eyes) out.push(`${eyes[1]!.toLowerCase()} eyes`);
  const hair = text.match(/\b((?:long |short |curly |straight |wavy |cropped |shoulder-length )?(?:blonde?|brown|black|red|auburn|ginger|silver|white|grey|gray|chestnut|dark|light|pink|blue|platinum)(?: and (?:curly|straight|wavy))?) hair\b/i);
  if (hair) out.push(`${hair[1]!.toLowerCase()} hair`);
  // A scar on a body ("a thin scar across his jaw"), never a place ("the torn scar of pines").
  const BODY = "face|cheek|jaw|lip|brow|eyebrow|forehead|chin|neck|throat|arm|forearm|hand|wrist|chest|back|shoulder|leg|knee|thigh|stomach|belly|side|eye|temple|nose|knuckles?|palm|finger|hip|collarbone|ribs";
  const scar =
    text.match(new RegExp(`\\b((?:(?:thin|long|jagged|faint|old|pale|white|raised|deep|small|puckered|silvery|silver|crescent|burn|ragged)\\s+){0,2}scars?\\s+(?:on|across|over|along|through|down|above|below|under)\\s+(?:(?:his|her|their|its|the|a|one|left|right|upper|lower)\\s+){0,3}(?:${BODY}))\\b`, "i")) ??
    text.match(/\b((?:thin|long|jagged|faint|old|pale|white|raised|deep|small|puckered|silvery|silver|crescent|burn|ragged)\s+(?:\w+\s+)?scars?)\b(?!\s+of\b)/i);
  if (scar) out.push(scar[1]!.trim().toLowerCase());
  return out.slice(0, 4);
}

interface CacheEntry {
  version: string;
  result: FoldResult;
  /** State time after each message (CHAT-20). */
  times: Record<string, string | null>;
}

const versions = new Map<string, number>();
const cache = new Map<string, CacheEntry>();
let globalVersion = 0;

/**
 * The cached fold is stale. M20: fold snapshots at or after the message named (all of them when none is)
 * go too; the snapshots' own prefix check would catch the change anyway, this just frees them early.
 */
export function invalidate(chatId: string, from?: { messageId?: string | null; seq?: number }) {
  versions.set(chatId, (versions.get(chatId) ?? 0) + 1);
  const seq = from?.seq ?? (from?.messageId ? one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", from.messageId)?.seq : undefined);
  dropSnapshots(chatId, seq);
}
function invalidateAll() {
  globalVersion++;
  snapshots.clear();
}

// ---------- fold snapshots (M20) ----------
//
// Folding every event from the start on every new message grows with the chat. Instead a fold
// starts from the nearest snapshot at or before where it ends: the state after every message up
// to a seq that's a multiple of SNAP_EVERY. Whether a snapshot is still good comes from the
// database itself: triggers (migration 13) leave a mark in fold_marks, with the earliest seq it
// touches, for every message written, edited, deleted, restored, purged or switched to another
// swipe, and every tracker event written, renumbered or removed, whichever code path does it. A
// snapshot at seq S is good while no mark newer than its last check has a seq at or before S;
// otherwise it and every later one are dropped and the fold starts from an earlier one (or the
// beginning). Snapshots also belong to one set of fold settings (card, persona, cast, templates)
// and one open database.

let SNAP_EVERY = 250;
const MAX_SNAPSHOT_CHATS = 8;

interface Snapshot {
  seq: number;
  state: FoldResult["state"];
  changes: FoldResult["changes"];
  verdicts: FoldResult["verdicts"];
  times: Record<string, string | null>;
}
interface SnapshotSet {
  key: string;
  /** The fold mark up to which every snapshot here is known to be good. */
  checked: number;
  list: Snapshot[];
}
const snapshots = new Map<string, SnapshotSet>();
let snapshotDb = -1;
let foldsSincePrune = 0;

/** Tests: a smaller spacing to exercise snapshots on short chats. Returns the previous spacing. */
export function setSnapshotSpacing(n: number) {
  const prev = SNAP_EVERY;
  SNAP_EVERY = Math.max(1, Math.floor(n));
  snapshots.clear();
  return prev;
}
/** Tests and diagnostics: the seqs a chat has snapshots at. */
export const snapshotSeqs = (chatId: string) => (snapshots.get(chatId)?.list ?? []).map((s) => s.seq);

function dropSnapshots(chatId: string, fromSeq?: number) {
  const b = snapshots.get(chatId);
  if (!b) return;
  if (fromSeq == null) snapshots.delete(chatId);
  else b.list = b.list.filter((s) => s.seq < fromSeq);
}

const topMark = () => one<{ id: number | null }>("SELECT MAX(id) AS id FROM fold_marks")?.id ?? 0;

/** Marks no snapshot needs any more (older than every set's last check) go. */
export function pruneFoldMarks() {
  if (snapshotDb !== dbGeneration()) snapshots.clear();
  const keep = Math.min(topMark(), ...[...snapshots.values()].map((b) => b.checked));
  run("DELETE FROM fold_marks WHERE id <= ?", keep);
}

/** The usable snapshots of a chat, checked against the marks left since they were last checked. */
function snapshotSet(chatId: string, key: string): SnapshotSet {
  if (snapshotDb !== dbGeneration()) {
    snapshots.clear();
    snapshotDb = dbGeneration();
  }
  let set = snapshots.get(chatId);
  if (set && set.key === key) {
    const r = one<{ low: number | null; top: number | null }>("SELECT MIN(seq) AS low, MAX(id) AS top FROM fold_marks WHERE chat_id = ? AND id > ?", chatId, set.checked);
    if (r?.low != null) set.list = set.list.filter((s) => s.seq < r.low!);
    if (r?.top != null) set.checked = r.top;
  } else {
    set = { key, checked: topMark(), list: [] };
  }
  snapshots.delete(chatId);
  snapshots.set(chatId, set); // most recently used last
  if (snapshots.size > MAX_SNAPSHOT_CHATS) snapshots.delete(snapshots.keys().next().value!);
  if (++foldsSincePrune >= 200) {
    foldsSincePrune = 0;
    pruneFoldMarks();
  }
  return set;
}

/**
 * Folds the branch up to `uptoSeq` (or the end), leaving out `excludeMessageId`, starting from the
 * nearest usable snapshot and taking new ones as it passes snapshot points. `useSnapshots: false`
 * folds from the very start (what the snapshots must always equal).
 */
function foldBranch(chatId: string, opts: { uptoSeq?: number; excludeMessageId?: string; useSnapshots?: boolean } = {}) {
  const cfg = foldConfigFor(chatId);
  const excludeSeq = opts.excludeMessageId ? one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", opts.excludeMessageId)?.seq : undefined;
  // Snapshots are of the whole branch: one past the left-out message (or past where this fold ends) can't be used or taken.
  const limit = Math.min(opts.uptoSeq ?? Infinity, excludeSeq != null ? excludeSeq - 1 : Infinity);
  const set = opts.useSnapshots === false ? undefined : snapshotSet(chatId, `${globalVersion}:${SNAP_EVERY}:${Bun.hash(JSON.stringify(cfg)).toString(36)}`);
  const base = set?.list.findLast((s) => s.seq <= limit);

  const f = new Folder(cfg, base ? structuredClone(base.state) : undefined);
  let times: Record<string, string | null> = {};
  if (base) {
    // Earlier messages' chips and verdicts are final: later events only add their own.
    f.changes = { ...base.changes };
    f.verdicts = { ...base.verdicts };
    times = { ...base.times };
  }
  const events = branchEvents(chatId, { uptoSeq: opts.uptoSeq, excludeMessageId: opts.excludeMessageId, afterSeq: base?.seq });
  let done = base?.seq ?? 0;
  for (const ev of events) {
    // Every event up to the last snapshot point before this one is in: that point's state is this.
    const point = Math.floor((ev.seq - 1) / SNAP_EVERY) * SNAP_EVERY;
    if (point > done) {
      if (set && point <= limit && !set.list.some((s) => s.seq === point)) {
        set.list.push({ seq: point, state: structuredClone(f.state), changes: { ...f.changes }, verdicts: { ...f.verdicts }, times: { ...times } });
        set.list.sort((a, b) => a.seq - b.seq);
      }
      done = point;
    }
    f.apply(ev);
    if (ev.messageId && f.state.time) times[ev.messageId] = `${f.state.time.minutes}:${f.state.time.form}`;
  }
  return { result: { state: f.state, changes: f.changes, verdicts: f.verdicts } as FoldResult, times };
}

/** The fold from the very first event, ignoring snapshots: the reference the snapshots must match (tests). */
export function fullFold(chatId: string, opts: { uptoSeq?: number; excludeMessageId?: string } = {}) {
  return foldBranch(chatId, { ...opts, useSnapshots: false });
}
/** A fold from the snapshots, past the result caches (tests). */
export function snapshotFold(chatId: string, opts: { uptoSeq?: number; excludeMessageId?: string } = {}) {
  return foldBranch(chatId, opts);
}

/** The chat's tracker state now, with change chips per message and story time per message. Cached until anything changes. */
/** Anything that changes the branch (a new swipe, an edit, a delete) changes this. */
function fingerprint(chatId: string) {
  // M20: which messages are deleted (not just how many) and which events (rowids, swipes) count too.
  const m = one<{ n: number; u: number | null; a: number | null; d: number | null; t: number | null }>(
    "SELECT COUNT(*) AS n, MAX(updated_at) AS u, SUM(CASE WHEN deleted_at IS NULL THEN (active_swipe + 1 + hidden * 1000) * seq ELSE 0 END) AS a, SUM(deleted_at IS NOT NULL) AS d, TOTAL(deleted_at) AS t FROM messages WHERE chat_id = ?",
    chatId,
  );
  const e = one<{ n: number; c: number | null; r: number | null; s: number | null }>("SELECT COUNT(*) AS n, MAX(created_at) AS c, TOTAL(rowid) AS r, TOTAL(swipe_idx) AS s FROM tracker_events WHERE chat_id = ?", chatId);
  return `${m?.n}:${m?.u}:${m?.a}:${m?.d}:${m?.t}:${e?.n}:${e?.c}:${e?.r}:${e?.s}`;
}

const foldVersion = (chatId: string) => `${versions.get(chatId) ?? 0}:${globalVersion}:${fingerprint(chatId)}`;

export function currentFold(chatId: string): CacheEntry {
  const v = foldVersion(chatId);
  const hit = cache.get(chatId);
  if (hit && hit.version === v) return hit;
  const result = foldBranch(chatId);
  const entry = { version: v, ...result };
  cache.set(chatId, entry);
  if (cache.size > 30) cache.delete(cache.keys().next().value!);
  return entry;
}

/** The state as of a message (the drawer of an older message, the graph's time scrubber, a swipe's prompt). */
export function foldAt(chatId: string, opts: { uptoSeq?: number; excludeMessageId?: string }) {
  if (opts.uptoSeq == null && !opts.excludeMessageId) return currentFold(chatId).result;
  // M20: the tracker update, the timeline check and the checker ask for the same points after each reply.
  const v = foldVersion(chatId);
  const key = `${chatId}|${opts.uptoSeq ?? ""}|${opts.excludeMessageId ?? ""}`;
  const hit = atCache.get(key);
  if (hit && hit.version === v) return hit.result;
  const result = foldBranch(chatId, opts).result;
  atCache.set(key, { version: v, result });
  if (atCache.size > 60) atCache.delete(atCache.keys().next().value!);
  return result;
}
const atCache = new Map<string, { version: string; result: FoldResult }>();

/**
 * Called when a message changes (edit, delete, restore, swipe): the cached fold is stale, and so are
 * the fold snapshots from the earliest message touched on (`fromSeq`; all of them when unknown).
 */
export function onTrackerLedgerEdit(chatId: string, fromSeq?: number) {
  invalidate(chatId, fromSeq != null ? { seq: fromSeq } : undefined);
  publish({ type: "trackers.changed", chatId });
}

/** Turns lines into ops, reporting the ones that didn't parse. */
export function linesToOps(lines: string[]): { ops: Op[]; bad: string[] } {
  const ops: Op[] = [];
  const bad: string[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    const op = parseLine(l);
    if (op) ops.push(op);
    else bad.push(l);
  }
  return { ops, bad };
}

export function characterRowMode(chatId: string) {
  const chat = mustChat(chatId);
  return chat.character_id ? getCharacterRow(chat.character_id)?.mode ?? chat.mode : chat.mode;
}
