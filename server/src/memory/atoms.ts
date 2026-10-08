import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { badRequest, notFound } from "../lib/http";
import { countTokens } from "../lib/tokens";
import { type AtomType, normalizeType } from "./prompts";
import { touchMemory } from "./store";

export type AtomStatus = "active" | "superseded" | "resolved" | "disputed";

export interface AtomRow {
  id: string;
  chat_id: string;
  scene_id: string | null;
  type: AtomType;
  content: string;
  entities: string;
  importance: number;
  emotions: string;
  story_time: string | null;
  known_by: string;
  status: AtomStatus;
  superseded_by: string | null;
  confidence: number;
  pinned: number;
  user_edited: number;
  stale: number;
  min_seq: number | null;
  max_seq: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  recall_count: number;
  ref_count: number;
  last_recalled_seq: number | null;
  last_ref_seq: number | null;
  ledger: string | null;
}

/** Promise and secret ledger state (MEM-30, MEM-31). */
export interface AtomLedger {
  status: "pending" | "kept" | "broken" | "secret" | "revealed";
  by?: string;
  to?: string;
  markedBy?: "you" | "story";
  seq?: number | null;
  note?: string;
}

export interface NewAtom {
  type: string;
  content: string;
  entities?: string[];
  importance?: number;
  emotions?: string[];
  storyTime?: string | null;
  knownBy?: string[];
  confidence?: number;
  status?: AtomStatus;
  pinned?: boolean;
  userEdited?: boolean;
}

