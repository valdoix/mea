import { Hono } from "hono";
import { z } from "zod";
import { asideHints, fileAside } from "../accuracy/asides";
import { chatCostToday, cheaperForBackground, cheaperProfile, replyCost } from "../services/chatcost";
import { deleteCustomCalendar, listCustomCalendars, saveCustomCalendar } from "../trackers/customcal";
import { bondsReport, deskCue, deskView, recapSince, secretsReport, storyAudit, threadsReport } from "../steer/desk";
import { body } from "../lib/http";
import { applySetup, previewOpening, saveUsual, setupSchema, setupView, skipSetup, usual } from "../services/setup";
import { mustChat } from "../services/chats";

/** F1: Session Zero; F2: the Director's Desk (same router). */
export const setup = new Hono();
const desk = setup;

setup.get("/chats/:id/setup", (c) => {
  mustChat(c.req.param("id"));
  return c.json(setupView(c.req.param("id")));
});

setup.post("/chats/:id/setup", async (c) => c.json(applySetup(c.req.param("id"), await body(c, setupSchema))));

setup.post("/chats/:id/setup/skip", (c) => c.json(skipSetup(c.req.param("id"))));

/** A sample of the opening in this tone (one cheap call). */
setup.post("/chats/:id/setup/preview", async (c) => c.json(await previewOpening(c.req.param("id"), await body(c, setupSchema.pick({ tone: true, persona: true, genres: true })))));

/** Save as my usual / Use my usual. */
setup.get("/setup/usual", (c) => c.json({ answers: usual() }));
setup.post("/setup/usual", async (c) => {
  saveUsual(await body(c, setupSchema));
  return c.json({ ok: true });
});

// ---------- F2: the Director's Desk ----------

desk.get("/chats/:id/desk", (c) => c.json(deskView(c.req.param("id"))));

desk.get("/chats/:id/desk/report/:kind", (c) => {
  const id = c.req.param("id");
  mustChat(id);
  const kind = c.req.param("kind");
  if (kind === "bonds") return c.json(bondsReport(id));
  if (kind === "threads") return c.json(threadsReport(id));
  if (kind === "secrets") return c.json(secretsReport(id));
  return c.json({ error: "No such report" }, 404);
});

/** Cut to, Bring someone in, Push this thread, Raise the stakes, Breathe: a one-shot cue. */
desk.post("/chats/:id/desk/cue", async (c) => {
  const b = await body(
    c,
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("cut"), to: z.string().min(1).max(120) }),
      z.object({ kind: z.literal("bring"), who: z.string().min(1).max(80) }),
      z.object({ kind: z.literal("push"), thread: z.string().min(1).max(160) }),
      z.object({ kind: z.literal("raise") }),
      z.object({ kind: z.literal("breathe") }),
    ]),
  );
  return c.json(deskCue(c.req.param("id"), b));
});

desk.post("/chats/:id/desk/audit", async (c) => {
  const b = await body(c, z.object({ n: z.number().int().min(1).max(100).default(20) }));
  return c.json(storyAudit(c.req.param("id"), b.n));
});

/** Previously on…, since I was away. */
desk.post("/chats/:id/recap/since", async (c) => {
  const b = await body(c, z.object({ since: z.number().int().min(0) }));
  return c.json(await recapSince(c.req.param("id"), b.since));
});

// ---------- F3: selection asides ----------

/** What a selection could be (a date for the calendar, a time for the clock), to offer the right asides. */
desk.get("/chats/:id/aside/hints", (c) => c.json(asideHints(c.req.query("text") ?? "")));

desk.post("/chats/:id/aside", async (c) => {
  const b = await body(
    c,
    z.object({
      kind: z.enum(["truth", "motif", "calendar", "clock", "plant", "owner"]),
      text: z.string().min(1).max(600),
      messageId: z.string().nullable().optional(),
      when: z.string().max(60).optional(),
      eventKind: z.string().max(30).optional(),
      owner: z.string().max(80).optional(),
    }),
  );
  return c.json({ filing: fileAside(c.req.param("id"), b) });
});

// ---------- G1: calendars you build ----------

desk.get("/calendars", (c) => c.json({ calendars: listCustomCalendars() }));
desk.post("/calendars", async (c) => c.json({ calendar: saveCustomCalendar(await c.req.json()) }));
desk.put("/calendars/:cid", async (c) => c.json({ calendar: saveCustomCalendar(await c.req.json(), c.req.param("cid")) }));
desk.delete("/calendars/:cid", (c) => {
  deleteCustomCalendar(c.req.param("cid"));
  return c.json({ ok: true });
});

// ---------- H2: per-chat cost guard ----------

desk.get("/chats/:id/cost", (c) => {
  mustChat(c.req.param("id"));
  return c.json({ ...chatCostToday(c.req.param("id")), cheaper: cheaperProfile() });
});

/** "Use a cheaper model for these": background work (summaries, helpers, trackers, the world) moves to it. */
desk.post("/cost/cheaper", (c) => c.json(cheaperForBackground()));

/** The Inspector's cost per reply: writer, planner and background. */
desk.get("/generations/:gid/cost", (c) => c.json({ cost: replyCost(c.req.param("gid")) }));
