import { z } from "zod";
import { all, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest } from "../lib/http";
import { memoryConfig } from "../lib/settings";
import { chatNames } from "../memory/build";
import { getCard } from "../services/characters";
import { getChatRow, mustChat } from "../services/chats";
import type { JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { getDefaultPersona, getPersona, personaPrompt } from "../services/personas";
import { shouldShed } from "../services/quota";
import type { ScanEntry } from "./activate";
import { chronicleBook } from "./chronicle";
import { addFact, factLine, factsNow, type LoreFact } from "./facts";
import type { FactOp } from "./keepup";
import { createEntry, getLorebook, linkedBooks } from "./service";
import { defaultEntry } from "./types";

/**
 * Since the card. The character card and the persona are written once and shared by every chat
 * they play in, so the story never rewrites them. But after a long story the card's "cold and
 * distrustful of everyone" isn't false by any tracker, just out of date. Each chat keeps a short,
 * always-on entry per card in its Chronicle ("Since the card: {{char}}", "Since the card: {{user}}")
 * whose lines are facts: who they've become, what the card no longer says. Like the Bond, they follow
 * swipes and Undo; the keep-up job proposes them from new memories, each citing one, as Inbox cards.
 */

export type SinceWho = "character" | "persona";
export const SINCE_WHO: SinceWho[] = ["character", "persona"];
/** The parts of a person the note covers (a tracker already says where they are and what they carry). */
export const SINCE_SLOTS = ["temperament", "toward", "believes", "wants", "fears", "habit", "looks", "life"];
/** An always-on entry stays short: past this many lines, the model has to supersede instead of add. */
const MAX_LINES = 12;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
const macro = (who: SinceWho) => (who === "character" ? "{{char}}" : "{{user}}");

type SinceExtra = { sinceCard?: { chatId: string; who: SinceWho } };
export const sinceCardOf = (e: { extra?: unknown }) => (e.extra as SinceExtra | undefined)?.sinceCard ?? null;

/** The chat's Since the card entry for one card (made in its Chronicle the first time). */
export function sinceCardEntry(chatId: string, who: SinceWho, create = true): string | null {
  const books = linkedBooks("chat", chatId).map((b) => getLorebook(b.id)).filter((b) => b?.settings.chronicleFor === chatId);
  for (const b of books) {
    const found = b!.entries.find((e) => sinceCardOf(e)?.chatId === chatId && sinceCardOf(e)?.who === who);
    if (found) return found.id;
  }
  if (!create) return null;
  const name = macro(who);
  return createEntry(
    chronicleBook(chatId),
    defaultEntry({
      comment: `Since the card: ${name}`,
      constant: true,
      order: 135,
      content: `Who ${name} is now, in this story. The ${who === "character" ? "card" : "persona"} describes ${name} as they were when it was written; where it disagrees with these lines, these lines are true now.`,
      extra: { sinceCard: { chatId, who }, type: "concept", essentials: `${name}, as the story has changed them.` },
    }),
  ).id;
}

/** Who a chat has a card for: its character always, the persona when there is one. */
export function sinceWhos(chatId: string): SinceWho[] {
  const chat = getChatRow(chatId);
  if (!chat) return [];
  const persona = getPersona(chat.persona_id) ?? getDefaultPersona();
  return [...(chat.character_id ? (["character"] as const) : []), ...(persona ? (["persona"] as const) : [])];
}

/** The card's own words about them, as written (what the note is measured against). */
export function cardWords(chatId: string, who: SinceWho): string {
  const chat = getChatRow(chatId);
  if (!chat) return "";
  if (who === "persona") return personaPrompt(getPersona(chat.persona_id) ?? getDefaultPersona());
  const card = chat.character_id ? getCard(chat.character_id) : undefined;
  return card ? [card.description, card.personality].filter((s) => s?.trim()).join("\n") : "";
}

/** How far the keep-up job has read memories for one card (kept on the chat, so no entry is needed to start). */
export function sinceRead(chatId: string, who: SinceWho): number {
  const s = parseJson<{ sinceCardAt?: Partial<Record<SinceWho, number>> }>(one<{ settings: string }>("SELECT settings FROM chats WHERE id = ?", chatId)?.settings ?? "{}", {});
  return s.sinceCardAt?.[who] ?? 0;
}
export function setSinceRead(chatId: string, who: SinceWho, at: number) {
  const s = parseJson<Record<string, unknown> & { sinceCardAt?: Partial<Record<SinceWho, number>> }>(one<{ settings: string }>("SELECT settings FROM chats WHERE id = ?", chatId)?.settings ?? "{}", {});
  run("UPDATE chats SET settings = ? WHERE id = ?", JSON.stringify({ ...s, sinceCardAt: { ...s.sinceCardAt, [who]: at } }), chatId);
}

const nameOf = (chatId: string, who: SinceWho) => (who === "character" ? chatNames(chatId).char : chatNames(chatId).user);

interface AtomLite {
  id: string;
  content: string;
  created_at: number;
  msg: string | null;
}

/**
 * New memories about them since the last check, the most important twenty, and how far it read.
 * A first run on a long chat reads its newest memories, not its first: who they are now matters.
 */
export function sinceAtoms(chatId: string, who: SinceWho, since: number): { atoms: AtomLite[]; at: number } {
  const name = norm(nameOf(chatId, who));
  if (name.length < 2) return { atoms: [], at: since };
  const rows = all<AtomLite & { entities: string; importance: number }>(
    `SELECT a.id, a.content, a.created_at, a.entities, a.importance,
       (SELECT s.message_id FROM memory_sources s JOIN messages m ON m.id = s.message_id WHERE s.memory_id = a.id AND m.deleted_at IS NULL ORDER BY s.seq DESC LIMIT 1) AS msg
     FROM memories a WHERE a.chat_id = ? AND a.deleted_at IS NULL AND a.status = 'active' AND a.origin != 'tracker' AND a.created_at > ?
     ORDER BY a.created_at DESC LIMIT 300`,
    chatId,
    since,
  );
  const about = rows.filter((a) => parseJson<string[]>(a.entities, []).some((n) => norm(n) === name) || ` ${norm(a.content)} `.includes(` ${name} `));
  const atoms = [...about]
    .sort((a, b) => b.importance - a.importance || b.created_at - a.created_at)
    .slice(0, 20)
    .sort((a, b) => a.created_at - b.created_at);
  return { atoms, at: rows[0]?.created_at ?? since };
}

const sentencesOf = (text: string) => text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);

