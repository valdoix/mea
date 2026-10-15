import { z } from "zod";
import type { CardData } from "../cards/card";
import { newId } from "../db/db";
import { countTokens } from "../lib/tokens";
import { callJson, callText } from "../services/llm";
import { type CardIssue, checkExamples, checkGreeting, checkPersona, checkProse } from "./checks";
import { getPersona, personaPrompt } from "../services/personas";
import { GREETING_RULES, REGISTERS } from "./creator";
import { CRAFT, tidy } from "./expand";
import { unslipPersona, WHO_IS_WHO } from "./smarts";

/**
 * Card tools for the regular editors (CHAR-11…15, CHAR-17, PER-04). Every tool works on the card
 * as it is on screen (saved or not) and returns a proposal; nothing is written until you accept it.
 */

export type ToolKind = "character" | "persona";
export type Pov = "first" | "second" | "third";

/** The parts of a card or persona the tools read for context. */
export interface CardLike {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  alternate_greetings?: string[];
  mes_example?: string;
  appearance?: string;
  background?: string;
  pronouns?: string;
  post_history_instructions?: string;
}

const LABEL: Record<string, string> = {
  description: "description",
  personality: "personality",
  scenario: "scenario",
  first_mes: "greeting (first message)",
  alternate_greetings: "alternate greeting",
  mes_example: "example dialogue",
  system_prompt: "system prompt",
  post_history_instructions: "rules (post-history instructions)",
  creator_notes: "creator notes",
  appearance: "appearance",
  background: "background",
  pronouns: "pronouns",
};

const isGreeting = (field: string) => field === "first_mes" || field === "alternate_greetings" || field.startsWith("alt_");

function cardContext(kind: ToolKind, c: CardLike, skip?: string) {
  const fields: [string, string | undefined][] =
    kind === "persona"
      ? [
          ["Pronouns", c.pronouns],
          ["Description", c.description],
          ["Appearance", c.appearance],
          ["Personality", c.personality],
          ["Background", c.background],
        ]
      : [
          ["Description", c.description],
          ["Personality", c.personality],
          ["Scenario", c.scenario],
          ["Greeting", c.first_mes],
          ["Example dialogue", c.mes_example],
        ];
  return [`${kind === "persona" ? "PERSONA (the user's character)" : "CHARACTER"}: ${c.name}`, ...fields.filter(([l, v]) => v?.trim() && l.toLowerCase() !== skip).map(([l, v]) => `## ${l}\n${v!.trim().slice(0, 6000)}`)].join("\n\n");
}

// ---------- field AI actions (CHAR-11) ----------

export type AssistAction = "expand" | "condense" | "rewrite" | "prose" | "pov" | "edit" | "unpuppet";

const ACTIONS: Record<AssistAction, (i: { instruction?: string; pov?: Pov; tense?: "present" | "past" }) => string> = {
  expand: () => "Expand it: keep every fact and phrase that's there and add depth: concrete specifics, behaviour, history, the details a scene would use. About half again as long.",
  condense: () => "Condense it for token efficiency: keep every fact, name and number and the voice; cut filler, repetition and adjectives that say nothing. At most two thirds of the length.",
  rewrite: (i) => `Rewrite it in this style: ${i.instruction?.trim() || "clean, vivid, plain prose"}. Keep every fact.`,
  prose: () => "Convert it to flowing prose: W++, brackets, JSON-ish lists, tags and bullet points become clear sentences grouped by topic. Keep every fact and every distinctive word choice.",
  pov: (i) => `Rewrite it consistently in ${i.pov === "first" ? "first person (I)" : i.pov === "second" ? "second person (you, for what {{user}} perceives)" : "third person"}, ${i.tense ?? "present"} tense. Change nothing else.`,
  edit: (i) => `Make exactly this change and nothing else: ${i.instruction?.trim() || "(no instruction)"}. Leave every other sentence as it is.`,
  unpuppet: () => "Remove every place where it writes {{user}}'s actions, words, thoughts or feelings, or decides what {{user}} does. Replace them with what {{user}} could perceive, or end the moment before {{user}} acts. Change nothing else.",
};

