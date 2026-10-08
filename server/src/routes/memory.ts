import { Hono } from "hono";
import { z } from "zod";
import { badRequest, body, must } from "../lib/http";
import { createAtom, deleteAtom, getAtom, listAtoms, mergeAtoms, restoreAtom, splitAtom, updateAtom } from "../memory/atoms";
import { acceptProposal, editSummary, rejectProposal, restoreSummaryVersion } from "../memory/build";
import { embeddingStatus, reembedAll } from "../memory/embed";
import { atomDetail, boundaries, memoryOverview, messageMemory, summaryDetail } from "../memory/inspect";
import { ATOM_TYPES } from "../memory/prompts";
import { endSceneAfter, newChapterAt, requestRebuild, scheduleMemory } from "../memory/scheduler";
import { getSummary, levelRows, memState, removeBoundary, resetChatMemory, setMemState, summaryOut, touchMemory } from "../memory/store";
import { getMessageRow, mustChat } from "../services/chats";
import { cancelChatJobs, enqueue } from "../services/jobs";

export const memory = new Hono();

// ---------- Overview & structure ----------

memory.get("/chats/:id/memory", (c) => {
  mustChat(c.req.param("id"));
  return c.json(memoryOverview(c.req.param("id")));
});

memory.patch("/chats/:id/memory", async (c) => {
  const id = c.req.param("id");
  mustChat(id);
  const input = await body(c, z.object({ paused: z.boolean().optional() }));
  if (input.paused !== undefined) setMemState(id, { paused: input.paused });
  if (input.paused === false) scheduleMemory(id, 0);
  touchMemory(id);
  return c.json(memoryOverview(id));
});

/** Catch up now: segment and build whatever is due. */
memory.post("/chats/:id/memory/run", (c) => {
  mustChat(c.req.param("id"));
  scheduleMemory(c.req.param("id"), 0);
  return c.json({ ok: true });
});

/** Rebuild everything from the ledger. Memories you edited or pinned are kept. */
memory.post("/chats/:id/memory/rebuild", async (c) => {
  const id = c.req.param("id");
  mustChat(id);
  const input = await body(c, z.object({ keepUserWork: z.boolean().default(true) }));
  cancelChatJobs(id, ["memory.segment", "memory.build", "memory.embed"]);
  resetChatMemory(id, input.keepUserWork);
  touchMemory(id);
  scheduleMemory(id, 0);
  return c.json({ ok: true });
});

memory.get("/chats/:id/boundaries", (c) => c.json({ boundaries: boundaries(c.req.param("id")) }));

memory.get("/chats/:id/summaries", (c) => {
  const level = c.req.query("level") as "scene" | "chapter" | "arc" | "story" | undefined;
  const id = c.req.param("id");
  mustChat(id);
  const levels = level ? [level] : (["story", "arc", "chapter", "scene"] as const);
  return c.json({ summaries: levels.flatMap((l) => levelRows(id, l).map(summaryOut)), state: memState(id) });
});

memory.get("/summaries/:id", (c) => c.json(must(summaryDetail(c.req.param("id")), "Summary not found")));

memory.put("/summaries/:id", async (c) => {
  const input = await body(c, z.object({ title: z.string().max(200).optional(), content: z.string().max(50_000).optional() }));
  const r = must(editSummary(c.req.param("id"), input), "Summary not found");
  return c.json(summaryOut(r));
});

memory.post("/summaries/:id/rebuild", async (c) => {
  const input = await body(c, z.object({ instruction: z.string().max(2000).optional(), propose: z.boolean().optional() }));
  const r = must(getSummary(c.req.param("id")), "Summary not found");
  if (r.level !== "story" && !r.closed) throw badRequest("This part of the story is still being written. It's summarized once it closes.");
  requestRebuild(r.chat_id, r.id, { instruction: input.instruction?.trim() || undefined, propose: input.propose });
  return c.json({ queued: true });
});

memory.post("/summaries/:id/accept", (c) => c.json({ ok: must(acceptProposal(c.req.param("id")) || undefined, "Nothing to accept") }));
memory.post("/summaries/:id/reject", (c) => c.json({ ok: must(rejectProposal(c.req.param("id")) || undefined, "Summary not found") }));

memory.post("/summaries/:id/versions/:vid/restore", (c) => {
  const r = must(restoreSummaryVersion(c.req.param("id"), c.req.param("vid")), "Version not found");
  return c.json(summaryOut(r));
});

