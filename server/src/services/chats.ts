import { z } from "zod";
import { applyCardVariant, getVariant, lookFits } from "./variants";
import { personaForVersion } from "./versionchat";
import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { guardsSchema } from "../lib/settings";
import { expandMacros } from "../prompt/macros";
import type { HistoryMessage } from "../prompt/assemble";
import type { Role } from "../lore/types";
import { type ChatMode, getCard, getCharacterRow, touchCharacter } from "./characters";
import { detectMode } from "./mode";
import { getDefaultPersona, getPersona } from "./personas";

const short = (n = 200) => z.string().trim().max(n);

/** Trackers for this chat (TRK-06, TRK-08). Missing fields fall back to the character's and the global defaults. */
export const trackerConfigSchema = z.object({
  mode: z.enum(["helper", "inline", "off"]).optional(),
  cadence: z.enum(["every", "everyN", "scene", "manual"]).optional(),
  everyN: z.number().int().min(2).max(20).optional(),
  gate: z.boolean().optional(),
  sections: z.record(z.string(), z.boolean()).optional(),
  templates: z.array(z.string()).max(20).optional(),
  romance: z.enum(["off", "slow", "measured", "fast", "established"]).optional(),
  sealed: z.boolean().optional(),
  strictness: z.enum(["strict", "lenient"]).optional(),
  limits: z.boolean().optional(),
  budget: z.number().int().min(100).max(4000).optional(),
  quietAfter: z.number().int().min(5).max(500).optional(),
  nudges: z.boolean().optional(),
  /** Gregorian, Westeros, or one you built (G1: "custom:<id>"). */
  calendar: z.union([z.enum(["gregorian", "westeros"]), z.string().regex(/^custom:[\w-]{1,40}$/)]).optional(),
  /** Westeros seasons last for years, so the chat states its own ("a long summer, its ninth year"). */
  season: z.string().max(80).optional(),
});
export type TrackerConfig = z.infer<typeof trackerConfigSchema>;

/** The world off the page (sim/). */
export const worldConfigSchema = z.object({
  mode: z.enum(["off", "quiet", "living", "restless"]).optional(),
  director: z.enum(["steady", "rising", "chaotic", "gentle"]).optional(),
  telling: z.enum(["model", "engine"]).optional(),
  seeding: z.enum(["auto", "ask", "off"]).optional(),
  fates: z.enum(["page", "ask", "allow"]).optional(),
  view: z.enum(["director", "surprise"]).optional(),
  climate: short(80).optional(),
  latitude: short(40).optional(),
  tech: z.enum(["modern", "historic", "fantasy", "future"]).optional(),
  genres: z.array(short(30)).max(6).optional(),
  step: z.number().int().min(30).max(1440).optional(),
});
export type WorldConfig = z.infer<typeof worldConfigSchema>;

/** C1: the canon cutoff (accuracy/canoncut.ts). */
const canonItem = z.object({ id: z.string().max(40), kind: z.enum(["event", "character", "reveal", "term"]), text: z.string().max(300), terms: z.array(z.string().max(60)).max(12), source: z.string().max(200).optional() });
export const canonSchema = z
  .object({
    source: z.string().max(120),
    point: z.string().max(200),
    later: z.array(canonItem).max(150),
    wont: z.array(z.object({ id: z.string().max(40), text: z.string().max(300) })).max(60),
    proposed: z.array(canonItem).max(150),
    notYet: z.array(z.string().max(40)).max(150),
  })
  .partial();