export async function fieldAssist(input: { kind: ToolKind; field: string; action: AssistAction; text: string; card: CardLike; instruction?: string; pov?: Pov; tense?: "present" | "past" }) {
  const label = LABEL[input.field] ?? input.field;
  const r = await callText({
    task: "summarizer",
    kind: `assist:${input.action}`,
    system: [
      `Field: ${label}`,
      `You edit one field of ${input.kind === "persona" ? "the user's persona" : "a character card"} for interactive fiction: the ${label}. ${ACTIONS[input.action](input)}`,
      input.kind === "persona" ? WHO_IS_WHO.persona : "",
      isGreeting(input.field) ? GREETING_RULES({ pov: input.pov ?? "third", tense: input.tense ?? "present" }) : "",
      input.field === "mes_example" ? 'Keep the "<START>" separators and the "{{user}}:" / "{{char}}:" speaker labels.' : "",
      `Craft rules:\n- ${CRAFT}`,
      input.kind === "persona" ? "Stay consistent with the rest of the persona. Call them by name." : "Stay consistent with the rest of the card. Keep macros like {{user}} and {{char}} exactly.",
      "Reply with the new text of the field only: no label, no commentary.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    user: [cardContext(input.kind, input.card), `THE FIELD TO EDIT (${label}):\n${input.text}`].join("\n\n"),
    maxTokens: Math.min(4000, Math.max(800, Math.round(countTokens(input.text) * 2.2))),
    temperature: input.action === "edit" || input.action === "pov" || input.action === "unpuppet" || input.action === "condense" ? 0.3 : 0.7,
    validate: (t) => {
      const text = tidy(t);
      if (!text) return "That was empty. Write the field.";
      if (isGreeting(input.field) && checkGreeting(text, input.pov ?? "third").some((i) => i.kind === "puppets-user")) return "It still writes {{user}}'s actions, words or feelings. Leave every choice to {{user}}.";
      return null;
    },
  });
  const text = input.kind === "persona" ? unslipPersona(tidy(r.text), input.card.name) : tidy(r.text);
  return { text, tokens: { before: countTokens(input.text), after: countTokens(text) } };
}

// ---------- sort messy notes into fields (CHAR-12) ----------

const FIELDS: Record<ToolKind, string[]> = {
  character: ["name", "description", "personality", "scenario", "first_mes", "mes_example", "creator_notes"],
  persona: ["name", "pronouns", "description", "appearance", "personality", "background"],
};

const sortSchema = z.object({
  fields: z.record(z.string(), z.string()).default({}),
  placements: z.array(z.object({ piece: z.string(), field: z.string(), why: z.string().default("") })).default([]),
  leftover: z.array(z.string()).default([]),
});

/** Sorts pasted notes into the card's fields, explaining where each piece went. Proposals only. */
export async function sortNotes(input: { kind: ToolKind; notes: string; card: CardLike }) {
  const fields = FIELDS[input.kind];
  const r = await callJson({
    task: "summarizer",
    kind: "assist:sort",
    name: "notes_sort",
    schema: sortSchema,
    system: [
      `You sort an author's messy notes into the fields of ${input.kind === "persona" ? "the user's persona" : "a character card"} for interactive fiction.`,
      input.kind === "persona" ? `${WHO_IS_WHO.persona} Notes meant for a card (a greeting, dialogue samples, a scenario) go to "leftover".` : "",
      `Fields: ${fields.map((f) => `"${f}" (${f === "name" ? "name" : LABEL[f]})`).join(", ")}.`,
      `For each field the notes have material for, write the full new text of that field: what the ${input.kind === "persona" ? "persona" : "card"} already says there, merged with the notes, as clean prose${input.kind === "persona" ? "" : " (dialogue samples go to example dialogue in <START> blocks with {{user}}:/{{char}}: labels)"}. Keep the author's words and every fact; don't invent anything that isn't in the notes or the ${input.kind === "persona" ? "persona" : "card"}. Leave out fields the notes don't touch.`,
      '"placements": for each piece of the notes, a few words quoting it, the field it went to, and why. "leftover": anything that fits no field (meta notes, ideas for lore).',
      'Reply with JSON only: {"fields": {"field": "full new text"}, "placements": [{"piece": "…", "field": "…", "why": "…"}], "leftover": ["…"]}',
    ]
      .filter(Boolean)
      .join("\n\n"),
    user: [cardContext(input.kind, input.card), `THE NOTES:\n${input.notes.slice(0, 40_000)}`].join("\n\n"),
    maxTokens: 6000,
  });
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.data.fields)) if (fields.includes(k) && v.trim()) out[k] = k === "name" ? v.trim().slice(0, 80) : tidy(v);
  return { fields: out, placements: r.data.placements.filter((p) => fields.includes(p.field) || p.field === "leftover"), leftover: r.data.leftover.filter((x) => x.trim()) };
}

// ---------- card check (CHAR-13) ----------

const reviewSchema = z.object({ issues: z.array(z.object({ field: z.string(), problem: z.string(), fix: z.string().default("") })).default([]) });

