import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { paths } from "../config";
import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { getCard } from "../services/characters";
import { getChatRow } from "../services/chats";
import { enqueue, type JobContext } from "../services/jobs";
import { invalidate } from "../trackers/store";
import { isDuplicate } from "./atoms";
import { embeddingsEnabled } from "./embed";
import { LEVELS, markStale, memState, recomputeEnds, setMemState, touchMemory } from "./store";

/**
 * Memory export and import (DATA-05): a chat's summaries, memories (with their sources),
 * entities, journals, tracker ledger, cast notes, notebook pages and highlights as one JSON file.
 * Messages are referred to by their number (#seq), so the file can go back into the same story
 * or a copy of it. Imports run as a background job in small chunks with progress, so even a big
 * file never freezes anything (PERF-11).
 */

export const MEMORY_FORMAT = "mea-memory";

export function exportMemory(chatId: string) {
  const chat = getChatRow(chatId);
  if (!chat) throw notFound("Chat not found");
  const seqOf = new Map(all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ?", chatId).map((r) => [r.id, r.seq]));
  const sources = new Map<string, number[]>();
  for (const s of all<{ memory_id: string; seq: number }>("SELECT ms.memory_id, ms.seq FROM memory_sources ms JOIN memories m ON m.id = ms.memory_id WHERE m.chat_id = ?", chatId)) {
    sources.set(s.memory_id, [...(sources.get(s.memory_id) ?? []), s.seq]);
  }
  const summaries = all<Record<string, unknown> & { id: string }>(
    "SELECT id, level, start_seq, end_seq, closed, boundary, manual, title, content, data, state, user_edited, importance, tokens, source_tokens, source_hash, story_time FROM summaries WHERE chat_id = ? ORDER BY level, start_seq",
    chatId,
  );
  return {
    format: MEMORY_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    chat: { title: chat.title, character: chat.character_id ? (getCard(chat.character_id)?.name ?? null) : null, messages: seqOf.size },
    summaries: summaries.map(({ id, ...r }) => ({ ...r, ref: id, data: parseJson(r.data as string, {}) })),
    memories: all<Record<string, unknown> & { id: string; scene_id: string | null }>(
      "SELECT id, scene_id, type, content, entities, importance, emotions, story_time, known_by, status, confidence, pinned, user_edited, min_seq, max_seq, ledger, recall_count, ref_count, origin, swipe_idx FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status != 'superseded'",
      chatId,
    ).map(({ id, scene_id, ...r }) => ({ ...r, scene: scene_id, entities: parseJson(r.entities as string, []), emotions: parseJson(r.emotions as string, []), known_by: parseJson(r.known_by as string, []), ledger: parseJson(r.ledger as string | null, null), sources: sources.get(id) ?? [] })),
    // M30: deleted ones go too, so they stay deleted wherever the file goes.
    entities: all<Record<string, unknown>>("SELECT kind, name, aliases, description, status, facts, data, first_seq, last_seq, mentions, user_edited, deleted_at FROM entities WHERE chat_id = ? AND merged_into IS NULL", chatId).map((r) => ({
      ...r,
      aliases: parseJson(r.aliases as string, []),
      facts: parseJson(r.facts as string, []),
      data: parseJson(r.data as string, {}),
    })),
    journals: all<Record<string, unknown>>("SELECT name, content, through_seq, user_edited FROM journals WHERE chat_id = ?", chatId),
    trackers: all<{ message_id: string | null; swipe_idx: number; source: string; ord: number; op: string }>("SELECT message_id, swipe_idx, source, ord, op FROM tracker_events WHERE chat_id = ? ORDER BY ord", chatId)
      .filter((e) => e.message_id == null || seqOf.has(e.message_id))
      .map((e) => ({ seq: e.message_id ? seqOf.get(e.message_id)! : null, swipe: e.swipe_idx, source: e.source, ord: e.ord, op: parseJson(e.op, {}) })),
    cast: all<Record<string, unknown>>("SELECT name, data FROM cast_profiles WHERE chat_id = ?", chatId).map((r) => ({ name: r.name, data: parseJson(r.data as string, {}) })),
    factions: all<Record<string, unknown>>("SELECT name, data FROM cast_factions WHERE chat_id = ?", chatId).map((r) => ({ name: r.name, data: parseJson(r.data as string, {}) })),
    notes: all<Record<string, unknown>>("SELECT title, body, pinned FROM notes WHERE chat_id = ? AND deleted_at IS NULL", chatId),
    highlights: all<{ message_id: string; text: string; note: string }>("SELECT message_id, text, note FROM highlights WHERE chat_id = ?", chatId)
      .filter((h) => seqOf.has(h.message_id))
      .map((h) => ({ seq: seqOf.get(h.message_id)!, text: h.text, note: h.note })),
  };
}
export type MemoryExport = ReturnType<typeof exportMemory>;

const fileSchema = z.object({
  format: z.literal(MEMORY_FORMAT),
  version: z.number().int().min(1).max(1),
  summaries: z.array(z.record(z.string(), z.unknown())).default([]),
  memories: z.array(z.record(z.string(), z.unknown())).default([]),
  entities: z.array(z.record(z.string(), z.unknown())).default([]),
  journals: z.array(z.record(z.string(), z.unknown())).default([]),
  trackers: z.array(z.record(z.string(), z.unknown())).default([]),
  cast: z.array(z.record(z.string(), z.unknown())).default([]),
  factions: z.array(z.record(z.string(), z.unknown())).default([]),
  notes: z.array(z.record(z.string(), z.unknown())).default([]),
  highlights: z.array(z.record(z.string(), z.unknown())).default([]),
});

/** Checks a file and queues its import. Returns what it holds. */
export function queueMemoryImport(chatId: string, text: string, mode: "merge" | "replace") {
  if (!getChatRow(chatId)) throw notFound("Chat not found");
  let parsed: z.infer<typeof fileSchema>;
  try {
    parsed = fileSchema.parse(JSON.parse(text));
  } catch {
    throw badRequest("That isn't a Mea memory file");
  }
  const dir = join(paths.backups, "..", "tmp");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `memory-import-${newId()}.json`);
  writeFileSync(file, text);
  const jobId = enqueue("memory.import", { chatId, file, mode }, { chatId, priority: 4, maxAttempts: 1 });
  const counts = Object.fromEntries((["summaries", "memories", "entities", "journals", "trackers", "cast", "notes", "highlights"] as const).map((k) => [k, parsed[k].length]));
  return { jobId, counts };
}

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d: number | null = null) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const json = (v: unknown, d: unknown) => JSON.stringify(v ?? d);
const ORIGINS = new Set(["ai", "user", "tracker", "consolidation"]);

