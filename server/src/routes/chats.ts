import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { badRequest, body, must } from "../lib/http";
import { linkedBooks } from "../lore/service";
import { getCharacter } from "../services/characters";
import {
  addMessage,
  chatSettingsSchema,
  createChat,
  editMessage,
  getChat,
  getMessage,
  getMessageRow,
  lastMessage,
  listChats,
  listMessages,
  mustChat,
  restoreChat,
  restoreMessage,
  setActiveSwipe,
  setMessageFlags,
  softDeleteChat,
  softDeleteMessage,
  updateChat,
} from "../services/chats";
import { chatTitleFor, exportChatHtml, exportChatJsonl, exportChatMarkdown } from "../services/export";
import { activeGenerations, getGeneration, prefetch, previewPrompt, startStory, stopChatGenerations, stopGeneration, streamDraft } from "../services/generation";
import { HttpError } from "../lib/http";
import { getDefaultPersona, getPersona } from "../services/personas";

export const chats = new Hono();

chats.get("/chats", (c) => {
  const q = c.req.query();
  return c.json({ chats: listChats({ characterId: q.characterId, archived: q.archived === "1", deleted: q.deleted === "1", limit: Number(q.limit) || undefined, collectionId: q.collection || undefined }) });
});

chats.post("/chats", async (c) => {
  const input = await body(c, z.object({ characterId: z.string(), personaId: z.string().nullable().optional(), mode: z.enum(["companion", "narrator"]).optional() }));
  return c.json(createChat(input), 201);
});

/** Everything the chat screen needs in one request. */
chats.get("/chats/:id", (c) => {
  const chat = must(getChat(c.req.param("id")), "Chat not found");
  const character = chat.characterId ? getCharacter(chat.characterId) : undefined;
  const persona = getPersona(chat.personaId) ?? getDefaultPersona();
  return c.json({
    chat,
    character: character && { id: character.id, name: character.name, avatarId: character.avatarId, palette: character.palette, mode: character.mode, tags: character.tags },
    persona: persona && { id: persona.id, name: persona.name, avatarId: persona.avatarId },
    lorebooks: linkedBooks("chat", chat.id),
    active: activeGenerations(chat.id),
  });
});

chats.patch("/chats/:id", async (c) => {
  const input = await body(
    c,
    z.object({
      title: z.string().trim().min(1).max(200).optional(),
      personaId: z.string().nullable().optional(),
      mode: z.enum(["companion", "narrator"]).optional(),
      settings: chatSettingsSchema.optional(),
      archived: z.boolean().optional(),
    }),
  );
  return c.json(updateChat(c.req.param("id"), input));
});

chats.delete("/chats/:id", (c) => {
  stopChatGenerations(c.req.param("id"));
  softDeleteChat(c.req.param("id"));
  return c.json({ ok: true });
});

chats.post("/chats/:id/restore", (c) => {
  restoreChat(c.req.param("id"));
  return c.json(getChat(c.req.param("id")));
});

chats.get("/chats/:id/messages", (c) => {
  mustChat(c.req.param("id"));
  const before = Number(c.req.query("before")) || undefined;
  return c.json(listMessages(c.req.param("id"), { before, limit: Number(c.req.query("limit")) || undefined }));
});

/** Send a message (optional) and start the reply. Generation continues server-side (ARCH-02). */
chats.post("/chats/:id/send", async (c) => {
  const chatId = c.req.param("id");
  const input = await body(c, z.object({ content: z.string().max(100_000).optional(), generate: z.boolean().default(true), profileId: z.string().nullable().optional(), director: z.boolean().optional() }));
  mustChat(chatId);
  if (activeGenerations(chatId).length) throw badRequest("Wait for the current reply to finish");
  let userMessageId: string | null = null;
  if (input.content?.trim()) {
    const chat = getChat(chatId)!;
    const persona = getPersona(chat.personaId) ?? getDefaultPersona();
    userMessageId = addMessage(chatId, "user", input.content.trim(), { name: persona?.name ?? "You", meta: input.director ? { director: true } : undefined });
  }
  if (!input.generate) return c.json({ userMessage: userMessageId && getMessage(userMessageId) });
  try {
    const gen = await startStory(chatId, "new", { profileId: input.profileId });
    return c.json({ userMessage: userMessageId && getMessage(userMessageId), ...gen });
  } catch (e) {
    // The user's message is kept even if the reply can't start (e.g. no model set up, quota used up).
    const details = e instanceof HttpError ? (e.details as Record<string, unknown> | undefined) : undefined;
    return c.json({ userMessage: userMessageId && getMessage(userMessageId), error: (e as Error).message, code: details?.code, details }, e instanceof HttpError && e.status === 429 ? 429 : 400);
  }
});