export function checkCardFields(kind: ToolKind, card: CardLike, pov: Pov = "third") {
  const issues: Record<string, CardIssue[]> = {};
  const add = (f: string, list: CardIssue[]) => list.length && (issues[f] = [...(issues[f] ?? []), ...list]);
  if (kind === "persona") {
    add("description", [...checkProse(card.description ?? "", { maxTokens: 350 }), ...checkPersona(card.description ?? "")]);
    for (const f of ["appearance", "personality", "background"] as const) if (card[f]?.trim()) add(f, [...checkProse(card[f]!, { maxTokens: 400 }), ...checkPersona(card[f]!)]);
    return issues;
  }
  add("description", checkProse(card.description ?? "", { maxTokens: 1100, minTokens: 120 }));
  if (card.personality?.trim()) add("personality", checkProse(card.personality, { maxTokens: 160 }));
  if (card.scenario?.trim()) add("scenario", checkProse(card.scenario, { maxTokens: 300 }));
  if (card.first_mes?.trim()) add("first_mes", [...checkGreeting(card.first_mes, pov), ...checkProse(card.first_mes)]);
  else add("first_mes", [{ kind: "empty", severity: "warn", message: "No greeting: the story starts without an opening." }]);
  (card.alternate_greetings ?? []).forEach((g, i) => g.trim() && add(`alt_${i + 1}`, checkGreeting(g, pov)));
  if (card.mes_example?.trim()) add("mes_example", checkExamples(card.mes_example));
  if (/\[[^\]]*\]|\{[^}]*\+[^}]*\}|^\s*\w+\s*\(\s*"/m.test(card.description ?? "")) add("description", [{ kind: "format", severity: "info", message: "Looks like W++ or bracket lists. Prose usually plays better and costs fewer tokens (try “Make it prose”)." }]);
  return issues;
}

/** The editor's pass over a whole card: generic, contradictory, missing, flat. */
export async function reviewCard(kind: ToolKind, card: CardLike) {
  const fields = kind === "persona" ? ["description", "appearance", "personality", "background"] : ["description", "personality", "scenario", "first_mes", "mes_example"];
  const r = await callJson({
    task: "summarizer",
    kind: "assist:review",
    name: "card_review",
    schema: reviewSchema,
    system: `Review this ${kind === "persona" ? "persona" : "character card"} like a demanding editor of interactive fiction. ${kind === "persona" ? `${WHO_IS_WHO.persona} Find: anything written as if it were a character card ({{char}}, chat lines, a relationship "with {{user}}", text that decides what they feel or choose); generic choices (stock names, tropes played straight, purple prose, traits told instead of shown); contradictions between fields; missing essentials (a distinct voice, a concrete want, a real limit or flaw, what others notice first); point-of-view or tense that shifts.` : "Find: generic choices (stock names, tropes played straight, purple prose, traits told instead of shown); contradictions between fields; missing essentials (a distinct voice, a concrete want, a real flaw, what they want from {{user}}, a greeting that opens a scene, tension that drives scenes); a greeting that writes {{user}}'s actions or feelings; point-of-view or tense that shifts."} Each issue names the field (${fields.join(", ")}), states the problem in one sentence, and gives a concrete fix the author could apply as an edit instruction. Only real issues, at most 8, most important first. Reply with JSON only: {"issues": [{"field": "…", "problem": "…", "fix": "…"}]}`,
    user: cardContext(kind, card),
    maxTokens: 1600,
  });
  return r.data.issues.filter((i) => fields.includes(i.field) && i.problem.trim()).slice(0, 8);
}

// ---------- greeting workshop (CHAR-15) ----------