export const chatSettingsSchema = z.object({
  authorsNote: z.object({ content: z.string(), depth: z.number().int().min(0).max(100), role: z.enum(["system", "user", "assistant"]) }).optional(),
  profileId: z.string().nullable().optional(),
  presetId: z.string().nullable().optional(),
  trackers: trackerConfigSchema.optional(),
  world: worldConfigSchema.optional(),
  /** CHAT-13: story settings compiled into the prompt. */
  story: z
    .object({ genre: short(60), tone: short(60), pov: short(40), tense: short(20), style: short(200), intensity: short(40), language: short(30) })
    .partial()
    .optional(),
  /** CHAT-12: quick switches. */
  length: z.enum(["short", "normal", "long"]).nullable().optional(),
  pacing: z.enum(["slow", "normal", "fast"]).nullable().optional(),
  /** CHAT-10: standing out-of-character notes, and a one-time cue for the next reply. */
  ooc: z.array(z.object({ id: z.string(), text: short(600) })).max(20).optional(),
  cue: short(1000).nullable().optional(),
  /** CHAT-11: guidance chips switched on for this chat (persistent), and ones used once. */
  guidance: z.object({ active: z.array(z.string()).max(40), once: z.array(z.string()).max(40) }).partial().optional(),
  /** CHAT-09: your messages are stage directions. */
  director: z.boolean().optional(),
  /** CONN-07: a model picked in the header, with this chat's profile settings. */
  modelOverride: z.object({ connectionId: z.string(), modelId: z.string() }).nullable().optional(),
  /** Meus (docs/13-meus.md): apply record and time fixes without the card (still with Undo). */
  meus: z.object({ autoApply: z.boolean() }).partial().optional(),
  /** Story truths: your rules for this story, sent every turn. */
  truths: z.array(short(300)).max(30).optional(),
  /** docs/15, 4.3: what {{char}} knows about {{user}} rides on the Bond (null: on in companion mode). */
  personaFacts: z.boolean().nullable().optional(),
  /** docs/14, part 6: retold from another chat in this version's world (the recap the story keeps to). */
  retold: z.object({ fromChatId: z.string(), arcId: z.string(), recap: z.string().max(8000) }).nullable().optional(),
  /** PROMPT-07: this chat's preset control values (over the character's and the preset's). */
  controls: z.record(z.string(), z.union([z.boolean(), z.string()])).optional(),
  /** CHAR-06 / PER-05: the character variant and persona variant this chat plays. */
  variantId: z.string().nullable().optional(),
  personaVariantId: z.string().nullable().optional(),
  /** Phase 5: this chat's own accuracy guard settings (CON-03…05, CON-10, CON-12) over the global ones. */
  guards: guardsSchema.partial().optional(),
  /** STEER-01 / STEER-03: this chat's advisor and editor (null = the global default). */
  advisor: z.boolean().nullable().optional(),
  editor: z.enum(["off", "flagged", "every"]).nullable().optional(),
  /** UI-08: per-chat ambience: the portrait's accent, a background with blur/dim/vignette, and how solid text panels are. */
  ambience: z
    .object({
      accent: z.boolean(),
      imageId: z.string().max(80).nullable(),
      blur: z.number().min(0).max(30),
      dim: z.number().min(0).max(0.9),
      vignette: z.boolean(),
      panel: z.number().min(0.4).max(1),
    })
    .partial()
    .optional(),
  /** J3: this chat's soundtrack: on or off, your thumbs, "not for this scene", what's playing. */
  music: z
    .object({
      on: z.boolean(),
      votes: z.record(z.string(), z.number()),
      notFor: z.record(z.string(), z.array(z.string())),
      recent: z.array(z.string()).max(20),
      lastKey: z.string().max(200),
      now: z.object({ videoId: z.string(), title: z.string(), artist: z.string(), key: z.string(), why: z.string(), at: z.number() }).nullable(),
    })
    .partial()
    .optional(),
  /** J1: "This place is…": your correction of a place's kind for its scene plate (by place name). */
  placeKinds: z.record(z.string().max(120), z.string().max(30)).optional(),
  /** H3: who plans each reply: the writer itself ("reply"), or a separate planner model. */
  planning: z.enum(["reply", "planner"]).optional(),
  plannerProfileId: z.string().nullable().optional(),
  /** H2: Budget mode: no optional model reads for this chat (checks, lessons, the advisor, the editor…). */
  budgetMode: z.boolean().optional(),
  /** H1: what this chat never cuts when the prompt is over its ceiling ("Keep this next time"). */
  promptKeep: z.array(z.string().max(40)).max(30).optional(),
  /** D2: the craft coach in this chat: paused, and the habits you said are fine. */
  craft: z.object({ paused: z.boolean(), ignored: z.array(z.string().max(120)).max(60) }).partial().optional(),
  /** C1: where the story stands in its source, and what hasn't happened yet. */
  canon: canonSchema.optional(),
  /** Reliable state 2.1: lore secrets you linked to a tracker fact ("entryId:index" → fact key), or unlinked (""). */
  secretLinks: z.record(z.string().max(120), z.string().max(120)).optional(),
  /** STEER-04: the style profile, over the character's. */
  style: z
    .object({
      guide: z.string().max(1500).optional(),
      banned: z.array(z.string().trim().min(1).max(80)).max(60).optional(),
      actions: z.enum(["asterisks", "plain", "any"]).optional(),
      quotes: z.enum(["straight", "curly", "any"]).optional(),
      dialogue: z.string().max(200).optional(),
    })
    .optional(),
});
export type ChatSettings = z.infer<typeof chatSettingsSchema>;

