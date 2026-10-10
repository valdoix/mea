import { z } from "zod";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { type ArchiveCitation, gatherSources } from "../accuracy/archivist";
import { addTurns, ASSISTANT_NAME, CHANGE_DISCIPLINE, type ChatTurn, chatBlock, type Proposal, newProposal, withLookups } from "../assistant/core";
import { GRAMMAR } from "../trackers/prompts";
import { mustChat } from "../services/chats";
import { callJson } from "../services/llm";
import { buildBrief, type BriefHeader } from "./brief";
import { applyChange, CHANGE_KINDS, checkChanges, type UndoStep, undoStep } from "./changes";
import { LOOKUPS, lookup } from "./lookups";

/**
 * Meus in a chat: out of character, it answers from the story with sources, brainstorms from what's
 * open in it, and fixes things (the cast, the clock, the records, the Codex, memory, past messages,
 * the next reply), always as a card you tick and apply, with one Undo for the whole set.
 * Nothing here is ever read by the prompt, memory or the trackers; only what you apply reaches the story.
 */

export interface MeusTurn extends ChatTurn {
  /** Story sources the answer cites ([1] [2]). */
  cites?: ArchiveCitation[];
  /** What it looked up first. */
  reads?: string[];
  /** The last message it had read. */
  seq?: number;
  /** A change set this turn applied or undid. */
  setId?: string;
}

export interface MeusSet {
  id: string;
  at: number;
  labels: string[];
  undo: UndoStep[];
  failed: string[];
  undone: boolean;
}

interface Row {
  chat_id: string;
  turns: string;
  proposal: string | null;
  sets: string;
  updated_at: number;
}

function load(chatId: string) {
  mustChat(chatId);
  let r = one<Row>("SELECT * FROM meus WHERE chat_id = ?", chatId);
  if (!r) {
    // The Ask tab's answers come along as Meus's history.
    const old = all<{ question: string; answer: string; citations: string; created_at: number }>("SELECT question, answer, citations, created_at FROM archivist WHERE chat_id = ? ORDER BY created_at LIMIT 30", chatId);
    const turns: MeusTurn[] = old.flatMap((a) => [
      { role: "user" as const, text: a.question, at: a.created_at },
      { role: "mea" as const, text: a.answer, at: a.created_at, cites: parseJson<{ citations: ArchiveCitation[] }>(a.citations, { citations: [] }).citations },
    ]);
    run("INSERT INTO meus (chat_id, turns, proposal, sets, updated_at) VALUES (?, ?, NULL, '[]', ?)", chatId, JSON.stringify(turns), now());
    r = one<Row>("SELECT * FROM meus WHERE chat_id = ?", chatId)!;
  }
  return { turns: parseJson<MeusTurn[]>(r.turns, []), proposal: parseJson<Proposal | null>(r.proposal, null), sets: parseJson<MeusSet[]>(r.sets, []) };
}

function save(chatId: string, s: ReturnType<typeof load>) {
  run("UPDATE meus SET turns = ?, proposal = ?, sets = ?, updated_at = ? WHERE chat_id = ?", JSON.stringify(s.turns.slice(-60)), s.proposal ? JSON.stringify(s.proposal) : null, JSON.stringify(s.sets.slice(-20)), now(), chatId);
  publish({ type: "meus.changed", chatId });
}

export function meusView(chatId: string) {
  const s = load(chatId);
  let header: BriefHeader | null = null;
  try {
    header = buildBrief(chatId).header;
  } catch {
    header = null;
  }
  return {
    turns: s.turns,
    proposal: s.proposal,
    sets: s.sets.slice(-10).reverse().map(({ undo: _u, ...rest }) => rest),
    header,
  };
}

const turnSchema = z.object({
  reply: z.string().default(""),
  cites: z.array(z.coerce.number()).default([]),
  lookup: z.array(z.string()).default([]),
  changes: z.array(z.record(z.string(), z.unknown())).default([]),
});

const SYSTEM = [
  `You are ${ASSISTANT_NAME}, the player's story companion inside one chat of their roleplay: warm, curious, opinionated, and genuinely invested in their story. Talk like a friend who knows craft and knows the fandom, not like a form.`,
  "You are OUT OF CHARACTER. Nothing you say goes into the story; you talk with the player (the human who plays their persona and runs this story) about it. Never write the story's next reply yourself.",
  "You can: answer questions about the story from what it keeps (cite the numbered SOURCES like [2], and say plainly when the story doesn't establish something); brainstorm (riff, offer two or three distinct options and what each would do, push back, ground ideas in what's open: unpaid debts, unrevealed secrets, planted details with no payoff, deadlines, quiet threads); catch them up; notice what's inconsistent; and change things for them.",
  "Read WHO IS WHO first and keep it straight: the player's persona is the player's own character, never the character card, and never someone the AI plays. Merging, editing or describing people, always say whose side they're on.",
  CHANGE_DISCIPLINE,
  "Every change you propose is shown to the player as a card they tick and apply, with Undo; they see exactly what will change. Use the ids in [brackets] and the exact names from the cast. When a fact changes, change it everywhere it's kept (the records, the Codex page, memory) in one proposal.",
  "You can't change the character card or the persona card from here (only this chat): for a change to a card itself, say so and suggest Meus in the Studio. Facts about people in THIS story go in the story's records.",
  `Changes you can propose: ${CHANGE_KINDS}`,
  `THE LEDGER GRAMMAR (for "ledger" lines):\n${GRAMMAR}`,
  `If you need to read more before answering, list up to 3 lookups in "lookup" and propose nothing yet; you'll get them back. Lookups: ${LOOKUPS}`,
  'Your "reply" is conversational and can run a few short paragraphs when brainstorming (light Markdown is fine: lists, bold); keep it to a sentence or two when you\'re proposing edits, and never paste the edits themselves into it. Refer to messages as #number.',
  'Reply with JSON only: {"reply": "…", "cites": [1], "lookup": [], "changes": [ … ]}',
].join("\n\n");

