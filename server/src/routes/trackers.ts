import { Hono } from "hono";
import { stash } from "../services/undo";
import { z } from "zod";
import { all, one } from "../db/db";
import { badRequest, body, must, notFound } from "../lib/http";
import { belongingsOf } from "../trackers/belongings";
import { getCharacterRow } from "../services/characters";
import { getMessageRow, mustChat, trackerConfigSchema } from "../services/chats";
import { enqueue } from "../services/jobs";
import { describeWhen, spanLabel } from "../trackers/calendars";
import { formatStoryTime, parseStoryTime, shortStoryTime } from "../trackers/clock";
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
  moveCastProfile,
  saveCastProfile,
  saveTemplate,
  setCharacterTrackerDefaults,
  trackerConfig,
} from "../trackers/store";
import { personName } from "../trackers/fold";
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
  const seq = c.req.query("seq");
  // ?at=<message> or ?seq=<n>: the world as it stood then (the Almanac's rewind).
  const state = at ? foldAt(chatId, { uptoSeq: seqOf(chatId, at) }).state : seq ? foldAt(chatId, { uptoSeq: Number(seq) }).state : currentFold(chatId).result.state;
  const config = trackerConfig(chatId);
  const fc = foldConfigFor(chatId, config);
  const running = Boolean(one("SELECT 1 FROM jobs WHERE chat_id = ? AND kind IN ('tracker.update', 'tracker.init') AND status IN ('queued', 'running')", chatId));
  return c.json({
    state,
    time: momentText(state.time),
    when: state.time ? describeWhen(state.time, config.calendar, config.season) : null,
    hud: hudLine(state, fc.templates, config.calendar),
    config,
    templates: fc.templates,
    userName: fc.userName,
    mainName: fc.mainName,
    profiles: castProfiles(chatId),
    hasBase: hasBase(chatId),
    running,
    maxSeq: one<{ s: number | null }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0,
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
  const cal = trackerConfig(chatId).calendar;
  const times: Record<string, string> = {};
  for (const [id, t] of Object.entries(fold.times)) {
    if (!t) continue;
    const [minutes, form] = t.split(":");
    const moment = { minutes: Number(minutes), form: form as Moment["form"] };
    times[id] = cal === "gregorian" ? shortStoryTime(formatStoryTime(moment)) : describeWhen(moment, cal).short;
  }
  // Clock chips read in the chat's calendar ("21:40 → 23:10" within a day).
  const byMessage: Record<string, Change[]> = {};
  for (const [id, list] of Object.entries(fold.result.changes)) {
    byMessage[id] = list.map((ch) => {
      if (ch.kind !== "clock" || ch.flag) return ch;
      const to = parseStoryTime(ch.to);
      return to ? { ...ch, text: spanLabel(parseStoryTime(ch.from), to, cal) } : ch;
    });
  }
  const issues: Record<string, number> = {};
  return c.json({ byMessage, times, issues });
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
  for (const [mid, list] of Object.entries(fold.changes)) for (const ch of list) if (ch.kind !== "thought" && ch.kind !== "mask") entries.push({ ...ch, messageId: mid, seq: seqs.get(mid) ?? 0 });
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
    // G2: the group they stand best with (the factions layer).
    faction: Object.values(st.rep).filter((r) => r.who === ch.id && r.score > 0).sort((a, b) => b.score - a.score)[0]?.group ?? null,
  }));
  const edges = Object.values(st.bonds).map((b) => {
    const a = b.axes;
    const warmth = ((a.trust ?? 0) + (a.affection ?? 0) + (a.respect ?? 0) + (a.comfort ?? 0)) / 4;
    const heat = Math.max(a.attraction ?? 0, a.fear ?? 0, a.resentment ?? 0, a.rivalry ?? 0);
    // G2: the bond's history, for "click a line" (each change with Jump to the message).
    const history = b.history.slice(-24).map((h) => ({ axis: h.axis, delta: h.delta, to: h.to, cause: h.cause ?? null, seq: h.seq }));
    return { from: b.from, to: b.to, label: b.label ?? null, axes: b.axes, tags: b.tags, warmth, heat, ladder: st.ladders[`${b.from}>${b.to}`]?.tier ?? null, history };
  });
  for (const l of Object.values(st.ladders)) if (!edges.some((e) => e.from === l.from && e.to === l.to)) edges.push({ from: l.from, to: l.to, label: null, axes: {}, tags: [], warmth: 0, heat: 0, ladder: l.tier, history: [] });
  // G2 layers: who knows each secret, and the trail each important object took between people.
  const secrets = Object.values(st.facts)
    .filter((f) => f.secret || Object.values(f.stances).some((x) => x.status === "unaware"))
    .map((f) => ({
      key: f.key,
      statement: f.statement,
      knows: Object.entries(f.stances).filter(([, x]) => ["knows", "believes", "suspects"].includes(x.status)).map(([id]) => id),
      unaware: Object.entries(f.stances).filter(([, x]) => x.status === "unaware").map(([id]) => id),
    }));
  const trails = Object.values(st.items)
    .map((i) => ({ id: i.id, name: i.name, gift: i.gift ?? null, steps: i.custody.filter((h) => h.to && st.chars[h.to]).map((h) => ({ from: h.from && st.chars[h.from] ? h.from : null, to: h.to!, seq: h.seq, at: h.at ?? null })) }))
    .filter((t) => t.steps.length >= 1 && t.steps.some((x) => x.from));
  const maxSeq = one<{ s: number | null }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0;
  return c.json({ nodes, edges, secrets, trails, seq: seq ?? maxSeq, maxSeq });
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

