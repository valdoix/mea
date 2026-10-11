import { z } from "zod";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { cleanText } from "../memory/text";
import { chatNames } from "../memory/build";
import { lane, registerLane } from "../prompt/lanes";
import { getMessageRow, getSwipes, mustChat } from "../services/chats";
import type { JobContext } from "../services/jobs";
import { enqueue } from "../services/jobs";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { registerInboxProvider } from "../accuracy/inbox";
import { canonFor, type Issue, leakGuardOn, registerSheetRules } from "../accuracy/checker";
import { guardsFor } from "../accuracy/guards";
import { type Found, runSlips, slipContext, SLIPS } from "../accuracy/slips";

/**
 * Lessons from swipes (Almanac plan A1). When you swipe past takes and keep one, Mea works out
 * what the takes you passed over got wrong and suggests it as a rule for this story. Three
 * sources: the slip registry's rules (a take that had the dead speak), an optional model
 * comparison of the kept and rejected takes, and your own edits to a reply. Lessons you keep go
 * to the model every turn in the [LESSONS] lane; one that keeps getting broken grows stronger and
 * moves up, and one that hasn't been needed for 200 messages rests and costs nothing.
 */

export type LessonScope = "story" | "character" | "everywhere";
export type LessonStatus = "suggested" | "kept" | "off" | "rejected";

export interface LessonData {
  /** The message seq it was learned at. */
  seq?: number;
  /** The take you kept, and the ones you passed over (their quotes), as evidence. */
  keptIdx?: number;
  kept?: string;
  rejected?: { idx: number; quote: string }[];
  /** The check it came from, so a later slip of the same kind counts as breaking it. */
  slip?: { kind: string; subject?: string };
  /** Per chat: the seq it was last needed at (kept, broken, or first applied there). */
  seen?: Record<string, number>;
  /** Messages already counted as breaking it (so "Check again" doesn't count twice). */
  brokenAt?: string[];
  /** Where the lesson came from: swipes, an edit, you. */
  from?: "swipes" | "edit" | "you" | "meus" | "flag";
}

interface LessonRow {
  id: string;
  chat_id: string | null;
  character_id: string | null;
  scope: string;
  text: string;
  why: string;
  quote: string;
  message_id: string | null;
  status: string;
  strength: number;
  by: string;
  last_broken_seq: number | null;
  data: string;
  created_at: number;
  updated_at: number;
}

export interface Lesson {
  id: string;
  chatId: string | null;
  characterId: string | null;
  scope: LessonScope;
  text: string;
  why: string;
  quote: string;
  messageId: string | null;
  status: LessonStatus;
  strength: number;
  by: "rules" | "model" | "edit" | "user";
  lastBrokenSeq: number | null;
  data: LessonData;
  createdAt: number;
  /** Not needed for 200 messages in this chat: kept, but out of the prompt until it's broken again. */
  resting?: boolean;
}

/** A lesson unneeded for this many messages rests (A1). */
export const REST_AFTER = 200;
/** At this strength a lesson goes in at the very end of the prompt, marked as one that keeps slipping. */
const STRONG = 3;
const MAX_STRENGTH = 5;

const view = (r: LessonRow): Lesson => ({
  id: r.id,
  chatId: r.chat_id,
  characterId: r.character_id,
  scope: r.scope as LessonScope,
  text: r.text,
  why: r.why,
  quote: r.quote,
  messageId: r.message_id,
  status: r.status as LessonStatus,
  strength: r.strength,
  by: r.by as Lesson["by"],
  lastBrokenSeq: r.last_broken_seq,
  data: parseJson<LessonData>(r.data, {}),
  createdAt: r.created_at,
});

export function lessonsMode(chatId: string): "off" | "rules" | "model" {
  return guardsFor(chatId).lessons ?? "rules";
}

const curSeq = (chatId: string) => one<{ s: number | null }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
const changed = (chatId: string | null) => {
  if (chatId) publish({ type: "lessons.changed", chatId });
  publish({ type: "inbox.changed" });
};

export function getLesson(id: string) {
  const r = one<LessonRow>("SELECT * FROM lessons WHERE id = ?", id);
  return r ? view(r) : undefined;
}
const mustLesson = (id: string) => {
  const l = getLesson(id);
  if (!l) throw notFound("That lesson is gone");
  return l;
};

