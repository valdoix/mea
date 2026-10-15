import { z } from "zod";
import { all, parseJson } from "../db/db";
import { cleanText } from "../memory/text";
import { getSwipes } from "../services/chats";
import { enqueue, type JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { parsePlan, type PlanStepKey } from "../../../shared/plan";
import { type Candidate, type Lesson, lessonsFor, lessonsMode, suggest } from "./lessons";
import { planOutcomes, planStats, type PlanOutcome } from "./planbook";

/**
 * The learning planner (after the planner's log, steer/planbook.ts): notes on how this story's
 * plans should be made, learned from how earlier plans turned out. They are lessons (steer/lessons.ts)
 * with a plan step: they start as suggestions you keep or turn down, wait in the Inbox like any
 * lesson, and the kept ones go into the planning pass itself, each in its step, instead of the
 * [LESSONS] lane. Rules find most of them from the log; with lessons set to "Rules + model", the
 * helper also compares the plans of the takes you kept with the ones you passed over.
 */

export type NoteStep = PlanStepKey | "TIER";
export interface PlannerNote {
  id: string;
  step: NoteStep;
  text: string;
}

const STEPS = ["TIER", "NOW", "SEAL", "KNOW", "MINDS", "WORLD", "MOVE", "RISK", "VOICE"] as const;
/** At most this many notes go into a plan, the strongest first. */
const MAX_NOTES = 6;

/** The planner notes that apply in a chat: kept and not resting, in step order. */
export function plannerNotes(chatId: string): PlannerNote[] {
  return lessonsFor(chatId)
    .filter((l) => l.data.from === "planner" && l.status === "kept" && !l.resting)
    .slice(0, MAX_NOTES)
    .map((l) => ({ id: l.id, step: (l.data.step ?? "MOVE") as NoteStep, text: l.text }))
    .sort((a, b) => STEPS.indexOf(a.step) - STEPS.indexOf(b.step));
}

/** The notes as the planning pass gets them, after its steps. Empty when there are none. */
export function notebookText(notes: PlannerNote[]) {
  if (!notes.length) return "";
  return `[THE PLANNER'S NOTEBOOK — notes the player kept from how this story's earlier plans turned out. Fold each into its step; they never appear in the reply.]\n${notes.map((n) => `- for ${n.step}: ${n.text}`).join("\n")}`;
}

// ---------- learning ----------

const SLIP_WORDS: Record<string, string> = {
  leak: "someone knowing what they shouldn't",
  dead: "the dead acting",
  name: "a wrong name",
  time: "the clock running wrong",
  place: "someone in the wrong place",
  fact: "contradicting an established fact",
  trait: "a trait contradicted",
  pov: "slipping out of the viewpoint",
  tense: "slipping tense",
  puppet: "writing for the player",
  timeline: "events out of order",
};

/** What the log already supports, without a model. */
export function ruleNotes(list: PlanOutcome[]): (Candidate & { step: NoteStep; rule: string })[] {
  const out: (Candidate & { step: NoteStep; rule: string })[] = [];
  const recent = list.slice(-30);
  // RISK: the slip this story keeps making, named so the plan looks for it first.
  const kinds = new Map<string, number>();
  for (const o of recent) for (const k of new Set(o.slips)) kinds.set(k, (kinds.get(k) ?? 0) + 1);
  for (const [kind, n] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    if (n < 3 || kind === "lesson") continue;
    const what = SLIP_WORDS[kind] ?? `the "${kind}" slip`;
    out.push({
      step: "RISK",
      rule: `risk:${kind}`,
      text: `Check for ${what} first: it is this story's likeliest slip.`,
      why: `The checker found it in ${n} of the last ${recent.length} replies you answered.`,
      quote: "",
      by: "rules",
    });
  }
  // TIER: beats planned as routine that kept needing new takes, while the bigger ones held.
  const routine = recent.filter((o) => o.tier === "Routine");
  const bigger = recent.filter((o) => o.tier === "Charged" || o.tier === "Pivotal");
  const r = planStats(routine);
  const b = planStats(bigger);
  if (routine.length >= 5 && bigger.length >= 3 && r.firstTry != null && b.firstTry != null && r.firstTry <= 0.5 && b.firstTry - r.firstTry >= 0.25) {
    out.push({
      step: "TIER",
      rule: "tier:routine-up",
      text: "When a beat could be Routine or Charged, plan it as Charged: run every step.",
      why: `You kept ${Math.round(r.firstTry * 100)}% of the beats planned as Routine on the first take, against ${Math.round(b.firstTry * 100)}% of the Charged and Pivotal ones.`,
      quote: "",
      by: "rules",
    });
  }
  return out;
}

const reviewSchema = z.object({ notes: z.array(z.object({ step: z.string(), text: z.string(), why: z.string().default("") })).default([]) });

/** The plan steps worth comparing between takes (fragments, so they're short). */
function planLines(reasoning: string | null) {
  const p = parsePlan(reasoning);
  return p.steps
    .filter((s) => ["MINDS", "MOVE", "RISK", "VOICE"].includes(s.key))
    .map((s) => `${s.key} — ${cleanText(s.text).slice(0, 300)}`)
    .join("\n");
}

/** The helper's pass: what the plans of the takes you kept share that the ones you passed over lack. */
export async function modelNotes(chatId: string, list: PlanOutcome[], job?: JobContext): Promise<(Candidate & { step: NoteStep; rule: string })[]> {
  if (shouldShed("lessons", chatId)) return [];
  const swiped = list.filter((o) => o.tries > 1).slice(-6);
  const pairs = swiped
    .map((o) => {
      const takes = getSwipes(o.messageId).filter((s) => s.status === "done");
      const keptIdx = all<{ active_swipe: number }>("SELECT active_swipe FROM messages WHERE id = ?", o.messageId)[0]?.active_swipe ?? 0;
      const kept = takes.find((s) => s.idx === keptIdx);
      const passed = takes.filter((s) => s.idx !== keptIdx).map((s) => planLines(s.reasoning)).filter(Boolean);
      const keptPlan = planLines(kept?.reasoning ?? null);
      return keptPlan && passed.length ? `KEPT PLAN:\n${keptPlan}\n${passed.map((p, i) => `PASSED OVER #${i + 1}:\n${p}`).join("\n")}` : "";
    })
    .filter(Boolean);
  if (pairs.length < 3) return [];
  const r = await callJson({
    task: "helper",
    kind: "lessons",
    chatId,
    jobId: job?.id,
    name: "planner_review",
    schema: reviewSchema,
    system: `In a roleplay, every reply is planned before it's written (steps: MINDS, MOVE, RISK, VOICE, among others). The player swiped past some takes and kept others. Below are the plans of the takes they kept next to the plans of the ones they passed over. Work out what the kept plans do that the passed-over ones don't, as at most two notes for future plans, each for one step and written as an instruction for that step (for example, for MOVE: "Prefer the sideways consequence over the obvious answer."). Only notes the evidence clearly supports; none is fine. Reply with JSON only: {"notes": [{"step": "MOVE", "text": "…", "why": "…"}]}`,
    user: pairs.join("\n\n").slice(0, 9000),
    maxTokens: 500,
  });
  return r.data.notes
    .filter((n) => STEPS.includes(n.step.toUpperCase() as NoteStep) && n.text.trim().length >= 8)
    .slice(0, 2)
    .map((n) => ({ step: n.step.toUpperCase() as NoteStep, rule: `model:${n.step.toUpperCase()}:${n.text.trim().toLowerCase().slice(0, 60)}`, text: n.text.trim().slice(0, 300), why: n.why.trim().slice(0, 300) || "The helper compared the plans of your kept and passed-over takes.", quote: "", by: "model" as const }));
}

/** The answered replies counted at the helper's last pass, per chat (so it runs every 20, not every turn). */
const lastModelPass = new Map<string, number>();
const MODEL_EVERY = 20;

/**
 * Reviews a chat's plans and files new notes as suggestions. A note found before (kept, switched off
 * or turned down) is never suggested again. `force`: run the helper now ("Review now").
 */
export async function reviewPlans(chatId: string, opts: { force?: boolean; job?: JobContext } = {}): Promise<Lesson[]> {
  const mode = lessonsMode(chatId);
  if (mode === "off") return [];
  const list = planOutcomes({ chatId });
  if (list.length < 5) return [];
  const cands = ruleNotes(list);
  if (mode === "model" && (opts.force || list.length - (lastModelPass.get(chatId) ?? 0) >= MODEL_EVERY)) {
    lastModelPass.set(chatId, list.length);
    try {
      cands.push(...(await modelNotes(chatId, list, opts.job)));
    } catch (e) {
      console.error("[mea] planner review:", (e as Error).message);
    }
  }
  const known = new Set(
    all<{ data: string }>("SELECT data FROM lessons WHERE chat_id = ?", chatId)
      .map((r) => parseJson<{ rule?: string }>(r.data, {}).rule)
      .filter(Boolean),
  );
  const out: Lesson[] = [];
  const seq = list.at(-1)!.seq;
  for (const c of cands) {
    if (known.has(c.rule)) continue;
    known.add(c.rule);
    out.push(...suggest(chatId, list.at(-1)!.messageId, [c], { seq, from: "planner", step: c.step, rule: c.rule }));
  }
  return out;
}

/** After you answer a reply: review the plans in the background. */
export function notePlanReview(chatId: string) {
  if (lessonsMode(chatId) === "off") return;
  enqueue("planner.review", { chatId }, { chatId, delayMs: 2500, dedupeKey: `planner.review:${chatId}` });
}
