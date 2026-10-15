/**
 * The planning pass, read back for the page: every reply is planned first (in the model's reasoning
 * or a <think> block), and the plan drawer shows that pass step by step. The steps are found by
 * their labels (NOW —, **SEAL:**, ## KNOW –, …), the same headers the server's leak watch knows
 * (server/src/services/generation.ts).
 */

export type PlanStepKey = "NOW" | "SEAL" | "KNOW" | "MINDS" | "WORLD" | "MOVE" | "RISK" | "VOICE";

export const PLAN_STEPS: { key: PlanStepKey; label: string; hint: string }[] = [
  { key: "NOW", label: "Now", hint: "The time, the place, who is here" },
  { key: "SEAL", label: "Your turn", hint: "Your message, sorted: said, done, attempted, intended" },
  { key: "KNOW", label: "Who knows", hint: "Each fact in play and who holds it" },
  { key: "MINDS", label: "Minds", hint: "What each character wants, fears and hides" },
  { key: "WORLD", label: "World", hint: "What the world does on its own" },
  { key: "MOVE", label: "The move", hint: "The options weighed and the one chosen" },
  { key: "RISK", label: "Risk", hint: "The likeliest way this reply goes wrong" },
  { key: "VOICE", label: "Voice", hint: "Length, talk, and how it opens" },
];

export type PlanTier = "Routine" | "Charged" | "Pivotal";

export interface ParsedPlan {
  /** The steps in the order the plan wrote them (a step written twice is joined). */
  steps: { key: PlanStepKey; text: string }[];
  /** The beat's tier, when the plan named one. */
  tier: PlanTier | null;
  /** Reasoning that isn't the pass: thinking before it, or after its last step. */
  rest: string;
}

// A label opens a line, or follows a sentence end when the pass is written inline ("NOW — dusk. MOVE — tea.").
const STEP_HEAD = /(?:^|(?<=[.;!?)\]][ \t]+))[ \t]*(?:[-*•][ \t]*)?(?:\*\*|#{1,6}[ \t]*)?(NOW|SEAL|KNOW|MINDS|WORLD|MOVE|RISK|VOICE)\b(?:\*\*)?[ \t]*(?:\([^)\n]*\))?[ \t]*[—–:-]+[ \t]*(?:\*\*[ \t]*)?/gm;
const TIER = /\b(Routine|Charged|Pivotal)\b/i;
const NOISE = /<\/?(?:think|thinking|plan|reasoning)>|^\s*\[BEFORE YOU WRITE[^\]\n]*\]\s*$|^\s*STOP RULE\b.*$/gim;

/** Splits reasoning into the plan's steps. Fewer than two step labels: no steps, and it all stays as rest. */
export function parsePlan(reasoning: string | null | undefined): ParsedPlan {
  const text = (reasoning ?? "").replace(/\r\n?/g, "\n").replace(/<\/?(?:think|thinking|plan|reasoning)>/gi, "");
  const heads = [...text.matchAll(STEP_HEAD)];
  if (heads.length < 2) return { steps: [], tier: null, rest: text.replace(NOISE, "").trim() };

  const steps: ParsedPlan["steps"] = [];
  let after = "";
  heads.forEach((m, i) => {
    const start = m.index! + m[0].length;
    let body = text.slice(start, heads[i + 1]?.index ?? text.length);
    if (i === heads.length - 1) {
      // The last step runs to the first blank line: what follows is the model thinking on, not the pass.
      const gap = body.search(/\n[ \t]*\n/);
      if (gap >= 0) {
        after = body.slice(gap);
        body = body.slice(0, gap);
      }
    }
    body = body.replace(NOISE, "").replace(/\*\*$/, "").trim();
    const key = m[1] as PlanStepKey;
    const same = steps.find((s) => s.key === key);
    if (same) same.text = [same.text, body].filter(Boolean).join("\n");
    else steps.push({ key, text: body });
  });

  const before = text.slice(0, heads[0]!.index);
  const tier = (before.match(TIER) ?? steps.map((s) => s.text).join("\n").match(TIER))?.[1];
  // A line that only names the tier ("Tier: Charged") is part of the pass, not other reasoning.
  const lead = before.replace(/^[ \t*#[(]*(?:tier|beat)?[ \t:—–-]*(?:routine|charged|pivotal)\b[^\n]{0,24}$/gim, "");
  const rest = [lead, after].map((s) => s.replace(NOISE, "").trim()).filter((s) => s.length >= 12).join("\n\n");
  return { steps, tier: tier ? ((tier[0]!.toUpperCase() + tier.slice(1).toLowerCase()) as PlanTier) : null, rest };
}

/** Where a reply's plan came from (the reply's meta.plan, set by the server). */
export function planSource(how: unknown): string | null {
  switch (how) {
    case "own":
      return "Planned in its own reasoning.";
    case "step":
      return "Planned in a step of its own: the first try skipped its plan.";
    case "first":
      return "Planned first, in a step of its own: this model has been skipping its plan.";
    case "planner":
      return "Planned by the planner model.";
    case "rescue":
      return "Planned by the planner model, as a last resort: the writer skipped its plan twice.";
    default:
      return null;
  }
}
