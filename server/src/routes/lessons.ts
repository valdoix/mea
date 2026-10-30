import { Hono } from "hono";
import { z } from "zod";
import { body, must } from "../lib/http";
import { type ChatSettings, getMessageRow, mustChat } from "../services/chats";
import { parseJson } from "../db/db";
import { banPhrase, craftOn, craftReport, setCraft } from "../steer/craft";
import { showKindAgain } from "../accuracy/checker";
import { healthDot, storyHealth } from "../accuracy/health";

const getChatSettings = (id: string) => parseJson<ChatSettings>(mustChat(id).settings, {});
import { addLesson, deleteLesson, learnFromSwipes, lessonsFor, lessonsMode, updateLesson } from "../steer/lessons";

/** A1: lessons from swipes. */
export const lessons = new Hono();

const scope = z.enum(["story", "character", "everywhere"]);

lessons.get("/chats/:id/lessons", (c) => {
  const id = c.req.param("id");
  mustChat(id);
  return c.json({ lessons: lessonsFor(id), mode: lessonsMode(id) });
});

lessons.post("/chats/:id/lessons", async (c) => {
  const b = await body(c, z.object({ text: z.string().trim().min(1).max(300), scope: scope.optional(), why: z.string().max(300).optional(), messageId: z.string().optional() }));
  return c.json({ lesson: addLesson(c.req.param("id"), b) });
});

lessons.patch("/lessons/:id", async (c) => {
  const b = await body(c, z.object({ text: z.string().trim().max(300).optional(), scope: scope.optional(), status: z.enum(["kept", "off", "rejected"]).optional(), chatId: z.string().optional() }));
  return c.json({ lesson: updateLesson(c.req.param("id"), b) });
});

lessons.delete("/lessons/:id", (c) => {
  deleteLesson(c.req.param("id"));
  return c.json({ ok: true });
});

/** "Learn from this swipe": the comparison on demand (the helper model too, unless lessons are off). */
lessons.post("/messages/:id/learn", async (c) => {
  const m = must(getMessageRow(c.req.param("id")), "Message not found");
  const found = await learnFromSwipes(m.chat_id, m.id, { model: lessonsMode(m.chat_id) !== "off" });
  return c.json({ lessons: found });
});

// ---------- D2: the craft coach ----------

lessons.get("/chats/:id/craft", (c) => {
  const id = c.req.param("id");
  mustChat(id);
  const r = craftReport(id);
  return c.json({ ...r, on: craftOn(id), paused: Boolean(getChatSettings(id).craft?.paused), ignored: getChatSettings(id).craft?.ignored ?? [] });
});

/** Pause coach, "It's fine" (ignore a habit here), or take that back. */
lessons.post("/chats/:id/craft", async (c) => {
  const b = await body(c, z.object({ paused: z.boolean().optional(), ignore: z.string().max(120).optional(), unignore: z.string().max(120).optional() }));
  setCraft(c.req.param("id"), b);
  return c.json({ ok: true });
});

/** "Ban it": a phrase that keeps coming back joins your banned phrases. */
lessons.post("/craft/ban", async (c) => {
  const b = await body(c, z.object({ phrase: z.string().trim().min(2).max(80) }));
  banPhrase(b.phrase);
  return c.json({ ok: true });
});

// ---------- D3: story health ----------

lessons.get("/chats/:id/story-health", (c) => c.json(storyHealth(c.req.param("id"))));

/** docs/22 4.2: a quiet kind of flag shows on replies again. */
lessons.post("/chats/:id/story-health/show-kind", async (c) => {
  const input = await body(c, z.object({ key: z.string().min(1).max(60) }));
  showKindAgain(c.req.param("id"), input.key);
  return c.json(storyHealth(c.req.param("id")));
});

/** The dots on Home's chat cards. */
lessons.get("/story-health/dots", (c) => {
  const ids = (c.req.query("ids") ?? "").split(",").filter(Boolean).slice(0, 100);
  return c.json({ dots: Object.fromEntries(ids.map((id) => [id, healthDot(id)])) });
});
