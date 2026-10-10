import { Hono } from "hono";
import { characterSettings } from "../services/charsettings";
import { memState } from "../memory/store";
import { layered } from "../services/layers";
import { listVariants } from "../services/variants";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { badRequest, body, must } from "../lib/http";
import { applyRegex } from "../lib/regex";
import { getSetting } from "../lib/settings";
import { linkedBooks } from "../lore/service";
import { getCharacter } from "../services/characters";
import {
  addMessage,
  chatSettingsSchema,
  createChat,
  deleteSwipe,
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
  return c.json({ chats: listChats({ characterId: q.characterId, archived: q.archived === "1", deleted: q.deleted === "1", limit: Number(q.limit) || undefined, offset: Number(q.offset) || undefined, collectionId: q.collection || undefined }) });
});

chats.post("/chats", async (c) => {
  const input = await body(c, z.object({ characterId: z.string(), personaId: z.string().nullable().optional(), mode: z.enum(["companion", "narrator"]).optional(), variantId: z.string().nullable().optional() }));
  return c.json(createChat(input), 201);
});

/** Everything the chat screen needs in one request. */
chats.get("/chats/:id", (c) => {
  const chat = must(getChat(c.req.param("id")), "Chat not found");
  const character = chat.characterId ? getCharacter(chat.characterId) : undefined;
  const persona = getPersona(chat.personaId) ?? getDefaultPersona();
  // CHAR-06 / PER-05: the variants this chat can play, and a variant's own portrait.
  const variants = character ? listVariants("character", character.id) : [];
  const personaVariants = persona ? listVariants("persona", persona.id) : [];
  const variant = variants.find((v) => v.id === chat.settings.variantId);
  const personaVariant = personaVariants.find((v) => v.id === chat.settings.personaVariantId);
  const layers = layered(chat.settings, chat.characterId);
  return c.json({
    chat,
    character: character && { id: character.id, name: character.name, avatarId: variant?.avatarId ?? character.avatarId, palette: character.palette, mode: character.mode, tags: character.tags },
    persona: persona && { id: persona.id, name: persona.name, avatarId: personaVariant?.avatarId ?? persona.avatarId },
    lorebooks: linkedBooks("chat", chat.id),
    active: activeGenerations(chat.id),
    variants: variants.map((v) => ({ id: v.id, name: v.name, note: v.note })),
    personaVariants: personaVariants.map((v) => ({ id: v.id, name: v.name, note: v.note })),
    // PROMPT-06: what the character sets for its chats, so the panel can say "from the character".
    defaults: { from: layers.from, presetId: layers.presetId, profileId: layers.profileId, characterControls: characterSettings(chat.characterId).controls ?? {}, characterStyle: characterSettings(chat.characterId).style ?? null },
    // SUM-20: summarized isn't hidden; the chat marks where word-for-word ends.
    memory: { evictedThrough: memState(chat.id).evictedThrough },
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
  const afterQ = c.req.query("after");
  const after = afterQ !== undefined && afterQ !== "" && Number.isFinite(Number(afterQ)) ? Number(afterQ) : undefined;
  return c.json(listMessages(c.req.param("id"), { before, after, limit: Number(c.req.query("limit")) || undefined }));
});

/**
 * H8: messages already stored, by the client's own id for them (the offline outbox resends until it
 * hears back), so a resend never adds the message twice. Kept a day, and only so many.
 */
const sentByClient = new Map<string, { messageId: string; at: number }>();
const CLIENT_ID_TTL = 24 * 3600_000;
const CLIENT_ID_CAP = 5000;

function rememberClientId(key: string, messageId: string) {
  const t = Date.now();
  sentByClient.set(key, { messageId, at: t });
  for (const [k, v] of sentByClient) {
    if (sentByClient.size <= CLIENT_ID_CAP && t - v.at < CLIENT_ID_TTL) break;
    sentByClient.delete(k);
  }
}

/** Send a message (optional) and start the reply. Generation continues server-side (ARCH-02). */
chats.post("/chats/:id/send", async (c) => {
  const chatId = c.req.param("id");
  const input = await body(
    c,
    z.object({
      content: z.string().max(100_000).optional(),
      generate: z.boolean().default(true),
      profileId: z.string().nullable().optional(),
      director: z.boolean().optional(),
      clientId: z.string().min(1).max(100).optional(),
    }),
  );
  mustChat(chatId);
  // H8: a resend of a message that's already stored: say so, and don't start another reply.
  const key = input.clientId ? `${chatId}:${input.clientId}` : null;
  const seen = key ? sentByClient.get(key) : undefined;
  if (seen && Date.now() - seen.at < CLIENT_ID_TTL) return c.json({ userMessage: getMessage(seen.messageId) ?? null, duplicate: true });
  if (activeGenerations(chatId).length) return c.json({ error: "Wait for the current reply to finish", stored: false }, 400);
  let userMessageId: string | null = null;
  if (input.content?.trim()) {
    const chat = getChat(chatId)!;
    const persona = getPersona(chat.personaId) ?? getDefaultPersona();
    userMessageId = addMessage(chatId, "user", applyRegex(input.content.trim(), getSetting("regex.scripts"), { role: "user", mode: "persistent", characterId: mustChat(chatId).character_id }), { name: persona?.name ?? "You", meta: input.director ? { director: true } : undefined });
    if (key) rememberClientId(key, userMessageId);
  }
  if (!input.generate) return c.json({ userMessage: userMessageId && getMessage(userMessageId) });
  try {
    const gen = await startStory(chatId, "new", { profileId: input.profileId });
    return c.json({ userMessage: userMessageId && getMessage(userMessageId), ...gen });
  } catch (e) {
    // The user's message is kept even if the reply can't start (e.g. no model set up, quota used up).
    // H8: `stored` tells the outbox whether its message is safe, whatever the status code.
    const details = e instanceof HttpError ? (e.details as Record<string, unknown> | undefined) : undefined;
    return c.json(
      { userMessage: userMessageId && getMessage(userMessageId), error: (e as Error).message, code: details?.code, details, stored: Boolean(userMessageId) },
      e instanceof HttpError && e.status === 429 ? 429 : 400,
    );
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

// A deleted message reads as gone, so an open chat drops it instead of drawing it back in.
chats.get("/messages/:id", (c) => {
  const m = getMessageRow(c.req.param("id"));
  return c.json(must(m && !m.deleted_at ? getMessage(m.id) : undefined, "Message not found"));
});

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

chats.delete("/messages/:id/swipes/:idx", (c) => {
  const idx = Number(c.req.param("idx"));
  if (!Number.isInteger(idx) || idx < 0) throw badRequest("No such swipe");
  return c.json(deleteSwipe(c.req.param("id"), idx));
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
