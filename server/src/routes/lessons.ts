import { Hono } from "hono";
import { z } from "zod";
import { body, must } from "../lib/http";
import { getMessageRow, mustChat } from "../services/chats";
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
