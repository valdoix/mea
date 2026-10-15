import { z } from "zod";
import { newId } from "../db/db";
import { callJson } from "../services/llm";
import { type Criterion, type GateVerdict, runGate, writeTemp } from "./gate";

/**
 * Drawing an idea out of its author, shared by the creator, a lorebook's "Add lore" loop and a
 * person's interview: one question at a time aimed at the biggest gap, each screened before you see
 * it; directions when you're stuck; an answer that also settles other things gets filed there too;
 * and every fact remembers whose words it is, so your own words outrank anything picked or extended.
 */

/** Where a fact came from: your idea, typed by you, picked from directions, or your draft extended. */
export type FactSource = "idea" | "typed" | "picked" | "extended";

export interface Fact {
  id: string;
  /** The bible section (or lore subject) it belongs to. */
  section: string;
  text: string;
  source: FactSource;
  /** The question it answered, so editing the answer edits the fact. */
  qid?: string;
}

export interface Direction {
  caption: string;
  text: string;
}

export const SOURCE_MARK: Record<FactSource, string> = {
  idea: "from their idea",
  typed: "their own words",
  picked: "picked from suggestions",
  extended: "their words, extended",
};

export const isFactSource = (s: unknown): s is FactSource => s === "idea" || s === "typed" || s === "picked" || s === "extended";

/** How the writer weighs facts by whose words they are. */
export const WEIGHT_RULE =
  "Whose words: facts marked [their own words] or [from their idea] are untouchable in substance and, where you can, in wording. [picked from suggestions] and [their words, extended] are canon too but may be rephrased. Anything the author left open is your best, overturnable guess: keep it modest and consistent, not bold new canon.";

/** The rules every interviewer question follows (Lumiverse's Weaver, adapted). */
export const ASK_RULES = [
  "Grounded in THIS subject: build the question from the author's own material and quote their phrase when it helps. A question that could be asked about anyone fails.",
  "Ask, never assert: the premise may state only what the author established. Raise a new possibility AS a question (\"is there someone who…\"), never as a fact (\"who is the person that…\"); an invented premise steers the author and leaks into their canon.",
  "Plain language, the way a sharp co-writer talks across a table. No craft jargon.",
  'Obvious intent: a one-line "why" saying what this pins down and what a good answer gives.',
  "One thing at a time: no compound questions, no lists, no multiple choice.",
  "Concrete beats abstract: what they did, said, chose or avoided in a moment, not how they \"generally feel\".",
].join("\n- ");

export const QUESTION_CRITERIA: Criterion[] = [
  { key: "specific", label: "Specific", description: "Answerable only for THIS subject given what is established, not a generic prompt that would fit anyone." },
  { key: "load_bearing", label: "Load-bearing", description: "Its answer would change how it's written: a real behaviour, relationship, history, knowledge or secret, not trivia." },
  { key: "non_duplicative", label: "Non-duplicative", description: "It doesn't restate an established fact or a question already asked; it reaches into open space." },
  { key: "grounded_premise", label: "Grounded premise", description: "Everything it asserts as true is established by the author's material; a new possibility raised as a question is fine, an invented person, event or secret stated as fact fails." },
];

export const factsBlock = (facts: Fact[], labelOf: (section: string) => string, title = "THE AUTHOR'S FACTS (locked; by section, with whose words they are)") =>
  facts.length ? `${title}:\n${facts.map((f) => `- ${labelOf(f.section)}: ${f.text.trim()} [${SOURCE_MARK[f.source]}]`).join("\n")}` : "";

export const tasteBlock = (taste: string[]) => (taste.length ? `THE AUTHOR'S TASTE (steers they've given; let it bias your choices):\n${taste.map((t) => `- ${t}`).join("\n")}` : "");

/** Adds a steer to the author's taste, newest last, without repeats (at most 24). */
export function addTaste(taste: string[], steer: string | undefined): string[] {
  const s = steer?.trim().slice(0, 200);
  if (!s || s.length < 3) return taste;
  return [...taste.filter((t) => t.toLowerCase() !== s.toLowerCase()), s].slice(-24);
}

