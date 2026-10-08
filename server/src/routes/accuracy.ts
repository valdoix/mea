import { Hono } from "hono";
import { z } from "zod";
import { askArchivist, deleteArchive, listArchive, pushArchive } from "../accuracy/archivist";
import { acceptIssue, checkReply, dismissIssue, fixNotes, flagsFor } from "../accuracy/checker";
import { codex, codexEntry } from "../accuracy/codex";
import { quizRuns, runQuiz } from "../accuracy/quiz";
import { body } from "../lib/http";
import { getMessageRow, mustChat } from "../services/chats";
import { startStory } from "../services/generation";

/** Accuracy (Phase 3): continuity and leak checks, the Archivist, the Codex, the memory quiz. */
export const accuracy = new Hono();

// ---------- continuity checker & leak guard (CON-02, CON-06) ----------

accuracy.get("/chats/:id/continuity", (c) => {
  const id = c.req.param("id");
  mustChat(id);
  const ids = c.req.query("messageIds");
  return c.json({ flags: flagsFor(id, { messageIds: ids ? ids.split(",") : undefined, open: c.req.query("open") === "1" }) });
});

accuracy.post("/messages/:id/check", async (c) => {
  const m = getMessageRow(c.req.param("id"));
  if (!m) return c.json({ error: "Message not found" }, 404);
  const issues = await checkReply(m.chat_id, m.id, m.active_swipe, { model: c.req.query("model") === "0" ? false : undefined });
  return c.json({ issues: issues ?? [], flags: flagsFor(m.chat_id, { messageIds: [m.id] }) });
});

accuracy.post("/continuity/:id/dismiss", async (c) => {
  const input = await body(c, z.object({ issueId: z.string().nullable().default(null) }));
  return c.json(dismissIssue(c.req.param("id"), input.issueId));
});

accuracy.post("/continuity/:id/accept", async (c) => {
  const input = await body(c, z.object({ issueId: z.string() }));
  return c.json(acceptIssue(c.req.param("id"), input.issueId));
});

/** "Regenerate with fix": a new swipe that carries the corrections as notes for the model. */
accuracy.post("/continuity/:id/regenerate", async (c) => {
  const f = fixNotes(c.req.param("id"));
  await startStory(f.chatId, "swipe", { messageId: f.messageId, feedback: f.feedback });
  return c.json({ ok: true, feedback: f.feedback });
});

// ---------- Ask the Archivist (CON-07) ----------

accuracy.get("/chats/:id/archivist", (c) => {
  mustChat(c.req.param("id"));
  return c.json({ answers: listArchive(c.req.param("id")) });
});

accuracy.post("/chats/:id/archivist", async (c) => {
  const input = await body(c, z.object({ question: z.string().trim().min(2).max(2000) }));
  return c.json(await askArchivist(c.req.param("id"), input.question), 201);
});

accuracy.delete("/archivist/:id", (c) => {
  deleteArchive(c.req.param("id"));
  return c.json({ ok: true });
});

accuracy.post("/archivist/:id/push", async (c) => {
  const input = await body(c, z.object({ as: z.enum(["ooc", "memory"]) }));
  return c.json(pushArchive(c.req.param("id"), input.as));
});

// ---------- Story Codex (CON-08) ----------

accuracy.get("/chats/:id/codex", (c) => c.json(codex(c.req.param("id"))));
accuracy.get("/codex/:entityId", (c) => c.json(codexEntry(c.req.param("entityId"))));

// ---------- memory quiz (MEM-46) ----------

accuracy.get("/chats/:id/quiz", (c) => {
  mustChat(c.req.param("id"));
  return c.json({ runs: quizRuns(c.req.param("id")) });
});

accuracy.post("/chats/:id/quiz", async (c) => {
  const input = await body(c, z.object({ n: z.number().int().min(1).max(20).default(8), answers: z.boolean().default(true) }));
  return c.json(await runQuiz(c.req.param("id"), input), 201);
});