/** Merge a scene or chapter with the next one (removes the boundary between them). */
memory.post("/summaries/:id/merge-next", (c) => {
  const r = must(getSummary(c.req.param("id")), "Summary not found");
  if (r.level === "story") throw badRequest("The Story So Far can't be merged");
  const next = levelRows(r.chat_id, r.level).find((x) => x.start_seq > r.start_seq);
  if (!next) throw badRequest("There's nothing after this one to merge with");
  removeBoundary(r.chat_id, r.level, next.start_seq);
  touchMemory(r.chat_id);
  scheduleMemory(r.chat_id, 2000);
  return c.json({ ok: true });
});

memory.post("/messages/:id/end-scene", (c) => {
  const m = must(getMessageRow(c.req.param("id")), "Message not found");
  try {
    endSceneAfter(m.chat_id, m.id);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  return c.json({ boundaries: boundaries(m.chat_id) });
});

memory.post("/messages/:id/new-chapter", (c) => {
  const m = must(getMessageRow(c.req.param("id")), "Message not found");
  try {
    newChapterAt(m.chat_id, m.id);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  return c.json({ boundaries: boundaries(m.chat_id) });
});

memory.get("/messages/:id/memory", (c) => {
  const m = must(getMessageRow(c.req.param("id")), "Message not found");
  return c.json(messageMemory(m.chat_id, m.id, m.seq));
});

// ---------- Memory atoms ----------

memory.get("/chats/:id/memories", (c) => {
  const q = c.req.query();
  mustChat(c.req.param("id"));
  return c.json(
    listAtoms(c.req.param("id"), {
      q: q.q,
      type: q.type || undefined,
      status: q.status || undefined,
      pinned: q.pinned === "1",
      stale: q.stale === "1",
      sceneId: q.sceneId || undefined,
      limit: Number(q.limit) || undefined,
      offset: Number(q.offset) || undefined,
    }),
  );
});

const atomInput = z.object({
  type: z.enum(ATOM_TYPES).default("fact"),
  content: z.string().trim().min(1).max(4000),
  importance: z.number().int().min(1).max(10).optional(),
  entities: z.array(z.string().max(80)).max(20).optional(),
  knownBy: z.array(z.string().max(80)).max(20).optional(),
  pinned: z.boolean().optional(),
  storyTime: z.string().max(120).nullable().optional(),
  messageIds: z.array(z.string()).max(50).optional(),
});

memory.post("/chats/:id/memories", async (c) => {
  mustChat(c.req.param("id"));
  const input = await body(c, atomInput);
  return c.json(createAtom(c.req.param("id"), input), 201);
});

memory.get("/memories/:id", (c) => c.json(must(atomDetail(c.req.param("id")), "Memory not found")));

memory.patch("/memories/:id", async (c) => {
  const input = await body(
    c,
    z.object({
      content: z.string().trim().min(1).max(4000).optional(),
      type: z.enum(ATOM_TYPES).optional(),
      importance: z.number().int().min(1).max(10).optional(),
      entities: z.array(z.string().max(80)).max(20).optional(),
      knownBy: z.array(z.string().max(80)).max(20).optional(),
      status: z.enum(["active", "superseded", "resolved", "disputed"]).optional(),
      pinned: z.boolean().optional(),
      storyTime: z.string().max(120).nullable().optional(),
    }),
  );
  return c.json(updateAtom(c.req.param("id"), input));
});

memory.delete("/memories/:id", (c) => {
  must(getAtom(c.req.param("id")), "Memory not found");
  deleteAtom(c.req.param("id"));
  return c.json({ ok: true });
});

memory.post("/memories/:id/restore", (c) => c.json(restoreAtom(c.req.param("id"))));

memory.post("/memories/merge", async (c) => {
  const input = await body(c, z.object({ ids: z.array(z.string()).min(2).max(20), content: z.string().max(4000).optional() }));
  return c.json(mergeAtoms(input.ids, input.content));
});

memory.post("/memories/:id/split", async (c) => {
  const input = await body(c, z.object({ parts: z.tuple([z.string().max(4000), z.string().max(4000)]) }));
  return c.json({ atoms: splitAtom(c.req.param("id"), input.parts) });
});

// ---------- Embeddings registry (ARCH-12) ----------

memory.get("/memory/embeddings", (c) => c.json(embeddingStatus()));

memory.post("/memory/embeddings/reembed", (c) => {
  reembedAll((chatId) => enqueue("memory.embed", { chatId }, { dedupeKey: `memory.embed:${chatId}`, chatId }));
  return c.json(embeddingStatus());
});
