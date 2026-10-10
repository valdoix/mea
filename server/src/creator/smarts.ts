import { newId } from "../db/db";
import type { Expansion } from "./expand";

/**
 * What both studios share to work smarter: canon awareness (fan works and AUs), suggested answers,
 * the co-writer's conversation and proposals, and the fingerprints that tell a field or entry it was
 * written from an older version of its sources.
 */

/** A short, stable fingerprint of some text (FNV-1a), for "was this written from what's there now?". */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// ---------- who is who ----------

/**
 * What a card or a persona IS in a chat, said the same way to every step that writes or talks about
 * one (both studios, the card tools, and any assistant that works on a chat). Models default to
 * treating everything as a character card for the AI to play; a persona is the opposite: the person
 * the user plays. Without this they write a persona greetings, {{char}} macros, "what she wants from
 * {{user}}", or a scene where the persona's choices are made for them.
 */
export const WHO_IS_WHO = {
  persona: [
    "WHO IS WHO: This is a PERSONA, the user's own character: the person the human player plays in the story. In a chat the persona IS {{user}}; the AI storyteller never voices, plays or decides for them. It is NOT a character card.",
    "So: never write a persona greetings, a scenario, example dialogue, rules or creator notes; never call them {{char}}, and never describe their relationship \"with {{user}}\" (they are {{user}}). Write about them by name, in third person, as a reference the storyteller reads so it knows who it is talking to: who they are, how they look, sound and carry themselves, their past, skills and limits, and the people in their life.",
    "Describe; don't script. Give tendencies and history, never decide what they will feel, say or choose in a scene: those belong to the player.",
    "Authors often write about their persona in first person (\"I'm a nurse\", \"my sister\"): that is the persona, not a separate character and not the author talking about someone else.",
    "The other people they meet (AI characters, the cast of a world) are someone else, even when the world's lore is full of them. Never merge the persona with a character card from the world.",
  ].join(" "),
  character: "WHO IS WHO: This is a CHARACTER CARD: someone the AI plays (as {{char}}) opposite the human player, whose own character is {{user}} (their persona). Write {{char}}'s side only; {{user}} belongs to the player.",
  narrator: "WHO IS WHO: This is a NARRATOR CARD: the AI is a storyteller running a world and voicing its whole cast; the human player is {{user}} (their persona). The narrator plays everyone except {{user}}.",
} as const;

export const whoIsWho = (kind: "character" | "persona", mode?: "companion" | "narrator") => (kind === "persona" ? WHO_IS_WHO.persona : mode === "narrator" ? WHO_IS_WHO.narrator : WHO_IS_WHO.character);

/** Card vocabulary a persona text must never carry, with what to tell the model when it slips. */
export function personaSlip(text: string): string | null {
  if (/\{\{\s*char\s*\}\}/i.test(text)) return "A persona is never {{char}}: they are the player's own character. Write about them by name, with no {{char}} macro.";
  if (/^\s*<START>/im.test(text) || /^\s*\{\{\s*user\s*\}\}\s*:/im.test(text)) return "A persona has no example dialogue or chat lines. Write a description of them by name.";
  return null;
}

/** A persona text with the card macros a model slipped in replaced by the persona's name. */
export const unslipPersona = (text: string, name: string) => (name.trim() ? text.replace(/\{\{\s*char\s*\}\}/gi, name.trim()) : text);

/** For a world or character based on an existing work: canon is the floor, the author's changes the ceiling. */
export const canonRule = (basedOn: string) =>
  basedOn.trim()
    ? `This is based on an existing work: ${basedOn.trim()}. Use its canon accurately and in detail (real names, ages, relationships, history, personalities, places, how people talk) wherever the author hasn't changed it, and keep canon's minor figures too. The author's changes (AU choices, new characters, new facts) override canon; never invent a replacement for something canon already establishes.`
    : "";

export const canonBlock = (basedOn: string) => (basedOn.trim() ? `BASED ON (canon applies unless the author changed it): ${basedOn.trim()}` : "");

/** What the read-back asks for so each question comes with answers to pick from. */
export const SUGGEST_RULE =
  '"suggestions": three short, concrete, genuinely different answers the author could pick for that question (each under 25 words, written as the answer itself, consistent with everything they said). Build on the author\'s earlier answers: follow-ups dig into what they said, never re-ask it.';