/** One message to Meus: it reads the story, maybe looks things up, and answers (maybe with a change card). */
export async function meusTurn(chatId: string, message: string) {
  const text = message.trim();
  if (!text) throw badRequest("Write something to Meus");
  const s = load(chatId);
  const brief = buildBrief(chatId);
  let sources: (ArchiveCitation & { key: string })[] = [];
  try {
    sources = await gatherSources(chatId, text, 14);
  } catch {
    sources = [];
  }
  const sourceBlock = sources.length ? `SOURCES (numbered, for citing):\n${sources.map((x) => `[${x.n}] (${x.type}${x.seq != null ? `, #${x.seq}` : ""}${x.type === "memory" && x.ownerId ? `, memory id ${x.ownerId}` : ""}) ${x.excerpt.slice(0, 600)}`).join("\n")}` : "";
  const ask = async (looked: string, last: boolean) =>
    (
      await callJson({
        task: "assistant",
        kind: "meus",
        chatId,
        name: "meus_turn",
        schema: turnSchema,
        system: SYSTEM,
        user: [brief.text, sourceBlock, chatBlock(s.turns, "PLAYER"), looked, last && looked ? "You can't look anything else up now: answer with what you have." : "", `THE PLAYER SAYS: ${text}`].filter(Boolean).join("\n\n"),
        maxTokens: 6000,
        temperature: 0.6,
      })
    ).data;
  const { data, sources: read } = await withLookups(ask, (q) => lookup(chatId, q), { rounds: 3, heading: "WHAT YOU LOOKED UP (use it; don't look these up again)" });
  const { changes, dropped } = checkChanges(chatId, data.changes);
  const cited = new Set([...data.cites, ...[...data.reply.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))]);
  const cites = sources.filter((x) => cited.has(x.n)).map(({ key: _k, ...x }) => x);
  let reply = data.reply.trim() || (changes.length ? "Here's what I'd change." : "I'm not sure what to say to that yet.");
  if (dropped.length) reply += `\n\n_Left out: ${dropped.slice(0, 6).join("; ")}._`;
  const proposal = changes.length ? newProposal(text, reply, changes) : null;
  s.turns = addTurns<MeusTurn>(s.turns, { role: "user", text, seq: brief.header.seq }, { role: "mea", text: reply, seq: brief.header.seq, ...(cites.length ? { cites } : {}), ...(read.length ? { reads: read.map((p) => p.title) } : {}) });
  s.proposal = proposal;
  save(chatId, s);
  return meusView(chatId);
}

/** Applies the ticked changes, in order; one set, one Undo. */
export function applyMeus(chatId: string, accept: string[]) {
  const s = load(chatId);
  const p = s.proposal;
  if (!p) throw badRequest("There's nothing to apply");
  const ok = p.changes.filter((c) => accept.includes(c.id));
  const set: MeusSet = { id: newId(), at: now(), labels: [], undo: [], failed: [], undone: false };
  for (const c of ok) {
    try {
      set.undo.push(...applyChange(chatId, c));
      set.labels.push(c.label);
    } catch (e) {
      set.failed.push(`${c.label}: ${(e as Error).message}`);
    }
  }
  s.proposal = null;
  if (set.labels.length) s.sets.push(set);
  const note = `Applied ${set.labels.length} of ${p.changes.length} change${p.changes.length === 1 ? "" : "s"}.${set.failed.length ? ` Couldn't apply: ${set.failed.join("; ")}.` : ""}`;
  s.turns = addTurns<MeusTurn>(s.turns, { role: "mea", text: note, ...(set.labels.length ? { setId: set.id } : {}) });
  save(chatId, s);
  return { ...meusView(chatId), applied: set.labels.length, setId: set.labels.length ? set.id : null };
}

export function dismissMeus(chatId: string) {
  const s = load(chatId);
  s.proposal = null;
  save(chatId, s);
  return meusView(chatId);
}

/** Undoes a whole applied set, last change first. */
export function undoMeus(chatId: string, setId: string) {
  const s = load(chatId);
  const set = s.sets.find((x) => x.id === setId);
  if (!set) throw notFound("That change set is gone");
  if (set.undone) return meusView(chatId);
  const failed: string[] = [];
  for (const step of [...set.undo].reverse()) {
    try {
      undoStep(chatId, step);
    } catch (e) {
      failed.push((e as Error).message);
    }
  }
  set.undone = true;
  s.turns = addTurns<MeusTurn>(s.turns, { role: "mea", text: `Undid: ${set.labels.join("; ")}.${failed.length ? ` Some of it couldn't be undone: ${failed.join("; ")}.` : ""}`, setId });
  save(chatId, s);
  return meusView(chatId);
}

export function clearMeus(chatId: string) {
  const s = load(chatId);
  s.turns = [];
  s.proposal = null;
  save(chatId, s);
  return meusView(chatId);
}
