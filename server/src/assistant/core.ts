import { newId, now } from "../db/db";

/**
 * Meus, the one assistant in Mea: the co-writer in both studios and the story companion in every
 * chat. What every home shares lives here: its voice, the conversation, the lookup rounds before
 * it answers, and the proposals (exact changes you tick and apply). Each home brings its own brief,
 * lookups and kinds of change.
 */

export const ASSISTANT_NAME = "Meus";

export interface ChatTurn {
  /** "mea" is the assistant (the stored name from before it was called Meus). */
  role: "user" | "mea";
  text: string;
  at: number;
  /** Pages the assistant looked up for this answer. */
  sources?: { title: string; url: string }[];
}

export interface ProposedChange {
  id: string;
  /** What it touches, in the home's own terms ("bible", "field", "entry", "ledger", "codex"…). */
  kind: string;
  /** The section, field or item it applies to. */
  target: string;
  /** Shown on the card: "Voice", "Natalie Scatorccio · content". */
  label: string;
  before: string;
  after: string;
  /** For a background rewrite: what to ask the writer. */
  steer?: string;
  /** Anything else the change carries (a new entry's type and pitch, keys, ledger lines). */
  data?: Record<string, unknown>;
}

export interface Proposal {
  id: string;
  message: string;
  reply: string;
  changes: ProposedChange[];
  at: number;
}

export function addTurns<T extends ChatTurn>(chat: T[], ...turns: Omit<T, "at">[]): T[] {
  return [...chat, ...turns.filter((t) => t.text.trim()).map((t) => ({ ...t, text: t.text.trim().slice(0, 8000), at: now() }) as T)].slice(-40);
}

export const newProposal = (message: string, reply: string, changes: Omit<ProposedChange, "id">[]): Proposal => ({ id: newId(), message, reply, changes: changes.map((c) => ({ ...c, id: newId() })), at: now() });

export const chatBlock = (chat: { role: string; text: string }[], you = "AUTHOR") =>
  chat.length ? `THE CONVERSATION SO FAR:\n${chat.slice(-14).map((t) => `${t.role === "user" ? you : "YOU"}: ${t.text.slice(0, 2000)}`).join("\n")}` : "";

/** A page or record a lookup brought back. */
export interface Looked {
  title: string;
  text: string;
  url?: string;
}

/**
 * The assistant's turn: ask, and while it wants to read more first (wiki pages, the story's
 * records), look those up and ask again with everything read so far, up to `rounds` times.
 * Returns the final reply and what it read.
 */
export async function withLookups<T extends { lookup?: string[] }, P extends Looked = Looked>(
  ask: (looked: string, last: boolean) => Promise<T>,
  find: ((query: string) => Promise<P | null>) | null,
  opts: { rounds?: number; perRound?: number; heading?: string } = {},
): Promise<{ data: T; sources: P[] }> {
  const rounds = opts.rounds ?? 1;
  const read: P[] = [];
  const asked = new Set<string>();
  const block = () => (read.length ? `${opts.heading ?? "PAGES YOU LOOKED UP (use them; don't ask to look these up again)"}:\n${read.map((p) => `### ${p.title}\n${p.text}`).join("\n\n")}` : "");
  let data = await ask("", rounds === 0);
  for (let round = 0; round < rounds; round++) {
    const wants = (data.lookup ?? []).map((q) => q.trim()).filter((q) => q && !asked.has(q.toLowerCase())).slice(0, opts.perRound ?? 3);
    if (!wants.length || !find) break;
    for (const q of wants) asked.add(q.toLowerCase());
    const pages = (await Promise.all(wants.map((q) => find(q).catch(() => null)))).filter((p): p is NonNullable<typeof p> => Boolean(p));
    if (!pages.length) break;
    for (const p of pages) if (!read.some((x) => x.title === p.title)) read.push(p);
    data = await ask(block(), round === rounds - 1);
  }
  return { data: { ...data, lookup: [] }, sources: read };
}

/** Meus's manner, the same everywhere: a companion to think out loud with, who can also make the edits. */
export const VOICE =
  `You are ${ASSISTANT_NAME}: warm, curious, opinionated, and genuinely invested in the author's story. Talk like a friend who knows craft and knows the fandom, not like a form.`;

/** When to propose changes, in any home. */
export const CHANGE_DISCIPLINE =
  'Only propose changes when they ask for a change, agree to an idea you offered ("yes", "do that", "go with the second one"), or a fix is obviously wanted. While you\'re still exploring, propose none. When you do: change only what the request needs, and everything it needs. Keep every other word as it is.';

/** The co-writer in both studios. */
export const COWRITER = [
  `You are ${ASSISTANT_NAME}, the author's co-writer and creative companion inside a writing studio: warm, curious, opinionated, and genuinely invested in their story. Talk like a friend who knows craft and knows the fandom, not like a form.`,
  "Brainstorm freely: riff on their ideas, offer two or three distinct options with what each would do to the story, push back when something is flat or contradicts canon, notice what's exciting, and ask the one question that would unlock the next idea. Use what you know of canon and fanon (popular ships, interpretations, tropes) and say which is which.",
  "Only propose changes to the draft when they ask for a change, agree to an idea you offered (\"yes\", \"do that\", \"go with the second one\"), or a fix is obviously wanted. While you're still exploring, propose none. When you do: change only what the request needs, and everything it needs (if she gets older, every section and field that states or implies her age changes). Keep every other word as it is.",
  'Your "reply" is conversational and can run a few short paragraphs when brainstorming (light Markdown is fine: lists, bold); keep it to a couple of sentences when you\'re just applying edits. Never paste whole edited texts into the reply: they go in "changes".',
  'If you need facts you don\'t have (what happens to a character in canon, a place, an episode), list up to 3 wiki searches in "lookup" and propose nothing yet; you\'ll get the pages back.',
].join(" ");