/** The card sentence a quote comes from, as the card says it (a quote that isn't in the card is dropped). */
export function cardSentence(card: string, quote: string | null | undefined): string | undefined {
  const q = norm(quote ?? "");
  if (q.length < 8) return undefined;
  return sentencesOf(card).find((s) => norm(s).includes(q) || (q.includes(norm(s)) && norm(s).length >= 8));
}

const opsSchema = z.object({
  ops: z
    .array(
      z.object({
        op: z.enum(["add", "supersede", "retire"]),
        slot: z.string().nullable().optional(),
        value: z.string().default(""),
        fact: z.string().nullable().optional(),
        cite: z.string().nullable().optional(),
        card: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

/**
 * One model call: what the new memories show has lastingly changed about them, measured against the
 * card. Every operation cites a memory; an uncited one is dropped, and a quote from the card that
 * isn't really there is left off.
 */
export async function sinceCardOps(chatId: string, who: SinceWho, atoms: AtomLite[], facts: LoreFact[], job?: JobContext): Promise<FactOp[]> {
  if (!atoms.length || shouldShed("verification", chatId)) return [];
  const name = nameOf(chatId, who);
  const other = who === "character" ? chatNames(chatId).user : chatNames(chatId).char;
  const card = cardWords(chatId, who);
  const F = facts.map((f, i) => ({ ref: `F${i + 1}`, f }));
  const A = atoms.map((a, i) => ({ ref: `M${i + 1}`, a }));
  const full = facts.length >= MAX_LINES;
  let data: z.infer<typeof opsSchema>;
  try {
    data = (
      await callJson({
        task: "summarizer",
        kind: "since the card",
        chatId,
        jobId: job?.id,
        name: "since_card",
        schema: opsSchema,
        system: `You keep a short note on how ${name} has changed in a long story since their ${who === "character" ? "character card" : "persona"} was written. The ${who === "character" ? "card" : "persona"} stays as written; the note says who they are now where that differs. You get the ${who === "character" ? "card" : "persona"}, the note's lines now (F1…) and new memories from the story (M1…). Propose only lasting changes the memories clearly show: their temperament, how they treat someone ("toward": name them, e.g. "toward ${other}: trusts her with the keys"), what they believe, want or fear, a new habit, how they look, their life (work, home, role). Skip where they are, injuries, what they carry (the story's records hold those), passing moods, one-off actions, and anything the ${who === "character" ? "card" : "persona"} or the note already says. When a line changes, supersede it rather than adding a second one${full ? `; the note is full (${MAX_LINES} lines), so only supersede or retire` : ""}. When a change makes a sentence of the ${who === "character" ? "card" : "persona"} out of date, quote that sentence as "card". Lines are short and plain, in present tense, keeping names word for word. Most memories change nothing; an empty list is the usual answer. Every operation must cite the memory it rests on. Reply with JSON only: {"ops": [{"op": "add|supersede|retire", "slot": "${SINCE_SLOTS.join("|")}", "value": "the line", "fact": "F2 for supersede/retire", "cite": "M3", "card": "the sentence it updates, or null"}]}`,
        user: `${who === "character" ? "CARD" : "PERSONA"}: ${name}\n${card.slice(0, 2500) || "(empty)"}\n\nTHE NOTE NOW:\n${F.map((x) => `${x.ref}. ${factLine(x.f)}`).join("\n") || "(nothing yet)"}\n\nNEW MEMORIES:\n${A.map((x) => `${x.ref}. ${x.a.content}`).join("\n")}`,
        maxTokens: 700,
      })
    ).data;
  } catch {
    return [];
  }
  const out: FactOp[] = [];
  for (const o of data.ops.slice(0, 6)) {
    const cite = A.find((x) => x.ref === o.cite?.trim());
    if (!cite) continue;
    const value = o.value.replace(/\s+/g, " ").trim().slice(0, 300);
    const fact = F.find((x) => x.ref === o.fact?.trim())?.f;
    const raw = o.slot?.trim().toLowerCase() || fact?.slot || null;
    // "toward Alex" is a "toward" line: the name goes in the line, so one slot holds one person each.
    const slot = raw && SINCE_SLOTS.some((s) => raw === s || raw.startsWith(`${s} `)) ? raw : null;
    const against = cardSentence(card, o.card);
    const base = { slot, messageId: cite.a.msg, origin: "story" as const, cite: cite.a.id, citeText: cite.a.content, kind: slot === "habit" ? ("habit" as const) : ("attribute" as const), ...(against ? { against } : {}) };
    if (o.op === "add" && value && !full && !facts.some((f) => norm(f.value) === norm(value))) out.push({ op: "add", value, ...base });
    else if (o.op === "supersede" && fact && value && norm(value) !== norm(fact.value)) out.push({ op: "supersede", value, factId: fact.id, old: fact.value, ...base, ...(fact.locked ? { locked: true } : {}) });
    else if (o.op === "retire" && fact) out.push({ op: "retire", value: fact.value, old: fact.value, factId: fact.id, ...base, ...(fact.locked ? { locked: true } : {}) });
  }
  return out;
}

/** The keep-up job's ScanEntry for a Since the card entry, titled with the real name for the Inbox. */
export function sinceScanEntry(entryId: string, chatId: string, who: SinceWho): ScanEntry | null {
  const bookId = one<{ lorebook_id: string }>("SELECT lorebook_id FROM lorebook_entries WHERE id = ?", entryId)?.lorebook_id;
  const book = bookId ? getLorebook(bookId) : undefined;
  const e = book?.entries.find((x) => x.id === entryId);
  return book && e ? { ...e, bookId: book.id, bookName: book.name, book: book.settings, comment: `Since the card: ${nameOf(chatId, who)}` } : null;
}

export interface SinceCardPage {
  enabled: boolean;
  people: { who: SinceWho; name: string; entryId: string | null; lines: LoreFact[] }[];
}

/** Side dock › Story › Since the card: each card's lines now. */
export function sinceCardPage(chatId: string): SinceCardPage {
  mustChat(chatId);
  return {
    enabled: memoryConfig().sinceCard,
    people: sinceWhos(chatId).map((who) => {
      const entryId = sinceCardEntry(chatId, who, false);
      return { who, name: nameOf(chatId, who), entryId, lines: entryId ? factsNow(entryId, chatId) : [] };
    }),
  };
}

/** A line you add yourself: locked, so the story won't rewrite your words, and from the newest message on. */
export function addSinceLine(chatId: string, who: SinceWho, value: string, slot?: string | null) {
  const v = value.replace(/\s+/g, " ").trim();
  if (!v) throw badRequest("Say what has changed");
  if (!sinceWhos(chatId).includes(who)) throw badRequest(who === "persona" ? "This chat has no persona" : "This chat has no character");
  const entryId = sinceCardEntry(chatId, who)!;
  const messageId = one<{ id: string }>("SELECT id FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1", chatId)?.id ?? null;
  const s = slot?.trim().toLowerCase() || null;
  const r = addFact(entryId, { value: v, slot: s, kind: s === "habit" ? "habit" : "attribute", chatId, messageId, origin: "you", locked: true });
  publish({ type: "lore.facts", entryId, chatId });
  return { fact: r.fact, undo: r.undo };
}
