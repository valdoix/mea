import { z } from "zod";
import { all, now, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { memoryConfig } from "../lib/settings";
import { activeGenerations } from "../services/generation";
import { Deferred, type JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { type AtomRow, insertAtom, mergeAtoms, supersede } from "./atoms";
import { chatVectors, cosine, embeddingsEnabled } from "./embed";
import { type EntityData, entityFacts, getEntityRow, mergeEntities, duplicateSuggestions, resolver } from "./entities";
import { queueBuilds } from "./scheduler";
import { memState, touchMemory } from "./store";
import { contentWords, ftsQuery, overlap } from "./text";

/**
 * Consolidation, or "sleep" (MEM-42): an idle job that tidies a chat's memory.
 *   1. merges near-duplicate memories (same meaning, same type),
 *   2. compresses old trivia nobody used into one digest per scene,
 *   3. refreshes entity descriptions from what the story now knows,
 *   4. merges entities that are plainly the same (a title on a name),
 *   5. lets chapters, arcs and the Story So Far catch up.
 * Your edits and pins are never touched (MEM-27).
 */

export interface ConsolidationReport {
  merged: number;
  compressed: number;
  digests: number;
  entities: number;
  aliases: number;
  at: number;
}

const lastRun = new Map<string, ConsolidationReport>();
export const lastConsolidation = (chatId: string) => lastRun.get(chatId) ?? null;

const editable = (a: AtomRow) => !a.user_edited && !a.pinned && !a.deleted_at && a.status === "active";

/** Pairs of memories that say the same thing. Vectors when there are some, shared words otherwise. */
export function findDuplicates(chatId: string, limit = 400) {
  const atoms = all<AtomRow>("SELECT * FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status = 'active' ORDER BY COALESCE(max_seq, 0) DESC LIMIT ?", chatId, limit);
  const byId = new Map(atoms.map((a) => [a.id, a]));
  const vec = new Map<string, Float32Array>();
  if (embeddingsEnabled()) for (const v of chatVectors(chatId)) if (v.ownerType === "memory") vec.set(v.ownerId, v.vector);
  const pairs: [AtomRow, AtomRow, number][] = [];
  const taken = new Set<string>();
  for (const a of atoms) {
    if (taken.has(a.id)) continue;
    const q = ftsQuery(a.content, 10);
    if (!q) continue;
    const near = all<{ id: string }>("SELECT id FROM memories_fts WHERE memories_fts MATCH ? AND chat_id = ? ORDER BY bm25(memories_fts) LIMIT 8", q, chatId);
    const wa = contentWords(a.content);
    for (const { id } of near) {
      const b = byId.get(id);
      if (!b || b.id === a.id || taken.has(b.id) || b.type !== a.type) continue;
      const va = vec.get(a.id);
      const vb = vec.get(b.id);
      const sim = va && vb ? cosine(va, vb) : overlap(wa, contentWords(b.content));
      if ((va && vb && sim >= 0.93) || (!(va && vb) && sim >= 0.72)) {
        pairs.push([a, b, sim]);
        taken.add(a.id);
        taken.add(b.id);
        break;
      }
    }
  }
  return pairs;
}

const digestSchema = z.object({ digest: z.string().min(1) });
const profileSchema = z.object({ description: z.string().min(1) });

export async function consolidate(chatId: string, job?: JobContext) {
  const cfg = memoryConfig();
  if (!cfg.enabled) return null;
  if (activeGenerations(chatId).length) throw new Deferred("A reply is being written", 60_000);
  const report: ConsolidationReport = { merged: 0, compressed: 0, digests: 0, entities: 0, aliases: 0, at: now() };

  // 1. Near-duplicates: keep the more important (or older) one; its sources gain the other's.
  for (const [a, b] of findDuplicates(chatId)) {
    if (!editable(a) && !editable(b)) continue;
    const [keep, drop] = !editable(a) || a.importance > b.importance || (a.importance === b.importance && (a.min_seq ?? 0) <= (b.min_seq ?? 0)) ? [a, b] : [b, a];
    if (!editable(drop)) continue;
    mergeAtoms([keep.id, drop.id], keep.content);
    // A merge by the sleep job isn't your edit.
    run("UPDATE memories SET user_edited = ? WHERE id = ?", keep.user_edited, keep.id);
    report.merged++;
  }

  // 2. Old trivia nobody used, folded into one digest per scene.
  const evicted = memState(chatId).evictedThrough;
  const trivia = all<AtomRow>(
    "SELECT * FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status = 'active' AND importance <= 3 AND ref_count = 0 AND pinned = 0 AND user_edited = 0 AND scene_id IS NOT NULL AND COALESCE(max_seq, 0) < ?",
    chatId,
    evicted - 200,
  );
  const byScene = new Map<string, AtomRow[]>();
  for (const a of trivia) byScene.set(a.scene_id!, [...(byScene.get(a.scene_id!) ?? []), a]);
  for (const [sceneId, list] of byScene) {
    if (list.length < 3) continue;
    let digest = list.map((a) => a.content.replace(/[.!?]+$/, "")).join("; ");
    if (!shouldShed("verification") && digest.length > 240) {
      try {
        const r = await callJson({
          task: "summarizer",
          kind: "digest",
          chatId,
          jobId: job?.id,
          name: "memory_digest",
          schema: digestSchema,
          system: 'Combine these small memories from one scene of a story into a single sentence of at most 40 words. Keep names and numbers exactly. Reply with JSON only: {"digest": "…"}',
          user: list.map((a) => `- ${a.content}`).join("\n"),
          maxTokens: 160,
        });
        digest = r.data.digest.trim();
      } catch {
        // the joined list is a fine digest too
      }
    }
    const sources = all<{ message_id: string; seq: number }>(`SELECT DISTINCT message_id, seq FROM memory_sources WHERE memory_id IN (${list.map(() => "?").join(",")})`, ...list.map((a) => a.id));
    tx(() => {
      const id = insertAtom(
        chatId,
        sceneId,
        { type: "event", content: digest, entities: [...new Set(list.flatMap((a) => parseJson<string[]>(a.entities, [])))], importance: 3, confidence: 0.85 },
        sources.map((s) => ({ id: s.message_id, seq: s.seq })),
      );
      for (const a of list) supersede(a.id, id);
    });
    report.compressed += list.length;
    report.digests++;
  }

  // 3. Entity descriptions, refreshed from their facts (never over yours).
  const res = resolver(chatId);
  if (!shouldShed("verification")) {
    const stale = res.rows
      .filter((e) => ["person", "place", "group", "object"].includes(e.kind))
      .filter((e) => {
        const d = parseJson<EntityData & { refreshedAt?: number; refreshedMentions?: number }>(e.data, {});
        return !(d.locked ?? []).includes("description") && !d.isUser && e.mentions >= 3 && e.mentions !== d.refreshedMentions;
      })
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 6);
    for (const e of stale) {
      const facts = entityFacts(chatId, e, 10);
      if (facts.length < 2) continue;
      try {
        const r = await callJson({
          task: "helper",
          kind: "entity",
          chatId,
          jobId: job?.id,
          name: "entity_profile",
          schema: profileSchema,
          system: `Write a short, factual description (1–2 sentences, at most 45 words) of ${e.name} (${e.kind}) as the story so far establishes them: who or what they are, their state now, what matters about them. Only what the notes say. Reply with JSON only: {"description": "…"}`,
          user: `${e.description ? `CURRENT DESCRIPTION: ${e.description}\n` : ""}NOTES:\n${facts.map((f) => `- ${f.content}`).join("\n")}`,
          maxTokens: 160,
        });
        const d = parseJson<Record<string, unknown>>(e.data, {});
        run(
          "UPDATE entities SET description = ?, data = ?, updated_at = ? WHERE id = ?",
          r.data.description.trim(),
          JSON.stringify({ ...d, descSource: "consolidation", refreshedAt: now(), refreshedMentions: e.mentions }),
          now(),
          e.id,
        );
        report.entities++;
      } catch {
        // try again next sleep
      }
    }
  }

  // 4. The same entity under a title ("Captain Mira" and "Mira"): merged when neither is yours.
  for (const s of duplicateSuggestions(chatId)) {
    if (s.reason !== "same name" || s.keep.userEdited || s.merge.userEdited) continue;
    if (!getEntityRow(s.keep.id)?.merged_into && !getEntityRow(s.merge.id)?.merged_into) {
      mergeEntities(s.keep.id, [s.merge.id]);
      run("UPDATE entities SET user_edited = 0 WHERE id = ?", s.keep.id);
      report.aliases++;
    }
  }

  // 5. Chapters, arcs and the Story So Far catch up with everything above.
  queueBuilds(chatId);
  touchMemory(chatId);
  lastRun.set(chatId, report);
  job?.note({ ...report });
  publish({ type: "memory.changed", chatId });
  return report;
}
