import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { countTokens } from "../lib/tokens";
import { cleanText } from "./text";

export type Level = "scene" | "chapter" | "arc" | "story";
export const LEVELS: Level[] = ["scene", "chapter", "arc"];
/** pending: never built · building · ready · stale: sources changed · review: a rebuild waits for your OK · error */
export type SummaryState = "pending" | "building" | "ready" | "stale" | "review" | "error";

export interface SummaryRow {
  id: string;
  chat_id: string;
  level: Level;
  start_seq: number;
  end_seq: number | null;
  closed: number;
  boundary: string | null;
  manual: number;
  title: string;
  content: string;
  data: string;
  state: SummaryState;
  error: string | null;
  verification: string | null;
  user_edited: number;
  importance: number | null;
  tokens: number;
  source_tokens: number;
  source_hash: string | null;
  story_time: string | null;
  proposal: string | null;
  built_at: number | null;
  created_at: number;
  updated_at: number;
}

/** Per-chat memory bookkeeping, stored on chats.memory. */
export interface ChatMemoryState {
  /** Last message seq that segmentation has looked at. */
  segmentedThrough: number;
  /** Messages up to this seq are out of the verbatim window (CTX-05). */
  evictedThrough: number;
  /** Bumped on every memory change; keys recall caches (PERF-06). */
  version: number;
  paused?: boolean;
  /** SUM-15: the last "previously on…" recap, for the story as of this seq. */
  recap?: { text: string; seq: number; at: number; hash?: string };
  /** SUM-19: a rebuild from scratch in progress (when it started, what it was estimated to take). */
  rebuild?: { startedAt: number; estimate: Record<string, number | null> } | null;
  /** M29: bumped by a rebuild from scratch, so a pass already running stops instead of writing into it. */
  epoch?: number;
}

const DEFAULT_STATE: ChatMemoryState = { segmentedThrough: 0, evictedThrough: 0, version: 0 };

export function memState(chatId: string): ChatMemoryState {
  const r = one<{ memory: string }>("SELECT memory FROM chats WHERE id = ?", chatId);
  return { ...DEFAULT_STATE, ...parseJson<Partial<ChatMemoryState>>(r?.memory, {}) };
}

export function setMemState(chatId: string, patch: Partial<ChatMemoryState>) {
  const next = { ...memState(chatId), ...patch };
  run("UPDATE chats SET memory = ? WHERE id = ?", JSON.stringify(next), chatId);
  return next;
}

/** Marks the chat's memory as changed so caches refresh and open screens update. */
export function touchMemory(chatId: string) {
  const s = memState(chatId);
  setMemState(chatId, { version: s.version + 1 });
  publish({ type: "memory.changed", chatId });
}

// ---------- Ledger ----------

export interface LedgerRow {
  id: string;
  seq: number;
  role: "user" | "assistant" | "system";
  name: string | null;
  content: string;
  created_at: number;
}

/** Visible messages (active swipe, not hidden or deleted, not empty) in a seq range. */
export function ledger(chatId: string, from = 0, to = Number.MAX_SAFE_INTEGER): LedgerRow[] {
  return all<LedgerRow>(
    `SELECT m.id, m.seq, m.role, m.name, s.content, m.created_at FROM messages m
     JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.hidden = 0 AND s.status NOT IN ('error', 'streaming') AND TRIM(s.content) != ''
       AND m.seq >= ? AND m.seq <= ?
     ORDER BY m.seq`,
    chatId,
    from,
    to,
  );
}

/** The visible message just before `seq` (M20: one row, not the whole chat). */
export function ledgerBefore(chatId: string, seq: number): LedgerRow | null {
  return (
    one<LedgerRow>(
      `SELECT m.id, m.seq, m.role, m.name, s.content, m.created_at FROM messages m
       JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
       WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.hidden = 0 AND s.status NOT IN ('error', 'streaming') AND TRIM(s.content) != '' AND m.seq < ?
       ORDER BY m.seq DESC LIMIT 1`,
      chatId,
      seq,
    ) ?? null
  );
}

/**
 * The last seq memory may touch: everything except the newest `lag` messages (SUM-06, MEM-09).
 * The latest reply can still be swiped, so it never reaches memory until you answer it.
 */
export function settledThrough(chatId: string, lag: number): number {
  const streaming = one<{ seq: number }>(
    `SELECT MIN(m.seq) AS seq FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND s.status = 'streaming'`,
    chatId,
  )?.seq;
  const r = one<{ seq: number }>("SELECT seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1 OFFSET ?", chatId, Math.max(0, lag));
  const settled = r?.seq ?? 0;
  return streaming != null ? Math.min(settled, streaming - 1) : settled;
}

export function lastSeq(chatId: string) {
  return one<{ s: number | null }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0;
}