function resting(l: Lesson, chatId: string, seq: number) {
  if (l.status !== "kept") return false;
  // Needed last: kept or first applied here, or (in its own chat) broken or learned.
  const marks = [l.data.seen?.[chatId], l.chatId === chatId ? (l.lastBrokenSeq ?? l.data.seq) : undefined].filter((n): n is number => typeof n === "number");
  return marks.length > 0 && seq - Math.max(...marks) >= REST_AFTER;
}

/**
 * Every lesson that matters in a chat: those that apply to it (this story, its character, every
 * story) and the suggestions learned here, with `resting` worked out for this chat.
 */
export function lessonsFor(chatId: string): Lesson[] {
  const chat = mustChat(chatId);
  const seq = curSeq(chatId);
  return all<LessonRow>(
    `SELECT * FROM lessons WHERE status != 'rejected' AND (chat_id = ? OR (scope = 'character' AND character_id = ?) OR scope = 'everywhere') ORDER BY strength DESC, created_at`,
    chatId,
    chat.character_id ?? "",
  )
    .map(view)
    .filter((l) => l.status !== "suggested" || l.chatId === chatId)
    .map((l) => ({ ...l, resting: resting(l, chatId, seq) }));
}

/** The kept lessons that go to the model in this chat now (not resting, not switched off). */
export function activeLessons(chatId: string) {
  return lessonsFor(chatId).filter((l) => l.status === "kept" && !l.resting);
}

function saveData(id: string, data: LessonData) {
  run("UPDATE lessons SET data = ?, updated_at = ? WHERE id = ?", JSON.stringify(data), now(), id);
}

/** A lesson that applies in a chat for the first time is "seen" there from now (so fading counts from here). */
function markSeen(l: Lesson, chatId: string, seq: number) {
  if (l.data.seen?.[chatId] != null) return;
  saveData(l.id, { ...l.data, seen: { ...(l.data.seen ?? {}), [chatId]: seq } });
}

// ---------- learning ----------

interface Candidate {
  text: string;
  why: string;
  quote: string;
  by: Lesson["by"];
  slip?: { kind: string; subject?: string };
  rejectedIdx?: number;
}