/** E2: a person's rooms and belongings, with each item's history. */
trackers.get("/chats/:id/belongings/:char", (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const st = currentFold(chatId).result.state;
  const who = st.chars[c.req.param("char")];
  if (!who) throw notFound("Who?");
  const places = Object.values(st.places).map((p) => ({ id: p.id, name: p.name, path: p.path.join(" › "), owner: p.owner ? (st.chars[p.owner]?.name ?? null) : null }));
  return c.json({ ...belongingsOf(st, who), places });
});

trackers.get("/chats/:id/cast", (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const st = currentFold(chatId).result.state;
  // Profiles filed under a name the story no longer uses (a renamed duplicate, "Jackie Taylor@down-slope")
  // go back to the person their name points to; what's already set on that person wins.
  const byName = new Map<string, string>();
  for (const ch of Object.values(st.chars)) if (!ch.isUser) for (const n of [ch.name, ...ch.aliases]) byName.set(castKey(n), ch.name);
  for (const [key, p] of Object.entries(castProfiles(chatId))) {
    if (byName.has(key)) continue;
    const owner = byName.get(castKey(p.name)) ?? byName.get(castKey(personName(key)));
    if (owner) moveCastProfile(chatId, key, owner);
  }
  const profiles = castProfiles(chatId);
  const seen = new Set<string>();
  const people = Object.values(st.chars)
    .filter((ch) => !ch.isUser)
    .map((ch) => {
      const key = castKey(ch.name);
      // A profile saved under another name they go by still belongs to them.
      const names = [ch.name, ...ch.aliases].map(castKey);
      for (const k of names) seen.add(k);
      const items = Object.values(st.items).filter((i) => i.holder === ch.id && !i.gone).map((i) => i.name);
      const toUser = st.bonds[`${ch.id}>user`];
      return {
        key,
        id: ch.id,
        name: ch.name,
        aliases: ch.aliases,
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
        profile: names.map((k) => profiles[k]).find(Boolean) ?? null,
        char: ch,
      };
    });
  // People you added who haven't been on the page yet.
  for (const [key, p] of Object.entries(profiles)) if (!seen.has(key) && !Object.values(st.chars).some((ch) => ch.isUser && castKey(ch.name) === key)) people.push({ key, id: key, name: p.name, aliases: [], isMain: false, present: false, dead: p.standing === "dead", mood: null, place: p.where ?? null, activity: null, look: null, traits: [], wants: null, items: [], regard: null, lastSeq: 0, firstSeq: 0, profile: p, char: null as never });
  return c.json({ people, userName: foldConfigFor(chatId).userName });
});

trackers.put("/chats/:id/cast/:name", async (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const input = await body(c, castInput);
  const name = decodeURIComponent(c.req.param("name"));
  // A new name: the story calls them that from now on, and the profile follows.
  if (input.name && castKey(input.name) !== castKey(name)) {
    const ch = Object.values(currentFold(chatId).result.state.chars).find((x) => !x.isUser && [x.name, ...x.aliases].some((n) => castKey(n) === castKey(name)));
    if (ch) userEdit(chatId, [{ op: "rename", subject: ch.name, args: { to: input.name }, raw: `rename ${ch.name}: ${input.name}` }]);
    moveCastProfile(chatId, name, input.name);
    return c.json(saveCastProfile(chatId, input.name, input));
  }
  return c.json(saveCastProfile(chatId, name, input));
});