/** Messages formatted for a helper: "[#12] Mira: …", cleaned of markup (SUM-13). */
export function formatLedger(rows: LedgerRow[], names: { char: string; user: string }) {
  return rows
    .map((m) => {
      const who = m.role === "user" ? names.user : m.role === "assistant" ? (m.name ?? names.char) : "Note";
      return `[#${m.seq}] ${who}: ${cleanText(m.content)}`;
    })
    .join("\n\n");
}

export function ledgerTokens(rows: LedgerRow[]) {
  return rows.reduce((n, m) => n + countTokens(m.content), 0);
}

// ---------- Summary rows ----------

export function getSummary(id: string) {
  return one<SummaryRow>("SELECT * FROM summaries WHERE id = ?", id);
}

export function levelRows(chatId: string, level: Level) {
  return all<SummaryRow>("SELECT * FROM summaries WHERE chat_id = ? AND level = ? ORDER BY start_seq", chatId, level);
}

export function allRows(chatId: string) {
  return all<SummaryRow>("SELECT * FROM summaries WHERE chat_id = ? ORDER BY level, start_seq", chatId);
}

export function storyRow(chatId: string) {
  return one<SummaryRow>("SELECT * FROM summaries WHERE chat_id = ? AND level = 'story'", chatId);
}

/** The row at a level whose range contains seq. */
export function rowAt(chatId: string, level: Level, seq: number) {
  return one<SummaryRow>("SELECT * FROM summaries WHERE chat_id = ? AND level = ? AND start_seq <= ? ORDER BY start_seq DESC LIMIT 1", chatId, level, seq);
}

/** Rows of `child` level inside a parent row's range. */
export function childrenOf(parent: SummaryRow, child: Level) {
  return all<SummaryRow>(
    "SELECT * FROM summaries WHERE chat_id = ? AND level = ? AND start_seq >= ? AND start_seq <= ? ORDER BY start_seq",
    parent.chat_id,
    child,
    parent.start_seq,
    parent.end_seq ?? Number.MAX_SAFE_INTEGER,
  );
}

function insertRow(chatId: string, level: Level, startSeq: number, extra: { boundary?: string | null; manual?: boolean } = {}) {
  const t = now();
  const id = newId();
  run(
    "INSERT INTO summaries (id, chat_id, level, start_seq, boundary, manual, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
    id,
    chatId,
    level,
    startSeq,
    extra.boundary ?? null,
    extra.manual ? 1 : 0,
    t,
    t,
  );
  return id;
}

/** Recomputes end_seq/closed for a level: each row ends where the next begins; the last stays open. */
export function recomputeEnds(chatId: string, level: Level) {
  const rows = levelRows(chatId, level);
  rows.forEach((r, i) => {
    const next = rows[i + 1];
    const end = next ? next.start_seq - 1 : null;
    const closed = next ? 1 : 0;
    if (r.end_seq !== end || r.closed !== closed) run("UPDATE summaries SET end_seq = ?, closed = ?, updated_at = ? WHERE id = ?", end, closed, now(), r.id);
  });
}

/** Creates the first scene, chapter, and arc for a chat. */
export function ensureRoots(chatId: string, firstSeq: number) {
  for (const level of LEVELS) {
    if (!one("SELECT 1 FROM summaries WHERE chat_id = ? AND level = ?", chatId, level)) insertRow(chatId, level, firstSeq, { boundary: "start" });
  }
}

/** H4: rows whose sources changed while they were being built; the build saves them stale and runs again. */
export const dirtyBuilds = new Set<string>();

/** Marks a summary as needing a rebuild because its sources changed (MEM-10). */
export function markStale(id: string) {
  if (one("SELECT 1 FROM summaries WHERE id = ? AND state = 'building'", id)) dirtyBuilds.add(id);
  run("UPDATE summaries SET state = CASE WHEN state IN ('ready', 'review', 'error') THEN 'stale' ELSE state END, updated_at = ? WHERE id = ?", now(), id);
}

/**
 * Starts a new row at `seq` on a level (and on the levels below it, which must also break there).
 * The row that contained `seq` is split: both halves need rebuilding.
 */
export function startAt(chatId: string, level: Level, seq: number, opts: { boundary?: string; manual?: boolean } = {}) {
  return tx(() => {
    const idx = LEVELS.indexOf(level);
    let createdId = "";
    for (let i = 0; i <= idx; i++) {
      const lv = LEVELS[i]!;
      const existing = one<SummaryRow>("SELECT * FROM summaries WHERE chat_id = ? AND level = ? AND start_seq = ?", chatId, lv, seq);
      if (existing) {
        if (lv === level) {
          if (opts.manual) run("UPDATE summaries SET manual = 1, boundary = ? WHERE id = ?", opts.boundary ?? existing.boundary, existing.id);
          createdId = existing.id;
        }
        continue;
      }
      const containing = rowAt(chatId, lv, seq);
      const id = insertRow(chatId, lv, seq, { boundary: opts.boundary ?? null, manual: opts.manual && lv === level });
      if (lv === level) createdId = id;
      if (containing && containing.closed) {
        markStale(containing.id);
        run("UPDATE summaries SET state = 'pending' WHERE id = ?", id);
      }
      recomputeEnds(chatId, lv);
    }
    // Parents that now cover a changed child also need rebuilding.
    for (let i = idx + 1; i < LEVELS.length; i++) {
      const p = rowAt(chatId, LEVELS[i]!, seq);
      if (p?.closed) markStale(p.id);
    }
    const story = storyRow(chatId);
    if (story && story.end_seq != null && story.end_seq >= seq) markStale(story.id);
    return createdId;
  });
}

