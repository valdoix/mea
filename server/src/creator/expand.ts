import { z } from "zod";
import { newId } from "../db/db";
import { callJson, callText } from "../services/llm";
import { STOCK_NAMES, STOCK_PHRASES } from "../lore/quality";

/**
 * "Expand my idea": your few lines become a fully fleshed-out concept, section by section,
 * shared by the Lore Studio and the character and persona creator. Your words are canon (CHAR-09);
 * the model builds outward from them, commits to choices, and makes every section playable.
 * Sections stay editable, can be taken deeper one at a time, and feed every later step.
 */

export type ExpandKind = "world" | "character" | "persona";

export interface ExpansionSection {
  id: string;
  heading: string;
  text: string;
}

export interface Expansion {
  sections: ExpansionSection[];
  /** Feed it to the plan, bible and writing steps (on unless you turn it off). */
  use: boolean;
  steer: string;
}

/** What each kind of concept covers, in order, with what a good section holds. */
export const EXPAND_OUTLINE: Record<ExpandKind, { heading: string; ask: string }[]> = {
  world: [
    { heading: "Premise", ask: "the world in three or four strong sentences: what makes it this world and no other" },
    { heading: "The setting", ask: "where and when; geography and climate; the level of technology or magic; the daily texture of life: work, food, sounds, smells, money" },
    { heading: "Central tension", ask: "the conflict that drives stories here: who wants what, what stands in their way, and what is about to break" },
    { heading: "Powers and factions", ask: "3–5 groups or powers: what each wants, how it operates, who leads it, and what it would never do" },
    { heading: "Places", ask: "4–6 specific places worth a scene, one short paragraph each: a concrete detail, who is found there, and what can go wrong there" },
    { heading: "People", ask: "4–6 named people: role, a want, a contradiction, and how they connect to the tension" },
    { heading: "History", ask: "the 2–4 past events that still shape the present, with dates or how long ago, and the scars they left" },
    { heading: "Rules and limits", ask: "how magic, technology, law or custom works here, what it costs, and the hard rules a story must never break" },
    { heading: "Secrets and mysteries", ask: "truths few people know, who knows each, and what happens if it comes out" },
    { heading: "Tone and themes", ask: "how stories here feel, the themes they circle, and what this world is deliberately not" },
    { heading: "Story hooks", ask: "five situations a roleplay could open with, one or two lines each, each pulling on a different part of the world" },
  ],
  character: [
    { heading: "Concept", ask: "who they are in three or four sentences: role, age, what makes them unforgettable" },
    { heading: "Look", ask: "build, face, hair, clothes, marks, and how they move and carry themselves; details a scene can show" },
    { heading: "Personality", ask: "traits shown as behaviour (what they do, not adjectives), and the contradiction at their core" },
    { heading: "Voice", ask: "how they talk: vocabulary, rhythm, verbal habits, what they never say; then three or four sample lines in quotes, in different moods" },
    { heading: "Past", ask: "the formative events, with places and how long ago, and what each left behind" },
    { heading: "Wants and fears", ask: "what they want now, what they truly need, what they fear, and what they would do to get or avoid it" },
    { heading: "Flaws", ask: "two or three real flaws that cause trouble in scenes, not charming quirks" },
    { heading: "Relationships", ask: "3–5 named people in their life: who they are to them and where things stand now" },
    { heading: "Secrets", ask: "what they hide, from whom, and what happens if it comes out" },
    { heading: "Daily life", ask: "routines, possessions, places they go, tells, small likes and dislikes" },
    { heading: "With {{user}}", ask: "how they meet or know {{user}}, what they want from {{user}}, and the tension in that dynamic" },
    { heading: "Story hooks", ask: "four situations a roleplay with them could open with, one or two lines each" },
  ],
  persona: [
    { heading: "Concept", ask: "who this person is in three or four sentences: role, age, what they bring to a story" },
    { heading: "Look", ask: "build, face, hair, clothes, marks, and how they carry themselves" },
    { heading: "Personality", ask: "traits shown as behaviour, and the contradiction at their core" },
    { heading: "Voice", ask: "how they talk, with two or three sample lines in quotes" },
    { heading: "Past", ask: "where they come from and the events that shaped them, with places and times" },
    { heading: "Relationships", ask: "3–5 named people in their life and where things stand" },
    { heading: "Skills and limits", ask: "what they're good at, what they can't do, and what that costs them" },
    { heading: "What they want", ask: "their goal, their need, and their fear" },
    { heading: "Story hooks", ask: "four situations a story with them could open with" },
  ],
};

