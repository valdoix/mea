import { all, newId, now, one, run, tx } from "../db/db";
import { memoryConfig } from "../lib/settings";
import { countTokens } from "../lib/tokens";
import { getMessageRow, type LedgerChange } from "../services/chats";
import { activeGenerations } from "../services/generation";
import { Deferred, enqueue, type JobContext } from "../services/jobs";
import { shouldShed } from "../services/quota";
import { dropAtoms, markAtomsStaleForMessage } from "./atoms";
import { buildSummary, chatNames, confirmBoundary, storyNeedsRebuild } from "./build";
import { embeddingsEnabled } from "./embed";
import { syncTrackerMemories } from "../trackers/service";
import { currentFold } from "../trackers/store";
import { autoTitle } from "../services/stories";
import { reconcileScene } from "./reconcile";
import { detectBoundary, type BoundarySignal } from "./segment";
import {
  childrenOf,
  ensureRoots,
  LEVELS,
  getSummary,
  formatLedger,
  ledger,
  ledgerBefore,
  type LedgerRow,
  levelRows,
  markStale,
  memState,
  recomputeEnds,
  rowAt,
  setMemState,
  settledThrough,
  startAt,
  storyRow,
  touchMemory,
} from "./store";

/** Background work waits a moment after replies and never runs while one is being written (SUM-07). */
const IDLE_DELAY = 20_000;

export function scheduleMemory(chatId: string, delayMs = IDLE_DELAY) {
  if (!memoryConfig().enabled) return;
  enqueue("memory.segment", { chatId }, { dedupeKey: `memory.segment:${chatId}`, delayMs, priority: 1, chatId });
}

function scheduleBuild(chatId: string, summaryId: string, priority: number) {
  enqueue("memory.build", { chatId, summaryId }, { dedupeKey: `memory.build:${summaryId}`, priority, chatId, maxAttempts: 4 });
}

/**
 * Segmentation pass (MEM-03): walks settled messages since the last pass and opens a new
 * scene at each break. Then closes chapters and arcs by size and queues summaries in order.
 */
