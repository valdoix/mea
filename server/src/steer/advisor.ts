import { z } from "zod";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { defaultSteer, getSetting, type SteerConfig } from "../lib/settings";
import { chatNames } from "../memory/build";
import { storyRow } from "../memory/store";
import { cleanText, hashText } from "../memory/text";
import type { HistoryMessage, PromptExtra } from "../prompt/assemble";
import { type ChatSettings, historyForPrompt, mustChat } from "../services/chats";
import { activeGuidance } from "../services/chattools";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { trackerPrompt } from "../trackers/service";
import { currentFold } from "../trackers/store";

/**
 * The advisor ("council-lite", STEER-01): before a reply, a helper model writes a short private
 * plan (the direction, beats to hit, threads worth touching, continuity reminders) that goes into
 * the prompt as guidance. It runs while you type, so sending usually finds the plan waiting.
 * It sees its own last few plans (STEER-02), so longer plotting stays coherent.
 */

export function steerFor(chatId: string): SteerConfig & { advisorOn: boolean } {
  const cfg = { ...defaultSteer, ...getSetting("steer.config") };
  const s = parseJson<ChatSettings>(mustChat(chatId).settings, {});
  return { ...cfg, advisorOn: s.advisor ?? cfg.advisor, editor: s.editor ?? cfg.editor };
}

export const planSchema = z.object({
  direction: z.string().default(""),
  beats: z.array(z.string()).default([]),
  threads: z.array(z.string()).default([]),
  reminders: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
});
export type Plan = z.infer<typeof planSchema>;

/**
 * Which turn a plan is for: the message the reply answers plus the user's words. While you type,
 * the draft stands in for the message you're about to send, so the key matches once you send it.
 */