const LABEL: Record<ExpandKind, string> = { world: "setting for interactive fiction (roleplay)", character: "character for interactive fiction (roleplay)", persona: "the user's own character (persona) for interactive fiction (roleplay)" };

/** The craft rules every creative step shares; most of the quality lives here. */
export const CRAFT = [
  "The author's material is canon: keep every name, fact and phrase they gave (verbatim where you can) and build outward from it. Never contradict, rename or replace it.",
  "Make decisions. No hedging (\"perhaps\", \"might\", \"could be\", \"or\"), no menus of options: pick the most interesting choice and commit to it.",
  "Be specific: proper names, numbers, places, textures, the one concrete detail that makes a thing real. Show traits through behaviour, not adjectives.",
  "Give it internal logic: causes and consequences, people and places that connect across sections, a cost for every power.",
  "Every part should hand a storyteller something to play: a want, a conflict, a cost, a secret, a door left open.",
  "Fresh, not generic: avoid the obvious first idea when a stranger, truer one fits; avoid stock fantasy and romance tropes played straight.",
  `Avoid names models overuse (${STOCK_NAMES.slice(0, 16).join(", ")}…) unless the author used them, and filler phrases (${STOCK_PHRASES.slice(0, 12).join(", ")}…).`,
  "Plain, vivid prose. No meta commentary, no headings inside the text, no disclaimers.",
].join("\n- ");

export interface ExpandContext {
  idea: string;
  answers?: string;
  world?: string;
  tone?: string;
  style?: string;
  /** Lore Studio or creator id, for request history. */
  kindLabel?: string;
}

