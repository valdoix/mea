import { Hono } from "hono";
import { stash } from "../services/undo";
import { z } from "zod";
import { all, one } from "../db/db";
import { badRequest, body, must } from "../lib/http";
import { getCharacterRow } from "../services/characters";
import { getMessageRow, mustChat, trackerConfigSchema } from "../services/chats";
import { enqueue } from "../services/jobs";
import { formatStoryTime, shortStoryTime } from "../trackers/clock";
import { checkCondition, evalCondition } from "../trackers/condition";
import { hudLine } from "../trackers/note";
import { STARTER_TEMPLATES, templateInput } from "../trackers/schema";
import { timeskip, trackerPrompt, userEdit } from "../trackers/service";
import {
  castKey,
  castProfiles,
  characterTrackerDefaults,
  clearEvents,
  currentFold,
  deleteCastProfile,
  deleteEvent,
  deleteTemplate,
  eventsOf,
  foldAt,
  foldConfigFor,
  getTemplate,
  hasBase,
  linesToOps,
  listTemplates,
  saveCastProfile,
  saveTemplate,
  setCharacterTrackerDefaults,
  trackerConfig,
} from "../trackers/store";
import type { Change, Moment } from "../trackers/types";

export const trackers = new Hono();

const momentText = (t: Moment | null) => (t ? formatStoryTime(t) : null);

function seqOf(chatId: string, messageId?: string | null) {
  if (!messageId) return undefined;
  const m = getMessageRow(messageId);
  if (!m || m.chat_id !== chatId) throw badRequest("That message isn't in this chat");
  return m.seq;
}

/** The story world now, or as of a message (TRK-26, the drawer of an older message). */
trackers.get("/chats/:id/trackers", (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const at = c.req.query("at");
  const state = at ? foldAt(chatId, { uptoSeq: seqOf(chatId, at) }).state : currentFold(chatId).result.state;
  const config = trackerConfig(chatId);
  const fc = foldConfigFor(chatId, config);
  const running = Boolean(one("SELECT 1 FROM jobs WHERE chat_id = ? AND kind IN ('tracker.update', 'tracker.init') AND status IN ('queued', 'running')", chatId));
  return c.json({
    state,
    time: momentText(state.time),
    hud: hudLine(state, fc.templates),
    config,
    templates: fc.templates,
    userName: fc.userName,
    mainName: fc.mainName,
    profiles: castProfiles(chatId),
    hasBase: hasBase(chatId),
    running,
  });
});

/** The prompt block the trackers add, with its lanes (for the inspector and the settings preview). */
trackers.get("/chats/:id/trackers/note", (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const p = trackerPrompt(chatId, { kind: "story" });
  return c.json({ note: p.note, inline: p.inline });
});

/** Change chips for every message (TRK-07) and in-story time per message (CHAT-20). */
trackers.get("/chats/:id/trackers/chips", (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const fold = currentFold(chatId);
  const times: Record<string, string> = {};
  for (const [id, t] of Object.entries(fold.times)) {
    if (!t) continue;
    const [minutes, form] = t.split(":");
    times[id] = shortStoryTime(formatStoryTime({ minutes: Number(minutes), form: form as Moment["form"] }));
  }
  const issues: Record<string, number> = {};
  return c.json({ byMessage: fold.result.changes, times, issues });
});

/** One message's ledger: its lines, what each did, and why any was refused. */
trackers.get("/chats/:id/trackers/message/:mid", (c) => {
  const chatId = c.req.param("id");
  const mid = c.req.param("mid");
  mustChat(chatId);
  const m = must(getMessageRow(mid), "Message not found");
  const fold = currentFold(chatId).result;
  const events = eventsOf(chatId, mid).filter((e) => e.swipeIdx === -1 || e.swipeIdx === m.active_swipe);
  return c.json({
    events: events.map((e) => ({ ...e, verdict: fold.verdicts[e.id] ?? null })),
    changes: fold.changes[mid] ?? [],
  });
});

/** Your edits (TRK-05): ledger lines, anchored to the newest message on every swipe of it. */
trackers.post("/chats/:id/trackers/edit", async (c) => {
  const chatId = c.req.param("id");
  const input = await body(c, z.object({ lines: z.array(z.string().max(2000)).min(1).max(60) }));
  const { ops, bad } = linesToOps(input.lines);
  if (bad.length && !ops.length) throw badRequest(`Couldn't read: ${bad[0]}`);
  const fold = userEdit(chatId, ops);
  return c.json({ ok: true, bad, state: fold.state });
});

