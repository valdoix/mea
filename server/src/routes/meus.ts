import { Hono } from "hono";
import { z } from "zod";
import { body } from "../lib/http";
import { applyMeus, clearMeus, dismissMeus, meusTurn, meusView, undoMeus } from "../meus/meus";

/** Meus in a chat (docs/13-meus.md): the conversation, its change card, and undo. */
export const meus = new Hono();

meus.get("/chats/:id/meus", (c) => c.json(meusView(c.req.param("id"))));

meus.post("/chats/:id/meus", async (c) => {
  const input = await body(c, z.object({ message: z.string().trim().min(1).max(4000) }));
  return c.json(await meusTurn(c.req.param("id"), input.message));
});

meus.post("/chats/:id/meus/apply", async (c) => {
  const input = await body(c, z.object({ accept: z.array(z.string()).max(40) }));
  return c.json(applyMeus(c.req.param("id"), input.accept));
});

meus.post("/chats/:id/meus/dismiss", (c) => c.json(dismissMeus(c.req.param("id"))));

meus.post("/chats/:id/meus/undo/:setId", (c) => c.json(undoMeus(c.req.param("id"), c.req.param("setId"))));

meus.delete("/chats/:id/meus", (c) => c.json(clearMeus(c.req.param("id"))));