const SUBJECT: Record<string, RegExp> = { dead: /^(.+?) is dead\b/, trait: /^(.+?) has /, leak: /^(.+?) doesn't know/ };
function subjectOf(i: Found) {
  const re = SUBJECT[i.kind];
  return (re ? i.conflict.match(re)?.[1] : undefined) ?? (i.kind === "name" ? i.claim : undefined);
}

/** The rule a slip teaches, in a sentence the model can follow (after Almanac's autopsy `ruleFor`). */
export function ruleFor(i: Found, names: { user: string }): string {
  const who = subjectOf(i);
  switch (i.kind) {
    case "dead":
      return `${who ?? "The dead"} is dead: they don't speak or act on the page (only in memories, dreams, or as a body).`;
    case "puppet":
      return `Never write ${names.user}'s words, actions or decisions; stop where ${names.user} would respond.`;
    case "leak":
      return i.fix.replace(/; they must not reference it\.?$/, ", and must not act as if they do.");
    default:
      return i.fix;
  }
}

const slipKey = (s?: { kind: string; subject?: string }) => (s ? `${s.kind}:${norm(s.subject ?? "")}` : "");

/** What the rules find in one take, with the story state as that reply found it. */
function slipsIn(chatId: string, messageId: string, text: string) {
  const m = getMessageRow(messageId)!;
  let st = null;
  try {
    st = canonFor(chatId, m.seq);
  } catch {
    st = null;
  }
  const ctx = slipContext({ chatId, text, seq: m.seq, messageId, role: m.role, speaker: m.name ?? chatNames(chatId).char, state: st, guards: guardsFor(chatId), continuity: true, leaks: leakGuardOn(chatId) });
  return runSlips(ctx, "reply").filter((i) => i.kind !== "lesson");
}

const words = (s: string) => cleanText(s).split(/\s+/).filter(Boolean).length;

/** The rules source: slips the takes you passed over had and the one you kept didn't, plus length. */
function ruleCandidates(chatId: string, messageId: string, kept: { idx: number; content: string }, rejected: { idx: number; content: string }[]): Candidate[] {
  const names = chatNames(chatId);
  const keptSlips = new Set(slipsIn(chatId, messageId, kept.content).map((i) => slipKey({ kind: i.kind, subject: subjectOf(i) })));
  const out: Candidate[] = [];
  for (const r of rejected) {
    for (const i of slipsIn(chatId, messageId, r.content)) {
      const slip = { kind: i.kind, subject: subjectOf(i) };
      if (keptSlips.has(slipKey(slip))) continue;
      out.push({ text: ruleFor(i, names), why: `A take you swiped past: ${i.conflict}`, quote: i.claim, by: "rules", slip, rejectedIdx: r.idx });
    }
  }
  // Length: every take you passed over ran much longer (or shorter) than the one you kept.
  const kw = words(kept.content);
  if (rejected.length >= 2 && kw >= 40) {
    const rw = rejected.map((r) => words(r.content));
    if (rw.every((w) => w > kw * 1.6)) out.push({ text: `Keep replies short: about ${Math.round(kw / 25) * 25} words, not ${Math.round(Math.min(...rw) / 25) * 25} or more.`, why: `You passed over ${rejected.length} longer takes for a shorter one.`, quote: "", by: "rules", slip: { kind: "length", subject: "shorter" } });
    else if (rw.every((w) => w * 1.6 < kw)) out.push({ text: `Write fuller replies: about ${Math.round(kw / 25) * 25} words.`, why: `You passed over ${rejected.length} shorter takes for a longer one.`, quote: "", by: "rules", slip: { kind: "length", subject: "longer" } });
  }
  return out;
}

const modelSchema = z.object({ lessons: z.array(z.object({ text: z.string(), why: z.string().default(""), quote: z.string().default("") })).default([]) });

/** The model source: a helper compares the takes you passed over with the one you kept. */
async function modelCandidates(chatId: string, kept: string, rejected: { idx: number; content: string }[], job?: JobContext): Promise<Candidate[]> {
  if (shouldShed("lessons")) return [];
  const names = chatNames(chatId);
  const r = await callJson({
    task: "helper",
    kind: "lessons",
    chatId,
    jobId: job?.id,
    name: "lessons_from_swipes",
    schema: modelSchema,
    system: `In a roleplay, the player swiped past one or more takes of a reply and kept another. Work out what the takes they passed over got wrong that the kept one got right, as at most two short, general rules for the rest of this story (for example "${names.char} never apologises first." or "Don't summarise ${names.user}'s feelings for them."). Only rules the evidence clearly supports; none is fine. Quote the passed-over take's words in "quote". Reply with JSON only: {"lessons": [{"text": "…", "why": "…", "quote": "…"}]}`,
    user: `KEPT TAKE:\n${cleanText(kept).slice(0, 3000)}\n\n${rejected.map((r, i) => `PASSED OVER #${i + 1}:\n${cleanText(r.content).slice(0, 2500)}`).join("\n\n")}`,
    maxTokens: 500,
  });
  return r.data.lessons.slice(0, 2).filter((l) => l.text.trim().length >= 8).map((l) => ({ text: l.text.trim().slice(0, 300), why: l.why.trim().slice(0, 300) || "The helper compared your takes.", quote: l.quote.trim().slice(0, 240), by: "model" as const }));
}

/** Files candidates as suggestions, skipping any the story already has (or you said "Not this" to). */
function suggest(chatId: string, messageId: string, cands: Candidate[], data: LessonData): Lesson[] {
  const chat = mustChat(chatId);
  const existing = all<LessonRow>("SELECT * FROM lessons WHERE chat_id = ? OR (scope = 'character' AND character_id = ?) OR scope = 'everywhere'", chatId, chat.character_id ?? "").map(view);
  const texts = new Set(existing.map((l) => norm(l.text)));
  const slips = new Set(existing.map((l) => slipKey(l.data.slip)).filter(Boolean));
  const out: Lesson[] = [];
  const t = now();
  for (const c of cands) {
    if (texts.has(norm(c.text)) || (c.slip && slips.has(slipKey(c.slip)))) continue;
    texts.add(norm(c.text));
    if (c.slip) slips.add(slipKey(c.slip));
    const id = newId();
    const d: LessonData = { ...data, ...(c.slip ? { slip: c.slip } : {}), ...(c.rejectedIdx != null ? { rejected: (data.rejected ?? []).filter((r) => r.idx === c.rejectedIdx) } : {}) };
    run(
      "INSERT INTO lessons (id, chat_id, character_id, scope, text, why, quote, message_id, status, strength, by, data, created_at, updated_at) VALUES (?, ?, ?, 'story', ?, ?, ?, ?, 'suggested', 1, ?, ?, ?, ?)",
      id,
      chatId,
      chat.character_id,
      c.text,
      c.why,
      c.quote,
      messageId,
      c.by,
      JSON.stringify(d),
      t,
      t,
    );
    out.push(getLesson(id)!);
  }
  if (out.length) changed(chatId);
  return out;
}

/**
 * Learns from a reply you swiped and kept. `model`: also ask the helper (the "Rules + model"
 * setting, or "Learn from this swipe" on demand).
 */
export async function learnFromSwipes(chatId: string, messageId: string, opts: { model?: boolean; job?: JobContext } = {}): Promise<Lesson[]> {
  const m = getMessageRow(messageId);
  if (!m || m.deleted_at || m.chat_id !== chatId || m.role !== "assistant") throw notFound("Reply not found");
  const swipes = getSwipes(messageId).filter((s) => s.status === "done" && s.content.trim());
  const kept = swipes.find((s) => s.idx === m.active_swipe);
  const rejected = swipes.filter((s) => s.idx !== m.active_swipe);
  if (!kept || !rejected.length) return [];
  const data: LessonData = { seq: m.seq, keptIdx: kept.idx, kept: cleanText(kept.content).slice(0, 240), rejected: rejected.map((r) => ({ idx: r.idx, quote: cleanText(r.content).slice(0, 240) })), from: "swipes" };
  const cands = ruleCandidates(chatId, messageId, kept, rejected);
  if (opts.model) {
    try {
      cands.push(...(await modelCandidates(chatId, kept.content, rejected, opts.job)));
    } catch (e) {
      opts.job?.note({ lessonsModelError: (e as Error).message.slice(0, 200) });
    }
  }
  return suggest(chatId, messageId, cands, data);
}

const editSchema = z.object({ lesson: z.string().default(""), why: z.string().default("") });

/**
 * Learns from your edit to a reply: what the edit removed that the rules call a slip, or (with the
 * model) the rule behind the edit ("cut her apology" → "Wren doesn't apologise easily").
 */
export async function learnFromEdit(chatId: string, messageId: string, before: string, after: string, opts: { model?: boolean; job?: JobContext } = {}): Promise<Lesson[]> {
  const m = getMessageRow(messageId);
  if (!m || m.role !== "assistant" || before.trim() === after.trim()) return [];
  const names = chatNames(chatId);
  const keptSlips = new Set(slipsIn(chatId, messageId, after).map((i) => slipKey({ kind: i.kind, subject: subjectOf(i) })));
  const cands: Candidate[] = slipsIn(chatId, messageId, before)
    .filter((i) => !keptSlips.has(slipKey({ kind: i.kind, subject: subjectOf(i) })))
    .map((i) => ({ text: ruleFor(i, names), why: `You edited this out: ${i.conflict}`, quote: i.claim, by: "edit" as const, slip: { kind: i.kind, subject: subjectOf(i) } }));
  if (opts.model && !shouldShed("lessons")) {
    try {
      const r = await callJson({
        task: "helper",
        kind: "lessons",
        chatId,
        jobId: opts.job?.id,
        name: "lesson_from_edit",
        schema: editSchema,
        system: `The player edited a roleplay reply by hand. If the edit shows a general rule for the rest of the story (for example cutting an apology → "${names.char} doesn't apologise easily"), state it in one short sentence; if it's only a one-off fix (a typo, a detail), leave "lesson" empty. Reply with JSON only: {"lesson": "…", "why": "…"}`,
        user: `BEFORE:\n${cleanText(before).slice(0, 3000)}\n\nAFTER:\n${cleanText(after).slice(0, 3000)}`,
        maxTokens: 250,
      });
      if (r.data.lesson.trim().length >= 8) cands.push({ text: r.data.lesson.trim().slice(0, 300), why: r.data.why.trim().slice(0, 300) || "From your edit to this reply.", quote: "", by: "edit" });
    } catch (e) {
      opts.job?.note({ lessonsModelError: (e as Error).message.slice(0, 200) });
    }
  }
  return suggest(chatId, messageId, cands, { seq: m.seq, from: "edit" });
}

/** After you send a message: if the reply before it was swiped, learn from the take you kept (in the background). */
export function noteKeptSwipe(chatId: string, userMessageId: string) {
  if (lessonsMode(chatId) === "off") return;
  const u = getMessageRow(userMessageId);
  if (!u) return;
  const prev = one<{ id: string; active_swipe: number }>("SELECT id, active_swipe FROM messages WHERE chat_id = ? AND seq < ? AND role = 'assistant' AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1", chatId, u.seq);
  if (!prev) return;
  const n = one<{ n: number }>("SELECT COUNT(*) AS n FROM swipes WHERE message_id = ? AND status = 'done'", prev.id)?.n ?? 0;
  if (n < 2) return;
  enqueue("lessons.learn", { chatId, messageId: prev.id }, { chatId, delayMs: 1500, dedupeKey: `lessons.learn:${prev.id}:${prev.active_swipe}` });
}

/** After you edit a reply by hand. */
export function noteEdit(chatId: string, messageId: string, before: string, after: string) {
  if (lessonsMode(chatId) === "off" || before.trim() === after.trim()) return;
  enqueue("lessons.edit", { chatId, messageId, before: before.slice(0, 20_000), after: after.slice(0, 20_000) }, { chatId, delayMs: 1500 });
}

export async function runLessonsJob(p: { chatId: string; messageId: string; before?: string; after?: string }, job?: JobContext) {
  const mode = lessonsMode(p.chatId);
  if (mode === "off") return;
  if (p.before != null && p.after != null) await learnFromEdit(p.chatId, p.messageId, p.before, p.after, { model: mode === "model", job });
  else await learnFromSwipes(p.chatId, p.messageId, { model: mode === "model", job });
}

// ---------- your hand ----------

export function addLesson(chatId: string, input: { text: string; scope?: LessonScope; why?: string; by?: Lesson["by"]; messageId?: string | null; from?: LessonData["from"]; slip?: LessonData["slip"] }): Lesson {
  const text = input.text.trim().slice(0, 300);
  if (!text) throw badRequest("Write the lesson first");
  const chat = mustChat(chatId);
  const id = newId();
  const t = now();
  const seq = curSeq(chatId);
  run(
    "INSERT INTO lessons (id, chat_id, character_id, scope, text, why, quote, message_id, status, strength, by, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '', ?, 'kept', 1, ?, ?, ?, ?)",
    id,
    chatId,
    chat.character_id,
    input.scope ?? "story",
    text,
    input.why?.slice(0, 300) ?? "",
    input.messageId ?? null,
    input.by ?? "user",
    JSON.stringify({ seq, seen: { [chatId]: seq }, from: input.from ?? "you", ...(input.slip ? { slip: input.slip } : {}) } satisfies LessonData),
    t,
    t,
  );
  changed(chatId);
  return getLesson(id)!;
}

/** Keep, edit, switch off or on, rescope. Keeping (or switching on) counts as needed now. */
export function updateLesson(id: string, patch: { text?: string; scope?: LessonScope; status?: Exclude<LessonStatus, "suggested">; chatId?: string }) {
  const l = mustLesson(id);
  const text = patch.text?.trim().slice(0, 300) || l.text;
  const status = patch.status ?? l.status;
  const scope = patch.scope ?? l.scope;
  run("UPDATE lessons SET text = ?, scope = ?, status = ?, updated_at = ? WHERE id = ?", text, scope, status, now(), id);
  const where = patch.chatId ?? l.chatId;
  if (where && status === "kept" && l.status !== "kept") {
    const seq = curSeq(where);
    saveData(id, { ...l.data, seen: { ...(l.data.seen ?? {}), [where]: seq } });
  }
  changed(where);
  return getLesson(id)!;
}

export function deleteLesson(id: string) {
  const l = mustLesson(id);
  run("DELETE FROM lessons WHERE id = ?", id);
  changed(l.chatId);
}

// ---------- after each reply: kept lessons broken ----------

/**
 * The "Broken lesson" check (slip `lesson`): a kept lesson learned from a slip is broken when the
 * reply makes that slip again. Each break makes the lesson stronger (it moves up the prompt) and
 * wakes it if it was resting.
 */
export function brokenLessons(chatId: string, messageId: string | undefined, seq: number, found: Found[], recheck: (kind: string) => Found[]): Found[] {
  const kept = lessonsFor(chatId).filter((l) => l.status === "kept" && l.data.slip && l.data.slip.kind !== "length");
  if (!kept.length) return [];
  const byKind = new Map<string, Found[]>();
  const issuesOf = (kind: string) => {
    if (!byKind.has(kind)) byKind.set(kind, found.some((f) => f.kind === kind) ? found.filter((f) => f.kind === kind) : recheck(kind));
    return byKind.get(kind)!;
  };
  const out: Found[] = [];
  for (const l of kept) {
    const slip = l.data.slip!;
    const hit = issuesOf(slip.kind).find((i) => slipKey({ kind: i.kind, subject: subjectOf(i) }) === slipKey(slip));
    if (!hit) continue;
    out.push({
      kind: "lesson",
      severity: l.strength >= STRONG ? "major" : "minor",
      claim: hit.claim,
      conflict: `This breaks a lesson you kept: ${l.text}`,
      citations: [{ ref: "R", type: "lesson", label: l.text.slice(0, 120), id: l.id }],
      fix: l.text,
      by: "rules",
    });
    if (messageId && !(l.data.brokenAt ?? []).includes(messageId)) {
      run("UPDATE lessons SET strength = ?, last_broken_seq = ?, updated_at = ? WHERE id = ?", Math.min(MAX_STRENGTH, l.strength + 1), seq, now(), l.id);
      saveData(l.id, { ...l.data, brokenAt: [...(l.data.brokenAt ?? []), messageId].slice(-20), seen: { ...(l.data.seen ?? {}), [chatId]: seq } });
      changed(chatId);
    }
  }
  return out;
}

SLIPS.push({
  id: "lesson",
  label: "Broken lessons",
  description: "A reply making a slip you kept a lesson about.",
  phase: "reply",
  on: (c) => c.role === "assistant",
  run: (_t, _s, c) =>
    brokenLessons(c.chatId, c.messageId, c.seq, c.found ?? [], (kind) => {
      const s = SLIPS.find((x) => x.id === kind);
      if (!s || !s.on({ ...c, continuity: true })) return [];
      try {
        return s.run(c.text, c.state, { ...c, continuity: true });
      } catch {
        return [];
      }
    }),
});

// The helper pass re-reads kept lessons too, when lessons use the model.
registerSheetRules((chatId) => (lessonsMode(chatId) === "model" ? activeLessons(chatId).slice(0, 10).map((l) => ({ type: "lesson" as const, label: l.text.slice(0, 120), id: l.id, text: l.text })) : []));

// ---------- the [LESSONS] lane ----------

registerLane("lessons", (ctx) => {
  if (ctx.kind !== "story" && ctx.kind !== "continue") return null;
  const seq = curSeq(ctx.chatId);
  const list = activeLessons(ctx.chatId).slice(0, 12);
  if (!list.length) return null;
  for (const l of list) markSeen(l, ctx.chatId, seq);
  const strong = list.some((l) => l.strength >= STRONG);
  return lane(
    "lessons",
    null,
    `Rules this story has learned from the player's choices. Follow every one:\n${list.map((l) => `- ${l.strength >= STRONG ? "(keeps slipping, take care) " : ""}${l.text}`).join("\n")}`,
    { depth: strong ? 0 : 1 },
  );
});

// ---------- the Inbox: suggested lessons wait there too ----------

registerInboxProvider({
  kind: "lesson",
  source: "lesson",
  items: (chats) => {
    const ids = chats.map((c) => c.id);
    if (!ids.length) return [];
    return all<LessonRow>(`SELECT * FROM lessons WHERE status = 'suggested' AND chat_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at DESC LIMIT 200`, ...ids).map((r) => {
      const l = view(r);
      const seq = l.data.seq;
      return {
        key: `lesson:${l.id}`,
        chatId: l.chatId!,
        chatTitle: "",
        title: `A lesson${l.data.from === "edit" ? " from your edit" : " from your swipes"}${seq ? ` (#${seq})` : ""}`,
        why: [l.why, l.quote ? `“${l.quote}”` : ""].filter(Boolean).join(" "),
        before: null,
        after: l.text,
        editable: true,
        createdAt: l.createdAt,
        link: `/chat/${l.chatId}`,
      };
    });
  },
  act: (id, action, edited) => {
    const l = getLesson(id);
    if (!l) throw notFound("That lesson is gone");
    updateLesson(id, action === "accept" ? { status: "kept", ...(edited ? { text: edited } : {}) } : { status: "rejected" });
    return l.chatId;
  },
});

export type { Issue };