trackers.delete("/chats/:id/trackers/events/:eid", (c) => {
  deleteEvent(c.req.param("id"), c.req.param("eid"));
  return c.json({ ok: true });
});

/** Read the latest reply again (or a chosen one). */
trackers.post("/chats/:id/trackers/run", async (c) => {
  const chatId = c.req.param("id");
  const input = await body(c, z.object({ messageId: z.string().optional() }));
  mustChat(chatId);
  const target = input.messageId
    ? must(getMessageRow(input.messageId), "Message not found")
    : one<{ id: string; active_swipe: number }>("SELECT id, active_swipe FROM messages WHERE chat_id = ? AND role = 'assistant' AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1", chatId);
  if (!target) throw badRequest("There's no reply to read yet");
  if (!hasBase(chatId)) enqueue("tracker.init", { chatId }, { dedupeKey: `tracker.init:${chatId}`, priority: 6, chatId });
  enqueue("tracker.update", { chatId, messageId: target.id, swipeIdx: target.active_swipe }, { dedupeKey: `tracker.update:${target.id}:${target.active_swipe}`, priority: 7, chatId });
  return c.json({ ok: true });
});

/** The starting state from the card (TRK-09); `fresh` clears everything first. */
trackers.post("/chats/:id/trackers/init", async (c) => {
  const chatId = c.req.param("id");
  const input = await body(c, z.object({ fresh: z.boolean().default(false) }));
  mustChat(chatId);
  if (input.fresh) clearEvents(chatId);
  else clearEvents(chatId, ["init"]);
  enqueue("tracker.init", { chatId }, { dedupeKey: `tracker.init:${chatId}`, priority: 7, chatId });
  if (input.fresh) {
    // Read the latest reply again too, so the state isn't only the opening.
    const last = one<{ id: string; active_swipe: number }>("SELECT id, active_swipe FROM messages WHERE chat_id = ? AND role = 'assistant' AND deleted_at IS NULL AND seq > 1 ORDER BY seq DESC LIMIT 1", chatId);
    if (last) enqueue("tracker.update", { chatId, messageId: last.id, swipeIdx: last.active_swipe }, { dedupeKey: `tracker.update:${last.id}:${last.active_swipe}`, priority: 5, chatId, delayMs: 2000 });
  }
  return c.json({ ok: true });
});

/** TRK-10: "/timeskip 3 days". */
trackers.post("/chats/:id/timeskip", async (c) => {
  const input = await body(c, z.object({ duration: z.string().min(1).max(40), note: z.string().max(500).optional() }));
  return c.json(timeskip(c.req.param("id"), input.duration, input.note));
});

/** TRK-28: every change in story order, plus series for the sparklines. */
trackers.get("/chats/:id/trackers/timeline", (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const fold = currentFold(chatId).result;
  const seqs = new Map(all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId).map((m) => [m.id, m.seq]));
  const entries: (Change & { messageId: string; seq: number })[] = [];
  for (const [mid, list] of Object.entries(fold.changes)) for (const ch of list) entries.push({ ...ch, messageId: mid, seq: seqs.get(mid) ?? 0 });
  entries.sort((a, b) => a.seq - b.seq);
  const st = fold.state;
  const userName = foldConfigFor(chatId).userName ?? "You";
  const nm = (id: string) => (st.chars[id]?.isUser ? userName : (st.chars[id]?.name ?? id));
  const series: { key: string; label: string; min: number; max: number; points: { seq: number; v: number }[] }[] = [];
  for (const b of Object.values(st.bonds)) {
    const axes = new Set(b.history.map((h) => h.axis));
    for (const axis of axes) {
      const pts = b.history.filter((h) => h.axis === axis).map((h) => ({ seq: h.seq, v: h.to }));
      const first = b.history.find((h) => h.axis === axis)!;
      series.push({ key: `bond:${b.from}>${b.to}:${axis}`, label: `${nm(b.from)} → ${nm(b.to)} · ${axis}`, min: ["trust", "affection", "respect", "comfort"].includes(axis) ? -5 : 0, max: 5, points: [{ seq: first.seq - 1, v: first.from }, ...pts] });
    }
  }
  for (const l of Object.values(st.ladders)) series.push({ key: `ladder:${l.from}>${l.to}`, label: `${nm(l.from)} → ${nm(l.to)} · romance`, min: 0, max: 7, points: l.history.map((h) => ({ seq: h.seq, v: h.tier })) });
  for (const g of Object.values(st.gauges)) series.push({ key: `gauge:${g.name}`, label: g.name, min: 0, max: g.max, points: g.history.map((h) => ({ seq: h.seq, v: h.v })) });
  for (const k of Object.values(st.clocks)) series.push({ key: `clock:${k.faction}:${k.name}`, label: `${k.faction}: ${k.name}`, min: 0, max: k.max, points: k.history.map((h) => ({ seq: h.seq, v: h.v })) });
  // Meters from the change log (their history isn't kept on the state).
  const meterPts = new Map<string, { label: string; points: { seq: number; v: number }[] }>();
  for (const e of entries) {
    const m = e.path.match(/^chars\.([^.]+)\.meters\.(\w+)$/);
    if (!m || typeof e.to !== "number") continue;
    const k = `meter:${m[1]}:${m[2]}`;
    if (!meterPts.has(k)) meterPts.set(k, { label: `${nm(m[1]!)} · ${m[2]}`, points: typeof e.from === "number" ? [{ seq: e.seq - 1, v: e.from }] : [] });
    meterPts.get(k)!.points.push({ seq: e.seq, v: e.to });
  }
  for (const [key, v] of meterPts) series.push({ key, label: v.label, min: 0, max: 5, points: v.points });
  return c.json({ entries, series });
});