export interface AskTarget {
  key: string;
  label: string;
  ask: string;
}

export interface AskedQuestion {
  q: string;
  why: string;
  target: string;
  gate: GateVerdict | null;
}

const questionSchema = z.object({ q: z.string().default(""), why: z.string().default(""), target: z.string().default("") });

/**
 * The single next question: at the most important target (unless the author's own words make another
 * more urgent), or a deepening question once no targets remain. Screened by a second call; up to
 * three tries, then a plain question about the top target.
 */
export async function askQuestion(opts: {
  kind: string;
  /** "a character card for roleplay", "the world in this lorebook"… */
  subject: string;
  who?: string;
  material: string;
  asked: { q: string; a: string }[];
  targets: AskTarget[];
  /** What deepening reaches into once the targets are covered (empty: no deepening). */
  deepening: string;
  taste: string[];
  steer?: string;
  avoid?: string[];
  jobId?: string;
}): Promise<AskedQuestion | null> {
  if (!opts.targets.length && !opts.deepening) return null;
  const avoid = [...(opts.avoid ?? [])];
  const keys = new Set(opts.targets.map((t) => t.key));
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await callJson({
      task: "helper",
      kind: `${opts.kind}:question`,
      name: "creator_question",
      schema: questionSchema,
      system: [
        `You are the interviewer helping an author grow ${opts.subject} from THEIR idea. Ask the single next question that most sharpens it.`,
        opts.who ?? "",
        opts.targets.length
          ? `Aim at the first PRIORITY (most important first), unless something the author already said makes another priority more urgent. "target" is that priority's key.`
          : `The essentials are covered: deepen into ${opts.deepening}. "target" is "depth".`,
        `The bar:\n- ${ASK_RULES}`,
        'Reply with JSON only: {"q": "the question", "why": "one plain line on what it pins down", "target": "…"}',
      ]
        .filter(Boolean)
        .join("\n\n"),
      user: [
        opts.material,
        opts.asked.length ? `ALREADY ASKED AND ANSWERED (never re-ask or reword these):\n${opts.asked.map((a) => `- Q: ${a.q}\n  A: ${a.a || "(skipped)"}`).join("\n")}` : "",
        opts.targets.length ? `PRIORITIES (not pinned down yet, most important first):\n${opts.targets.map((t) => `- ${t.key} (${t.label}): ${t.ask}`).join("\n")}` : "PRIORITIES: all covered; deepen with target \"depth\".",
        tasteBlock(opts.taste),
        opts.steer?.trim() ? `STEER from the author for this question: ${opts.steer.trim()}` : "",
        avoid.length ? `Do NOT ask these (rejected or already shown) or near-rewordings:\n${avoid.map((a) => `- ${a}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 600,
      temperature: writeTemp(0.9),
    });
    const q = r.data.q.trim();
    if (!q) continue;
    let target = r.data.target.trim();
    if (!opts.targets.length) target = "depth";
    else if (!keys.has(target)) target = opts.targets[0]!.key;
    const gate = await runGate({
      kind: `${opts.kind}:question-gate`,
      name: "creator_question_gate",
      what: `one interview question proposed for an author about ${opts.subject}: whether it earns the author's time`,
      criteria: QUESTION_CRITERIA,
      user: [opts.material, opts.asked.length ? `QUESTIONS ALREADY ASKED:\n${opts.asked.map((a) => `- ${a.q}`).join("\n")}` : "", `ITS STATED INTENT: ${r.data.why.trim()}`, `THE TEXT TO JUDGE:\n${q}`].filter(Boolean).join("\n\n"),
      jobId: opts.jobId,
    });
    if (gate.passed) return { q, why: r.data.why.trim(), target, gate };
    avoid.push(q);
  }
  const top = opts.targets[0];
  if (!top) return null;
  return { q: `What should ${top.label.toLowerCase()} be? (${top.ask})`, why: "This is the most important thing still open.", target: top.key, gate: null };
}

