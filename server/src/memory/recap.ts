import { z } from "zod";
import { all, now, one } from "../db/db";
import { getSetting, memoryConfig } from "../lib/settings";
import { countTokens } from "../lib/tokens";
import { historyForPrompt } from "../services/chats";
import { callJson } from "../services/llm";
import { cachedQuota } from "../services/connections";
import { trackerPrompt } from "../trackers/service";
import { standing } from "../trackers/stands";
import type { WorldState } from "../trackers/types";
import { chatNames } from "./build";
import { lensOf, summaryText } from "./openlist";
import { ledger, lastSeq, levelRows, memState, setMemState, storyRow } from "./store";
import { cleanText, hashText } from "./text";

/**
 * "Previously on…" (SUM-15): a short recap card when you come back to a chat after a while, and
 * on demand with /recap. It's written once per point in the story and kept, so reopening the
 * chat again costs nothing until the story moves on.
 */

export interface Recap {
  text: string;
  seq: number;
  at: number;
  /** L13: what it was written from, so an edit or a swipe of an older message writes it again. */
  hash?: string;
}

function storyContext(chatId: string) {
  const story = storyRow(chatId);
  const names = chatNames(chatId);
  const recent = historyForPrompt(chatId)
    .slice(-12)
    .map((m) => `${m.role === "user" ? names.user : m.role === "assistant" ? names.char : "Note"}: ${cleanText(m.content).slice(0, 1500)}`)
    .join("\n\n");
  let state = "";
  let st: WorldState | null = null;
  try {
    const tp = trackerPrompt(chatId, { kind: "story" });
    state = tp.note?.text ?? "";
    st = tp.state;
  } catch {
    // trackers are optional context
  }
  const lens = lensOf(chatId, st);
  const chapters = levelRows(chatId, "chapter")
    .filter((c) => c.state === "ready" && c.title)
    .slice(-4)
    .map((c) => `- ${c.title}: ${summaryText(c, lens).slice(0, 400)}`)
    .join("\n");
  const { stands, happened } = standing(chatId, st);
  return [story?.content ? `STORY SO FAR:\n${summaryText(story, lens)}` : "", chapters ? `LATEST CHAPTERS:\n${chapters}` : "", state, stands && `WHERE THINGS STAND:\n${stands}`, happened && `ALREADY HAPPENED:\n${happened}`, `RECENT MESSAGES:\n${recent}`].filter(Boolean).join("\n\n");
}

/** The cached recap if the story hasn't moved since, else a fresh one. */
export async function recapFor(chatId: string, opts: { force?: boolean } = {}): Promise<Recap & { cached: boolean }> {
  const seq = lastSeq(chatId);
  const cur = memState(chatId).recap;
  const user = storyContext(chatId);
  const hash = hashText(user);
  if (cur && cur.seq === seq && cur.hash === hash && !opts.force) return { ...cur, cached: true };
  const res = await callJson({
    task: "summarizer",
    kind: "recap",
    chatId,
    name: "recap",
    schema: z.object({ recap: z.string() }),
    system:
      'Write a warm, readable "previously on…" recap of this roleplay for the player picking it back up: the main events in order, where things stand now (who is where, what just happened), and what\'s unresolved. Three short paragraphs at most. Use only what the material establishes. Reply with JSON only: {"recap": "…"}',
    user,
    maxTokens: 900,
  });
  const recap: Recap = { text: res.data.recap.trim(), seq, at: now(), hash };
  setMemState(chatId, { recap });
  return { ...recap, cached: false };
}

/** The recap card for a chat you're reopening, if it's due (SUM-15). Null when it isn't. */
export async function autoRecap(chatId: string, awayMs: number) {
  const hours = getSetting("steer.config").recapAfterHours;
  if (!hours || awayMs < hours * 3600_000) return null;
  // A story only a few messages long doesn't need a recap.
  const n = one<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND role != 'system'", chatId)?.n ?? 0;
  if (n < 6) return null;
  return recapFor(chatId);
}

// ---------- Rebuild from scratch (SUM-19) ----------

/**
 * What rebuilding a chat's memory would take: scenes, input tokens through the summarizer
 * (scene records, checks, repairs, chapters, arcs, the Story So Far), and its share of the quota.
 */
export function rebuildEstimate(chatId: string) {
  const cfg = memoryConfig();
  const rows = ledger(chatId);
  const storyTokens = rows.reduce((n, r) => n + countTokens(r.content), 0);
  const scenes = Math.max(rows.length ? 1 : 0, Math.ceil(storyTokens / Math.max(1500, cfg.sceneTokenCap * 0.7)));
  const chapters = Math.ceil(scenes / Math.max(1, cfg.scenesPerChapter));
  const arcs = Math.ceil(chapters / Math.max(1, cfg.chaptersPerArc));
  const scenePrompt = 1800; // instructions, related memories, the previous scene
  const sceneRecord = cfg.compression.scene === "detailed" ? 1400 : cfg.compression.scene === "tight" ? 700 : 1000;
  const sceneIn = storyTokens + scenes * scenePrompt;
  const verifyIn = cfg.verify ? storyTokens + scenes * (sceneRecord + 600) : 0;
  const repairIn = cfg.verify && cfg.autoRepair ? Math.round(0.15 * sceneIn) : 0;
  const rollupIn = (chapters + arcs + 1) * 900 + scenes * 350 + chapters * 500 + arcs * 600;
  const input = sceneIn + verifyIn + repairIn + rollupIn;
  const output = scenes * sceneRecord + (cfg.verify ? scenes * 300 : 0) + (chapters + arcs + 1) * 700;
  const quota = cachedQuota();
  const limit = quota?.weekly?.limit ?? quota?.daily?.limit ?? null;
  return {
    messages: rows.length,
    storyTokens,
    scenes,
    chapters,
    arcs,
    inputTokens: Math.round(input),
    outputTokens: Math.round(output),
    calls: scenes * (cfg.verify ? 2 : 1) + chapters + arcs + 1,
    quotaShare: limit ? input / limit : null,
  };
}

/** How far a rebuild (or the normal catch-up) has got. */
export function rebuildProgress(chatId: string) {
  const state = memState(chatId);
  const last = lastSeq(chatId);
  const scenes = levelRows(chatId, "scene");
  const ready = scenes.filter((s) => s.state === "ready" || s.state === "review").length;
  const failed = scenes.filter((s) => s.state === "error").length;
  const queued = all<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE chat_id = ? AND status IN ('queued', 'running') AND kind LIKE 'memory.%'", chatId)[0]?.n ?? 0;
  return {
    startedAt: state.rebuild?.startedAt ?? null,
    estimate: state.rebuild?.estimate ?? null,
    segmentedThrough: state.segmentedThrough,
    lastSeq: last,
    scenes: { total: scenes.filter((s) => s.closed).length, ready, failed },
    working: queued > 0,
    paused: Boolean(state.paused),
    done: queued === 0 && scenes.filter((s) => s.closed).every((s) => s.state !== "pending" && s.state !== "building"),
  };
}