interface ChatRow {
  id: string;
  character_id: string | null;
  persona_id: string | null;
  title: string;
  mode: ChatMode;
  settings: string;
  vars: string;
  message_count: number;
  created_at: number;
  updated_at: number;
  last_message_at: number | null;
  archived_at: number | null;
  deleted_at: number | null;
  title_locked?: number;
  cover_image_id?: string | null;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  seq: number;
  role: Role;
  name: string | null;
  active_swipe: number;
  hidden: number;
  bookmarked: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface SwipeRow {
  id: string;
  message_id: string;
  idx: number;
  content: string;
  reasoning: string | null;
  status: "done" | "streaming" | "error" | "stopped";
  error: string | null;
  meta: string;
  created_at: number;
  updated_at: number;
}

const chatChanged = (chatId: string) => publish({ type: "chat.changed", chatId });

/**
 * Called when a message that memory may already be built from changes: edit, delete, restore,
 * hide, or a different swipe chosen (MEM-10). The memory module registers itself here.
 */
type LedgerHook = (chatId: string, messageId: string, change?: LedgerChange) => void;
/** C3: a rewind says where the story now ends; an undone rewind names the messages that came back. */
export interface LedgerChange {
  rewoundTo?: number;
  restored?: string[];
}
const ledgerHooks: LedgerHook[] = [];
export function onLedgerEdit(fn: LedgerHook) {
  ledgerHooks.push(fn);
}
function ledgerEdited(chatId: string, messageId: string, change?: LedgerChange) {
  for (const h of ledgerHooks) {
    try {
      h(chatId, messageId, change);
    } catch (e) {
      console.error("[mea] memory hook failed:", e);
    }
  }
}
const msgChanged = (chatId: string, messageId: string) => publish({ type: "message.changed", chatId, messageId });

export function getChatRow(id: string) {
  return one<ChatRow>("SELECT * FROM chats WHERE id = ?", id);
}

export function mustChat(id: string) {
  const c = getChatRow(id);
  if (!c || c.deleted_at) throw notFound("Chat not found");
  return c;
}

function chatOut(r: ChatRow) {
  return {
    id: r.id,
    characterId: r.character_id,
    personaId: r.persona_id,
    title: r.title,
    mode: r.mode,
    settings: parseJson<ChatSettings>(r.settings, {}),
    messageCount: r.message_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastMessageAt: r.last_message_at,
    archivedAt: r.archived_at,
    deletedAt: r.deleted_at,
    titleLocked: Boolean(r.title_locked),
    coverImageId: r.cover_image_id ?? null,
  };
}

export function getChat(id: string) {
  const r = getChatRow(id);
  return r ? chatOut(r) : undefined;
}

/** L17: `archived` lists the archive; `limit`/`offset` page the list (500 at most per page). */
export function listChats(opts: { characterId?: string; archived?: boolean; deleted?: boolean; limit?: number; offset?: number; collectionId?: string } = {}) {
  const where = [opts.deleted ? "c.deleted_at IS NOT NULL" : "c.deleted_at IS NULL"];
  const params: (string | number)[] = [];
  if (!opts.deleted && !opts.collectionId) where.push(opts.archived ? "c.archived_at IS NOT NULL" : "c.archived_at IS NULL");
  if (opts.collectionId) {
    where.push("c.id IN (SELECT chat_id FROM collection_chats WHERE collection_id = ?)");
    params.push(opts.collectionId);
  }
  if (opts.characterId) {
    where.push("c.character_id = ?");
    params.push(opts.characterId);
  }
  const rows = all<ChatRow & { character_name: string | null; avatar_id: string | null; last_text: string | null; last_role: string | null }>(
    `SELECT c.*, ch.name AS character_name, ch.avatar_id,
       (SELECT s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
        WHERE m.chat_id = c.id AND m.deleted_at IS NULL ORDER BY m.seq DESC LIMIT 1) AS last_text,
       (SELECT m.role FROM messages m WHERE m.chat_id = c.id AND m.deleted_at IS NULL ORDER BY m.seq DESC LIMIT 1) AS last_role
     FROM chats c LEFT JOIN characters ch ON ch.id = c.character_id
     WHERE ${where.join(" AND ")} ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id LIMIT ? OFFSET ?`,
    ...params,
    Math.min(500, Math.max(1, opts.limit ?? 200)),
    Math.max(0, opts.offset ?? 0),
  );
  const memberships = new Map<string, string[]>();
  for (const m of all<{ chat_id: string; collection_id: string }>("SELECT chat_id, collection_id FROM collection_chats")) memberships.set(m.chat_id, [...(memberships.get(m.chat_id) ?? []), m.collection_id]);
  return rows.map((r) => ({
    ...chatOut(r),
    collections: memberships.get(r.id) ?? [],
    characterName: r.character_name,
    avatarId: r.avatar_id,
    lastText: (r.last_text ?? "").slice(0, 160),
    lastRole: r.last_role,
  }));
}

/** Creates a chat and its greeting: first_mes plus alternate greetings as swipes. */
export function createChat(input: { characterId: string; personaId?: string | null; mode?: ChatMode; title?: string; variantId?: string | null }) {
  const row = getCharacterRow(input.characterId);
  // A variant with its own greetings opens the chat with them (CHAR-06).
  const variant = getVariant(input.variantId);
  const base = getCard(input.characterId);
  const card = base && applyCardVariant(base, variant, input.characterId);
  if (!row || !card || row.deleted_at) throw notFound("Character not found");
  // docs/14, part 6: a version in a universe brings your persona's version from the same universe.
  const persona = getPersona(input.personaId) ?? getPersona(personaForVersion(input.characterId, null)) ?? getPersona(row.default_persona_id) ?? getDefaultPersona();
  const mode = input.mode ?? row.mode ?? detectMode(card).mode;
  const id = newId();
  const t = now();
  const userName = persona?.name ?? "You";
  const fill = (s: string) => expandMacros(s, { char: card.name, user: userName, vars: {}, seed: id, mode });
  const greetings = [card.first_mes, ...card.alternate_greetings].map((g) => fill(g ?? "")).filter((g) => g.trim());
  tx(() => {
    run(
      `INSERT INTO chats (id, character_id, persona_id, title, mode, settings, vars, message_count, created_at, updated_at, last_message_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', 0, ?, ?, ?)`,
      id,
      input.characterId,
      persona?.id ?? null,
      input.title ?? `${card.name}${variant && lookFits(variant, "character", input.characterId) ? ` (${variant.name})` : ""} · ${new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      mode,
      JSON.stringify(variant && lookFits(variant, "character", input.characterId) ? { variantId: variant.id } : {}),
      t,
      t,
      t,
    );
    if (greetings.length) {
      const msgId = newId();
      run(
        "INSERT INTO messages (id, chat_id, seq, role, name, active_swipe, created_at, updated_at) VALUES (?, ?, 1, 'assistant', ?, 0, ?, ?)",
        msgId,
        id,
        card.name,
        t,
        t,
      );
      greetings.forEach((g, i) =>
        run("INSERT INTO swipes (id, message_id, idx, content, status, meta, created_at, updated_at) VALUES (?, ?, ?, ?, 'done', ?, ?, ?)", newId(), msgId, i, g, JSON.stringify({ greeting: true }), t, t),
      );
      run("UPDATE chats SET message_count = 1 WHERE id = ?", id);
    }
  });
  touchCharacter(input.characterId);
  chatChanged(id);
  return getChat(id)!;
}

export function updateChat(id: string, patch: { title?: string; personaId?: string | null; mode?: ChatMode; settings?: ChatSettings; archived?: boolean }) {
  const cur = mustChat(id);
  run(
    "UPDATE chats SET title = ?, persona_id = ?, mode = ?, settings = ?, archived_at = ?, updated_at = ? WHERE id = ?",
    patch.title ?? cur.title,
    patch.personaId !== undefined ? patch.personaId : cur.persona_id,
    patch.mode ?? cur.mode,
    patch.settings ? JSON.stringify({ ...parseJson<ChatSettings>(cur.settings, {}), ...patch.settings }) : cur.settings,
    patch.archived === undefined ? cur.archived_at : patch.archived ? now() : null,
    now(),
    id,
  );
  // LIB-04: a title you set yourself is never replaced by an automatic one.
  if (patch.title !== undefined && patch.title !== cur.title) run("UPDATE chats SET title_locked = 1 WHERE id = ?", id);
  chatChanged(id);
  return getChat(id)!;
}

export function softDeleteChat(id: string) {
  run("UPDATE chats SET deleted_at = ? WHERE id = ?", now(), id);
  chatChanged(id);
}

export function restoreChat(id: string) {
  run("UPDATE chats SET deleted_at = NULL WHERE id = ?", id);
  chatChanged(id);
}

export function setChatVars(id: string, vars: Record<string, string>) {
  run("UPDATE chats SET vars = ? WHERE id = ?", JSON.stringify(vars), id);
}

// ---------- Messages ----------

export function messageOut(m: MessageRow, swipes: SwipeRow[], includeAllSwipes: boolean) {
  const active = swipes.find((s) => s.idx === m.active_swipe) ?? swipes[0];
  return {
    id: m.id,
    chatId: m.chat_id,
    seq: m.seq,
    role: m.role,
    name: m.name,
    hidden: Boolean(m.hidden),
    bookmarked: Boolean(m.bookmarked),
    activeSwipe: m.active_swipe,
    swipeCount: swipes.length,
    content: active?.content ?? "",
    reasoning: active?.reasoning ?? null,
    status: active?.status ?? "done",
    error: active?.error ?? null,
    meta: parseJson<Record<string, unknown>>(active?.meta, {}),
    swipes: includeAllSwipes ? swipes.map((s) => ({ idx: s.idx, content: s.content, status: s.status, error: s.error, meta: parseJson<Record<string, unknown>>(s.meta, {}) })) : undefined,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  };
}

export type MessageOut = ReturnType<typeof messageOut>;

export function getMessageRow(id: string) {
  return one<MessageRow>("SELECT * FROM messages WHERE id = ?", id);
}

export function getSwipes(messageId: string) {
  return all<SwipeRow>("SELECT * FROM swipes WHERE message_id = ? ORDER BY idx", messageId);
}

export function getMessage(id: string, allSwipes = true) {
  const m = getMessageRow(id);
  return m ? messageOut(m, getSwipes(id), allSwipes) : undefined;
}

export function lastMessage(chatId: string) {
  return one<MessageRow>("SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1", chatId);
}

/** A page of messages, oldest first (PERF-02: paginated reads). The last message carries all its swipes. */
export function listMessages(chatId: string, opts: { before?: number; after?: number; limit?: number } = {}) {
  const limit = Math.min(200, opts.limit ?? 60);
  // `after` reads forward from a point (reading mode, UI-15); otherwise pages go backwards from the end.
  const forward = opts.after !== undefined && opts.before === undefined;
  const rows = forward
    ? all<MessageRow>("SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND seq > ? ORDER BY seq ASC LIMIT ?", chatId, opts.after!, limit + 1)
    : all<MessageRow>(
        `SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL ${opts.before ? "AND seq < ?" : ""} ORDER BY seq DESC LIMIT ?`,
        ...(opts.before ? [chatId, opts.before, limit + 1] : [chatId, limit + 1]),
      );
  const hasMore = rows.length > limit;
  const page = forward ? rows.slice(0, limit) : rows.slice(0, limit).reverse();
  if (!page.length) return { messages: [], hasMore: false };
  const ids = page.map((r) => r.id);
  const swipes = all<SwipeRow>(`SELECT * FROM swipes WHERE message_id IN (${ids.map(() => "?").join(",")}) ORDER BY idx`, ...ids);
  const byMsg = new Map<string, SwipeRow[]>();
  for (const s of swipes) {
    if (!byMsg.has(s.message_id)) byMsg.set(s.message_id, []);
    byMsg.get(s.message_id)!.push(s);
  }
  const last = lastMessage(chatId)?.id;
  return { messages: page.map((m) => messageOut(m, byMsg.get(m.id) ?? [], m.id === last)), hasMore };
}

function nextSeq(chatId: string) {
  return (one<{ s: number | null }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ?", chatId)?.s ?? 0) + 1;
}

function bumpChat(chatId: string) {
  const t = now();
  run(
    "UPDATE chats SET message_count = (SELECT COUNT(*) FROM messages WHERE chat_id = ? AND deleted_at IS NULL), last_message_at = ?, updated_at = ? WHERE id = ?",
    chatId,
    t,
    t,
    chatId,
  );
}

export function addMessage(chatId: string, role: Role, content: string, opts: { name?: string; status?: SwipeRow["status"]; meta?: Record<string, unknown> } = {}) {
  const id = newId();
  const t = now();
  tx(() => {
    run("INSERT INTO messages (id, chat_id, seq, role, name, active_swipe, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)", id, chatId, nextSeq(chatId), role, opts.name ?? null, t, t);
    run(
      "INSERT INTO swipes (id, message_id, idx, content, status, meta, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?, ?)",
      newId(),
      id,
      content,
      opts.status ?? "done",
      JSON.stringify(opts.meta ?? {}),
      t,
      t,
    );
    bumpChat(chatId);
  });
  msgChanged(chatId, id);
  return id;
}

export function addSwipe(messageId: string, status: SwipeRow["status"] = "streaming") {
  const m = getMessageRow(messageId);
  if (!m) throw notFound("Message not found");
  const idx = (one<{ i: number | null }>("SELECT MAX(idx) AS i FROM swipes WHERE message_id = ?", messageId)?.i ?? -1) + 1;
  const t = now();
  tx(() => {
    run("INSERT INTO swipes (id, message_id, idx, content, status, meta, created_at, updated_at) VALUES (?, ?, ?, '', ?, '{}', ?, ?)", newId(), messageId, idx, status, t, t);
    run("UPDATE messages SET active_swipe = ?, updated_at = ? WHERE id = ?", idx, t, messageId);
  });
  return idx;
}

export function updateSwipe(messageId: string, idx: number, patch: Partial<Pick<SwipeRow, "content" | "reasoning" | "status" | "error">> & { meta?: Record<string, unknown> }) {
  const cur = one<SwipeRow>("SELECT * FROM swipes WHERE message_id = ? AND idx = ?", messageId, idx);
  if (!cur) return;
  run(
    "UPDATE swipes SET content = ?, reasoning = ?, status = ?, error = ?, meta = ?, updated_at = ? WHERE id = ?",
    patch.content ?? cur.content,
    patch.reasoning !== undefined ? patch.reasoning : cur.reasoning,
    patch.status ?? cur.status,
    patch.error !== undefined ? patch.error : cur.error,
    patch.meta ? JSON.stringify({ ...parseJson<Record<string, unknown>>(cur.meta, {}), ...patch.meta }) : cur.meta,
    now(),
    cur.id,
  );
}

/** Edits the active swipe and keeps the previous text (MEM-01 edit history). */
export function editMessage(id: string, content: string) {
  const m = getMessageRow(id);
  if (!m || m.deleted_at) throw notFound("Message not found");
  const s = one<SwipeRow>("SELECT * FROM swipes WHERE message_id = ? AND idx = ?", id, m.active_swipe);
  if (!s) throw notFound("Message has no content");
  if (s.status === "streaming") throw badRequest("Wait for the reply to finish before editing");
  if (s.content === content) return getMessage(id)!;
  tx(() => {
    run("INSERT INTO swipe_edits (id, swipe_id, previous, created_at) VALUES (?, ?, ?, ?)", newId(), s.id, s.content, now());
    run("UPDATE swipes SET content = ?, status = 'done', error = NULL, updated_at = ? WHERE id = ?", content, now(), s.id);
    run("UPDATE messages SET updated_at = ? WHERE id = ?", now(), id);
  });
  msgChanged(m.chat_id, id);
  ledgerEdited(m.chat_id, id);
  return getMessage(id)!;
}

export function setActiveSwipe(id: string, idx: number) {
  const m = getMessageRow(id);
  if (!m) throw notFound("Message not found");
  const exists = one("SELECT 1 FROM swipes WHERE message_id = ? AND idx = ?", id, idx);
  if (!exists) throw badRequest("No such swipe");
  run("UPDATE messages SET active_swipe = ?, updated_at = ? WHERE id = ?", idx, now(), id);
  msgChanged(m.chat_id, id);
  if (idx !== m.active_swipe) ledgerEdited(m.chat_id, id);
  return getMessage(id)!;
}

/**
 * Deletes one version of a message for good. The versions after it move down one place, along
 * with the story-state events and continuity notes tied to them, so the count stays 1…n.
 */
export function deleteSwipe(id: string, idx: number) {
  const m = getMessageRow(id);
  if (!m || m.deleted_at) throw notFound("Message not found");
  const swipes = getSwipes(id);
  const target = swipes.find((s) => s.idx === idx);
  if (!target) throw notFound("No such swipe");
  if (swipes.length < 2) throw badRequest("This is the only version; delete the message instead");
  if (swipes.some((s) => s.status === "streaming")) throw badRequest("Wait for the reply to finish before deleting a version");
  const remaining = swipes.length - 1;
  // The version after the deleted one takes its place; deleting the last one shows the one before.
  const active = m.active_swipe > idx ? m.active_swipe - 1 : m.active_swipe === idx ? Math.min(idx, remaining - 1) : m.active_swipe;
  const t = now();
  tx(() => {
    run("DELETE FROM swipes WHERE id = ?", target.id);
    run("DELETE FROM tracker_events WHERE message_id = ? AND swipe_idx = ?", id, idx);
    run("DELETE FROM continuity_flags WHERE message_id = ? AND swipe_idx = ?", id, idx);
    // One row at a time, lowest first, so (message_id, idx) stays unique at every step.
    for (const s of swipes) if (s.idx > idx) run("UPDATE swipes SET idx = ? WHERE id = ?", s.idx - 1, s.id);
    for (const f of all<{ id: string; swipe_idx: number }>("SELECT id, swipe_idx FROM continuity_flags WHERE message_id = ? AND swipe_idx > ? ORDER BY swipe_idx", id, idx))
      run("UPDATE continuity_flags SET swipe_idx = ? WHERE id = ?", f.swipe_idx - 1, f.id);
    run("UPDATE tracker_events SET swipe_idx = swipe_idx - 1 WHERE message_id = ? AND swipe_idx > ?", id, idx);
    // docs/15: lore facts from that version go with it; the ones after it move down with theirs.
    run("DELETE FROM lore_facts WHERE message_id = ? AND swipe_idx = ?", id, idx);
    run("UPDATE lore_facts SET swipe_idx = swipe_idx - 1 WHERE message_id = ? AND swipe_idx > ?", id, idx);
    // M31: so do the tracker memories made from them.
    run(
      "UPDATE memories SET swipe_idx = swipe_idx - 1 WHERE origin = 'tracker' AND swipe_idx > ? AND id IN (SELECT memory_id FROM memory_sources WHERE message_id = ?)",
      idx,
      id,
    );
    run("UPDATE messages SET active_swipe = ?, updated_at = ? WHERE id = ?", active, t, id);
  });
  msgChanged(m.chat_id, id);
  publish({ type: "continuity.changed", chatId: m.chat_id, messageId: id });
  // L14: another version going leaves the story as it reads untouched; only the shown one changes it.
  if (idx === m.active_swipe) ledgerEdited(m.chat_id, id);
  return getMessage(id)!;
}

export function setMessageFlags(id: string, flags: { hidden?: boolean; bookmarked?: boolean }) {
  const m = getMessageRow(id);
  if (!m) throw notFound("Message not found");
  run(
    "UPDATE messages SET hidden = ?, bookmarked = ?, updated_at = ? WHERE id = ?",
    flags.hidden === undefined ? m.hidden : flags.hidden ? 1 : 0,
    flags.bookmarked === undefined ? m.bookmarked : flags.bookmarked ? 1 : 0,
    now(),
    id,
  );
  msgChanged(m.chat_id, id);
  if (flags.hidden !== undefined && Boolean(m.hidden) !== flags.hidden) ledgerEdited(m.chat_id, id);
  return getMessage(id)!;
}

export function softDeleteMessage(id: string) {
  const m = getMessageRow(id);
  if (!m) throw notFound("Message not found");
  run("UPDATE messages SET deleted_at = ? WHERE id = ?", now(), id);
  bumpChat(m.chat_id);
  msgChanged(m.chat_id, id);
  ledgerEdited(m.chat_id, id);
}

export function restoreMessage(id: string) {
  const m = getMessageRow(id);
  if (!m) throw notFound("Message not found");
  run("UPDATE messages SET deleted_at = NULL WHERE id = ?", id);
  bumpChat(m.chat_id);
  msgChanged(m.chat_id, id);
  ledgerEdited(m.chat_id, id);
  return getMessage(id)!;
}

/**
 * "Delete everything after this message" (CHAT-16): the rest goes to the trash and can be undone.
 * C3: it goes through the ledger hooks like any delete, so memory and trackers drop the abandoned timeline.
 */
export function rewindAfter(messageId: string) {
  const m = getMessageRow(messageId);
  if (!m || m.deleted_at) throw notFound("Message not found");
  const ids = all<{ id: string }>("SELECT id FROM messages WHERE chat_id = ? AND seq > ? AND deleted_at IS NULL ORDER BY seq", m.chat_id, m.seq).map((r) => r.id);
  if (!ids.length) return ids;
  const t = now();
  tx(() => {
    for (const id of ids) run("UPDATE messages SET deleted_at = ? WHERE id = ?", t, id);
    run("UPDATE chats SET message_count = (SELECT COUNT(*) FROM messages WHERE chat_id = ? AND deleted_at IS NULL), updated_at = ? WHERE id = ?", m.chat_id, t, m.chat_id);
  });
  chatChanged(m.chat_id);
  ledgerEdited(m.chat_id, m.id, { rewoundTo: m.seq });
  return ids;
}

/** Undoes a rewind: the messages come back, and memory and trackers pick them up again (C3). */
export function restoreMessages(chatId: string, ids: string[]) {
  const back = ids.length
    ? all<{ id: string }>(`SELECT id FROM messages WHERE chat_id = ? AND deleted_at IS NOT NULL AND id IN (${ids.map(() => "?").join(",")}) ORDER BY seq`, chatId, ...ids).map((r) => r.id)
    : [];
  tx(() => {
    for (const id of back) run("UPDATE messages SET deleted_at = NULL WHERE id = ? AND chat_id = ?", id, chatId);
    run("UPDATE chats SET message_count = (SELECT COUNT(*) FROM messages WHERE chat_id = ? AND deleted_at IS NULL), updated_at = ? WHERE id = ?", chatId, now(), chatId);
  });
  chatChanged(chatId);
  if (back.length) ledgerEdited(chatId, back[0]!, { restored: back });
  return back.length;
}

/** Messages that go into the prompt: not deleted, not hidden, non-empty, oldest first. */
export function historyForPrompt(chatId: string, opts: { excludeMessageId?: string; uptoSeq?: number } = {}): HistoryMessage[] {
  return all<{ id: string; role: Role; content: string; seq: number; meta: string }>(
    `SELECT m.id, m.role, s.content, m.seq, s.meta FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.hidden = 0 AND s.status != 'error' AND TRIM(s.content) != ''
     ${opts.uptoSeq != null ? "AND m.seq <= ?" : ""}
     ORDER BY m.seq`,
    ...(opts.uptoSeq != null ? [chatId, opts.uptoSeq] : [chatId]),
  )
    .filter((m) => m.id !== opts.excludeMessageId)
    .map(({ id, role, content, seq, meta }) => ({
      id,
      role,
      // CHAT-09: a stage direction never reads as the user's character speaking.
      content: role === "user" && meta.includes('"director":true') ? `[Stage direction from the user, not their character's words or actions: ${content.trim()}]` : content,
      seq,
    }));
}

export function messageCountOf(chatId: string) {
  return one<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.n ?? 0;
}
