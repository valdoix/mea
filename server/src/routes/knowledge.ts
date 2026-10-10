import { Hono } from "hono";
import { z } from "zod";
import { body } from "../lib/http";
import { memoryConfig } from "../lib/settings";
import { consolidate, lastConsolidation } from "../memory/consolidate";
import { indexCoverage, embeddingsEnabled } from "../memory/embed";
import {
  createEntity,
  deleteEntity,
  duplicateSuggestions,
  ENTITY_KINDS,
  entityCard,
  entityFacts,
  entityGraph,
  entityOut,
  getEntityRow,
  listEntities,
  mergeEntities,
  restoreEntity,
  unmergeEntity,
  updateEntity,
} from "../memory/entities";
import { atomOut } from "../memory/atoms";
import { decideJournalProposal, editJournal, journalSubjects, listJournals, updateJournal } from "../memory/journals";
import { markPromise, promises, revealSecret, secrets } from "../memory/ledgers";
import { applyMemoryProfile, MEMORY_PROFILES } from "../memory/profiles";
import { reconcileIssues } from "../memory/reconcile";
import { correctMemory, findWrong, rememberSelection } from "../memory/remember";
import { warmMemory } from "../memory/warm";
import { mustChat } from "../services/chats";
import { enqueue } from "../services/jobs";

/** Phase 3 knowledge: entities, journals, ledgers, corrections, sleep, profiles, warm-up. */
export const knowledge = new Hono();

const kind = z.enum(ENTITY_KINDS as [string, ...string[]]);
const status = z.enum(["active", "dead", "missing", "gone", "unknown"]);

// ---------- entities (MEM-26, MEM-28) ----------

knowledge.get("/chats/:id/entities", (c) => {
  const id = c.req.param("id");
  mustChat(id);
  return c.json({ entities: listEntities(id, { kind: c.req.query("kind") || undefined, q: c.req.query("q") || undefined, merged: c.req.query("merged") === "1" }) });
});

knowledge.post("/chats/:id/entities", async (c) => {
  const id = c.req.param("id");
  mustChat(id);
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(80), kind: kind.optional(), aliases: z.array(z.string().max(80)).max(20).optional(), description: z.string().max(2000).optional() }));
  return c.json(createEntity(id, input as Parameters<typeof createEntity>[1]), 201);
});

knowledge.get("/entities/:id", (c) => {
  const r = getEntityRow(c.req.param("id"));
  if (!r) return c.json({ error: "Entity not found" }, 404);
  const facts = entityFacts(r.chat_id, r, 30);
  return c.json({ entity: entityOut(r), card: entityCard(r, facts.slice(0, 2)), facts: facts.map((f) => atomOut(f)) });
});

knowledge.patch("/entities/:id", async (c) => {
  const input = await body(
    c,
    z.object({
      name: z.string().trim().min(1).max(80).optional(),
      kind: kind.optional(),
      aliases: z.array(z.string().max(80)).max(30).optional(),
      description: z.string().max(2000).optional(),
      status: status.optional(),
      facts: z.array(z.string().max(500)).max(40).optional(),
    }),
  );
  return c.json(updateEntity(c.req.param("id"), input as Parameters<typeof updateEntity>[1]));
});

knowledge.delete("/entities/:id", (c) => c.json(deleteEntity(c.req.param("id"))));

knowledge.post("/entities/:id/restore", (c) => c.json(restoreEntity(c.req.param("id"))));

knowledge.post("/entities/:id/merge", async (c) => {
  const input = await body(c, z.object({ ids: z.array(z.string()).min(1).max(20) }));
  return c.json(mergeEntities(c.req.param("id"), input.ids));
});

knowledge.post("/entities/:id/unmerge", (c) => c.json(unmergeEntity(c.req.param("id"))));

knowledge.get("/chats/:id/entities/duplicates", (c) => {
  mustChat(c.req.param("id"));
  return c.json({ suggestions: duplicateSuggestions(c.req.param("id")) });
});

knowledge.get("/chats/:id/entity-graph", (c) => {
  mustChat(c.req.param("id"));
  const at = c.req.query("at");
  return c.json(entityGraph(c.req.param("id"), { atSeq: at ? Number(at) : undefined }));
});

// ---------- ledgers (MEM-30, MEM-31) ----------