export async function draftGreeting(input: { card: CardLike; situation: string; pov: Pov; tense: "present" | "past"; personaId?: string | null; register?: string }) {
  const others = [input.card.first_mes, ...(input.card.alternate_greetings ?? [])].filter((g) => g?.trim());
  // Written opposite a specific persona, in a relationship register (neutral, canon, AU, romantic, adversarial).
  const persona = input.personaId ? getPersona(input.personaId) : undefined;
  const register = input.register && REGISTERS[input.register] ? REGISTERS[input.register] : "";
  const r = await callText({
    task: "summarizer",
    kind: "assist:greeting",
    system: [
      "Field: Greeting",
      `You write a new alternate greeting (opening message) for a character card: ${input.situation.trim() || "a genuinely different opening from the ones it has: a different place, time, mood or stage of the relationship"}. 160–320 words.`,
      persona ? `{{user}} IS the persona described below: open the scene opposite them specifically.` : "",
      register ? `RELATIONSHIP: ${register}` : "",
      GREETING_RULES(input),
      `Craft rules:\n- ${CRAFT}`,
      "Stay true to the card: the same person, voice and world. Reply with the greeting only.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    user: [cardContext("character", input.card, "greeting"), persona ? `{{user}} IS THIS PERSONA (${persona.name}):\n${personaPrompt(persona)}` : "", others.length ? `GREETINGS IT ALREADY HAS (be different from these):\n${others.map((g, i) => `${i + 1}. ${g!.slice(0, 800)}`).join("\n\n")}` : ""].filter(Boolean).join("\n\n"),
    maxTokens: 1400,
    temperature: 0.85,
    validate: (t) => (!tidy(t) ? "That was empty." : checkGreeting(tidy(t), input.pov).some((i) => i.kind === "puppets-user") ? "It writes {{user}}'s actions, words or feelings. Leave every choice to {{user}}." : null),
  });
  return tidy(r.text);
}

// ---------- built-in rules (CHAR-17) ----------

/** A small re-anchor block the card carries in its post-history instructions, so it plays well with any preset. */
export async function draftRules(card: CardLike) {
  const r = await callText({
    task: "summarizer",
    kind: "assist:rules",
    system: [
      "Field: Rules",
      `You write the built-in rules for a character card: a short re-anchor block the model reads right after the chat history, every turn. 50–120 words, as 4–7 terse bullet points in the imperative: the voice markers to keep (verbal habits, register), what ${card.name} would never do or say, the boundaries of their knowledge, the dynamic with {{user}} to preserve, and "Never write {{user}}'s actions, words, thoughts or feelings."`,
      "Only what's specific to this card; no generic writing advice. Use {{char}} and {{user}}.",
      "Reply with the bullet points only.",
    ].join("\n\n"),
    user: cardContext("character", card),
    maxTokens: 600,
    temperature: 0.4,
    validate: (t) => (tidy(t).length < 30 ? "Write the rules." : null),
  });
  // {{original}} keeps the preset's own post-history instructions in front of the card's.
  return `{{original}}\n${tidy(r.text)}`;
}

// ---------- voice lab (CHAR-14) ----------

export const VOICE_SITUATIONS = ["calm", "angry", "flirting", "scared", "lying", "grieving", "joking", "cornered"];

const voiceSchema = z.object({ lines: z.array(z.object({ situation: z.string(), cue: z.string(), line: z.string() })).default([]) });

/** Sample lines across situations; you keep the ones that sound right. */
export async function voiceSamples(input: { card: CardLike; situations: string[]; count: number; kept?: { situation: string; line: string }[] }) {
  const situations = (input.situations.length ? input.situations : VOICE_SITUATIONS).slice(0, 10);
  const n = Math.max(1, Math.min(3, input.count));
  const r = await callJson({
    task: "summarizer",
    kind: "assist:voice",
    name: "voice_lab",
    schema: voiceSchema,
    system: [
      `You are testing ${input.card.name}'s voice for a character card. For each situation, write ${n} different short exchange${n > 1 ? "s" : ""}: "cue" is one line {{user}} says or does (in plain words, no quotes needed), and "line" is ${input.card.name}'s reply in character: 1–4 sentences, what they say (in double quotes) with at most one short action beat in plain narration.`,
      "The point is the voice: word choice, rhythm, what they'd never say, how the situation bends them without breaking them. Each line must be unmistakably this character, not a generic one in that mood. Never write {{user}}'s reaction.",
      input.kept?.length ? "Lines the author already kept are the reference: match them, and don't repeat them." : "",
      `Situations: ${situations.join(", ")}.`,
      'Reply with JSON only: {"lines": [{"situation": "…", "cue": "…", "line": "…"}]}',
    ]
      .filter(Boolean)
      .join("\n\n"),
    user: [cardContext("character", input.card), input.kept?.length ? `KEPT LINES:\n${input.kept.map((k) => `- (${k.situation}) ${k.line}`).join("\n")}` : ""].filter(Boolean).join("\n\n"),
    maxTokens: 3000,
    temperature: 0.9,
  });
  return r.data.lines.filter((l) => l.line.trim()).map((l) => ({ id: newId(), situation: l.situation.trim().toLowerCase(), cue: l.cue.trim(), line: tidy(l.line) }));
}

/** Kept lines as example dialogue, in the format models learn from. */
export function voiceToExamples(kept: { cue: string; line: string }[]) {
  return kept.map((k) => `<START>\n{{user}}: ${k.cue}\n{{char}}: ${k.line}`).join("\n");
}

/** Normalizes a card from a request body for the tools. */
export function asCardLike(c: Partial<CardData> & Record<string, unknown>): CardLike {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    name: s(c.name) || "Unnamed",
    description: s(c.description),
    personality: s(c.personality),
    scenario: s(c.scenario),
    first_mes: s(c.first_mes),
    alternate_greetings: Array.isArray(c.alternate_greetings) ? c.alternate_greetings.map(s) : [],
    mes_example: s(c.mes_example),
    appearance: s(c.appearance),
    background: s(c.background),
    pronouns: s(c.pronouns),
    post_history_instructions: s(c.post_history_instructions),
  };
}