chats.post("/messages/:id/swipe", async (c) => {
  const input = await body(c, z.object({ feedback: z.string().max(2000).optional(), profileId: z.string().nullable().optional() }));
  const m = must(getMessageRow(c.req.param("id")), "Message not found");
  return c.json(await startStory(m.chat_id, "swipe", { messageId: m.id, feedback: input.feedback, profileId: input.profileId }));
});

chats.post("/messages/:id/continue", async (c) => {
  const raw = (await c.req.json().catch(() => ({}))) as { profileId?: unknown };
  const input = { profileId: typeof raw?.profileId === "string" ? raw.profileId : null };
  const m = must(getMessageRow(c.req.param("id")), "Message not found");
  return c.json(await startStory(m.chat_id, "continue", { messageId: m.id, profileId: input.profileId }));
});

chats.get("/messages/:id", (c) => c.json(must(getMessage(c.req.param("id")), "Message not found")));

chats.put("/messages/:id", async (c) => {
  const { content } = await body(c, z.object({ content: z.string().max(200_000) }));
  return c.json(editMessage(c.req.param("id"), content));
});

chats.patch("/messages/:id", async (c) => {
  const input = await body(c, z.object({ hidden: z.boolean().optional(), bookmarked: z.boolean().optional(), activeSwipe: z.number().int().min(0).optional() }));
  if (input.activeSwipe !== undefined) setActiveSwipe(c.req.param("id"), input.activeSwipe);
  return c.json(setMessageFlags(c.req.param("id"), input));
});

chats.delete("/messages/:id", (c) => {
  const m = must(getMessageRow(c.req.param("id")), "Message not found");
  for (const g of activeGenerations(m.chat_id)) if (g.messageId === m.id) stopGeneration(g.generationId);
  softDeleteMessage(m.id);
  return c.json({ ok: true });
});

chats.post("/messages/:id/restore", (c) => c.json(restoreMessage(c.req.param("id"))));

chats.post("/generations/:id/stop", (c) => c.json({ stopped: stopGeneration(c.req.param("id")) }));

chats.get("/generations/:id", (c) => c.json(must(getGeneration(c.req.param("id")), "Generation not found")));

chats.get("/chats/:id/prompt-preview", async (c) => c.json(await previewPrompt(c.req.param("id"))));

/** Warms retrieval while you type (CTX-10). Cheap and safe to call often. */
chats.post("/chats/:id/prefetch", async (c) => {
  const input = await body(c, z.object({ draft: z.string().max(20_000) }));
  mustChat(c.req.param("id"));
  return c.json(await prefetch(c.req.param("id"), input.draft));
});

/** Impersonate / expand stream straight back to the composer (CHAT-05). */
chats.post("/chats/:id/draft", async (c) => {
  const chatId = c.req.param("id");
  const input = await body(c, z.object({ kind: z.enum(["impersonate", "expand"]), draft: z.string().max(20_000).optional() }));
  if (input.kind === "expand" && !input.draft?.trim()) throw badRequest("Write a draft to expand first");
  mustChat(chatId);
  const iterator = streamDraft(chatId, input.kind, input.draft, c.req.raw.signal);
  return streamSSE(c, async (stream) => {
    for await (const chunk of iterator) await stream.writeSSE({ data: JSON.stringify(chunk) });
  });
});

chats.get("/chats/:id/export", (c) => {
  const id = c.req.param("id");
  const format = c.req.query("format") ?? "jsonl";
  const name = chatTitleFor(id);
  const out =
    format === "md"
      ? { text: exportChatMarkdown(id), mime: "text/markdown; charset=utf-8", ext: "md" }
      : format === "html"
        ? { text: exportChatHtml(id), mime: "text/html; charset=utf-8", ext: "html" }
        : { text: exportChatJsonl(id), mime: "application/jsonl; charset=utf-8", ext: "jsonl" };
  return new Response(must(out.text, "Chat not found"), {
    headers: { "Content-Type": out.mime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.${out.ext}`)}` },
  });
});

chats.get("/chats/:id/last", (c) => {
  const m = lastMessage(c.req.param("id"));
  return c.json(m ? getMessage(m.id) : null);
});