const directionsSchema = z.object({ options: z.array(z.object({ caption: z.string().default(""), text: z.string().default("") })).default([]) });

/** "Show me directions": three genuinely different answers, each captioned with the tradeoff it represents. */
export async function directions(opts: { kind: string; question: string; why?: string; material: string; taste: string[]; steer?: string; avoid?: string[] }): Promise<Direction[]> {
  const r = await callJson({
    task: "helper",
    kind: `${opts.kind}:directions`,
    name: "creator_directions",
    schema: directionsSchema,
    system: [
      "The author asked for possible directions on an interview question: inspiration, not an answer made for them.",
      "Offer exactly 3 candidate answers that are genuinely DIVERGENT: each sends the subject somewhere the others don't. Reach past the first, most obvious answer for at least one.",
      "Each one: a complete, concrete answer (a real behaviour, scene, belief or detail, never a bare adjective), grounded in the author's material and never contradicting it, under 60 words, with a 4–10 word caption naming the feel or tradeoff it represents.",
      opts.steer?.trim() ? "A STEER is given: move the whole set decisively toward it." : "",
      'Reply with JSON only: {"options": [{"caption": "…", "text": "…"}]}',
    ]
      .filter(Boolean)
      .join("\n\n"),
    user: [
      `THE QUESTION: ${opts.question}`,
      opts.why ? `What it pins down: ${opts.why}` : "",
      opts.material,
      tasteBlock(opts.taste),
      opts.steer?.trim() ? `STEER: ${opts.steer.trim()}` : "",
      opts.avoid?.length ? `Already shown (don't repeat or reword):\n${opts.avoid.map((a) => `- ${a}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: 900,
    temperature: writeTemp(0.9),
  });
  const out = r.data.options.map((o) => ({ caption: o.caption.trim().slice(0, 80), text: o.text.trim() })).filter((o) => o.text);
  if (!out.length) throw new Error("The model offered no directions. Try again.");
  return out.slice(0, 3);
}

const spillSchema = z.object({ facts: z.array(z.object({ section: z.string().default(""), text: z.string().default("") })).default([]) });

/**
 * The listener: an answer aimed at one section often settles others too. Returns up to four extra
 * facts, only what the answer plainly says; an empty list is the usual, correct outcome.
 */
export async function spillover(opts: { kind: string; question: string; target: string; answer: string; sections: { key: string; label: string }[]; facts: Fact[]; labelOf: (s: string) => string }): Promise<{ section: string; text: string }[]> {
  const keys = new Set(opts.sections.map((s) => s.key));
  try {
    const r = await callJson({
      task: "helper",
      kind: `${opts.kind}:spillover`,
      name: "creator_spillover",
      schema: spillSchema,
      system: [
        "The author just answered an interview question. Its main target is already recorded. Your only job: notice whether the answer ALSO plainly established something for OTHER sections, and list those as extra facts.",
        "Extract only what the answer's text directly supports: never interpret, generalise or embellish. State the bare value. Skip anything already established. An empty list is the common, correct outcome.",
        `Sections:\n${opts.sections.map((s) => `- ${s.key} (${s.label})`).join("\n")}`,
        'Reply with JSON only: {"facts": [{"section": "<key>", "text": "…"}]}',
      ].join("\n\n"),
      user: [`THE QUESTION: ${opts.question}`, `MAIN TARGET (already recorded, skip it): ${opts.target}`, `THE ANSWER:\n${opts.answer}`, factsBlock(opts.facts, opts.labelOf, "ALREADY ESTABLISHED (skip these)")].filter(Boolean).join("\n\n"),
      maxTokens: 600,
      temperature: 0.2,
    });
    return r.data.facts
      .map((f) => ({ section: f.section.trim(), text: f.text.trim() }))
      .filter((f) => f.text && keys.has(f.section) && f.section !== opts.target)
      .slice(0, 4);
  } catch {
    return [];
  }
}

export const newFact = (section: string, text: string, source: FactSource, qid?: string): Fact => ({ id: newId(), section, text: text.trim(), source, ...(qid ? { qid } : {}) });
