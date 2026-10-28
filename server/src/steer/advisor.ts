import { publish } from "../lib/events";
import { z } from "zod";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { defaultSteer, getSetting, memoryConfig, type SteerConfig } from "../lib/settings";
import { chatNames } from "../memory/build";
import { memState, storyRow } from "../memory/store";
import { cleanText, hashText } from "../memory/text";
import type { HistoryMessage, PromptExtra } from "../prompt/assemble";
import { type ChatSettings, historyForPrompt, mustChat } from "../services/chats";
import { activeGuidance } from "../services/chattools";
import { type PersonaMode, storyDials } from "../services/layers";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { trackerPrompt } from "../trackers/service";
import { gatherLanes } from "../prompt/lanes";
import { PLANNING } from "../prompt/mea";
import { foldAt } from "../trackers/store";
import { correctMemory } from "../accuracy/corrections";
import { countTokens } from "../lib/tokens";
import { buildMemoryContext, memoryInputs } from "../memory/context";
import { revealsOf } from "../trackers/reveals";
import { beatNames, todayText } from "../trackers/today";
import type { WorldState } from "../trackers/types";

/**
 * The advisor ("council-lite", STEER-01): before a reply, a helper model writes a short private
 * plan (the direction, beats to hit, threads worth touching, continuity reminders) that goes into
 * the prompt as guidance. It runs while you type, so sending usually finds the plan waiting.
 * It sees its own last few plans (STEER-02), so longer plotting stays coherent.
 */

export function steerFor(chatId: string): SteerConfig & { advisorOn: boolean; planner: boolean; plannerProfileId: string | null } {
  const cfg = { ...defaultSteer, ...getSetting("steer.config") };
  const s = parseJson<ChatSettings>(mustChat(chatId).settings, {});
  // H3: a separate planner is the advisor grown up: it always runs when the chat asks for it.
  const planner = s.planning === "planner";
  return { ...cfg, advisorOn: planner || (s.advisor ?? cfg.advisor), editor: s.editor ?? cfg.editor, planner, plannerProfileId: s.plannerProfileId ?? null };
}

/** H3: how long the writer waits for the planner before planning for itself. */
export const PLANNER_WAIT_S = 20;

export const planSchema = z.object({
  direction: z.string().default(""),
  beats: z.array(z.string()).default([]),
  threads: z.array(z.string()).default([]),
  reminders: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  /** H3: the separate planner's whole planning pass (fragments), which the writer follows. */
  pass: z.string().default(""),
});
export type Plan = z.infer<typeof planSchema>;

/**
 * Which turn a plan is for: the message the reply answers plus the user's words. While you type,
 * the draft stands in for the message you're about to send, so the key matches once you send it.
 * A note for the reply (a regenerate with notes) gets a plan of its own: the plan for the take
 * you passed over doesn't know what the note says.
 */
export function turnKey(history: HistoryMessage[], draft?: string, note?: string) {
  const base = turnBase(history, draft);
  return note?.trim() ? `${base}|note:${hashText(note.trim())}` : base;
}

function turnBase(history: HistoryMessage[], draft?: string) {
  if (draft !== undefined) return `${history.at(-1)?.id ?? "start"}|${hashText(draft.trim())}`;
  const last = history.at(-1);
  if (last?.role === "user") {
    // The words as you typed them (the prompt's copy may be wrapped as a stage direction or changed by regex).
    const raw = one<{ content: string }>("SELECT s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.id = ?", last.id)?.content ?? last.content;
    return `${history.at(-2)?.id ?? "start"}|${hashText(raw.trim())}`;
  }
  return `${last?.id ?? "start"}|${hashText("")}`;
}

interface PlanRow {
  id: string;
  chat_id: string;
  key: string;
  plan: string;
  used_at: number | null;
  generation_id: string | null;
  created_at: number;
}

export function planFor(chatId: string, key: string): Plan | null {
  const r = one<PlanRow>("SELECT * FROM advisor_plans WHERE chat_id = ? AND key = ?", chatId, key);
  return r ? parseJson<Plan>(r.plan, planSchema.parse({})) : null;
}