export function turnKey(history: HistoryMessage[], draft?: string) {
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

export function recentPlans(chatId: string, limit = 10) {
  return all<PlanRow>("SELECT * FROM advisor_plans WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?", chatId, limit).map((r) => ({
    id: r.id,
    plan: parseJson<Plan>(r.plan, planSchema.parse({})),
    used: r.used_at != null,
    generationId: r.generation_id,
    createdAt: r.created_at,
  }));
}

const running = new Map<string, Promise<Plan | null>>();

const ADVISOR_SYSTEM = (char: string, user: string) => `You are the private story advisor for an ongoing roleplay between ${char} (written by the AI) and ${user} (the player's character). Before ${char}'s next reply, you write a short plan the writer will follow loosely. The player never sees it.

Plan the NEXT reply only:
- "direction": one or two sentences: where this reply should take the scene, in response to what ${user} just did or said.
- "beats": 2–4 concrete beats to hit, in order. Small and specific; leave room for ${user} to act.
- "threads": up to 2 open threads, promises or secrets worth touching now (only if it fits naturally).
- "reminders": continuity facts the reply must respect (time, place, injuries, who knows what).
- "avoid": up to 3 things to avoid (repeating earlier beats, rushing, writing ${user}'s actions).
Stay consistent with your earlier plans unless the story moved somewhere else; never decide what ${user} does.
Reply with JSON only: {"direction":"…","beats":["…"],"threads":["…"],"reminders":["…"],"avoid":["…"]}`;

function advisorInput(chatId: string, history: HistoryMessage[], draft: string | undefined, cfg: SteerConfig) {
  const names = chatNames(chatId);
  const parts: string[] = [];
  const story = storyRow(chatId);
  if (story?.content) parts.push(`STORY SO FAR:\n${story.content.slice(0, 3000)}`);
  try {
    const note = trackerPrompt(chatId, { kind: "story" }).note?.text;
    if (note) parts.push(`STORY STATE:\n${note.slice(0, 2000)}`);
    const st = currentFold(chatId).result.state;
    const open = Object.values(st.threads)
      .filter((t) => t.status !== "resolved")
      .sort((a, b) => b.lastSeq - a.lastSeq)
      .map((t) => `${t.title}${t.status === "stalled" ? " (stalled)" : ""}${t.latest ? `: ${t.latest}` : ""}`)
      .slice(0, 8);
    if (open.length) parts.push(`OPEN THREADS:\n${open.map((t) => `- ${t}`).join("\n")}`);
  } catch {
    // trackers are optional
  }
  const prev = recentPlans(chatId, cfg.advisorMemory).reverse();
  if (prev.length) parts.push(`YOUR EARLIER PLANS (oldest first):\n${prev.map((p, i) => `${i + 1}. ${p.plan.direction}${p.plan.beats.length ? ` Beats: ${p.plan.beats.join("; ")}` : ""}`).join("\n")}`);
  const chat = mustChat(chatId);
  const s = parseJson<ChatSettings>(chat.settings, {});
  const steering = [s.pacing ? `pace: ${s.pacing}` : "", s.length ? `length: ${s.length}` : "", ...activeGuidance(s, chat.character_id, null).map((g) => g.text), s.cue ? `cue for this reply: ${s.cue}` : ""].filter(Boolean);
  if (steering.length) parts.push(`THE PLAYER'S STEERING:\n${steering.map((x) => `- ${x}`).join("\n")}`);
  const recent = history.slice(-8).map((m) => `${m.role === "user" ? names.user : m.role === "assistant" ? names.char : "Note"}: ${cleanText(m.content).slice(0, 1200)}`);
  parts.push(`RECENT MESSAGES:\n${recent.join("\n\n")}`);
  if (draft?.trim()) parts.push(`${names.user.toUpperCase()} IS ABOUT TO SAY:\n${draft.trim().slice(0, 2000)}`);
  return { system: ADVISOR_SYSTEM(names.char, names.user), user: parts.join("\n\n") };
}

/** Writes (or returns the cached) plan for a turn. Never throws: no plan just means no guidance. */
export async function runAdvisor(chatId: string, opts: { history?: HistoryMessage[]; draft?: string; signal?: AbortSignal } = {}): Promise<Plan | null> {
  const cfg = steerFor(chatId);
  if (!cfg.advisorOn || shouldShed("advisor")) return null;
  const history = opts.history ?? historyForPrompt(chatId);
  const key = turnKey(history, opts.draft);
  const cached = planFor(chatId, key);
  if (cached) return cached;
  const inflight = running.get(`${chatId}:${key}`);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const { system, user } = advisorInput(chatId, history, opts.draft, cfg);
      const r = await callJson({ task: "helper", kind: "advisor", chatId, name: "advisor_plan", schema: planSchema, system, user, maxTokens: 700, temperature: 0.6, signal: opts.signal });
      run("INSERT OR REPLACE INTO advisor_plans (id, chat_id, key, plan, created_at) VALUES (?, ?, ?, ?, ?)", newId(), chatId, key, JSON.stringify(r.data), now());
      // Keep a short history per chat.
      run("DELETE FROM advisor_plans WHERE chat_id = ? AND id NOT IN (SELECT id FROM advisor_plans WHERE chat_id = ? ORDER BY created_at DESC LIMIT 40)", chatId, chatId);
      return r.data;
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
export async function advisorExtra(chatId: string, history: HistoryMessage[], opts: { wait: boolean }): Promise<PromptExtra | null> {
  const cfg = steerFor(chatId);
  if (!cfg.advisorOn) return null;
  const key = turnKey(history);
  let plan = planFor(chatId, key);
  if (!plan && opts.wait && cfg.advisorWait > 0) {
    plan = await Promise.race([runAdvisor(chatId, { history }), Bun.sleep(cfg.advisorWait * 1000).then(() => null)]);
  }
  if (!plan) return null;
  return { id: "advisor", name: "Advisor's plan", content: planText(plan), depth: 0 };
}

/** STEER-02: the plan a reply was written with counts as used, so later plans can build on it. */
export function markPlanUsed(chatId: string, key: string, generationId: string) {
  run("UPDATE advisor_plans SET used_at = ?, generation_id = ? WHERE chat_id = ? AND key = ?", now(), generationId, chatId, key);
}