/**
 * The import job: small transactions with a breath between them, and progress as it goes. M30: a
 * replace is one transaction (a failure leaves memory as it was), and a re-run (after a restart)
 * doesn't add notes or highlights twice.
 */
export async function runMemoryImport(p: { chatId: string; file: string; mode: "merge" | "replace" }, job?: JobContext) {
  const data = fileSchema.parse(JSON.parse(readFileSync(p.file, "utf8")));
  const chatId = p.chatId;
  const msgBySeq = new Map(all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId).map((r) => [r.seq, r.id]));
  const total = data.summaries.length + data.memories.length + data.entities.length + data.journals.length + data.trackers.length + data.cast.length + data.factions.length + data.notes.length + data.highlights.length;
  let done = 0;
  const progress = (label: string) => {
    publish({ type: "import.progress", chatId, done, total, label });
    job?.note({ done, total });
  };
  const steps: (() => Promise<void> | void)[] = [];
  const chunks = <T>(rows: T[], label: string, fn: (r: T) => void) =>
    steps.push(
      p.mode === "replace"
        ? () => {
            rows.forEach(fn);
            done += rows.length;
          }
        : async () => {
            for (let i = 0; i < rows.length; i += 200) {
              tx(() => rows.slice(i, i + 200).forEach(fn));
              done += Math.min(200, rows.length - i);
              progress(label);
              await Bun.sleep(0);
            }
          },
    );

  if (p.mode === "replace")
    steps.push(() => {
      for (const t of ["summaries", "memories", "journals", "cast_profiles", "cast_factions", "highlights"]) run(`DELETE FROM ${t} WHERE chat_id = ?`, chatId);
      // Entities you deleted stay deleted (M30).
      run("DELETE FROM entities WHERE chat_id = ? AND deleted_at IS NULL", chatId);
      run("DELETE FROM tracker_events WHERE chat_id = ? AND source != 'user'", chatId);
      run("DELETE FROM embeddings WHERE chat_id = ?", chatId);
    });

  const t = now();
  const ends = new Map<string, number | null>();
  // Summaries keep their links to atoms through the file's own ids.
  const sceneIds = new Map<string, string>();
  steps.push(() => {
    for (const r of all<{ id: string; end_seq: number | null }>("SELECT id, end_seq FROM summaries WHERE chat_id = ?", chatId)) ends.set(r.id, r.end_seq);
  });
  const haveSummary = (level: string, start: number) => Boolean(one("SELECT 1 FROM summaries WHERE chat_id = ? AND level = ? AND start_seq = ?", chatId, level, start));
  chunks(data.summaries, "summaries", (r) => {
    const level = str(r.level);
    const start = num(r.start_seq, 0)!;
    if (!["scene", "chapter", "arc", "story"].includes(level) || haveSummary(level, start)) return;
    const id = newId();
    if (typeof r.ref === "string") sceneIds.set(r.ref, id);
    run(
      `INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, boundary, manual, title, content, data, state, user_edited, importance, tokens, source_tokens, source_hash, story_time, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, chatId, level, start, num(r.end_seq), num(r.closed, 0), (r.boundary as string | null) ?? null, num(r.manual, 0), str(r.title), str(r.content), json(r.data, {}),
      str(r.state, "ready") === "building" ? "pending" : str(r.state, "ready"), num(r.user_edited, 0), num(r.importance), num(r.tokens, 0), num(r.source_tokens, 0), (r.source_hash as string | null) ?? null, (r.story_time as string | null) ?? null, t, t,
    );
  });
  chunks(data.memories, "memories", (r) => {
    const content = str(r.content).trim();
    if (!content || (p.mode === "merge" && isDuplicate(chatId, content))) return;
    const id = newId();
    const scene = typeof r.scene === "string" ? (sceneIds.get(r.scene) ?? null) : null;
    const srcs = (Array.isArray(r.sources) ? r.sources : []) as number[];
    // M31: who made it; files from before the column say it the old way (a tracker memory: confidence 0.85, no scene, one message).
    const origin = ORIGINS.has(r.origin as string)
      ? (r.origin as string)
      : r.scene == null && num(r.confidence, 1) === 0.85 && srcs.length === 1
        ? "tracker"
        : r.scene == null && num(r.user_edited, 0)
          ? "user"
          : "ai";
    const swipe = origin !== "tracker" ? null : (num(r.swipe_idx) ?? one<{ s: number }>("SELECT active_swipe AS s FROM messages WHERE id = ?", msgBySeq.get(srcs[0]!) ?? "")?.s ?? null);
    run(
      `INSERT INTO memories (id, chat_id, scene_id, type, content, entities, importance, emotions, story_time, known_by, status, confidence, pinned, user_edited, min_seq, max_seq, ledger, recall_count, ref_count, created_at, updated_at, origin, swipe_idx)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, chatId, scene, str(r.type, "fact"), content, json(r.entities, []), num(r.importance, 5), json(r.emotions, []), (r.story_time as string | null) ?? null,
      json(r.known_by, []), str(r.status, "active"), num(r.confidence, 1), num(r.pinned, 0), num(r.user_edited, 0), num(r.min_seq), num(r.max_seq), r.ledger == null ? null : json(r.ledger, null), num(r.recall_count, 0), num(r.ref_count, 0), t, t, origin, swipe,
    );
    for (const seq of srcs) {
      const mid = msgBySeq.get(seq);
      if (mid) run("INSERT OR IGNORE INTO memory_sources (memory_id, message_id, seq) VALUES (?, ?, ?)", id, mid, seq);
    }
  });
  // M30: merging moves scene and chapter ends; rows whose range changed are built again.
  steps.push(() => {
    for (const level of LEVELS) recomputeEnds(chatId, level);
    for (const r of all<{ id: string; end_seq: number | null }>("SELECT id, end_seq FROM summaries WHERE chat_id = ?", chatId)) if (ends.has(r.id) && ends.get(r.id) !== r.end_seq) markStale(r.id);
  });
  let haveEntity = new Set<string>();
  steps.push(() => {
    haveEntity = new Set(all<{ name: string }>("SELECT name FROM entities WHERE chat_id = ?", chatId).map((e) => e.name.toLowerCase()));
  });
  chunks(data.entities, "people and places", (r) => {
    const name = str(r.name).trim();
    if (!name || haveEntity.has(name.toLowerCase())) return;
    haveEntity.add(name.toLowerCase());
    run(
      `INSERT INTO entities (id, chat_id, kind, name, aliases, description, status, facts, data, first_seq, last_seq, mentions, user_edited, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(), chatId, str(r.kind, "person"), name, json(r.aliases, []), str(r.description), str(r.status, "active"), json(r.facts, []), json(r.data, {}), num(r.first_seq), num(r.last_seq), num(r.mentions, 0), num(r.user_edited, 0), t, t, num(r.deleted_at),
    );
  });
  chunks(data.journals, "journals", (r) => {
    const name = str(r.name).trim();
    if (!name) return;
    run(
      "INSERT INTO journals (id, chat_id, name, content, through_seq, user_edited, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chat_id, name) DO NOTHING",
      newId(), chatId, name, str(r.content), num(r.through_seq, 0), num(r.user_edited, 0), t, t,
    );
  });
  // The tracker ledger only goes into a chat that doesn't have one (merging two ledgers would double every change).
  // M30: your own edits kept here aren't added again from the file ("+50 gold" once).
  const hasLedger = p.mode !== "replace" && Boolean(one("SELECT 1 FROM tracker_events WHERE chat_id = ? AND source != 'user' LIMIT 1", chatId));
  const hasYours = Boolean(one("SELECT 1 FROM tracker_events WHERE chat_id = ? AND source = 'user' LIMIT 1", chatId));
  chunks(hasLedger ? [] : data.trackers, "story state", (r) => {
    if (hasYours && str(r.source, "model") === "user") return;
    const seq = num(r.seq);
    const mid = seq == null ? null : msgBySeq.get(seq);
    if (seq != null && !mid) return;
    run("INSERT INTO tracker_events (id, chat_id, message_id, swipe_idx, source, ord, op, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", newId(), chatId, mid ?? null, num(r.swipe, -1), str(r.source, "model"), num(r.ord, 0), json(r.op, {}), t);
  });
  done += hasLedger ? data.trackers.length : 0;
  chunks(data.cast, "cast", (r) => {
    const name = str(r.name).trim();
    if (name) run("INSERT INTO cast_profiles (chat_id, name_key, name, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chat_id, name_key) DO NOTHING", chatId, name.toLowerCase().replace(/\s+/g, " "), name, json(r.data, {}), t);
  });
  chunks(data.factions, "factions", (r) => {
    const name = str(r.name).trim();
    // On a merge, a faction already here by that name is kept as it is.
    if (name && !one("SELECT 1 FROM cast_factions WHERE chat_id = ? AND name = ? COLLATE NOCASE", chatId, name)) run("INSERT INTO cast_factions (id, chat_id, name, data, updated_at) VALUES (?, ?, ?, ?, ?)", newId(), chatId, name, json(r.data, {}), t);
  });
  chunks(data.notes, "notes", (r) => {
    if (one("SELECT 1 FROM notes WHERE chat_id = ? AND title = ? AND body = ? AND deleted_at IS NULL", chatId, str(r.title), str(r.body))) return;
    if (str(r.body).trim() || str(r.title).trim()) run("INSERT INTO notes (id, chat_id, title, body, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", newId(), chatId, str(r.title), str(r.body), num(r.pinned, 0), t, t);
  });
  chunks(data.highlights, "highlights", (r) => {
    const mid = msgBySeq.get(num(r.seq, -1)!);
    if (mid && one("SELECT 1 FROM highlights WHERE message_id = ? AND text = ?", mid, str(r.text))) return;
    if (mid && str(r.text).trim()) run("INSERT INTO highlights (id, chat_id, message_id, text, note, created_at) VALUES (?, ?, ?, ?, ?, ?)", newId(), chatId, mid, str(r.text), str(r.note), t);
  });

  if (p.mode === "replace") {
    // One transaction: the steps run synchronously inside it.
    tx(() => {
      for (const s of steps) s();
    });
    progress("story");
  } else for (const s of steps) await s();

  // Memory picks up after what was imported instead of segmenting it again.
  const reach = one<{ s: number | null }>("SELECT MAX(COALESCE(end_seq, start_seq)) AS s FROM summaries WHERE chat_id = ? AND level = 'scene'", chatId)?.s ?? 0;
  if (reach > memState(chatId).segmentedThrough) setMemState(chatId, { segmentedThrough: reach });
  invalidate(chatId);
  touchMemory(chatId);
  publish({ type: "trackers.changed", chatId });
  if (embeddingsEnabled()) enqueue("memory.embed", { chatId }, { dedupeKey: `memory.embed:${chatId}`, delayMs: 2000, chatId });
  try {
    unlinkSync(p.file);
  } catch {
    // already gone
  }
  done = total;
  progress("done");
}