export async function segmentChat(chatId: string, job?: JobContext) {
  const cfg = memoryConfig();
  if (!cfg.enabled) return;
  if (activeGenerations(chatId).length) throw new Deferred("A reply is being written", 15_000);
  const state = memState(chatId);
  if (state.paused) return;

  const settled = settledThrough(chatId, cfg.lag);
  const fresh = ledger(chatId, state.segmentedThrough + 1, settled);
  // M29: a rebuild from scratch while this pass waits on a model call makes the rest of it moot;
  // the pass starts over (the rebuild's own request was folded into this running job).
  const epoch = state.epoch ?? 0;
  const reset = () => (memState(chatId).epoch ?? 0) !== epoch;
  if (fresh.length) {
    const first = one<{ seq: number }>("SELECT MIN(seq) AS seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.seq ?? fresh[0]!.seq;
    ensureRoots(chatId, first);
    const names = chatNames(chatId);
    let sceneId = "";
    let sceneRows: LedgerRow[] = [];
    let sceneTokens = 0;
    let prev: LedgerRow | null = ledgerBefore(chatId, fresh[0]!.seq);
    // The scene tracker (Phase 2) knows when the story moved: a new scene it recorded is a
    // break; a change of place is a likely one that the boundary check confirms.
    let tracked: Record<string, { kind: string; text: string; newScene?: boolean }[]> = {};
    try {
      tracked = currentFold(chatId).result.changes;
    } catch {
      tracked = {};
    }
    const fromTracker = (id: string): BoundarySignal | null => {
      const list = tracked[id] ?? [];
      const scene = list.find((c) => c.kind === "scene" && c.newScene);
      if (scene) return { kind: "tracker", strength: "strong", detail: scene.text };
      const place = list.find((c) => c.kind === "place" && c.newScene);
      return place ? { kind: "tracker", strength: "weak", detail: `moved: ${place.text}` } : null;
    };

    for (const m of fresh) {
      const tokens = countTokens(m.content);
      const scene = rowAt(chatId, "scene", m.seq)!;
      if (scene.id !== sceneId) {
        // Entering a scene (possibly one you started by hand): count what it already holds.
        sceneId = scene.id;
        sceneRows = ledger(chatId, scene.start_seq, m.seq - 1);
        sceneTokens = sceneRows.reduce((n, r) => n + countTokens(r.content), 0);
      }
      if (m.seq > scene.start_seq && prev) {
        const text = detectBoundary({ seq: prev.seq, content: prev.content, createdAt: prev.created_at }, { seq: m.seq, content: m.content, createdAt: m.created_at }, { pauseHours: cfg.pauseHours });
        const trk = fromTracker(m.id);
        // Strongest first; the text's own signal wins a tie.
        const signal = [text, trk].filter((x): x is BoundarySignal => !!x).sort((a, b) => Number(b.strength === "strong") - Number(a.strength === "strong"))[0] ?? null;
        let cut: string | null = null;
        let chapter = false;
        if (signal?.strength === "strong") {
          cut = `${signal.kind}: ${signal.detail}`;
          chapter = signal.kind === "chapter";
        } else if (signal) {
          if (cfg.boundaryCheck && !shouldShed("gates")) {
            try {
              const verdict = await confirmBoundary(chatId, formatLedger(sceneRows.slice(-3), names), formatLedger([m], names));
              if (verdict.newScene) cut = `${signal.kind}: ${signal.detail} (confirmed)`;
            } catch (e) {
              if ((e as Error).name === "Deferred") throw e;
              cut = `${signal.kind}: ${signal.detail}`;
            }
            if (reset()) throw new Deferred("Memory was rebuilt from scratch meanwhile", 1000);
          } else cut = `${signal.kind}: ${signal.detail}`;
        }
        if (!cut && sceneTokens + tokens > cfg.sceneTokenCap && sceneRows.length >= 2) cut = `length: over ${cfg.sceneTokenCap} tokens`;
        if (cut) {
          sceneId = startAt(chatId, chapter ? "chapter" : "scene", m.seq, { boundary: cut });
          if (chapter) sceneId = rowAt(chatId, "scene", m.seq)!.id;
          sceneRows = [];
          sceneTokens = 0;
        }
      }
      sceneRows.push(m);
      sceneTokens += tokens;
      prev = m;
      setMemState(chatId, { segmentedThrough: m.seq });
    }
  } else if (settled > state.segmentedThrough) {
    setMemState(chatId, { segmentedThrough: settled });
  }

  closeBySize(chatId);
  queueBuilds(chatId);
  if (embeddingsEnabled()) enqueue("memory.embed", { chatId }, { dedupeKey: `memory.embed:${chatId}`, delayMs: 5000, chatId });
  job?.note({ segmentedThrough: memState(chatId).segmentedThrough });
  touchMemory(chatId);
}

/** A chapter closes after N scenes, an arc after N chapters (SUM-01). Loops so a long backlog splits evenly. */
function closeBySize(chatId: string) {
  const cfg = memoryConfig();
  for (let guard = 0; guard < 1000; guard++) {
    const chapter = levelRows(chatId, "chapter").at(-1);
    const scenes = chapter ? childrenOf(chapter, "scene") : [];
    if (!chapter || scenes.length <= cfg.scenesPerChapter) break;
    startAt(chatId, "chapter", scenes[cfg.scenesPerChapter]!.start_seq, { boundary: `size: ${cfg.scenesPerChapter} scenes` });
  }
  for (let guard = 0; guard < 1000; guard++) {
    const arc = levelRows(chatId, "arc").at(-1);
    const chapters = arc ? childrenOf(arc, "chapter") : [];
    if (!arc || chapters.length <= cfg.chaptersPerArc) break;
    startAt(chatId, "arc", chapters[cfg.chaptersPerArc]!.start_seq, { boundary: `size: ${cfg.chaptersPerArc} chapters` });
  }
}

/**
 * Queues what can be built now, finest level first: scenes, then chapters whose scenes are
 * ready, then arcs, then the Story So Far. In "ask" mode stale rows wait for you (MEM-10).
 */
export function queueBuilds(chatId: string) {
  const cfg = memoryConfig();
  const wants = (state: string) => state === "pending" || (state === "stale" && cfg.onEdit === "auto");
  const done = (state: string) => state === "ready" || state === "error" || state === "review";
  const scenes = levelRows(chatId, "scene");
  for (const s of scenes) if (s.closed && wants(s.state)) scheduleBuild(chatId, s.id, 3);
  for (const c of levelRows(chatId, "chapter")) {
    if (!c.closed || !wants(c.state)) continue;
    const kids = childrenOf(c, "scene");
    if (kids.length && kids.every((k) => done(k.state))) scheduleBuild(chatId, c.id, 2);
  }
  for (const a of levelRows(chatId, "arc")) {
    if (!a.closed || !wants(a.state)) continue;
    const kids = childrenOf(a, "chapter");
    if (kids.length && kids.every((k) => done(k.state))) scheduleBuild(chatId, a.id, 1);
  }
  if (storyNeedsRebuild(chatId) && (cfg.onEdit === "auto" || storyRow(chatId)?.state !== "stale")) {
    let story = storyRow(chatId);
    if (!story) {
      const first = levelRows(chatId, "scene")[0];
      if (first) {
        const t = now();
        run("INSERT INTO summaries (id, chat_id, level, start_seq, closed, state, created_at, updated_at) VALUES (?, ?, 'story', ?, 1, 'pending', ?, ?)", newId(), chatId, first.start_seq, t, t);
        story = storyRow(chatId);
      }
    }
    const arcsReady = levelRows(chatId, "arc").filter((a) => a.closed).every((a) => done(a.state));
    if (story && arcsReady) scheduleBuild(chatId, story.id, 0);
  }
}

export async function runBuildJob(payload: { chatId: string; summaryId: string; instruction?: string; propose?: boolean }, job: JobContext) {
  if (activeGenerations(payload.chatId).length) throw new Deferred("A reply is being written", 15_000);
  await buildSummary(payload.summaryId, { job, instruction: payload.instruction, propose: payload.propose });
  const built = getSummary(payload.summaryId);
  if (built?.level === "scene" && built.state === "ready") afterScene(payload.chatId, built.id);
  // LIB-04: a new chapter or Story So Far may name the chat.
  if ((built?.level === "chapter" || built?.level === "story") && built.state === "ready") autoTitle(payload.chatId);
  // Cascade: a finished scene may complete a chapter, a chapter an arc, and so on.
  queueBuilds(payload.chatId);
  if (embeddingsEnabled()) enqueue("memory.embed", { chatId: payload.chatId }, { dedupeKey: `memory.embed:${payload.chatId}`, delayMs: 3000, chatId: payload.chatId });
}

/**
 * After a scene record (Phase 3): reconcile it with the trackers now (SUM-22), then let the
 * journals (MEM-29), the Chronicle (LORE-12) and, once the chat goes quiet, the sleep job (MEM-42) catch up.
 */
function afterScene(chatId: string, summaryId: string) {
  const cfg = memoryConfig();
  try {
    reconcileScene(summaryId);
  } catch (e) {
    console.error("[mea] reconcile failed:", e);
  }
  if (cfg.journals) enqueue("memory.journal", { chatId }, { dedupeKey: `memory.journal:${chatId}`, delayMs: 20_000, priority: 0, chatId });
  if (cfg.chronicle) enqueue("lore.chronicle", { chatId }, { dedupeKey: `lore.chronicle:${chatId}`, delayMs: 30_000, priority: 0, chatId });
  if (cfg.consolidate) enqueue("memory.consolidate", { chatId }, { dedupeKey: `memory.consolidate:${chatId}`, delayMs: 20 * 60_000, priority: 0, chatId });
}

/** Rebuild requested from the inspector, optionally with an instruction (SUM-08) or as a proposal. */
export function requestRebuild(chatId: string, summaryId: string, opts: { instruction?: string; propose?: boolean } = {}) {
  enqueue("memory.build", { chatId, summaryId, ...opts }, { dedupeKey: `memory.build:${summaryId}`, priority: 5, chatId, maxAttempts: 3 });
}

/**
 * A message changed after memory was made from it (MEM-10): its scene, chapter, arc, and the
 * Story So Far become stale, and so do atoms citing it. Auto mode rebuilds them in the background.
 * A rewind (C3) cuts memory back to where the story now ends.
 */
export function onLedgerChange(chatId: string, messageId: string, change?: LedgerChange) {
  if (change?.rewoundTo != null) return onRewind(chatId, change.rewoundTo);
  // An undone rewind: messages memory hasn't reached are segmented again; the rest rebuild where they fall.
  const ids = change?.restored ?? [messageId];
  const state = memState(chatId);
  let touched = false;
  for (const id of ids) {
    const m = getMessageRow(id);
    if (!m || m.seq > state.segmentedThrough) continue;
    markAtomsStaleForMessage(id);
    for (const level of LEVELS) {
      const row = rowAt(chatId, level, m.seq);
      if (row?.closed) markStale(row.id);
    }
    const story = storyRow(chatId);
    if (story && (story.end_seq ?? 0) >= m.seq) markStale(story.id);
    touched = true;
  }
  if (touched) touchMemory(chatId);
  if (touched || change?.restored) scheduleMemory(chatId, 5000);
}

/**
 * C3: a swipe or continue finished on a message memory was already built from (after a rewind, the
 * newest message can be one): its scene and the rows above it are rebuilt as after an edit.
 * Generation calls this when a swipe or continue ends; it does nothing for messages memory hasn't reached
 * (besides H5: the trackers' memories follow the swipe now shown).
 */
export function ledgerChangedAfterReply(chatId: string, messageId: string) {
  // H5: a new swipe is shown now; memories the trackers made from the one before go.
  syncTrackerMemories(chatId, messageId);
  const m = getMessageRow(messageId);
  if (!m || m.seq > memState(chatId).segmentedThrough) return;
  onLedgerChange(chatId, messageId);
}

/**
 * C3: the story now ends at `seq` (a rewind). Rows that begin after it described the abandoned
 * timeline and go, with their AI memories; the rows that held `seq` reopen and wait to be built
 * once they close again; the markers, the journals and the Story So Far move back with it.
 */
export function onRewind(chatId: string, seq: number) {
  const state = memState(chatId);
  tx(() => {
    const gone = all<{ id: string }>("SELECT id FROM summaries WHERE chat_id = ? AND level != 'story' AND start_seq > ?", chatId, seq).map((r) => r.id);
    for (const id of gone) dropRowAtoms(id);
    if (gone.length) {
      run(`DELETE FROM embeddings WHERE owner_type = 'summary' AND owner_id IN (${gone.map(() => "?").join(",")})`, ...gone);
      run(`DELETE FROM summaries WHERE id IN (${gone.map(() => "?").join(",")})`, ...gone);
    }
    for (const level of LEVELS) {
      recomputeEnds(chatId, level);
      // The row that held `seq` is open again: it isn't canon until it's rebuilt.
      const row = rowAt(chatId, level, seq);
      if (row && row.state !== "pending") run("UPDATE summaries SET state = 'pending', updated_at = ? WHERE id = ?", now(), row.id);
    }
    const story = storyRow(chatId);
    if (story && (story.end_seq ?? 0) > seq) run("UPDATE summaries SET state = 'pending', end_seq = NULL, updated_at = ? WHERE id = ?", now(), story.id);
    // Memories that reach past the rewind point are stale; recall leaves out stale ones whose sources are gone.
    run("UPDATE memories SET stale = 1, updated_at = ? WHERE chat_id = ? AND user_edited = 0 AND COALESCE(max_seq, 0) > ?", now(), chatId, seq);
    // M24: journals that took in the abandoned scenes are written again from what's left (yours wait as proposals).
    run("UPDATE journals SET content = CASE WHEN user_edited = 1 THEN content ELSE '' END, proposal = NULL, through_seq = 0, updated_at = ? WHERE chat_id = ? AND through_seq > ?", now(), chatId, seq);
    // A segmentation pass waiting on a model call starts over too (M29).
    setMemState(chatId, { segmentedThrough: Math.min(state.segmentedThrough, seq), evictedThrough: Math.min(state.evictedThrough, seq), recap: undefined, epoch: (state.epoch ?? 0) + 1 });
  });
  touchMemory(chatId);
  scheduleMemory(chatId, 5000);
  if (memoryConfig().journals) enqueue("memory.journal", { chatId }, { dedupeKey: `memory.journal:${chatId}`, delayMs: 20_000, priority: 0, chatId });
}

/** A summary row's AI memories go with it; the ones you edited or pinned stay, unfiled and stale. */
function dropRowAtoms(summaryId: string) {
  dropAtoms("scene_id = ? AND user_edited = 0 AND pinned = 0", summaryId);
  run("UPDATE memories SET scene_id = NULL, stale = 1 WHERE scene_id = ?", summaryId);
}

/** Manual structure controls (MEM-04). */
export function endSceneAfter(chatId: string, messageId: string) {
  const m = getMessageRow(messageId);
  if (!m) return;
  const next = one<{ seq: number }>("SELECT seq FROM messages WHERE chat_id = ? AND seq > ? AND deleted_at IS NULL ORDER BY seq LIMIT 1", chatId, m.seq);
  if (!next) throw new Error("There's no message after this one yet. End the scene once the story moves on.");
  prepareRoots(chatId);
  startAt(chatId, "scene", next.seq, { boundary: "manual", manual: true });
  catchUp(chatId, next.seq);
}

export function newChapterAt(chatId: string, messageId: string) {
  const m = getMessageRow(messageId);
  if (!m) return;
  prepareRoots(chatId);
  const first = levelRows(chatId, "scene")[0];
  if (first && first.start_seq >= m.seq) throw new Error("The story already begins here.");
  startAt(chatId, "chapter", m.seq, { boundary: "manual", manual: true });
  catchUp(chatId, m.seq);
}

function prepareRoots(chatId: string) {
  const first = one<{ seq: number }>("SELECT MIN(seq) AS seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.seq;
  if (first != null) ensureRoots(chatId, first);
}

/** After a manual break, segmentation picks up from where it was and respects the new scene. */
function catchUp(chatId: string, _seq: number) {
  touchMemory(chatId);
  scheduleMemory(chatId, 2000);
}

export function backfillChat(chatId: string) {
  scheduleMemory(chatId, 0);
}

export { touchMemory };