/** Two entries that are one person: the first folds into the second, in the story and in the cast. */
trackers.post("/chats/:id/cast/merge", async (c) => {
  const chatId = c.req.param("id");
  mustChat(chatId);
  const input = await body(c, z.object({ from: z.string().min(1).max(120), into: z.string().min(1).max(120) }));
  const st = currentFold(chatId).result.state;
  const into = Object.values(st.chars).find((x) => x.name === input.into || x.id === input.into);
  const from = Object.values(st.chars).find((x) => x.name === input.from || x.id === input.from);
  if (from && into) {
    const raw = `merge ${from.name} → ${into.name}`;
    const fold = userEdit(chatId, [{ op: "merge", subject: from.name, args: { to: into.name }, raw }]);
    const verdict = Object.values(fold.verdicts).filter((v) => v.raw === raw).at(-1);
    if (verdict && !verdict.ok) throw badRequest(verdict.reason ?? "Couldn't merge them");
  }
  moveCastProfile(chatId, from?.name ?? input.from, into?.name ?? input.into);
  return c.json({ ok: true });
});

/** ?forget=1 also takes them out of the story's records (not just the profile). */
trackers.delete("/chats/:id/cast/:name", (c) => {
  const chatId = c.req.param("id");
  const name = decodeURIComponent(c.req.param("name"));
  if (c.req.query("forget")) {
    const ch = Object.values(currentFold(chatId).result.state.chars).find((x) => !x.isUser && [x.name, ...x.aliases].some((n) => castKey(n) === castKey(name)));
    if (ch) userEdit(chatId, [{ op: "edit", args: { path: ["chars", ch.id], value: null }, raw: `edit ${JSON.stringify(["chars", ch.id])} = null` }]);
  }
  deleteCastProfile(chatId, name);
  return c.json({ ok: true });
});

// ---------- template library (TRK-32) ----------

trackers.get("/tracker-templates", (c) => c.json({ templates: listTemplates() }));
// L2: validate here so bad JSON or a bad template is a 400, not a 500 from saveTemplate's parse.
trackers.post("/tracker-templates", async (c) => c.json(saveTemplate(await body(c, templateInput)), 201));
trackers.put("/tracker-templates/:id", async (c) => {
  const id = c.req.param("id");
  if (STARTER_TEMPLATES.some((t) => t.id === id)) throw badRequest("Starter templates can't be changed; duplicate one first");
  return c.json(saveTemplate(await body(c, templateInput), id));
});
trackers.delete("/tracker-templates/:id", (c) => {
  const id = c.req.param("id");
  if (STARTER_TEMPLATES.some((t) => t.id === id)) throw badRequest("Starter templates can't be deleted");
  const undo = stash("Template", [{ table: "tracker_templates", where: "id = ?", params: [id] }]);
  deleteTemplate(id);
  return c.json({ ok: true, undo });
});
/**
 * A free template key from `base` (max 30 chars). H9: the number replaces the tail instead of being
 * sliced off the end, so a 30-char key can't repeat forever; the loop is capped as well.
 */
function freeKey(base: string): string {
  const keys = new Set(listTemplates().map((x) => x.key));
  base = base.slice(0, 30);
  if (!keys.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const key = base.slice(0, 30 - String(i).length) + i;
    if (!keys.has(key)) return key;
  }
  throw badRequest("Too many templates share that key; rename one first");
}

/** Duplicate (a starter or your own), with a fresh key. */
trackers.post("/tracker-templates/:id/duplicate", (c) => {
  const t = must(getTemplate(c.req.param("id")), "Template not found");
  const key = freeKey(`${t.key.slice(0, 25)}_copy`);
  return c.json(saveTemplate({ key, name: `${t.name} (copy)`, description: t.description, schema: t.schema }), 201);
});
/** Share as JSON. */
trackers.get("/tracker-templates/:id/export", (c) => {
  const t = must(getTemplate(c.req.param("id")), "Template not found");
  c.header("Content-Disposition", `attachment; filename="${t.key}.mea-tracker.json"`);
  return c.json({ format: "mea-tracker-template", version: 1, key: t.key, name: t.name, description: t.description, schema: t.schema });
});
trackers.post("/tracker-templates/import", async (c) => {
  const raw = await body(c, z.record(z.string(), z.unknown()));
  const parsed = templateInput.safeParse({ key: raw.key, name: raw.name, description: raw.description ?? "", schema: raw.schema });
  if (!parsed.success) throw badRequest(`That isn't a Mea tracker template: ${z.prettifyError(parsed.error).slice(0, 300)}`);
  return c.json(saveTemplate({ ...parsed.data, key: freeKey(parsed.data.key) }), 201);
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