/** With `played`, only the plans a reply was written from (not the drafts made while you typed, nor a passed-over take's). */
export function recentPlans(chatId: string, limit = 10, opts: { played?: boolean } = {}) {
  const played = opts.played ? " AND used_at IS NOT NULL" : "";
  return all<PlanRow>(`SELECT * FROM advisor_plans WHERE chat_id = ?${played} ORDER BY created_at DESC LIMIT ?`, chatId, limit).map((r) => ({
    id: r.id,
    plan: parseJson<Plan>(r.plan, planSchema.parse({})),
    used: r.used_at != null,
    generationId: r.generation_id,
    createdAt: r.created_at,
  }));
}

const running = new Map<string, Promise<Plan | null>>();
/** L10: while you type, one plan at a time per chat, and a pause between plans for the same turn (not one per typing pause). */
const draftStarted = new Map<string, number>();
const DRAFT_GAP_MS = 15_000;

/** What the plan may say about the player's character: the Persona control's rule (sealed when unset). */
const userRule = (user: string, persona: PersonaMode | null) =>
  persona === "full_cast"
    ? `${user} is yours to plan too, true to who they are and to the player's latest direction`
    : persona === "director"
      ? `plan ${user} only inside what the player directed this turn`
      : `never decide what ${user} does, says, thinks or feels`;

/**
 * Earlier plans are beats the story already played. Told only to "stay consistent" with them, the
 * planner staged the same discovery reply after reply (Dawn finding Buffy's hands, three times).
 */
const PLAYED_RULE =
  "Your earlier plans were already written into the story: what they planned has happened, so build on it and never stage it again (a discovery, confession or reaction that already played stays played). Pick up where the last reply ended, and follow the player's latest message even where it moves past your earlier plans. When someone retells or brings up something that already happened (the story promised at dinner, last night's fight), it happened where, when and how the story shows it: take it from TODAY SO FAR, WHERE THE OPEN PROMISES WERE MADE or the messages, never from a guess or a character's own loose recollection";

/** A text's content words, stemmed loosely ("jealousy" and "jealous" meet), for telling what a promise is about. */
const words = (s: string) => (s.toLowerCase().match(/\p{L}{4,}/gu) ?? []).map((w) => w.slice(0, 6));

/** How much of each promise's moment the planner reads: your message that led to it, and the reply it was made in. */
const ORIGIN_ASK_CHARS = 700;
const ORIGIN_REPLY_CHARS = 1800;
const ORIGIN_MAX = 3;

/**
 * Where each open promise was made, for the ones the recent messages no longer show. Told only
 * "Buffy promised to tell Dawn about the jealousy question", the planner made the question up
 * and put it in the kitchen that morning; it was asked in the car, before the faucet.
 */
export function promiseOrigins(state: WorldState, history: HistoryMessage[], names: { char: string; user: string }, shownFrom: number, focus = "") {
  const nm = (id?: string) => (!id ? "someone" : state.chars[id]?.isUser ? names.user : (state.chars[id]?.name ?? id));
  const speaker = (m: HistoryMessage) => (m.role === "user" ? names.user : m.role === "assistant" ? names.char : "Note");
  // The promises the latest messages are about come first ("the jealousy story"), then the ones falling due, then the newest.
  const said = new Set(words(focus));
  const now = state.time?.minutes ?? null;
  const rank = (o: WorldState["obligations"][string]) => {
    const about = words(o.what).filter((w) => said.has(w)).length;
    const due = o.status === "due" || (o.due?.minutes != null && now != null && o.due.minutes - now <= 1440) ? 1 : 0;
    return about * 2 + due;
  };
  const open = Object.values(state.obligations)
    .filter((o) => (o.status === "open" || o.status === "due") && o.seq < shownFrom)
    .sort((a, b) => rank(b) - rank(a) || b.seq - a.seq)
    .slice(0, ORIGIN_MAX);
  const out: string[] = [];
  for (const o of open) {
    const i = history.findIndex((m) => m.seq === o.seq);
    if (i < 0) continue;
    const made = history[i]!;
    const ask = made.role !== "user" ? history.slice(0, i).findLast((m) => m.role === "user") : undefined;
    const lines = [`- ${nm(o.who)} promised ${nm(o.whom)}: ${o.what}`];
    if (ask) lines.push(`  ${speaker(ask)}: ${excerpt(cleanText(ask.content), ORIGIN_ASK_CHARS)}`);
    lines.push(`  ${speaker(made)}: ${excerpt(cleanText(made.content), ORIGIN_REPLY_CHARS)}`);
    out.push(lines.join("\n"));
  }
  return out;
}

