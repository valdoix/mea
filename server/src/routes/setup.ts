import { type Context, Hono } from "hono";
import { storyBookDraft, storyBookJson } from "../lore/fromstory";
import { scenePlates } from "../trackers/plates";
import { runGolden } from "../golden/run";
import { addTrack, chatMusicView, connectFinish, connectStart, disconnect, MOODS, musicAction, musicView, refreshTaste, removeTrack, retagTrack, saveMusicConfig } from "../music/director";
import { z } from "zod";
import { asideHints, fileAside } from "../accuracy/asides";
import { chatCostToday, cheaperForBackground, cheaperProfile, replyCost } from "../services/chatcost";
import { deleteCustomCalendar, listCustomCalendars, saveCustomCalendar } from "../trackers/customcal";
import { bondsReport, deskCue, deskView, recapSince, secretsReport, storyAudit, threadsReport } from "../steer/desk";
import { body } from "../lib/http";
import { applySetup, previewOpening, saveUsual, setupSchema, setupView, skipSetup, usual } from "../services/setup";
import { historyForPrompt, mustChat } from "../services/chats";
import { one } from "../db/db";
import { editPlan, turnKey } from "../steer/advisor";

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

// ---------- H3: the separate planner ----------

/** "Edit the plan and regenerate": the plan the reply was written with becomes your edit (the regenerated take uses it). */
desk.post("/chats/:id/plan", async (c) => {
  const chatId = c.req.param("id");
  const b = await body(c, z.object({ generationId: z.string(), text: z.string().min(1).max(6000) }));
  const g = one<{ message_id: string | null }>("SELECT message_id FROM generations WHERE id = ? AND chat_id = ?", b.generationId, chatId);
  const key = g?.message_id ? turnKey(historyForPrompt(chatId).filter((m) => m.id !== g.message_id)) : undefined;
  return c.json({ ok: editPlan(chatId, b.generationId, b.text, key) });
});

// ---------- I3: story → lorebook ----------

const storyBookQuery = (c: Context) => ({ uptoSeq: c.req.query("seq") ? Number(c.req.query("seq")) : undefined, spoilerSafe: c.req.query("safe") === "1" });

/** Download: a SillyTavern World Info book of the story, as of a message (spoiler-safe optional). */
desk.get("/chats/:id/lorebook/export", (c) => {
  const chatId = c.req.param("id");
  const json = storyBookJson(chatId, storyBookQuery(c));
  const file = `${json.name.replace(/[^\w\- ()]+/g, "").trim() || "story"}.json`;
  return new Response(JSON.stringify(json, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${file}"` } });
});

/** "As a lorebook": a Lore Studio draft with the plan pre-filled, to review and save into a book. */
desk.post("/chats/:id/lorebook/draft", async (c) => {
  const b = await body(c, z.object({ seq: z.number().int().min(1).optional(), spoilerSafe: z.boolean().default(false) }));
  const d = storyBookDraft(c.req.param("id"), { uptoSeq: b.seq, spoilerSafe: b.spoilerSafe });
  return c.json({ draftId: d.id, entries: d.items.length }, 201);
});

// ---------- J1: scene plates ----------

desk.get("/chats/:id/plates", (c) => c.json(scenePlates(c.req.param("id"))));

// ---------- J3: the soundtrack (YouTube Music) ----------

desk.get("/music", (c) => {
  // Preferred artists not looked up yet (or a week ago) are found in the background.
  void refreshTaste().catch(() => {});
  return c.json(musicView());
});
// The body as sent, not parsed here: the schema would add its defaults for every field left out.
desk.put("/music", async (c) => c.json(saveMusicConfig(await body(c, z.record(z.string(), z.unknown())))));
desk.post("/music/connect", async (c) => c.json(await connectStart()));
desk.post("/music/connect/finish", async (c) => c.json(await connectFinish((await body(c, z.object({ code: z.string().min(1).max(40) }))).code)));
desk.post("/music/disconnect", (c) => c.json(disconnect()));
desk.post("/music/library", async (c) => c.json(await addTrack(await body(c, z.object({ link: z.string().max(300).optional(), moods: z.array(z.enum(MOODS)).optional(), instrumental: z.boolean().optional(), title: z.string().max(200).optional(), artist: z.string().max(120).optional() })))));
desk.patch("/music/library/:videoId", async (c) => c.json(retagTrack(c.req.param("videoId"), await body(c, z.object({ moods: z.array(z.enum(MOODS)).max(9).optional(), instrumental: z.boolean().optional() })))));
desk.delete("/music/library/:videoId", (c) => c.json(removeTrack(c.req.param("videoId"))));
desk.get("/chats/:id/music", (c) => {
  mustChat(c.req.param("id"));
  return c.json(chatMusicView(c.req.param("id")));
});
desk.post("/chats/:id/music", async (c) => {
  const b = await body(c, z.object({ action: z.enum(["on", "off", "playPause", "skip", "up", "down", "notForScene"]) }));
  return c.json(await musicAction(c.req.param("id"), b.action));
});

// ---------- K1: golden scenarios ----------

/** Settings › Status › Run story checks: the golden scenarios, on their own replies or written by your story model. */
desk.post("/golden/run", async (c) => {
  const b = await body(c, z.object({ model: z.boolean().default(false) }));
  return c.json(await runGolden({ model: b.model }));
});