knowledge.get("/chats/:id/ledgers", (c) => {
  const id = c.req.param("id");
  mustChat(id);
  return c.json({ promises: promises(id), secrets: secrets(id) });
});

knowledge.post("/chats/:id/promises/mark", async (c) => {
  const input = await body(c, z.object({ key: z.string().min(1), status: z.enum(["pending", "kept", "broken"]) }));
  return c.json({ promise: markPromise(c.req.param("id"), input.key, input.status) });
});

knowledge.post("/chats/:id/secrets/reveal", async (c) => {
  const input = await body(c, z.object({ key: z.string().min(1), to: z.string().trim().min(1).max(80), how: z.string().max(300).optional() }));
  return c.json({ secret: revealSecret(c.req.param("id"), input.key, input.to, input.how) });
});

// ---------- journals (MEM-29) ----------

knowledge.get("/chats/:id/journals", (c) => {
  const id = c.req.param("id");
  mustChat(id);
  return c.json({ journals: listJournals(id), subjects: journalSubjects(id), enabled: memoryConfig().journals });
});

knowledge.post("/chats/:id/journals/rebuild", async (c) => {
  const id = c.req.param("id");
  mustChat(id);
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(80), fromScratch: z.boolean().default(true) }));
  return c.json(await updateJournal(id, input.name, { fromScratch: input.fromScratch }));
});

knowledge.put("/journals/:id", async (c) => {
  const input = await body(c, z.object({ content: z.string().min(1).max(20_000) }));
  return c.json(editJournal(c.req.param("id"), input.content));
});

knowledge.post("/journals/:id/proposal", async (c) => {
  const input = await body(c, z.object({ accept: z.boolean() }));
  return c.json(decideJournalProposal(c.req.param("id"), input.accept));
});

// ---------- remember this / that's wrong (MEM-41) ----------

knowledge.post("/chats/:id/remember", async (c) => {
  const input = await body(c, z.object({ messageId: z.string().min(1), text: z.string().min(1).max(4000), pin: z.boolean().optional(), note: z.string().max(2000).optional() }));
  return c.json(rememberSelection(c.req.param("id"), input), 201);
});

knowledge.post("/chats/:id/correct/preview", async (c) => {
  const input = await body(c, z.object({ wrong: z.string().min(1).max(4000), messageId: z.string().optional() }));
  return c.json({ matches: findWrong(c.req.param("id"), input.wrong, input.messageId).map((x) => ({ ...atomOut(x.a), match: Math.round(x.score * 100) / 100 })) });
});

knowledge.post("/chats/:id/correct", async (c) => {
  const input = await body(c, z.object({ wrong: z.string().max(4000).default(""), right: z.string().min(1).max(4000), messageId: z.string().optional(), memoryIds: z.array(z.string()).max(20).optional() }));
  return c.json(correctMemory(c.req.param("id"), input));
});

// ---------- sleep (MEM-42), profiles (MEM-44), warm (MEM-21), reconcile (SUM-22) ----------

knowledge.post("/chats/:id/consolidate", async (c) => {
  const id = c.req.param("id");
  mustChat(id);
  if (c.req.query("background") === "1") {
    enqueue("memory.consolidate", { chatId: id }, { dedupeKey: `memory.consolidate:${id}`, chatId: id });
    return c.json({ queued: true });
  }
  return c.json({ report: await consolidate(id) });
});

knowledge.get("/chats/:id/consolidate", (c) => c.json({ report: lastConsolidation(c.req.param("id")) }));

knowledge.get("/memory/profiles", (c) => c.json({ profiles: MEMORY_PROFILES, current: memoryConfig().profile }));
knowledge.post("/memory/profiles/:name", (c) => {
  const name = c.req.param("name");
  if (!(name in MEMORY_PROFILES)) return c.json({ error: "Unknown profile" }, 400);
  return c.json({ config: applyMemoryProfile(name as keyof typeof MEMORY_PROFILES) });
});

/** Called when a chat opens (MEM-21): everything recall needs is warmed in the background. */
knowledge.post("/chats/:id/warm", (c) => {
  const id = c.req.param("id");
  mustChat(id);
  void warmMemory(id).catch(() => {});
  return c.json({ ok: true, index: embeddingsEnabled() ? indexCoverage(id) : null });
});

knowledge.get("/chats/:id/reconcile", (c) => {
  mustChat(c.req.param("id"));
  return c.json({ scenes: reconcileIssues(c.req.param("id")) });
});
