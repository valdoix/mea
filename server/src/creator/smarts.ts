import { newId, now } from "../db/db";
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

export interface ChatTurn {
  role: "user" | "mea";
  text: string;
  at: number;
  /** Pages the co-writer looked up for this answer. */
  sources?: { title: string; url: string }[];
}

export interface ProposedChange {
  id: string;
  /** What it touches, in the studio's own terms ("bible", "field", "entry", "overview", "add", "remove", "rewrite"…). */
  kind: string;
  /** The section, field or item it applies to. */
  target: string;
  /** Shown on the card: "Voice", "Natalie Scatorccio · content". */
  label: string;
  before: string;
  after: string;
  /** For a background rewrite: what to ask the writer. */
  steer?: string;
  /** Anything else the change carries (a new entry's type and pitch, keys). */
  data?: Record<string, unknown>;
}

export interface Proposal {
  id: string;
  message: string;
  reply: string;
  changes: ProposedChange[];
  at: number;
}

export function addTurns(chat: ChatTurn[], ...turns: Omit<ChatTurn, "at">[]): ChatTurn[] {
  return [...chat, ...turns.filter((t) => t.text.trim()).map((t) => ({ ...t, text: t.text.trim().slice(0, 8000), at: now() }))].slice(-40);
}

/**
 * The co-writer's turn: ask, and if it wants wiki pages first, look them up and ask once more
 * with them. Returns the final reply and the pages it read.
 */
export async function withLookups<T extends { lookup?: string[] }>(
  ask: (looked: string) => Promise<T>,
  find: ((query: string) => Promise<{ title: string; url: string; text: string } | null>) | null,
): Promise<{ data: T; sources: { title: string; url: string }[] }> {
  const first = await ask("");
  const wants = (first.lookup ?? []).map((q) => q.trim()).filter(Boolean).slice(0, 3);
  if (!wants.length || !find) return { data: first, sources: [] };
  const pages = (await Promise.all(wants.map((q) => find(q).catch(() => null)))).filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (!pages.length) return { data: first, sources: [] };
  const looked = `PAGES YOU LOOKED UP (use them; don't ask to look these up again):\n${pages.map((p) => `### ${p.title}\n${p.text}`).join("\n\n")}`;
  const second = await ask(looked);
  return { data: { ...second, lookup: [] }, sources: pages.map((p) => ({ title: p.title, url: p.url })) };
}

export const chatBlock = (chat: ChatTurn[]) =>
  chat.length ? `THE CONVERSATION SO FAR:\n${chat.slice(-14).map((t) => `${t.role === "user" ? "AUTHOR" : "YOU"}: ${t.text.slice(0, 2000)}`).join("\n")}` : "";

export const newProposal = (message: string, reply: string, changes: Omit<ProposedChange, "id">[]): Proposal => ({ id: newId(), message, reply, changes: changes.map((c) => ({ ...c, id: newId() })), at: now() });

/** The co-writer's manner, the same in both studios: a companion to think out loud with, who can also make the edits. */
export const COWRITER = [
  "You are Mea, the author's co-writer and creative companion inside a writing studio: warm, curious, opinionated, and genuinely invested in their story. Talk like a friend who knows craft and knows the fandom, not like a form.",
  "Brainstorm freely: riff on their ideas, offer two or three distinct options with what each would do to the story, push back when something is flat or contradicts canon, notice what's exciting, and ask the one question that would unlock the next idea. Use what you know of canon and fanon (popular ships, interpretations, tropes) and say which is which.",
  "Only propose changes to the draft when they ask for a change, agree to an idea you offered (\"yes\", \"do that\", \"go with the second one\"), or a fix is obviously wanted. While you're still exploring, propose none. When you do: change only what the request needs, and everything it needs (if she gets older, every section and field that states or implies her age changes). Keep every other word as it is.",
  'Your "reply" is conversational and can run a few short paragraphs when brainstorming (light Markdown is fine: lists, bold); keep it to a couple of sentences when you\'re just applying edits. Never paste whole edited texts into the reply: they go in "changes".',
  'If you need facts you don\'t have (what happens to a character in canon, a place, an episode), list up to 3 wiki searches in "lookup" and propose nothing yet; you\'ll get the pages back.',
].join(" ");

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
