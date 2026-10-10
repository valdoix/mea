import type { CalendarId } from "./calendars";
import { all, newId, now, one, parseJson, run, tx } from "../db/db";
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
  invalidate(chatId);
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
export function branchEvents(chatId: string, opts: { uptoSeq?: number; excludeMessageId?: string } = {}): TrackerEvent[] {
  const rows = all<EventRow & { seq: number | null }>(
    `SELECT e.*, m.seq FROM tracker_events e LEFT JOIN messages m ON m.id = e.message_id
     WHERE e.chat_id = ? AND (e.message_id IS NULL OR (m.id IS NOT NULL AND m.deleted_at IS NULL AND (e.swipe_idx = -1 OR e.swipe_idx = m.active_swipe)))
     ${opts.uptoSeq != null ? "AND (m.seq IS NULL OR m.seq <= ?)" : ""}
     ORDER BY COALESCE(m.seq, 0), e.ord`,
    ...(opts.uptoSeq != null ? [chatId, opts.uptoSeq] : [chatId]),
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

export function invalidate(chatId: string) {
  versions.set(chatId, (versions.get(chatId) ?? 0) + 1);
}
function invalidateAll() {
  globalVersion++;
}

/** The chat's tracker state now, with change chips per message and story time per message. Cached until anything changes. */
/** Anything that changes the branch (a new swipe, an edit, a delete) changes this. */
function fingerprint(chatId: string) {
  const m = one<{ n: number; u: number | null; a: number | null; d: number | null }>(
    "SELECT COUNT(*) AS n, MAX(updated_at) AS u, SUM(CASE WHEN deleted_at IS NULL THEN active_swipe + 1 + hidden * 1000 ELSE 0 END) AS a, SUM(deleted_at IS NOT NULL) AS d FROM messages WHERE chat_id = ?",
    chatId,
  );
  const e = one<{ n: number; c: number | null }>("SELECT COUNT(*) AS n, MAX(created_at) AS c FROM tracker_events WHERE chat_id = ?", chatId);
  return `${m?.n}:${m?.u}:${m?.a}:${m?.d}:${e?.n}:${e?.c}`;
}

export function currentFold(chatId: string): CacheEntry {
  const v = `${versions.get(chatId) ?? 0}:${globalVersion}:${fingerprint(chatId)}`;
  const hit = cache.get(chatId);
  if (hit && hit.version === v) return hit;
  const result = foldWithTimes(chatId, branchEvents(chatId));
  const entry = { version: v, ...result };
  cache.set(chatId, entry);
  if (cache.size > 30) cache.delete(cache.keys().next().value!);
  return entry;
}

function foldWithTimes(chatId: string, events: TrackerEvent[]) {
  const f = new Folder(foldConfigFor(chatId));
  const times: Record<string, string | null> = {};
  for (const ev of events) {
    f.apply(ev);
    if (ev.messageId && f.state.time) times[ev.messageId] = `${f.state.time.minutes}:${f.state.time.form}`;
  }
  return { result: { state: f.state, changes: f.changes, verdicts: f.verdicts }, times };
}

/** The state as of a message (the drawer of an older message, the graph's time scrubber, a swipe's prompt). */
export function foldAt(chatId: string, opts: { uptoSeq?: number; excludeMessageId?: string }) {
  if (opts.uptoSeq == null && !opts.excludeMessageId) return currentFold(chatId).result;
  return foldWithTimes(chatId, branchEvents(chatId, opts)).result;
}

/** Called when a message changes (edit, delete, restore, swipe): the cached fold is stale. */
export function onTrackerLedgerEdit(chatId: string) {
  invalidate(chatId);
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