/** TRK-29: the relationship web, now or as of a message (the time scrubber). */
trackers.get("/chats/:id/trackers/graph", (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const seq = c.req.query("seq") ? Number(c.req.query("seq")) : undefined;
  const st = seq != null ? foldAt(chatId, { uptoSeq: seq }).state : currentFold(chatId).result.state;
  const profiles = castProfiles(chatId);
  const nodes = Object.values(st.chars).map((ch) => ({
    id: ch.id,
    name: ch.isUser ? (foldConfigFor(chatId).userName ?? "You") : ch.name,
    isUser: ch.isUser,
    isMain: ch.isMain,
    present: ch.tier === "spot" || ch.tier === "peri",
    dead: Boolean(ch.dead),
    mood: ch.mood?.name ?? null,
    avatarId: profiles[castKey(ch.name)]?.avatarId ?? null,
    color: profiles[castKey(ch.name)]?.color ?? null,
  }));
  const edges = Object.values(st.bonds).map((b) => {
    const a = b.axes;
    const warmth = ((a.trust ?? 0) + (a.affection ?? 0) + (a.respect ?? 0) + (a.comfort ?? 0)) / 4;
    const heat = Math.max(a.attraction ?? 0, a.fear ?? 0, a.resentment ?? 0, a.rivalry ?? 0);
    return { from: b.from, to: b.to, label: b.label ?? null, axes: b.axes, tags: b.tags, warmth, heat, ladder: st.ladders[`${b.from}>${b.to}`]?.tier ?? null };
  });
  for (const l of Object.values(st.ladders)) if (!edges.some((e) => e.from === l.from && e.to === l.to)) edges.push({ from: l.from, to: l.to, label: null, axes: {}, tags: [], warmth: 0, heat: 0, ladder: l.tier });
  const maxSeq = one<{ s: number | null }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0;
  return c.json({ nodes, edges, seq: seq ?? maxSeq, maxSeq });
});

/** TRK-12: is this condition readable, and does it hold now? */
trackers.post("/chats/:id/trackers/check", async (c) => {
  const chatId = c.req.param("id");
  const input = await body(c, z.object({ condition: z.string().min(1).max(500) }));
  const st = currentFold(chatId).result.state;
  const error = checkCondition(st, input.condition);
  return c.json({ ok: !error, error, holds: error ? false : evalCondition(st, input.condition) });
});

// ---------- the cast (CHAT-26, CHAT-27) ----------

const castInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(2000).optional(),
  voice: z.string().max(600).optional(),
  pinned: z.boolean().optional(),
  avatarId: z.string().nullable().optional(),
  stamina: z.string().max(30).optional(),
  color: z.string().max(20).optional(),
  standing: z.enum(["here", "away", "captive", "changed", "dead", "companion", "construct"]).optional(),
  where: z.string().max(200).optional(),
  base: z.string().max(200).optional(),
  routine: z.string().max(400).optional(),
  role: z.string().max(200).optional(),
  out: z.boolean().optional(),
});

