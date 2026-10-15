import { Hono } from "hono";
import { z } from "zod";
import { body } from "../lib/http";
import { historyForPrompt, mustChat } from "../services/chats";
import { planFor, recentPlans, runAdvisor, steerFor, turnKey } from "../steer/advisor";
import { decideEdit } from "../steer/editor";
import { planbook } from "../steer/planbook";
import { reviewPlans } from "../steer/plannernotes";
import { styleFor, styleText } from "../steer/style";

/** Steering (Phase 5): the advisor's plans (STEER-01/02), the post-pass editor (STEER-03), the style profile (STEER-04). */
export const steer = new Hono();

/** The advisor's recent plans and whether one is ready for the next reply. */
steer.get("/chats/:id/advisor", (c) => {
  const id = c.req.param("id");
  mustChat(id);
  const cfg = steerFor(id);
  return c.json({ on: cfg.advisorOn, next: planFor(id, turnKey(historyForPrompt(id))), plans: recentPlans(id, 8) });
});

/** The planner's notebook: how this chat's plans turned out (or, with ?scope=model, its model's in every chat). */
steer.get("/chats/:id/planbook", (c) => c.json(planbook(c.req.param("id"), c.req.query("scope") === "model" ? "model" : "chat")));

/** "Review now": look for planner notes at once (the helper too, when lessons use the model). */
steer.post("/chats/:id/planbook/review", async (c) => {
  const id = c.req.param("id");
  mustChat(id);
  return c.json({ notes: await reviewPlans(id, { force: true }) });
});

/** Plan the next reply now (for the panel's "Plan now"; normally this happens while you type). */
steer.post("/chats/:id/advisor/plan", async (c) => {
  const id = c.req.param("id");
  mustChat(id);
  const input = await body(c, z.object({ draft: z.string().max(8000).optional() }));
  const plan = await runAdvisor(id, { draft: input.draft });
  return c.json({ plan });
});

/** STEER-03: accept or dismiss the editor's fixes, or undo an applied edit. */
steer.post("/messages/:id/edit-suggestion", async (c) => {
  const input = await body(c, z.object({ action: z.enum(["apply", "dismiss", "undo"]) }));
  decideEdit(c.req.param("id"), input.action);
  return c.json({ ok: true });
});

/** STEER-04: the style profile in effect (the character's under the chat's) and its prompt text. */
steer.get("/chats/:id/style", (c) => {
  const id = c.req.param("id");
  mustChat(id);
  const s = styleFor(id);
  return c.json({ style: s, text: styleText(s) });
});