const contextBlock = (kind: ExpandKind, c: ExpandContext) =>
  [
    `KIND: ${kind}`,
    `THE AUTHOR'S IDEA (canon):\n${c.idea.trim() || "(nothing yet)"}`,
    c.answers?.trim() ? `THE AUTHOR'S ANSWERS (their own words; canon):\n${c.answers.trim()}` : "",
    c.world?.trim() ? `THE WORLD IT LIVES IN (canon; fit into it):\n${c.world.trim()}` : "",
    c.tone?.trim() ? `TONE AND GENRE: ${c.tone.trim()}` : "",
    c.style?.trim() ? `STYLE NOTES: ${c.style.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

const expansionText = (e: Expansion) => e.sections.map((s) => `## ${s.heading}\n${s.text.trim()}`).join("\n\n");

const expandSchema = z.object({ sections: z.array(z.object({ heading: z.string(), text: z.string() })).default([]) });

/** The whole concept. With a previous expansion and a steer, it's reworked rather than started over. */
export async function expandIdea(kind: ExpandKind, c: ExpandContext, opts: { previous?: Expansion | null; steer?: string } = {}): Promise<Expansion> {
  const outline = EXPAND_OUTLINE[kind];
  const rework = Boolean(opts.previous?.sections.length);
  const r = await callJson({
    task: "summarizer",
    kind: `expand:${kind}`,
    name: "idea_expand",
    schema: expandSchema,
    system: [
      `You are a seasoned story developer. ${rework ? "Rework" : "Expand"} the author's idea for a ${LABEL[kind]} into a fully fleshed-out concept, section by section.`,
      `Craft rules:\n- ${CRAFT}`,
      `Write these sections, in this order, 70–170 words each (Places, People and Story hooks may be short lines):\n${outline.map((o) => `- ${o.heading}: ${o.ask}`).join("\n")}`,
      rework ? "Keep what the current version does well and everything the author edited into it; change what the author asks." : "",
      opts.steer?.trim() ? `The author asks: ${opts.steer.trim()}` : "",
      'Reply with JSON only: {"sections": [{"heading": "…", "text": "…"}]}',
    ]
      .filter(Boolean)
      .join("\n\n"),
    user: [contextBlock(kind, c), rework ? `THE CURRENT VERSION:\n${expansionText(opts.previous!)}` : ""].filter(Boolean).join("\n\n"),
    maxTokens: 6000,
    temperature: 0.85,
  });
  // Keep the outline's order; extra sections the model added go at the end.
  const order = new Map(outline.map((o, i) => [o.heading.toLowerCase(), i]));
  const sections = r.data.sections
    .map((s) => ({ heading: s.heading.replace(/^#+\s*/, "").trim(), text: tidy(s.text) }))
    .filter((s) => s.heading && s.text)
    .sort((a, b) => (order.get(a.heading.toLowerCase()) ?? 99) - (order.get(b.heading.toLowerCase()) ?? 99))
    .map((s) => ({ id: newId(), ...s }));
  if (!sections.length) throw new Error("The model returned no sections. Try again.");
  return { sections, use: true, steer: opts.steer?.trim() ?? "" };
}

/** One section, deeper (or rewritten as asked), consistent with the rest. */
export async function deepenSection(kind: ExpandKind, c: ExpandContext, e: Expansion, sectionId: string, steer = "") {
  const s = e.sections.find((x) => x.id === sectionId);
  if (!s) throw new Error("Section not found");
  const r = await callText({
    task: "summarizer",
    kind: `expand:${kind}:deepen`,
    system: [
      `Go deeper on one section of a fleshed-out ${LABEL[kind]}: "${s.heading}".`,
      steer.trim() ? `The author asks: ${steer.trim()}` : "Keep everything it already says and add depth: specifics, consequences, connections to the other sections, the detail a scene would use.",
      "150–350 words. Stay consistent with the other sections and the author's idea.",
      `Craft rules:\n- ${CRAFT}`,
      "Reply with the new text of this section only: no heading, no preamble.",
    ].join("\n\n"),
    user: [contextBlock(kind, c), `THE WHOLE CONCEPT:\n${expansionText(e)}`, `THE SECTION TO DEEPEN: ${s.heading}\n${s.text}`].join("\n\n"),
    maxTokens: 1500,
    validate: (t) => (tidy(t).length < 40 ? "That was empty or too short. Write the section text." : null),
  });
  return tidy(r.text);
}

/** "Extend my answer" (CHAR-10): your draft, pushed further, in your own voice and words. */
export async function extendText(text: string, c: { question?: string; idea?: string }) {
  const r = await callText({
    task: "helper",
    kind: "extend",
    system:
      "Push the author's draft answer further. Keep every word they wrote, in their voice and tense, and continue it with two to four sentences of concrete specifics that make it more distinctive and more playable. No hedging, no options, no commentary. Reply with the full extended answer only.",
    user: [c.idea?.trim() ? `CONTEXT:\n${c.idea.trim().slice(0, 4000)}` : "", c.question ? `QUESTION: ${c.question}` : "", `THE AUTHOR'S DRAFT:\n${text}`].filter(Boolean).join("\n\n"),
    maxTokens: 600,
    validate: (t) => (tidy(t).length < text.trim().length ? "Keep the author's words and add to them." : null),
  });
  return tidy(r.text);
}

/** Strips what models wrap prose in: code fences, think blocks, a leading label, outer quotes. */
export function tidy(text: string) {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  t = t.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();
  t = t.replace(/^(?:#+\s*)?[A-Z][\w {}'-]{0,40}:\s*\n/, "");
  if (/^".*"$/s.test(t) && !t.slice(1, -1).includes('"')) t = t.slice(1, -1);
  return t.trim();
}

export interface ExpansionPatch {
  sections?: { id: string; heading?: string; text?: string }[];
  use?: boolean;
  remove?: string[];
}

/** Edits to an expansion: section text and headings, removals, on/off. Shared with the Lore Studio. */
export function applyExpansionPatch(d: { expansion: Expansion | null }, p: ExpansionPatch) {
  if (!d.expansion) d.expansion = { sections: [], use: true, steer: "" };
  for (const s of p.sections ?? []) {
    const cur = d.expansion.sections.find((x) => x.id === s.id);
    if (cur) {
      if (s.heading !== undefined) cur.heading = s.heading;
      if (s.text !== undefined) cur.text = s.text;
    } else d.expansion.sections.push({ id: s.id || newId(), heading: s.heading ?? "Notes", text: s.text ?? "" });
  }
  if (p.remove) d.expansion.sections = d.expansion.sections.filter((s) => !p.remove!.includes(s.id));
  if (p.use !== undefined) d.expansion.use = p.use;
}

export function expansionBlock(e: Expansion | null | undefined, label = "THE EXPANDED CONCEPT (the author has read and edited it; canon)") {
  return e?.use && e.sections.length ? `${label}:\n${expansionText(e)}` : "";
}