export const BASED_ON_RULE = '"basedOn": if the material is fan fiction, an AU, or set in an existing show, book, film or game, name that work and its medium (like "Yellowjackets (TV series, 2021)"); else "".';

// The conversation, the proposals and the voice are Meus's, shared with the chat (assistant/core.ts).
export { addTurns, chatBlock, COWRITER, newProposal, withLookups, type ChatTurn, type Proposal, type ProposedChange } from "../assistant/core";
import type { ProposedChange } from "../assistant/core";

/** The idea and its expansion ("Expand my idea") as the co-writer sees them, every section by heading. */
export function ideaBlock(idea: string, expansion: Expansion | null) {
  return [
    idea.trim() ? `THE AUTHOR'S IDEA (their own words):\n${idea.trim().slice(0, 8000)}` : "",
    expansion?.sections.length ? `THE EXPANDED CONCEPT (from "Expand my idea"; ${expansion.use ? "fed to every step" : "switched off for now"}):\n${expansion.sections.map((s) => `[${s.heading}]\n${s.text.trim()}`).join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What the co-writer can propose for the idea and the expanded concept, in either studio. */
export const IDEA_CHANGES =
  '{"kind": "idea", "text": "the whole new idea"} to rewrite the author\'s idea (rarely; their words are canon); {"kind": "section", "section": "<exact heading, or a new heading to add one>", "text": "the whole new section"} to change or add a section of the expanded concept;';

/** A proposed idea or section change, checked against the draft (null if it changes nothing). */
export function ideaChange(c: { kind: string; text: string; section?: string }, idea: string, expansion: Expansion | null): Omit<ProposedChange, "id"> | null {
  const kind = c.kind.trim().toLowerCase();
  const text = c.text.trim();
  if (!text) return null;
  if (kind === "idea" && text !== idea.trim()) return { kind, target: "idea", label: "Your idea", before: idea, after: text };
  if (kind === "section" && c.section?.trim()) {
    const want = c.section.trim().replace(/^\[|\]$/g, "");
    const s = expansion?.sections.find((x) => x.heading.toLowerCase() === want.toLowerCase() || x.id === want);
    if (s && text === s.text.trim()) return null;
    return { kind, target: s?.id ?? "", label: `Concept · ${s?.heading ?? want}${s ? "" : " (new)"}`, before: s?.text ?? "", after: text, data: { heading: s?.heading ?? want } };
  }
  return null;
}

/** Applies an accepted idea or section change. */
export function applyIdeaChange(d: { expansion: Expansion | null }, c: ProposedChange, setIdea: (text: string) => void) {
  if (c.kind === "idea") setIdea(c.after);
  else if (c.kind === "section") {
    d.expansion ??= { sections: [], use: true, steer: "" };
    const s = d.expansion.sections.find((x) => x.id === c.target);
    if (s) s.text = c.after;
    else d.expansion.sections.push({ id: newId(), heading: String(c.data?.heading ?? "Notes"), text: c.after });
  }
}

export const LOOKUP_FIELD ='"lookup": ["a name or topic to look up on the wiki"] (or []),';

/** Splits "Taissa Turner & Van Palmer" or "Gen, Melissa & Crystal" into one name each (people get one entry apiece). */
export function splitPeople(title: string): string[] {
  const parts = title.split(/\s*(?:,|&|\band\b|\+)\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return [title];
  const looksLikeName = (s: string) => /^[\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*){0,3}$/u.test(s) && !/^(The|A|An)\s/.test(s);
  return parts.every(looksLikeName) ? parts : [title];
}

/** Lowercased, without a leading article: for matching names to titles written a little differently. */
export const nameKey = (s: string) => s.toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/['’]s\b/g, "").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();

/** Does a plan title (or one of its names) cover this name? "Natalie" ↔ "Natalie Scatorccio", "Coach Ben Scott" ↔ "Ben Scott". */
export function covers(names: string[], name: string): boolean {
  const n = nameKey(name);
  if (!n) return true;
  const words = n.split(" ");
  return names.some((t) => {
    const k = nameKey(t);
    if (!k) return false;
    if (k === n) return true;
    const kw = k.split(" ");
    // Whole words of one inside the other, and the shorter has a surname or is the longer's first name.
    const inside = (a: string[], b: string[]) => a.length <= b.length && b.join(" ").includes(a.join(" ")) && (a.length > 1 || b[0] === a[0] || b.at(-1) === a[0]);
    return inside(words, kw) || inside(kw, words);
  });
}
