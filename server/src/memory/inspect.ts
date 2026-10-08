import { all, one, parseJson } from "../db/db";
import { memoryConfig } from "../lib/settings";
import { atomOut, type AtomRow, atomSources, usageOf } from "./atoms";
import { telescope } from "./context";
import { embeddingStatus } from "./embed";
import { allRows, getSummary, lastSeq, ledger, memState, rowAt, summaryOut } from "./store";
import { countTokens } from "../lib/tokens";
import { summaryVersions } from "./build";

/** Overview for the Memory Inspector (MEM-39): coverage map (SUM-09), stats (SUM-16), and health. */
export function memoryOverview(chatId: string) {
  const cfg = memoryConfig();
  const state = memState(chatId);
  const rows = allRows(chatId);
  const first = one<{ s: number | null }>("SELECT MIN(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0;
  const last = lastSeq(chatId);
  const t = telescope(chatId, state.evictedThrough, Number.MAX_SAFE_INTEGER);
  const counts = all<{ type: string; status: string; n: number }>("SELECT type, status, COUNT(*) AS n FROM memories WHERE chat_id = ? AND deleted_at IS NULL GROUP BY type, status", chatId);
  const atomTotals = one<{ n: number; pinned: number; stale: number; edited: number }>(
    "SELECT COUNT(*) AS n, SUM(pinned) AS pinned, SUM(stale) AS stale, SUM(user_edited) AS edited FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status != 'superseded'",
    chatId,
  );
  const scenes = rows.filter((r) => r.level === "scene");
  const sourceTokens = scenes.filter((s) => s.state === "ready").reduce((n, s) => n + s.source_tokens, 0);
  const summaryTokens = scenes.filter((s) => s.state === "ready").reduce((n, s) => n + s.tokens, 0);
  // SUM-16: "1,240 messages · 610k tokens → 9.8k tokens of memory".
  const summarizedThrough = scenes.filter((s) => s.state === "ready").reduce((n, s) => Math.max(n, s.end_seq ?? 0), 0);
  const tail = ledger(chatId, summarizedThrough + 1);
  const storyTokens = sourceTokens + tail.reduce((n, r) => n + countTokens(r.content), 0);
  const messageCount = one<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.n ?? 0;
  const jobs = all<{ kind: string; status: string; n: number }>("SELECT kind, status, COUNT(*) AS n FROM jobs WHERE chat_id = ? AND status IN ('queued', 'running', 'failed') GROUP BY kind, status", chatId);
  const lastUsed = one<{ trace: string | null }>("SELECT trace FROM generations WHERE chat_id = ? AND task = 'story' AND trace IS NOT NULL ORDER BY started_at DESC LIMIT 1", chatId);
  const lastTrace = parseJson<{ memory?: { telescopeTokens: number; recallTokens: number } } | null>(lastUsed?.trace, null);
  return {
    enabled: cfg.enabled,
    paused: Boolean(state.paused),
    onEdit: cfg.onEdit,
    firstSeq: first,
    lastSeq: last,
    segmentedThrough: state.segmentedThrough,
    evictedThrough: state.evictedThrough,
    coverage: rows.map((r) => ({ id: r.id, level: r.level, title: r.title, startSeq: r.start_seq, endSeq: r.end_seq, closed: Boolean(r.closed), state: r.state, manual: Boolean(r.manual), userEdited: Boolean(r.user_edited), tokens: r.tokens })),
    gaps: t.gaps,
    stats: {
      scenes: scenes.length,
      chapters: rows.filter((r) => r.level === "chapter").length,
      arcs: rows.filter((r) => r.level === "arc").length,
      hasStory: rows.some((r) => r.level === "story" && r.state === "ready"),
      summarizedSourceTokens: sourceTokens,
      sceneSummaryTokens: summaryTokens,
      telescopeTokens: t.tokens,
      lastPromptMemoryTokens: lastTrace?.memory ? lastTrace.memory.telescopeTokens + lastTrace.memory.recallTokens : null,
      atoms: atomTotals?.n ?? 0,
      pinned: atomTotals?.pinned ?? 0,
      stale: (atomTotals?.stale ?? 0) + rows.filter((r) => r.state === "stale").length,
      review: rows.filter((r) => r.state === "review").length,
      errors: rows.filter((r) => r.state === "error").length,
      edited: atomTotals?.edited ?? 0,
      messages: messageCount,
      storyTokens,
      memoryTokens: lastTrace?.memory ? lastTrace.memory.telescopeTokens + lastTrace.memory.recallTokens : t.tokens,
    },
    atomCounts: counts,
    jobs,
    embeddings: embeddingStatus(),
  };
}

export function summaryDetail(id: string) {
  const r = getSummary(id);
  if (!r) return undefined;
  const atoms =
    r.level === "scene" ? all<AtomRow>("SELECT * FROM memories WHERE scene_id = ? AND deleted_at IS NULL ORDER BY COALESCE(min_seq, 0), created_at", id).map((a) => atomOut(a, { sources: atomSources(a.id) })) : [];
  return { summary: summaryOut(r), versions: summaryVersions(id), usage: usageOf("summary", id), atoms };
}

export function atomDetail(id: string) {
  const a = one<AtomRow>("SELECT * FROM memories WHERE id = ?", id);
  if (!a) return undefined;
  // History of what this fact replaced (MEM-07), newest first.
  const history = all<AtomRow>("SELECT * FROM memories WHERE superseded_by = ? ORDER BY updated_at DESC", id).map((x) => atomOut(x));
  const successor = a.superseded_by ? one<AtomRow>("SELECT * FROM memories WHERE id = ?", a.superseded_by) : undefined;
  return { atom: atomOut(a, { sources: atomSources(id) }), replaced: history, supersededBy: successor ? atomOut(successor) : null, usage: usageOf("memory", id) };
}

/** Dividers for the chat view (MEM-04): scene and chapter starts with titles. */
export function boundaries(chatId: string) {
  return all<{ id: string; level: string; start_seq: number; title: string; state: string; manual: number; boundary: string | null; story_time: string | null }>(
    "SELECT id, level, start_seq, title, state, manual, boundary, story_time FROM summaries WHERE chat_id = ? AND level IN ('scene', 'chapter') ORDER BY start_seq, level",
    chatId,
  ).map((r) => ({ id: r.id, level: r.level, startSeq: r.start_seq, title: r.title, state: r.state, manual: Boolean(r.manual), boundary: r.boundary, storyTime: r.story_time }));
}

/** What memory knows about one message: its scene and the atoms citing it. */
export function messageMemory(chatId: string, messageId: string, seq: number) {
  const scene = rowAt(chatId, "scene", seq);
  const atoms = all<AtomRow>(
    "SELECT m.* FROM memory_sources s JOIN memories m ON m.id = s.memory_id WHERE s.message_id = ? AND m.deleted_at IS NULL ORDER BY m.importance DESC",
    messageId,
  ).map((a) => atomOut(a));
  return { scene: scene ? summaryOut(scene) : null, atoms, inMemory: seq <= memState(chatId).segmentedThrough };
}
