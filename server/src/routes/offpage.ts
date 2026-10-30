import { Hono } from "hono";
import { z } from "zod";
import { addNeverSay, createOffpage, deleteOffpage, getOffpage, holdOffpage, listOffpage, type RevealPlan, revealOffpage, updateOffpage } from "../accuracy/offpage";
import { fixIssueSentence } from "../accuracy/fixes";
import { issueToLesson } from "../accuracy/moreslips";
import { one } from "../db/db";
import { badRequest, body, must } from "../lib/http";
import { fileItem } from "../services/filings";
import { parseStoryTime } from "../trackers/clock";
import { exposureFor, nudgeExposure } from "../trackers/exposure";
import { pressureAction, pressuresView } from "../trackers/pressures";
import { loopsFor, promisesFor, setLoop, setPromise } from "../trackers/promises";
import { canonOf, laterItem, moveCutoff, queueSuggest, setCanon } from "../accuracy/canoncut";
import { canonSchema, mustChat } from "../services/chats";

/** B1: secrets kept off the page, and the one-sentence fix. */
export const offpage = new Hono();

const revealInput = z
  .object({
    when: z.enum(["never", "say", "after", "exposure"]),
    /** "after": this many messages from now… */
    messages: z.number().int().min(1).max(100_000).optional(),
    /** …or this story time ("Day 12", "2026-03-20 18:00"). */
    at: z.string().max(80).optional(),
  })
  .optional();

const curSeq = (chatId: string) => one<{ s: number | null }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0;

function plan(chatId: string, r: z.infer<typeof revealInput>): RevealPlan | undefined {
  if (!r) return undefined;
  if (r.when !== "after") return { when: r.when };
  const at = r.at?.trim() ? parseStoryTime(r.at.trim()) : null;
  if (r.at?.trim() && !at) throw badRequest(`Couldn't read "${r.at}" as a story time (try "Day 12" or "2026-03-20 18:00")`);
  if (!r.messages && !at) throw badRequest("Say after how many messages, or at what story time");
  return { when: "after", ...(r.messages ? { afterSeq: curSeq(chatId) + r.messages } : {}), ...(at ? { atMinutes: at.minutes } : {}), text: [r.messages ? `${r.messages} messages` : "", r.at?.trim() ?? ""].filter(Boolean).join(" or ") };
}

const fields = {
  label: z.string().trim().min(1).max(300),
  neverSay: z.array(z.string().max(60)).max(30).optional(),
  hintAs: z.string().max(300).optional(),
  hints: z.enum(["never", "rarely", "building"]).optional(),
  reveal: revealInput,
};

offpage.get("/chats/:id/offpage", (c) => {
  mustChat(c.req.param("id"));
  return c.json({ secrets: listOffpage(c.req.param("id")) });
});

offpage.post("/chats/:id/offpage", async (c) => {
  const chatId = c.req.param("id");
  const b = await body(c, z.object({ ...fields, ref: z.string().max(200).optional(), messageId: z.string().optional() }));
  const o = createOffpage(chatId, { ...b, reveal: plan(chatId, b.reveal) });
  // From a selection: a chip on the message, with Undo.
  const filing = b.messageId ? fileItem(chatId, { messageId: b.messageId, kind: "offpage", label: `Off the page: ${o.label.slice(0, 60)}`, data: { offpageId: o.id } }) : null;
  return c.json({ secret: o, filing });
});

offpage.patch("/offpage/:id", async (c) => {
  const o = must(getOffpage(c.req.param("id")), "That secret is gone");
  const b = await body(c, z.object({ ...fields, label: fields.label.optional(), status: z.enum(["kept", "revealed"]).optional() }));
  return c.json({ secret: updateOffpage(o.id, { ...b, reveal: plan(o.chatId, b.reveal) }) });
});

offpage.delete("/offpage/:id", (c) => {
  deleteOffpage(c.req.param("id"));
  return c.json({ ok: true });
});

offpage.post("/offpage/:id/reveal", (c) => c.json({ secret: revealOffpage(c.req.param("id")) }));
offpage.post("/offpage/:id/hold", (c) => c.json({ secret: holdOffpage(c.req.param("id")) }));

/** B2: the exposure clocks of this chat's secrets. */
offpage.get("/chats/:id/exposure", (c) => {
  mustChat(c.req.param("id"));
  return c.json({ secrets: exposureFor(c.req.param("id")) });
});

/** B2: + / −, Raise the stakes (+1 and a cue for the next scene), Cool it down (−1). */
offpage.post("/chats/:id/exposure/:key", async (c) => {
  const b = await body(c, z.object({ delta: z.number().int().min(-6).max(6), how: z.enum(["set", "raise", "cool"]).default("set") }));
  return c.json(nudgeExposure(c.req.param("id"), c.req.param("key"), b.delta, b.how));
});