/**
 * A message as the planner reads it: whole when it fits, else its opening and its ending, since
 * how a reply ends is where the next one starts (the old cut kept only the first 1200 characters,
 * so a long reply's last beats never reached the planner, and it planned them again).
 */
export function excerpt(text: string, max: number) {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.35);
  return `${text.slice(0, head).trimEnd()}\n[…]\n${text.slice(text.length - (max - head)).trimStart()}`;
}

/** The newest two messages (the last reply and your answer) are read near whole; older ones, cut. */
const RECENT_LAST_CHARS = 9000;
const RECENT_OLDER_CHARS = 1500;

const ADVISOR_SYSTEM =(char: string, user: string, persona: PersonaMode | null) => `You are the private story advisor for an ongoing roleplay between ${char} (written by the AI) and ${user} (the player's character). Before ${char}'s next reply, you write a short plan the writer will follow loosely. The player never sees it.

Plan the NEXT reply only:
- "direction": one or two sentences: where this reply should take the scene, in response to what ${user} just did or said.
- "beats": 2–4 concrete beats to hit, in order. Small and specific; leave room for ${user} to act.
- "threads": up to 2 open threads, promises or secrets worth touching now (only if it fits naturally).
- "reminders": continuity facts the reply must respect (time, place, injuries, who knows what).
- "avoid": up to 3 things to avoid (repeating earlier beats, rushing, an echo of the last reply).
${PLAYED_RULE}; ${userRule(user, persona)}.
Reply with JSON only: {"direction":"…","beats":["…"],"threads":["…"],"reminders":["…"],"avoid":["…"]}`;

/**
 * H3: the separate planner gets Mea's full planning pass (prompt/mea.ts), resolved for this chat:
 * the same steps the writer would run in its <think>, so the writer only writes the prose.
 */
export function plannerSteps(user: string, sealed: boolean) {
  const lines = PLANNING.split("\n").filter((l) => /^(NOW|SEAL|KNOW|MINDS|WORLD|MOVE|RISK|VOICE|STOP RULE)\b/.test(l));
  return lines
    .join("\n")
    .replace(/\{\{if userSealed\}\}(.*?)\{\{else\}\}(.*?)\{\{\/if\}\}/g, (_, a: string, b: string) => (sealed ? a : b))
    .replace(/\{\{if [^}]*\}\}.*?\{\{\/if\}\}/g, "")
    .replace(/\{\{user\}\}/g, user)
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/[ \t]+/g, " ");
}

const PLANNER_SYSTEM = (char: string, user: string, persona: PersonaMode | null) => `You are the director of an ongoing roleplay between ${char} (written by the AI) and ${user} (the player's character). Before ${char}'s next reply, you run the planning pass below; a separate writer then writes only the prose from your plan. The player never sees it.

The planning pass, step by step (fragments, not prose; never draft a line of the reply):
${plannerSteps(user, persona !== "full_cast" && persona !== "director")}

You plan; you never write. The writer chooses every word, image and line of dialogue, so the plan says WHAT happens, never HOW it reads:
- no quoted dialogue, not even part of a line: "she asks why he went alone", never "she asks 'why did you go alone'";
- no imagery, metaphor or sensory description: "her composure cracks", never "her jaw does the soft twitch she can't control";
- each beat is one fragment of 15 words at most: "she grips his hand, then lets go", never a paragraph;
- no self-talk, no "Wait", no checking your own work: the pass is the labelled lines and nothing else.

${PLAYED_RULE}; ${userRule(user, persona)}.
Reply with JSON only: {"pass":"the whole pass as labelled lines, NOW — … through VOICE — … (never a one-word tag)","direction":"one sentence","beats":["2–4 short fragments, in order"],"threads":["…"],"reminders":["…"],"avoid":["…"]}`;

/** Planner beats longer than this are cut at a clause boundary (GLM writes paragraphs whatever it's told). */
const BEAT_MAX_WORDS = 20;