export function atomOut(r: AtomRow, extra: { sources?: { messageId: string; seq: number }[] } = {}) {
  return {
    id: r.id,
    sceneId: r.scene_id,
    type: r.type,
    content: r.content,
    entities: parseJson<string[]>(r.entities, []),
    importance: r.importance,
    emotions: parseJson<string[]>(r.emotions, []),
    storyTime: r.story_time,
    knownBy: parseJson<string[]>(r.known_by, []),
    status: r.status,
    supersededBy: r.superseded_by,
    confidence: r.confidence,
    pinned: Boolean(r.pinned),
    userEdited: Boolean(r.user_edited),
    stale: Boolean(r.stale),
    minSeq: r.min_seq,
    maxSeq: r.max_seq,
    tokens: countTokens(r.content),
    recallCount: r.recall_count ?? 0,
    refCount: r.ref_count ?? 0,
    lastRecalledSeq: r.last_recalled_seq ?? null,
    lastRefSeq: r.last_ref_seq ?? null,
    ledger: r.ledger ? parseJson<AtomLedger | null>(r.ledger, null) : null,
    sources: extra.sources,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
export type AtomOut = ReturnType<typeof atomOut>;

export function getAtom(id: string) {
  return one<AtomRow>("SELECT * FROM memories WHERE id = ?", id);
}

export function atomSources(id: string) {
  return all<{ message_id: string; seq: number }>("SELECT message_id, seq FROM memory_sources WHERE memory_id = ? ORDER BY seq", id).map((s) => ({ messageId: s.message_id, seq: s.seq }));
}

/** Inserts an atom with its source links (principle 2: every fact has a source). */
export function insertAtom(chatId: string, sceneId: string | null, a: NewAtom, sources: { id: string; seq: number }[]) {
  const id = newId();
  const t = now();
  const seqs = sources.map((s) => s.seq);
  run(
    `INSERT INTO memories (id, chat_id, scene_id, type, content, entities, importance, emotions, story_time, known_by, status, confidence, pinned, user_edited, min_seq, max_seq, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    chatId,
    sceneId,
    normalizeType(a.type),
    a.content.trim(),
    JSON.stringify((a.entities ?? []).map((e) => e.trim()).filter(Boolean).slice(0, 12)),
    Math.max(1, Math.min(10, Math.round(a.importance ?? 5))),
    JSON.stringify((a.emotions ?? []).slice(0, 6)),
    a.storyTime ?? null,
    JSON.stringify(a.knownBy ?? []),
    a.status ?? "active",
    Math.max(0, Math.min(1, a.confidence ?? 0.9)),
    a.pinned ? 1 : 0,
    a.userEdited ? 1 : 0,
    seqs.length ? Math.min(...seqs) : null,
    seqs.length ? Math.max(...seqs) : null,
    t,
    t,
  );
  for (const s of sources) run("INSERT OR IGNORE INTO memory_sources (memory_id, message_id, seq) VALUES (?, ?, ?)", id, s.id, s.seq);
  return id;
}

/** Marks `oldId` as superseded by `newId`, keeping its history (MEM-07). */
export function supersede(oldId: string, newId: string) {
  run("UPDATE memories SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ? AND status != 'superseded'", newId, now(), oldId);
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

/** True if an active atom with practically the same text already exists in the chat. */
export function isDuplicate(chatId: string, content: string, ignoreSceneId?: string | null) {
  const n = norm(content);
  if (!n) return true;
  const rows = all<{ content: string; scene_id: string | null }>(
    "SELECT m.content, m.scene_id FROM memories_fts f JOIN memories m ON m.id = f.id WHERE memories_fts MATCH ? AND f.chat_id = ? AND m.deleted_at IS NULL AND m.status = 'active' LIMIT 20",
    `"${n.split(" ").slice(0, 8).join(" ").replaceAll('"', "")}"`,
    chatId,
  );
  return rows.some((r) => r.scene_id !== ignoreSceneId && norm(r.content) === n);
}

export interface AtomFilter {
  q?: string;
  type?: string;
  status?: string;
  pinned?: boolean;
  stale?: boolean;
  sceneId?: string;
  limit?: number;
  offset?: number;
}

/** Memory Inspector listing (MEM-39). */
export function listAtoms(chatId: string, f: AtomFilter = {}) {
  const where = ["m.chat_id = ?", "m.deleted_at IS NULL"];
  const params: (string | number)[] = [chatId];
  if (f.type) {
    where.push("m.type = ?");
    params.push(f.type);
  }
  if (f.status) {
    where.push("m.status = ?");
    params.push(f.status);
  }
  if (f.pinned) where.push("m.pinned = 1");
  if (f.stale) where.push("m.stale = 1");
  if (f.sceneId) {
    where.push("m.scene_id = ?");
    params.push(f.sceneId);
  }
  let from = "memories m";
  if (f.q?.trim()) {
    const terms = f.q
      .trim()
      .split(/\s+/)
      .map((w) => `"${w.replaceAll('"', "")}"*`)
      .join(" ");
    from = "memories_fts x JOIN memories m ON m.id = x.id";
    where.push("memories_fts MATCH ?");
    params.push(terms);
  }
  const total = one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${from} WHERE ${where.join(" AND ")}`, ...params)?.n ?? 0;
  const rows = all<AtomRow>(
    `SELECT m.* FROM ${from} WHERE ${where.join(" AND ")} ORDER BY m.pinned DESC, COALESCE(m.max_seq, 0) DESC, m.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    Math.min(500, f.limit ?? 100),
    f.offset ?? 0,
  );
  const sources = new Map<string, { messageId: string; seq: number }[]>();
  if (rows.length) {
    for (const s of all<{ memory_id: string; message_id: string; seq: number }>(
      `SELECT memory_id, message_id, seq FROM memory_sources WHERE memory_id IN (${rows.map(() => "?").join(",")}) ORDER BY seq`,
      ...rows.map((r) => r.id),
    )) {
      if (!sources.has(s.memory_id)) sources.set(s.memory_id, []);
      sources.get(s.memory_id)!.push({ messageId: s.message_id, seq: s.seq });
    }
  }
  return { total, atoms: rows.map((r) => atomOut(r, { sources: sources.get(r.id) ?? [] })) };
}

function mustAtom(id: string) {
  const a = getAtom(id);
  if (!a || a.deleted_at) throw notFound("Memory not found");
  return a;
}

/** Your edits always win: an edited atom is locked against AI rebuilds (principle 4, MEM-27). */
export function updateAtom(id: string, patch: { content?: string; type?: string; importance?: number; entities?: string[]; knownBy?: string[]; status?: AtomStatus; pinned?: boolean; storyTime?: string | null }) {
  const a = mustAtom(id);
  const edited = patch.content !== undefined || patch.type !== undefined || patch.importance !== undefined || patch.entities !== undefined || patch.knownBy !== undefined || patch.storyTime !== undefined;
  run(
    `UPDATE memories SET content = ?, type = ?, importance = ?, entities = ?, known_by = ?, status = ?, pinned = ?, story_time = ?, user_edited = ?, stale = ?, updated_at = ? WHERE id = ?`,
    patch.content?.trim() || a.content,
    patch.type ? normalizeType(patch.type) : a.type,
    patch.importance != null ? Math.max(1, Math.min(10, Math.round(patch.importance))) : a.importance,
    patch.entities ? JSON.stringify(patch.entities) : a.entities,
    patch.knownBy ? JSON.stringify(patch.knownBy) : a.known_by,
    patch.status ?? a.status,
    patch.pinned === undefined ? a.pinned : patch.pinned ? 1 : 0,
    patch.storyTime !== undefined ? patch.storyTime : a.story_time,
    edited ? 1 : a.user_edited,
    edited ? 0 : a.stale,
    now(),
    id,
  );
  if (patch.status === "active" && a.status === "superseded") run("UPDATE memories SET superseded_by = NULL WHERE id = ?", id);
  touchMemory(a.chat_id);
  return atomOut(getAtom(id)!, { sources: atomSources(id) });
}

export function deleteAtom(id: string) {
  const a = mustAtom(id);
  run("UPDATE memories SET deleted_at = ?, updated_at = ? WHERE id = ?", now(), now(), id);
  touchMemory(a.chat_id);
}

export function restoreAtom(id: string) {
  const a = getAtom(id);
  if (!a) throw notFound("Memory not found");
  run("UPDATE memories SET deleted_at = NULL, updated_at = ? WHERE id = ?", now(), id);
  touchMemory(a.chat_id);
  return atomOut(getAtom(id)!, { sources: atomSources(id) });
}

/** A memory you write yourself, optionally tied to messages. */
export function createAtom(chatId: string, input: NewAtom & { messageIds?: string[] }) {
  const sources = input.messageIds?.length
    ? all<{ id: string; seq: number }>(`SELECT id, seq FROM messages WHERE chat_id = ? AND id IN (${input.messageIds.map(() => "?").join(",")})`, chatId, ...input.messageIds)
    : [];
  const id = insertAtom(chatId, null, { ...input, userEdited: true }, sources);
  touchMemory(chatId);
  return atomOut(getAtom(id)!, { sources: atomSources(id) });
}

/** Merges several atoms into the first one (MEM-39): sources are combined, the rest are superseded. */
export function mergeAtoms(ids: string[], content?: string) {
  if (ids.length < 2) throw badRequest("Pick at least two memories to merge");
  const rows = ids.map(mustAtom);
  const chatId = rows[0]!.chat_id;
  if (rows.some((r) => r.chat_id !== chatId)) throw badRequest("Memories belong to different chats");
  const keep = rows[0]!;
  tx(() => {
    const merged = content?.trim() || rows.map((r) => r.content).join(" ");
    const entities = [...new Set(rows.flatMap((r) => parseJson<string[]>(r.entities, [])))];
    run(
      "UPDATE memories SET content = ?, entities = ?, importance = ?, pinned = ?, user_edited = 1, stale = 0, updated_at = ? WHERE id = ?",
      merged,
      JSON.stringify(entities),
      Math.max(...rows.map((r) => r.importance)),
      rows.some((r) => r.pinned) ? 1 : 0,
      now(),
      keep.id,
    );
    for (const r of rows.slice(1)) {
      run("INSERT OR IGNORE INTO memory_sources (memory_id, message_id, seq) SELECT ?, message_id, seq FROM memory_sources WHERE memory_id = ?", keep.id, r.id);
      supersede(r.id, keep.id);
    }
    const span = one<{ a: number | null; b: number | null }>("SELECT MIN(seq) AS a, MAX(seq) AS b FROM memory_sources WHERE memory_id = ?", keep.id);
    run("UPDATE memories SET min_seq = ?, max_seq = ? WHERE id = ?", span?.a ?? null, span?.b ?? null, keep.id);
  });
  touchMemory(chatId);
  return atomOut(getAtom(keep.id)!, { sources: atomSources(keep.id) });
}

/** Splits an atom into two edited halves sharing its sources (MEM-39). */
export function splitAtom(id: string, parts: [string, string]) {
  const a = mustAtom(id);
  if (!parts[0].trim() || !parts[1].trim()) throw badRequest("Both parts need text");
  const sources = atomSources(id).map((s) => ({ id: s.messageId, seq: s.seq }));
  let second = "";
  tx(() => {
    run("UPDATE memories SET content = ?, user_edited = 1, stale = 0, updated_at = ? WHERE id = ?", parts[0].trim(), now(), id);
    second = insertAtom(
      a.chat_id,
      a.scene_id,
      {
        type: a.type,
        content: parts[1],
        entities: parseJson(a.entities, []),
        importance: a.importance,
        knownBy: parseJson(a.known_by, []),
        storyTime: a.story_time,
        userEdited: true,
        pinned: Boolean(a.pinned),
      },
      sources,
    );
  });
  touchMemory(a.chat_id);
  return [atomOut(getAtom(id)!, { sources: atomSources(id) }), atomOut(getAtom(second)!, { sources: atomSources(second) })];
}

/** Atoms that cite a message (for "what does Mea remember from this message?"). */
export function atomsForMessage(messageId: string) {
  return all<AtomRow>(
    "SELECT m.* FROM memory_sources s JOIN memories m ON m.id = s.memory_id WHERE s.message_id = ? AND m.deleted_at IS NULL ORDER BY m.importance DESC",
    messageId,
  ).map((r) => atomOut(r));
}

/** Which replies used a memory or summary (MEM-39). */
export function usageOf(ownerType: "memory" | "summary", ownerId: string, limit = 20) {
  return all<{ generation_id: string; slot: string; created_at: number; message_id: string | null; seq: number | null }>(
    `SELECT u.generation_id, u.slot, u.created_at, g.message_id, m.seq FROM memory_usage u
     LEFT JOIN generations g ON g.id = u.generation_id LEFT JOIN messages m ON m.id = g.message_id
     WHERE u.owner_type = ? AND u.owner_id = ? ORDER BY u.created_at DESC LIMIT ?`,
    ownerType,
    ownerId,
    limit,
  ).map((r) => ({ generationId: r.generation_id, slot: r.slot, at: r.created_at, messageId: r.message_id, seq: r.seq }));
}

/** Atoms whose sources include a message are marked stale when it changes (MEM-10). */
export function markAtomsStaleForMessage(messageId: string) {
  run("UPDATE memories SET stale = 1, updated_at = ? WHERE id IN (SELECT memory_id FROM memory_sources WHERE message_id = ?) AND user_edited = 0", now(), messageId);
}
