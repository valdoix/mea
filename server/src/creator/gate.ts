import { z } from "zod";
import { getSetting } from "../lib/settings";
import { callJson } from "../services/llm";

/**
 * Pass/fail checks with named criteria, shared by every creator: the bible, a written field, an
 * interview question, a depth entry, an enriched lore entry, a person's profile. A criterion only
 * passes when the judge says so; one it skipped counts as failed, so a lazy verdict can't wave weak
 * work through. Also the creators' tuning: writing runs warmer than judging, and both can be set.
 */

export interface Criterion {
  key: string;
  label: string;
  description: string;
}

export interface GateVerdict {
  passed: boolean;
  criteria: { key: string; label: string; passed: boolean; note: string }[];
  summary: string;
}

const tuning = () => getSetting("creator.tuning");

/** Temperature for anything the model composes (questions, the bible, fields, entries). */
export const writeTemp = (fallback: number) => tuning().writeTemp ?? fallback;
/** Temperature for anything the model judges (gates, the read-back). */
export const judgeTemp = (fallback: number) => tuning().judgeTemp ?? fallback;
/** How many extra "deepening" questions an interview may ask once the essentials are covered. */
export const deepenCap = () => tuning().deepenCap ?? 6;
/** How many people one "Propose people" pass suggests. */
export const peopleCount = () => tuning().peopleCount ?? 5;
/** How many answers about one person count as enough for a solid profile. */
export const namedTarget = () => tuning().namedTarget ?? 3;

const verdictSchema = z.object({
  criteria: z.array(z.object({ key: z.string(), passed: z.boolean().default(false), note: z.string().default("") })).default([]),
  summary: z.string().default(""),
});

/** The model's verdict, held to the criteria asked for: anything missing or unknown fails. */
export function toVerdict(raw: z.infer<typeof verdictSchema>, criteria: readonly Criterion[]): GateVerdict {
  const seen = new Map(raw.criteria.filter((c) => criteria.some((x) => x.key === c.key)).map((c) => [c.key, c]));
  const out = criteria.map((c) => ({ key: c.key, label: c.label, passed: seen.get(c.key)?.passed === true, note: seen.get(c.key)?.note.trim() ?? "" }));
  return { passed: out.length > 0 && out.every((c) => c.passed), criteria: out, summary: raw.summary.trim() };
}

export const rubric = (criteria: readonly Criterion[]) => criteria.map((c) => `- ${c.key} (${c.label}): ${c.description}`).join("\n");

/**
 * One judging call. `what` names what is being judged; `user` carries the material and must end
 * with the text under judgement after "THE TEXT TO JUDGE:".
 */
export async function runGate(opts: { kind: string; name: string; what: string; criteria: readonly Criterion[]; user: string; editor?: boolean; jobId?: string; signal?: AbortSignal }): Promise<GateVerdict> {
  if (!opts.criteria.length) return { passed: true, criteria: [], summary: "" };
  const r = await callJson({
    task: "helper",
    kind: opts.kind,
    name: opts.name,
    jobId: opts.jobId,
    signal: opts.signal,
    schema: verdictSchema,
    system: [
      `You judge ${opts.what}. Be a demanding critic, not a cheerleader: passing weak work costs the author more than a fair fail. A criterion fails if it is only half met.`,
      `For each criterion decide passed true or false and write one sharp sentence naming exactly what is strong or weak.${opts.editor ? " Write notes as an editor talking to the author, in plain writer's language; a failing note hands them one concrete fix." : ""}`,
      `CRITERIA:\n${rubric(opts.criteria)}`,
      'Then a one-line summary. Reply with JSON only: {"criteria": [{"key": "…", "passed": true, "note": "…"}], "summary": "…"}',
    ].join("\n\n"),
    user: opts.user,
    maxTokens: 1200,
    temperature: judgeTemp(0.2),
  });
  return toVerdict(r.data, opts.criteria);
}

/** The failed criteria as a steer for a rewrite ("fix exactly these"). */
export const failedNotes = (v: GateVerdict) =>
  v.criteria
    .filter((c) => !c.passed)
    .map((c) => `${c.label}: ${c.note || "failed"}`)
    .join("; ");