/**
 * Quoted speech of four or more words: a drafted line of the reply. Single quotes skip apostrophes
 * inside words ("didn't"); shorter quotes are names and terms ("black box").
 */
const QUOTED = /"([^"\n]+)"|“([^”\n]+)”|(?<!\w)'((?:[^'\n]|(?<=\w)'(?=\w))+?)'(?!\w)|‘([^’\n]+)’/g;
const unquote = (s: string) => s.replace(QUOTED, (m, a, b, c, d) => ((a ?? b ?? c ?? d) as string).trim().split(/\s+/).length >= 4 ? "(in their own words)" : m);

function clip(beat: string) {
  const words = beat.trim().split(/\s+/);
  if (words.length <= BEAT_MAX_WORDS) return beat.trim();
  const head = words.slice(0, BEAT_MAX_WORDS).join(" ");
  const cut = Math.max(head.lastIndexOf(" — "), head.lastIndexOf(";"), head.lastIndexOf(","));
  return (cut > head.length / 3 ? head.slice(0, cut) : head).replace(/[\s,;—–-]+$/, "");
}

/**
 * The separate planner's plan with the drafting taken out: quoted lines go, beats are cut to a
 * fragment, and a pass that isn't the labelled steps (a tag like "normal", or self-talk) is dropped,
 * so the writer plans for itself from the beats instead of following it.
 */
export function undraft(p: Plan): Plan {
  const pass = unquote(p.pass).trim();
  return {
    ...p,
    pass: /^(NOW|MOVE)\b/m.test(pass) ? pass : "",
    direction: unquote(p.direction),
    beats: p.beats.map((b) => clip(unquote(b))).filter(Boolean),
  };
}

/** docs/19 1.1: how much of the Story So Far (its newest chapters) and of the lanes the planner reads, in tokens. */
const STORY_TOKENS = 1500;
const LANES_TOKENS = 2500;
const RECALL_TOKENS = 2500;