/**
 * Removes the boundary at `seq` on a level (merging that row into the one before),
 * together with the boundaries above it that started there.
 */
export function removeBoundary(chatId: string, level: Level, seq: number) {
  tx(() => {
    const idx = LEVELS.indexOf(level);
    for (let i = idx; i < LEVELS.length; i++) {
      const lv = LEVELS[i]!;
      const row = one<SummaryRow>("SELECT * FROM summaries WHERE chat_id = ? AND level = ? AND start_seq = ?", chatId, lv, seq);
      if (!row) continue;
      const prev = one<SummaryRow>("SELECT * FROM summaries WHERE chat_id = ? AND level = ? AND start_seq < ? ORDER BY start_seq DESC LIMIT 1", chatId, lv, seq);
      if (!prev) continue; // the first row can't merge backwards
      run("DELETE FROM summaries WHERE id = ?", row.id);
      run("DELETE FROM embeddings WHERE owner_type = 'summary' AND owner_id = ?", row.id);
      run("UPDATE memories SET scene_id = ? WHERE scene_id = ?", lv === "scene" ? prev.id : null, row.id);
      markStale(prev.id);
      recomputeEnds(chatId, lv);
    }
    for (let i = idx + 1; i < LEVELS.length; i++) {
      const p = rowAt(chatId, LEVELS[i]!, seq);
      if (p?.closed) markStale(p.id);
    }
    const story = storyRow(chatId);
    if (story && story.end_seq != null && story.end_seq >= seq) markStale(story.id);
  });
}

/** Deletes every derived row and atom for a chat (rebuild from scratch, SUM-19-lite). */
export function resetChatMemory(chatId: string, keepUserWork = true) {
  tx(() => {
    run("DELETE FROM summaries WHERE chat_id = ?", chatId);
    if (keepUserWork) {
      run("UPDATE memories SET scene_id = NULL, stale = 1 WHERE chat_id = ? AND (user_edited = 1 OR pinned = 1)", chatId);
      run("DELETE FROM memories WHERE chat_id = ? AND user_edited = 0 AND pinned = 0", chatId);
    } else run("DELETE FROM memories WHERE chat_id = ?", chatId);
    run("DELETE FROM embeddings WHERE chat_id = ? AND owner_type = 'summary'", chatId);
    // M31: and the vectors of the memories that just went.
    run("DELETE FROM embeddings WHERE chat_id = ? AND owner_type = 'memory' AND owner_id NOT IN (SELECT id FROM memories WHERE chat_id = ?)", chatId, chatId);
    const s = memState(chatId);
    setMemState(chatId, { segmentedThrough: 0, evictedThrough: 0, epoch: (s.epoch ?? 0) + 1 });
  });
}

export function saveVersion(row: SummaryRow, source: "ai" | "user" | "restore", note?: string) {
  if (!row.content.trim()) return;
  run(
    "INSERT INTO summary_versions (id, summary_id, title, content, data, source, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    newId(),
    row.id,
    row.title,
    row.content,
    row.data,
    source,
    note ?? null,
    now(),
  );
  // M31: the history is capped (the inspector shows the newest 50).
  run(
    "DELETE FROM summary_versions WHERE summary_id = ? AND id NOT IN (SELECT id FROM summary_versions WHERE summary_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50)",
    row.id,
    row.id,
  );
}

export function summaryOut(r: SummaryRow) {
  return {
    id: r.id,
    level: r.level,
    startSeq: r.start_seq,
    endSeq: r.end_seq,
    closed: Boolean(r.closed),
    boundary: r.boundary,
    manual: Boolean(r.manual),
    title: r.title,
    content: r.content,
    data: parseJson<Record<string, unknown>>(r.data, {}),
    state: r.state,
    error: r.error,
    verification: parseJson<Record<string, unknown> | null>(r.verification, null),
    userEdited: Boolean(r.user_edited),
    importance: r.importance,
    tokens: r.tokens,
    sourceTokens: r.source_tokens,
    storyTime: r.story_time,
    proposal: parseJson<{ title: string; content: string; data: Record<string, unknown>; at: number } | null>(r.proposal, null),
    builtAt: r.built_at,
    updatedAt: r.updated_at,
  };
}
export type SummaryOut = ReturnType<typeof summaryOut>;
