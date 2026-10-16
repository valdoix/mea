import { Hono } from "hono";
import { z } from "zod";
import { askArchivist, deleteArchive, listArchive, pushArchive } from "../accuracy/archivist";
import { acceptIssue, checkReply, dismissIssue, fixNotes, flagsFor, leakGuardOn, replaceIssue } from "../accuracy/checker";
import { slipCatalog } from "../accuracy/slips";
import { memoryConfig } from "../lib/settings";
import { codex, codexEntry } from "../accuracy/codex";
import { quizRuns, runQuiz } from "../accuracy/quiz";
import { body } from "../lib/http";
import { stash } from "../services/undo";
import { getMessageRow, mustChat } from "../services/chats";
import { startStory } from "../services/generation";
import { anchorExtra, buildAnchor } from "../accuracy/anchor";
import { checkDrift, driftHistory, voiceSamples } from "../accuracy/drift";
import { guardsFor } from "../accuracy/guards";
import { actOnInbox, inboxCount, inboxCounts, inboxItems } from "../accuracy/inbox";
import { nameRegistry } from "../accuracy/names";
import { parseJson } from "../db/db";
import { getCard } from "../services/characters";
import { storyDials } from "../services/layers";
import { chatNames } from "../memory/build";
import type { ChatSettings } from "../services/chats";

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

/** docs/14, part 6: swap the original's name for the version's in the reply. */
accuracy.post("/continuity/:id/replace", async (c) => {
  const input = await body(c, z.object({ issueId: z.string() }));
  return c.json(replaceIssue(c.req.param("id"), input.issueId));
});

/** "Regenerate with fix": a new swipe that carries the corrections as notes for the model. */
accuracy.post("/continuity/:id/regenerate", async (c) => {
  const f = fixNotes(c.req.param("id"));
  await startStory(f.chatId, "swipe", { messageId: f.messageId, feedback: f.feedback });
  return c.json({ ok: true, feedback: f.feedback });
});

// ---------- guards (CON-03…05, CON-10, CON-12) ----------

/** What the guards are doing in this chat: settings (yours over the global ones), the re-anchor, the voice. */
accuracy.get("/chats/:id/guards", (c) => {
  const id = c.req.param("id");
  const chat = mustChat(id);
  const card = chat.character_id ? getCard(chat.character_id) : undefined;
  const names = chatNames(id);
  const active = card ? anchorExtra(id, card, names.user, chat.character_id) : null;
  const samples = voiceSamples(chat.character_id);
  return c.json({
    config: guardsFor(id),
    own: parseJson<ChatSettings>(chat.settings, {}).guards ?? {},
    anchor: {
      active: Boolean(active),
      strong: Boolean(active?.name.includes("stronger")),
      text: active?.content ?? (card ? buildAnchor({ card, userName: names.user, characterId: chat.character_id, persona: storyDials(chat).persona }) : ""),
    },
    drift: { history: driftHistory(id), samples: samples.lines.length, source: samples.source },
    // P1: every check in the slip registry, with this chat's switch.
    slips: slipCatalog(id, guardsFor(id), { continuity: memoryConfig().continuity, leaks: leakGuardOn(id) }),
  });
});

accuracy.post("/chats/:id/drift/check", async (c) => {
  mustChat(c.req.param("id"));
  const r = await checkDrift(c.req.param("id"));
  return c.json({ ...r, history: driftHistory(c.req.param("id")) });
});

/** CON-05: the names the story spells one way (also the composer's @-mentions, QOL-03). */
accuracy.get("/chats/:id/names", (c) => {
  mustChat(c.req.param("id"));
  return c.json({ names: nameRegistry(c.req.param("id")) });
});

// ---------- the review inbox (CON-09) ----------

accuracy.get("/inbox", (c) => c.json({ items: inboxItems({ chatId: c.req.query("chat") || undefined }) }));
accuracy.get("/inbox/count", (c) => {
  const chat = c.req.query("chat") || undefined;
  return c.json({ count: inboxCount(chat), bySource: inboxCounts(chat) });
});
accuracy.post("/inbox/act", async (c) => {
  const input = await body(c, z.object({ key: z.string().min(3).max(300), action: z.enum(["accept", "reject"]), edited: z.string().max(40_000).optional() }));
  return c.json(actOnInbox(input.key, input.action, input.edited));
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
  const undo = stash("Answer", [{ table: "archivist", where: "id = ?", params: [c.req.param("id")] }]);
  deleteArchive(c.req.param("id"));
  return c.json({ ok: true, undo });
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
