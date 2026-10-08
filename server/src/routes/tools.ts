import { Hono } from "hono";
import { z } from "zod";
import { all, now, one, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, body, must } from "../lib/http";
import { storyRow } from "../memory/store";
import { cleanText } from "../memory/text";
import { getMessageRow, getMessage, historyForPrompt, mustChat } from "../services/chats";
import { callJson } from "../services/llm";
import { trackerPrompt } from "../trackers/service";

/** Chat tools that act on the chat itself (CHAT-15…18). */
export const tools = new Hono<{ Variables: { deviceId: string | null } }>();

// ---------- rewind (CHAT-16) ----------

/** "Delete everything after this message": the rest goes to the trash and can be undone. */
tools.post("/messages/:id/rewind", (c) => {
  const m = must(getMessageRow(c.req.param("id")), "Message not found");
  const ids = all<{ id: string }>("SELECT id FROM messages WHERE chat_id = ? AND seq > ? AND deleted_at IS NULL ORDER BY seq", m.chat_id, m.seq).map((r) => r.id);
  if (!ids.length) return c.json({ deleted: [] });
  const t = now();
  tx(() => {
    for (const id of ids) run("UPDATE messages SET deleted_at = ? WHERE id = ?", t, id);
    run("UPDATE chats SET message_count = (SELECT COUNT(*) FROM messages WHERE chat_id = ? AND deleted_at IS NULL), updated_at = ? WHERE id = ?", m.chat_id, t, m.chat_id);
  });
  publish({ type: "chat.changed", chatId: m.chat_id });
  publish({ type: "trackers.changed", chatId: m.chat_id });
  publish({ type: "memory.changed", chatId: m.chat_id });
  return c.json({ deleted: ids });
});

/** Undo a rewind. */
tools.post("/chats/:id/restore-messages", async (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const input = await body(c, z.object({ ids: z.array(z.string()).min(1).max(5000) }));
  tx(() => {
    for (const id of input.ids) run("UPDATE messages SET deleted_at = NULL WHERE id = ? AND chat_id = ?", id, chatId);
    run("UPDATE chats SET message_count = (SELECT COUNT(*) FROM messages WHERE chat_id = ? AND deleted_at IS NULL), updated_at = ? WHERE id = ?", chatId, now(), chatId);
  });
  publish({ type: "chat.changed", chatId });
  publish({ type: "trackers.changed", chatId });
  return c.json({ restored: input.ids.length });
});

// ---------- drafts that follow you (CHAT-17) ----------

tools.get("/chats/:id/draft", (c) => {
  mustChat(c.req.param("id"));
  return c.json(one<{ text: string; device: string | null; updated_at: number }>("SELECT text, device, updated_at FROM drafts WHERE chat_id = ?", c.req.param("id")) ?? { text: "", device: null, updated_at: 0 });
});

tools.put("/chats/:id/draft", async (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const input = await body(c, z.object({ text: z.string().max(100_000), device: z.string().max(80).optional() }));
  const device = input.device ?? c.get("deviceId") ?? "local";
  if (!input.text) run("DELETE FROM drafts WHERE chat_id = ?", chatId);
  else run("INSERT INTO drafts (chat_id, text, device, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET text = excluded.text, device = excluded.device, updated_at = excluded.updated_at", chatId, input.text, device, now());
  publish({ type: "draft.changed", chatId, device });
  return c.json({ ok: true, updated_at: now() });
});

// ---------- search (CHAT-18) ----------

tools.get("/search", (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ results: [], total: 0 });
  const chatId = c.req.query("chatId") || null;
  const limit = Math.min(200, Number(c.req.query("limit")) || 60);
  const like = `%${q.replace(/[%_\\]/g, (x) => `\\${x}`)}%`;
  const rows = all<{ id: string; chat_id: string; seq: number; role: string; name: string | null; content: string; created_at: number; title: string; character_name: string | null }>(
    `SELECT m.id, m.chat_id, m.seq, m.role, m.name, s.content, m.created_at, c.title, ch.name AS character_name
     FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe JOIN chats c ON c.id = m.chat_id LEFT JOIN characters ch ON ch.id = c.character_id
     WHERE m.deleted_at IS NULL AND c.deleted_at IS NULL AND s.content LIKE ? ESCAPE '\\' ${chatId ? "AND m.chat_id = ?" : ""}
     ORDER BY ${chatId ? "m.seq ASC" : "m.created_at DESC"} LIMIT ?`,
    ...(chatId ? [like, chatId, limit] : [like, limit]),
  );
  const lower = q.toLowerCase();
  const results = rows.map((r) => {
    const text = r.content.replace(/\s+/g, " ");
    const at = text.toLowerCase().indexOf(lower);
    const start = Math.max(0, at - 70);
    return {
      messageId: r.id,
      chatId: r.chat_id,
      chatTitle: r.title,
      characterName: r.character_name,
      seq: r.seq,
      role: r.role,
      name: r.name,
      createdAt: r.created_at,
      snippet: `${start > 0 ? "…" : ""}${text.slice(start, start + 200)}${start + 200 < text.length ? "…" : ""}`,
      match: { start: at - start + (start > 0 ? 1 : 0), length: q.length },
    };
  });
  return c.json({ results, total: results.length });
});

// ---------- /ask and /recap (CHAT-15) ----------

function storyContext(chatId: string) {
  const story = storyRow(chatId);
  const recent = historyForPrompt(chatId).slice(-12).map((m) => `${m.role === "user" ? "User" : m.role === "assistant" ? "Story" : "Note"}: ${cleanText(m.content).slice(0, 1500)}`).join("\n\n");
  let state = "";
  try {
    state = trackerPrompt(chatId, { kind: "story" }).note?.text ?? "";
  } catch {
    // trackers are optional context
  }
  return [story?.content ? `STORY SO FAR:\n${story.content}` : "", state, `RECENT MESSAGES:\n${recent}`].filter(Boolean).join("\n\n");
}

/** Ask the narrator something out of character; the answer isn't added to the story. */
tools.post("/chats/:id/ask", async (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const input = await body(c, z.object({ question: z.string().trim().min(2).max(2000) }));
  const res = await callJson({
    task: "helper",
    kind: "ask",
    chatId,
    name: "ask_answer",
    schema: z.object({ answer: z.string() }),
    system: 'You answer the user\'s out-of-character question about their roleplay, using only what the story so far, the story state and the recent messages establish. If the story hasn\'t established it, say so plainly. Be brief and concrete. Reply with JSON only: {"answer": "…"}',
    user: `${storyContext(chatId)}\n\nQUESTION: ${input.question}`,
    maxTokens: 700,
  });
  return c.json({ answer: res.data.answer });
});

/** A recap of the story so far, to read before picking it back up. */
tools.post("/chats/:id/recap", async (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const res = await callJson({
    task: "summarizer",
    kind: "recap",
    chatId,
    name: "recap",
    schema: z.object({ recap: z.string() }),
    system: 'Write a warm, readable "previously on…" recap of this roleplay for the user picking it back up: the main events in order, where things stand now, and what\'s unresolved. Three short paragraphs at most. Use only what the material establishes. Reply with JSON only: {"recap": "…"}',
    user: storyContext(chatId),
    maxTokens: 900,
  });
  return c.json({ recap: res.data.recap });
});

/** The message a search result points at (for jump-to when it's older than what's loaded). */
tools.get("/messages/:id/locate", (c) => {
  const m = must(getMessage(c.req.param("id"), false), "Message not found");
  if (!m) throw badRequest("Message not found");
  return c.json({ chatId: m.chatId, seq: m.seq });
});