trackers.get("/chats/:id/cast", (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const st = currentFold(chatId).result.state;
  const profiles = castProfiles(chatId);
  const seen = new Set<string>();
  const people = Object.values(st.chars)
    .filter((ch) => !ch.isUser)
    .map((ch) => {
      const key = castKey(ch.name);
      seen.add(key);
      const items = Object.values(st.items).filter((i) => i.holder === ch.id && !i.gone).map((i) => i.name);
      const toUser = st.bonds[`${ch.id}>user`];
      return {
        key,
        id: ch.id,
        name: ch.name,
        isMain: ch.isMain,
        present: ch.tier === "spot" || ch.tier === "peri",
        dead: Boolean(ch.dead),
        mood: ch.mood?.name ?? null,
        place: ch.place ?? null,
        activity: ch.activity ?? null,
        look: ch.look ?? null,
        traits: ch.traits.map((t) => t.text),
        wants: ch.drives.want ?? null,
        items,
        regard: toUser ? { label: toUser.label ?? null, axes: toUser.axes } : null,
        lastSeq: ch.lastSeq,
        firstSeq: ch.firstSeq,
        profile: profiles[key] ?? null,
      };
    });
  // People you added who haven't been on the page yet.
  for (const [key, p] of Object.entries(profiles)) if (!seen.has(key)) people.push({ key, id: key, name: p.name, isMain: false, present: false, dead: p.standing === "dead", mood: null, place: p.where ?? null, activity: null, look: null, traits: [], wants: null, items: [], regard: null, lastSeq: 0, firstSeq: 0, profile: p });
  return c.json({ people });
});

trackers.put("/chats/:id/cast/:name", async (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const input = await body(c, castInput);
  return c.json(saveCastProfile(chatId, decodeURIComponent(c.req.param("name")), input));
});

trackers.delete("/chats/:id/cast/:name", (c) => {
  deleteCastProfile(c.req.param("id"), decodeURIComponent(c.req.param("name")));
  return c.json({ ok: true });
});

// ---------- template library (TRK-32) ----------

trackers.get("/tracker-templates", (c) => c.json({ templates: listTemplates() }));
trackers.post("/tracker-templates", async (c) => c.json(saveTemplate(await c.req.json()), 201));
trackers.put("/tracker-templates/:id", async (c) => {
  const id = c.req.param("id");
  if (STARTER_TEMPLATES.some((t) => t.id === id)) throw badRequest("Starter templates can't be changed; duplicate one first");
  return c.json(saveTemplate(await c.req.json(), id));
});
trackers.delete("/tracker-templates/:id", (c) => {
  const id = c.req.param("id");
  if (STARTER_TEMPLATES.some((t) => t.id === id)) throw badRequest("Starter templates can't be deleted");
  const undo = stash("Template", [{ table: "tracker_templates", where: "id = ?", params: [id] }]);
  deleteTemplate(id);
  return c.json({ ok: true, undo });
});
/** Duplicate (a starter or your own), with a fresh key. */
trackers.post("/tracker-templates/:id/duplicate", (c) => {
  const t = must(getTemplate(c.req.param("id")), "Template not found");
  const keys = new Set(listTemplates().map((x) => x.key));
  let key = `${t.key}_copy`;
  for (let i = 2; keys.has(key); i++) key = `${t.key}_copy${i}`;
  return c.json(saveTemplate({ key: key.slice(0, 30), name: `${t.name} (copy)`, description: t.description, schema: t.schema }), 201);
});
/** Share as JSON. */
trackers.get("/tracker-templates/:id/export", (c) => {
  const t = must(getTemplate(c.req.param("id")), "Template not found");
  c.header("Content-Disposition", `attachment; filename="${t.key}.mea-tracker.json"`);
  return c.json({ format: "mea-tracker-template", version: 1, key: t.key, name: t.name, description: t.description, schema: t.schema });
});
trackers.post("/tracker-templates/import", async (c) => {
  const raw = (await c.req.json()) as Record<string, unknown>;
  const parsed = templateInput.safeParse({ key: raw.key, name: raw.name, description: raw.description ?? "", schema: raw.schema });
  if (!parsed.success) throw badRequest(`That isn't a Mea tracker template: ${z.prettifyError(parsed.error).slice(0, 300)}`);
  const keys = new Set(listTemplates().map((x) => x.key));
  let key = parsed.data.key;
  for (let i = 2; keys.has(key); i++) key = `${parsed.data.key}${i}`.slice(0, 30);
  return c.json(saveTemplate({ ...parsed.data, key }), 201);
});

// ---------- per-character defaults (TRK-32) ----------

trackers.get("/characters/:id/trackers", (c) => {
  must(getCharacterRow(c.req.param("id")), "Character not found");
  return c.json(characterTrackerDefaults(c.req.param("id")));
});
trackers.put("/characters/:id/trackers", async (c) => {
  must(getCharacterRow(c.req.param("id")), "Character not found");
  const input = await body(c, trackerConfigSchema);
  setCharacterTrackerDefaults(c.req.param("id"), input);
  return c.json(input);
});