/** The newest chapters (paragraphs, in a story with no headings) that fit, whole: the planner plans the next beat, so the latest past matters most. */
export function newestChapters(text: string, budget: number) {
  const byHeading = text.split(/\n(?=#{2,3} )/);
  const sep = byHeading.length > 1 ? "\n" : "\n\n";
  const chapters = byHeading.length > 1 ? byHeading : text.split(/\n{2,}/);
  const kept: string[] = [];
  let used = 0;
  for (const c of chapters.reverse()) {
    const t = countTokens(c);
    if (used + t > budget && kept.length) break;
    kept.unshift(c);
    used += t;
  }
  return kept.join(sep);
}

/** Whole pieces in order while they fit; one that doesn't is left out, never cut mid-line. */
function wholeFit(pieces: string[], budget: number) {
  const kept: string[] = [];
  let used = 0;
  for (const p of pieces) {
    const t = countTokens(p);
    if (used + t > budget) continue;
    kept.push(p);
    used += t;
  }
  return kept;
}

/** The recalled memories the writer would get for this turn (CANON 4), for the planner's KNOW step. */
async function planRecall(chatId: string, history: HistoryMessage[], state: WorldState, draft?: string) {
  if (!memoryConfig().enabled) return "";
  try {
    const names = chatNames(chatId);
    const inputs = await memoryInputs(chatId, { history, draft, chatMode: mustChat(chatId).mode, state, names });
    // The window as it stands: more room would bring old scenes back, and recall only searches what has left it.
    const evicted = memState(chatId).evictedThrough;
    const window = history.reduce((n, h) => ((h.seq ?? 0) > evicted ? n + countTokens(h.content) : n), 0);
    const m = buildMemoryContext({ chatId, history, available: window, target: Math.round(RECALL_TOKENS / Math.max(0.01, memoryConfig().budget.recall)), inputs, seed: `${chatId}:plan`, reveals: revealsOf(state) });
    return correctMemory(state, m.recall, "recalled memories").text.trim();
  } catch (e) {
    console.error("[mea] the planner's recall failed:", (e as Error).message);
    return "";
  }
}

/**
 * The planner's input. It reads the story state as the writer does (docs/19 1.3): the fold before the
 * take being replaced, and the facts the player's message touches; the note whole (it fits its own
 * budget by lane), never cut at a length mid-line.
 */
export async function advisorInput(chatId: string, history: HistoryMessage[], draft: string | undefined, cfg: SteerConfig & { planner?: boolean }, note?: string, excludeMessageId?: string) {
  const names = chatNames(chatId);
  const parts: string[] = [];
  const story = storyRow(chatId);
  if (story?.content) parts.push(`STORY SO FAR (its latest chapters):\n${newestChapters(story.content, STORY_TOKENS)}`);
  try {
    const focus = [draft?.trim() || history.findLast((m) => m.role === "user")?.content, note].filter(Boolean).join("\n");
    const tp = trackerPrompt(chatId, { kind: "story", excludeMessageId, focus });
    if (tp.note?.text) parts.push(`STORY STATE:\n${tp.note.text}`);
    const st = tp.state;
    if (cfg.planner) {
      const recall = await planRecall(chatId, history, st, draft);
      if (recall) parts.push(`WHAT HAPPENED EARLIER THAT MAY MATTER NOW (recalled memories; the past, never to be staged again):\n${recall}`);
    }
    const open = Object.values(st.threads)
      .filter((t) => t.status !== "resolved")
      .sort((a, b) => b.lastSeq - a.lastSeq)
      .map((t) => `${t.title}${t.status === "stalled" ? " (stalled)" : ""}${t.latest ? `: ${t.latest}` : ""}`)
      .slice(0, 8);
    if (open.length) parts.push(`OPEN THREADS:\n${open.map((t) => `- ${t}`).join("\n")}`);
    const origins = promiseOrigins(st, history, names, history.at(-8)?.seq ?? Infinity, [...history.slice(-2).map((m) => m.content), focus].join("\n"));
    if (origins.length) parts.push(`WHERE THE OPEN PROMISES WERE MADE (what was said then; the past, as it happened):\n${origins.join("\n\n")}`);
    // docs/20 1.2: the day in order, so a plan that retells today places it where it happened.
    const today = todayText(st, beatNames(chatId, st));
    if (today) parts.push(`TODAY SO FAR:\n${today}`);
  } catch {
    // trackers are optional
  }
  const prev = recentPlans(chatId, cfg.advisorMemory, { played: true }).reverse();
  if (prev.length) parts.push(`YOUR EARLIER PLANS, ALREADY PLAYED IN THE STORY (oldest first):\n${prev.map((p, i) => `${i + 1}. ${p.plan.direction}${p.plan.beats.length ? ` Beats: ${p.plan.beats.join("; ")}` : ""}`).join("\n")}`);
  const chat = mustChat(chatId);
  const s = parseJson<ChatSettings>(chat.settings, {});
  const steering = [s.pacing ? `pace: ${s.pacing}` : "", s.length ? `length: ${s.length}` : "", ...activeGuidance(s, chat.character_id, null).map((g) => g.text), s.cue ? `cue for this reply: ${s.cue}` : ""].filter(Boolean);
  if (steering.length) parts.push(`THE PLAYER'S STEERING:\n${steering.map((x) => `- ${x}`).join("\n")}`);
  const last8 = history.slice(-8);
  const recent = last8.map((m, i) => `${m.role === "user" ? names.user : m.role === "assistant" ? names.char : "Note"}: ${excerpt(cleanText(m.content), i >= last8.length - 2 ? RECENT_LAST_CHARS : RECENT_OLDER_CHARS)}`);
  parts.push(`RECENT MESSAGES:\n${recent.join("\n\n")}`);
  if (draft?.trim()) parts.push(`${names.user.toUpperCase()} IS ABOUT TO SAY:\n${draft.trim().slice(0, 2000)}`);
  if (cfg.planner) {
    // H3: the planner also sees the lanes (lessons, canon, pressures, promises…) the writer would.
    try {
      const st = foldAt(chatId, { excludeMessageId }).state;
      // TODAY SO FAR is already above, whole.
      const lanes = wholeFit(gatherLanes({ chatId, kind: "story", state: st, history, characterId: chat.character_id ?? "" }).filter((l) => l.lane !== "today").map((l) => l.content.trim()).filter(Boolean), LANES_TOKENS);
      if (lanes.length) parts.push(`WHAT MEA'S FEATURES ADD THIS TURN:\n${lanes.join("\n\n")}`);
    } catch {
      // lanes are optional
    }
    return { system: PLANNER_SYSTEM(names.char, names.user, storyDials(chat).persona), user: parts.join("\n\n") };
  }
  return { system: ADVISOR_SYSTEM(names.char, names.user, storyDials(chat).persona), user: parts.join("\n\n") };
}

/** Writes (or returns the cached) plan for a turn. Never throws: no plan just means no guidance. */
export async function runAdvisor(chatId: string, opts: { history?: HistoryMessage[]; draft?: string; note?: string; signal?: AbortSignal; excludeMessageId?: string } = {}): Promise<Plan | null> {
  const cfg = steerFor(chatId);
  if (!cfg.advisorOn || shouldShed("advisor", chatId)) return null;
  const history = opts.history ?? historyForPrompt(chatId);
  const key = turnKey(history, opts.draft, opts.note);
  const cached = planFor(chatId, key);
  if (cached) return cached;
  const inflight = running.get(`${chatId}:${key}`);
  if (inflight) return inflight;
  if (opts.draft !== undefined) {
    const turn = `${chatId}:${key.split("|")[0]}`;
    const busy = [...running.keys()].some((k) => k.startsWith(`${chatId}:`));
    if (busy || Date.now() - (draftStarted.get(turn) ?? 0) < DRAFT_GAP_MS) return null;
    if (draftStarted.size > 500) draftStarted.clear();
    draftStarted.set(turn, Date.now());
  }
  const p = (async () => {
    try {
      const { system, user } = await advisorInput(chatId, history, opts.draft, cfg, opts.note, opts.excludeMessageId);
      const r = cfg.planner
        ? await callJson({ task: "planner", kind: "planner", chatId, name: "planner_plan", schema: planSchema, system, user, maxTokens: 1800, temperature: 0.5, signal: opts.signal, profileId: cfg.plannerProfileId })
        : await callJson({ task: "helper", kind: "advisor", chatId, name: "advisor_plan", schema: planSchema, system, user, maxTokens: 700, temperature: 0.6, signal: opts.signal });
      const plan = cfg.planner ? undraft(r.data) : r.data;
      run("INSERT OR REPLACE INTO advisor_plans (id, chat_id, key, plan, created_at) VALUES (?, ?, ?, ?, ?)", newId(), chatId, key, JSON.stringify(plan), now());
      // Keep a short history per chat.
      run("DELETE FROM advisor_plans WHERE chat_id = ? AND id NOT IN (SELECT id FROM advisor_plans WHERE chat_id = ? ORDER BY created_at DESC LIMIT 40)", chatId, chatId);
      return plan;
    } catch (e) {
      console.error("[mea] advisor failed:", (e as Error).message);
      return null;
    } finally {
      running.delete(`${chatId}:${key}`);
    }
  })();
  running.set(`${chatId}:${key}`, p);
  return p;
}

/**
 * Mandatory planning's last resort: the writer skipped its pass twice (its plan step came back empty
 * between), so the planner model, or the helper it borrows, writes the pass for this reply. Runs
 * whether or not the chat uses a separate planner, and isn't kept as the chat's plan. Null when it fails too.
 */
export async function rescuePlan(chatId: string, history: HistoryMessage[], signal?: AbortSignal, excludeMessageId?: string): Promise<string | null> {
  try {
    const cfg = steerFor(chatId);
    const { system, user } = await advisorInput(chatId, history, undefined, { ...cfg, planner: true }, undefined, excludeMessageId);
    const r = await callJson({ task: "planner", kind: "planner", chatId, name: "planner_plan", schema: planSchema, system, user, maxTokens: 1800, temperature: 0.5, signal, profileId: cfg.plannerProfileId });
    return undraft(r.data).pass.trim() || null;
  } catch (e) {
    console.error("[mea] the rescue plan failed:", (e as Error).message);
    return null;
  }
}

/** H3: the separate planner's plan, as the writer gets it: the pass is done, so it writes only the prose. */
export function directorPlanText(p: Plan) {
  const body = [p.pass.trim(), p.direction ? `Direction: ${p.direction}` : "", p.beats.length ? `Beats:\n${p.beats.map((b) => `- ${b}`).join("\n")}` : "", p.reminders.length ? `Keep straight: ${p.reminders.join("; ")}` : "", p.avoid.length ? `Avoid: ${p.avoid.join("; ")}` : ""].filter(Boolean).join("\n");
  return `<director-plan>\n${body}\n</director-plan>\nThe planning pass for this reply is done, above. Don't plan again and don't open with <think>: write only the reply, following the plan; never mention it. The plan says what happens: every word, image and line of dialogue is yours.`;
}

export function planText(p: Plan) {
  const lines = [
    "[Private plan for this reply, from the story advisor. Follow it loosely; never mention it.]",
    p.direction ? `Direction: ${p.direction}` : "",
    p.beats.length ? `Beats:\n${p.beats.map((b) => `- ${b}`).join("\n")}` : "",
    p.threads.length ? `Threads worth touching: ${p.threads.join("; ")}` : "",
    p.reminders.length ? `Keep straight: ${p.reminders.join("; ")}` : "",
    p.avoid.length ? `Avoid: ${p.avoid.join("; ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * The plan for the reply being prepared. With `wait`, a plan that isn't ready yet is waited for
 * up to the configured few seconds; without it (the inspector's preview), only a ready plan is used.
 */
export async function advisorExtra(chatId: string, history: HistoryMessage[], opts: { wait: boolean; note?: string; excludeMessageId?: string }): Promise<(PromptExtra & { planner?: boolean; pass?: string }) | null> {
  const cfg = steerFor(chatId);
  if (!cfg.advisorOn) return null;
  const note = opts.note?.trim() || undefined;
  const key = turnKey(history, undefined, note);
  let plan = planFor(chatId, key);
  // H3: the planner gets a longer budget; if it's late or fails, the writer plans for itself.
  const wait = cfg.planner ? PLANNER_WAIT_S : cfg.advisorWait;
  if (!plan && opts.wait && wait > 0) {
    publish({ type: "gen.prep", chatId, stage: "planning" });
    plan = await Promise.race([runAdvisor(chatId, { history, note, excludeMessageId: opts.excludeMessageId }), Bun.sleep(wait * 1000).then(() => null)]);
  }
  // L10: no plan for the words as sent: the newest one written for this turn while you typed will do
  // (never one that didn't hear the note, or heard another).
  if (!plan && !note) {
    const r = one<PlanRow>("SELECT * FROM advisor_plans WHERE chat_id = ? AND key LIKE ? AND key NOT LIKE '%|note:%' ORDER BY created_at DESC LIMIT 1", chatId, `${key.split("|")[0]}|%`);
    if (r) plan = parseJson<Plan>(r.plan, planSchema.parse({}));
  }
  if (!plan) return null;
  if (cfg.planner && plan.pass.trim()) return { id: "advisor", name: "Director's plan", content: directorPlanText(plan), depth: 0, planner: true, pass: plan.pass.trim() };
  return { id: "advisor", name: "Advisor's plan", content: planText(plan), depth: 0 };
}

/**
 * H3: "Edit the plan and regenerate": the plan a reply was written with is replaced by your edit,
 * and kept unused so the regenerated take (the same turn) is written from it.
 */
export function editPlan(chatId: string, generationId: string, text: string, key?: string) {
  const plan: Plan = planSchema.parse({ pass: text.trim().slice(0, 6000) });
  const row = one<PlanRow>("SELECT * FROM advisor_plans WHERE chat_id = ? AND generation_id = ?", chatId, generationId);
  if (row) run("UPDATE advisor_plans SET plan = ?, used_at = NULL, generation_id = NULL WHERE id = ?", JSON.stringify(plan), row.id);
  else if (key) run("INSERT OR REPLACE INTO advisor_plans (id, chat_id, key, plan, created_at) VALUES (?, ?, ?, ?, ?)", newId(), chatId, key, JSON.stringify(plan), now());
  else return false;
  return true;
}

/** STEER-02: the plan a reply was written with counts as used, so later plans can build on it. */
export function markPlanUsed(chatId: string, key: string, generationId: string) {
  run("UPDATE advisor_plans SET used_at = ?, generation_id = ? WHERE chat_id = ? AND key = ?", now(), generationId, chatId, key);
}
