import { Hono } from "hono";
import { z } from "zod";
import { body } from "../lib/http";
import { mustChat } from "../services/chats";
import { arcAction, authorArc, decideFate, decideProposal, forceOutcome, previewOutcome, retellStep, decideNews, queueSheets, rewordSubplot, runTick, setActor, undoEngine, worldView } from "../sim/service";
import { clearSheets } from "../sim/sheet";
import { FORCES } from "../sim/types";

/** The world off the page: subplots, arrivals, news, the director, your controls. */
export const world = new Hono();

world.get("/chats/:id/world", (c) => {
  mustChat(c.req.param("id"));
  return c.json(worldView(c.req.param("id")));
});

/** "Move the world a step now." */
world.post("/chats/:id/world/tick", (c) => {
  const res = runTick(c.req.param("id"), null, true);
  return c.json({ summary: res.summary, tension: res.tension, target: res.target });
});

world.post("/chats/:id/world/arcs/:arcId", async (c) => {
  const input = await body(
    c,
    z.object({
      action: z.enum(["hold", "resume", "nudge", "bringIn", "drop", "edit"]),
      premise: z.string().max(600).optional(),
      want: z.string().max(200).optional(),
      fear: z.string().max(200).optional(),
    }),
  );
  arcAction(c.req.param("id"), decodeURIComponent(c.req.param("arcId")), input.action, input);
  return c.json(worldView(c.req.param("id")));
});

/** Call a subplot's next beat: win, at a cost, loss, a twist or a reversal (null clears a waiting call). */
world.post("/chats/:id/world/arcs/:arcId/force", async (c) => {
  const input = await body(c, z.object({ outcome: z.enum(FORCES).nullable(), salt: z.number().int().min(0).max(1_000_000).optional(), text: z.string().max(1200).optional() }));
  const res = forceOutcome(c.req.param("id"), decodeURIComponent(c.req.param("arcId")), input.outcome, { salt: input.salt, text: input.text });
  return c.json({ ...worldView(c.req.param("id")), landed: res.landed });
});

/** G3: how a called beat would land (nothing commits); `salt` is the reroll. */
world.post("/chats/:id/world/arcs/:arcId/preview", async (c) => {
  const input = await body(c, z.object({ outcome: z.enum(FORCES), salt: z.number().int().min(0).max(1_000_000).default(0) }));
  return c.json(await previewOutcome(c.req.param("id"), decodeURIComponent(c.req.param("arcId")), input.outcome, input.salt));
});

/** Tell a step already taken (its index), or the ending (null), again in the model's words. */
world.post("/chats/:id/world/arcs/:arcId/retell", async (c) => {
  const input = await body(c, z.object({ step: z.number().int().min(0).nullable() }));
  await retellStep(c.req.param("id"), decodeURIComponent(c.req.param("arcId")), input.step);
  return c.json(worldView(c.req.param("id")));
});

/** Word a waiting proposal, or a subplot the engine started, again in the model's words. */
world.post("/chats/:id/world/reword/:subId", async (c) => {
  await rewordSubplot(c.req.param("id"), decodeURIComponent(c.req.param("subId")));
  return c.json(worldView(c.req.param("id")));
});

/** "Give someone a story": a person, or a group (a faction). */
world.post("/chats/:id/world/arcs", async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(80), premise: z.string().trim().min(5).max(600), group: z.boolean().optional() }));
  authorArc(c.req.param("id"), input.name, input.premise, input.group);
  return c.json(worldView(c.req.param("id")), 201);
});

world.post("/chats/:id/world/proposals/:pid", async (c) => {
  const input = await body(c, z.object({ accept: z.boolean() }));
  decideProposal(c.req.param("id"), decodeURIComponent(c.req.param("pid")), input.accept);
  return c.json(worldView(c.req.param("id")));
});

world.post("/chats/:id/world/fates/:arcId", async (c) => {
  const input = await body(c, z.object({ choice: z.enum(["accept", "soften", "page"]) }));
  decideFate(c.req.param("id"), decodeURIComponent(c.req.param("arcId")), input.choice);
  return c.json(worldView(c.req.param("id")));
});

/** docs/21 5.3: let a piece of news travel, or not. */
world.post("/chats/:id/world/news/:newsId", async (c) => {
  const input = await body(c, z.object({ accept: z.boolean() }));
  return c.json(decideNews(c.req.param("id"), decodeURIComponent(c.req.param("newsId")), input.accept));
});

/** docs/21 Part 2: read the lore of anyone whose sheet is missing or out of date (`again`: everyone). */
world.post("/chats/:id/world/sheets/read", async (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const input = await body(c, z.object({ again: z.boolean().optional() }));
  if (input.again) clearSheets(chatId);
  return c.json({ queued: queueSheets(chatId) });
});

/** Take back something the world did off the page (docs/21 1.1), and maybe keep it from happening again. */
world.post("/chats/:id/world/undo/:eventId", async (c) => {
  const input = await body(c, z.object({ also: z.enum(["apart", "out"]).optional() }));
  return c.json(undoEngine(c.req.param("id"), c.req.param("eventId"), input.also));
});

world.put("/chats/:id/world/people/:name", async (c) => {
  const input = await body(
    c,
    z.object({
      standing: z.enum(["here", "away", "captive", "changed", "dead", "companion", "construct"]).optional(),
      where: z.string().max(200).optional(),
      flag: z.enum(["out", "hold", "wake"]).nullable().optional(),
    }),
  );
  setActor(c.req.param("id"), decodeURIComponent(c.req.param("name")), input);
  return c.json(worldView(c.req.param("id")));
});