/** "Never say this": the selected word joins a secret's list. */
offpage.post("/offpage/:id/never-say", async (c) => {
  const b = await body(c, z.object({ word: z.string().trim().min(2).max(60), messageId: z.string().optional() }));
  const o = addNeverSay(c.req.param("id"), b.word);
  const filing = b.messageId ? fileItem(o.chatId, { messageId: b.messageId, kind: "neversay", label: `Never say “${b.word}”`, data: { offpageId: o.id, word: b.word } }) : null;
  return c.json({ secret: o, filing });
});

/** "Reword this sentence" (and D1's "Fix this sentence"): only the quoted sentence changes. */
offpage.post("/continuity/:id/fix", async (c) => {
  const b = await body(c, z.object({ issueId: z.string() }));
  return c.json(await fixIssueSentence(c.req.param("id"), b.issueId));
});

// ---------- C1: the canon cutoff ----------

offpage.get("/chats/:id/canon", (c) => c.json({ canon: canonOf(c.req.param("id")) }));

/** The whole canon cutoff, as the Chat tab's Canon card edits it. */
offpage.put("/chats/:id/canon", async (c) => {
  const b = await body(c, canonSchema);
  return c.json({ canon: setCanon(c.req.param("id"), b) });
});

/** One more "hasn't happened" or "won't happen here" line, typed in. */
offpage.post("/chats/:id/canon/items", async (c) => {
  const id = c.req.param("id");
  const b = await body(c, z.object({ list: z.enum(["later", "wont"]), kind: z.enum(["event", "character", "reveal", "term"]).default("event"), text: z.string().trim().min(1).max(300), terms: z.array(z.string().max(60)).max(12).optional() }));
  const cur = canonOf(id);
  const next = b.list === "later" ? { ...cur, later: [...(cur.later ?? []), laterItem(b.kind, b.text, b.terms ?? [])] } : { ...cur, wont: [...(cur.wont ?? []), { id: crypto.randomUUID().slice(0, 8), text: b.text }] };
  return c.json({ canon: setCanon(id, next) });
});

/** "Suggest from the wiki": in the background; the suggestions arrive in the Inbox. */
offpage.post("/chats/:id/canon/suggest", (c) => c.json({ jobId: queueSuggest(c.req.param("id")) }));
offpage.post("/chats/:id/canon/move/:item", (c) => c.json({ canon: moveCutoff(c.req.param("id"), c.req.param("item")) }));

/** D1: "Make it a lesson": a finding kept as a rule for this story. */
offpage.post("/continuity/:id/lesson", async (c) => {
  const b = await body(c, z.object({ issueId: z.string() }));
  return c.json({ lesson: issueToLesson(c.req.param("id"), b.issueId) });
});

// ---------- E1: hidden pressures ----------

offpage.get("/chats/:id/pressures", (c) => {
  mustChat(c.req.param("id"));
  return c.json({ people: pressuresView(c.req.param("id")) });
});

/** Redraw, Write my own, Lock / Unlock, Bring it to a head, Resolve. */
offpage.post("/chats/:id/pressures/:char", async (c) => {
  const b = await body(c, z.object({ action: z.enum(["redraw", "write", "lock", "unlock", "head", "resolve"]), text: z.string().max(200).optional() }));
  return c.json(pressureAction(c.req.param("id"), c.req.param("char"), b.action, b.text));
});

// ---------- E3: promises on the clock ----------

offpage.get("/chats/:id/promises", (c) => {
  mustChat(c.req.param("id"));
  return c.json({ promises: promisesFor(c.req.param("id")) });
});

/** Kept, Broken, They had a reason, Forgive, or reopen. */
offpage.post("/chats/:id/promises/:pid", async (c) => {
  const b = await body(c, z.object({ verdict: z.enum(["kept", "broken", "excused", "forgiven", "open"]) }));
  return c.json(setPromise(c.req.param("id"), c.req.param("pid"), b.verdict));
});

// ---------- docs/22 5.1: what the story is waiting for ----------

offpage.get("/chats/:id/loops", (c) => {
  mustChat(c.req.param("id"));
  return c.json({ loops: loopsFor(c.req.param("id")) });
});

/** It happened, it's off, or it's open again. */
offpage.post("/chats/:id/loops/:lid", async (c) => {
  const b = await body(c, z.object({ action: z.enum(["done", "dropped", "open"]) }));
  return c.json(setLoop(c.req.param("id"), c.req.param("lid"), b.action));
});
