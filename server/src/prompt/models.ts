/**
 * Model adapters (docs/29 §4): one preset for every model, and a small adapter per model family
 * for what differs — how the family drifts while planning, and the prose habits it leans on. The
 * preset reads them as {{model.plan}} and {{model.prose}}; the doctrine itself never changes by model.
 */

/** How this reply is planned: by a separate planner, in the route's own reasoning, or in a <think> block. */
export interface PlanRoute {
  planned: boolean;
  providerReasoning: boolean;
}

export interface ModelAdapter {
  family: string;
  label: string;
  /** Matched against the lowercased model id, in table order. */
  match: RegExp | null;
  /** How this family should plan (or, when a planner planned, write). */
  plan: (r: PlanRoute) => string;
  /** The prose habits this family leans on, to catch in the story. */
  prose: string;
  /**
   * docs/29 §8 (L5): whether the preset quotes one example of each bad phrase ("quote"), or only
   * describes the category ("describe"), for a family the quoted phrase may prime.
   */
  bans: Bans;
}

export type Bans = "quote" | "describe";

/**
 * Said to every model: the plan is fragments, and the story is written once. A draft in the plan
 * is wasted output, and it's the commonest way a plan leaks into the story.
 */
export function noDraft(r: PlanRoute): string {
  if (r.planned) return "Draft nothing: write the story once, straight through, with no draft, outline or rehearsal of it first.";
  if (r.providerReasoning) return "Draft nothing in your reasoning: no sentence, line of dialogue, opening or outline of the reply. Write the story once, after it.";
  return "Draft nothing in the <think> block: no sentence, line of dialogue, opening or outline of the reply. Write the story once, inside <story>.";
}

const none = () => "";

export const ADAPTERS: ModelAdapter[] = [
  {
    family: "claude",
    label: "Claude",
    match: /claude|anthropic/,
    plan: (r) =>
      `${r.planned ? "" : r.providerReasoning ? "Extended thinking is the planning pass: its steps and ceiling, then the reply. " : "Write the <think> block first, in plain fragments, then the story. "}Follow the output order literally.`,
    prose: "Your habits to catch: the teaser ending (\"Soon.\", what tonight will bring), a closing paragraph that sums up the mood, and the narration explaining what a look or a line meant.",
    bans: "quote",
  },
  {
    family: "deepseek",
    label: "DeepSeek",
    match: /deepseek|\br1\b/,
    plan: (r) => (r.planned ? "Write only the story." : "Plan once, in fragments, end the plan at VOICE, then write the story; nothing of the plan belongs after it."),
    prose: "",
    bans: "quote",
  },
  {
    family: "gemini",
    label: "Gemini",
    match: /gemini|gemma/,
    plan: (r) => (r.planned ? "" : "Don't restate these instructions or the story state while planning; the plan is bullet fragments."),
    prose: "Plain prose in the story, without markdown headings.",
    bans: "quote",
  },
  {
    family: "glm",
    label: "GLM",
    match: /glm|zhipu|z-ai/,
    plan: (r) =>
      r.planned
        ? "No self-talk: write only the story."
        : "Plan in telegraphic fragments within the ceiling. No self-talk, no rechecking. Then close </think> and write the story inside <story>…</story>: the plan alone is not a reply.",
    // Described, not quoted: GLM's office words may be primed by the lists that ban them (docs/29 §4.3).
    prose:
      "Your habits to catch, in the plan as in the story: office, bank and courtroom words for people and feelings, counting things instead of describing them, a line restarted on its own first word, chains that hand a word on from clause to clause, a line broken off before the sad word in every reply, the same closing image reply after reply, and everyone talking in one clipped, competent voice. People here talk like their cards, never like a report.",
    bans: "describe",
  },
  {
    family: "kimi",
    label: "Kimi",
    match: /kimi|moonshot/,
    plan: (r) =>
      r.planned ? "No workspace: no \"Let me plan\", no self-correction; write only the story." : "No workspace outside the plan: no \"Let me plan\", no self-correction.",
    prose: "",
    bans: "quote",
  },
  {
    family: "gpt",
    label: "GPT",
    match: /gpt|\bo[1345]\b|openai/,
    plan: () => "Keep the output order exact; no commentary around the story.",
    prose: "",
    bans: "quote",
  },
  {
    family: "open",
    label: "Open model",
    match: /mistral|mixtral|llama|qwen|hermes|command-r|nemo|magnum|euryale|wizard/,
    plan: (r) =>
      r.planned ? "" : r.providerReasoning ? "Plan in your reasoning, in fragments." : "Write the plan inside <think>…</think> as plain lines: never in a code fence, never as JSON, never skipped.",
    prose: "Keep names spelled exactly as before.",
    bans: "quote",
  },
];

/** Any model no adapter matches: it still gets the line every model gets. */
export const OTHER_ADAPTER: ModelAdapter = { family: "", label: "Other", match: null, plan: none, prose: "", bans: "quote" };

/** The family a model id belongs to ("" when none matches). */
export function detectFamily(modelId: string | undefined): string {
  const id = (modelId ?? "").toLowerCase();
  return ADAPTERS.find((a) => a.match?.test(id))?.family ?? "";
}

/**
 * The family a profile's model is treated as: the profile's own choice when it set one ("none"
 * turns the family notes off), else what the id says. The choice is the profile's own model's:
 * a quick switch to another model goes back to detecting.
 */
export function resolveFamily(setting: string | undefined, modelId: string | undefined): string {
  if (setting === "none") return "none";
  if (setting && ADAPTERS.some((a) => a.family === setting)) return setting;
  return detectFamily(modelId);
}

export function adapterFor(family: string): ModelAdapter {
  return ADAPTERS.find((a) => a.family === family) ?? OTHER_ADAPTER;
}

/** What the preset's {{model.*}} values hold for one reply. */
export function modelNotes(family: string, route: PlanRoute, extra = ""): { plan: string; prose: string; label: string; bans: Bans } {
  const a = family === "none" ? null : adapterFor(family);
  const plan = [a?.plan(route) ?? "", noDraft(route)].filter(Boolean).join(" ");
  const prose = [a?.prose ?? "", extra.trim()].filter(Boolean).join(" ");
  return { plan, prose, label: family === "none" ? "None" : (a?.label ?? "Other"), bans: a?.bans ?? "quote" };
}
