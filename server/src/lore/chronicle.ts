import { z } from "zod";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { notFound } from "../lib/http";
import { memoryConfig } from "../lib/settings";
import { chatNames } from "../memory/build";
import { entityCard, entityFacts, norm, resolver } from "../memory/entities";
import { getChatRow } from "../services/chats";
import type { JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import type { EntryExtra } from "./activate";
import { createEntry, createLorebook, getLorebook, linkedBooks, scanEntriesFor } from "./service";
import type { LoreEntry } from "./types";

/**
 * Story-born lore (LORE-12): each chat gets its own Chronicle book for the people, places and
 * objects the story introduces. New ones are proposed for review (never added on their own);
 * accepted entries are linked to their entity, so they also fire when it's in the scene (LORE-06).
 */

const TYPE: Record<string, EntryExtra["type"]> = { person: "character", place: "location", object: "item", group: "faction", concept: "concept" };

export interface ChronicleProposal {
  id: string;
  entityId: string | null;
  name: string;
  entry: Pick<LoreEntry, "comment" | "keys" | "content"> & { extra: EntryExtra };
  status: "open" | "accepted" | "rejected";
  createdAt: number;
}

interface Row {
  id: string;
  chat_id: string;
  entity_id: string | null;
  name: string;
  entry: string;
  status: string;
  created_at: number;
}

const out = (r: Row): ChronicleProposal => ({ id: r.id, entityId: r.entity_id, name: r.name, entry: parseJson(r.entry, { comment: r.name, keys: [r.name], content: "", extra: {} }), status: r.status as ChronicleProposal["status"], createdAt: r.created_at });

/** The chat's Chronicle book, created and linked on first use. */
export function chronicleBook(chatId: string) {
  for (const b of linkedBooks("chat", chatId)) {
    const book = getLorebook(b.id);
    if (book?.settings.chronicleFor === chatId) return book.id;
  }
  const title = getChatRow(chatId)?.title || "this story";
  return createLorebook({ name: `Chronicle — ${title}`, description: "People, places and things this story introduced. Proposed by Mea, kept by you.", settings: { chronicleFor: chatId }, links: [{ target_type: "chat", target_id: chatId }] });
}

const entrySchema = z.object({ comment: z.string().default(""), keys: z.array(z.string()).default([]), content: z.string().min(1) });

/** Background job after scene records: propose entries for what the story introduced. */
export async function runChronicle(chatId: string, job?: JobContext, opts: { max?: number } = {}) {
  if (!memoryConfig().chronicle) return [];
  const chat = getChatRow(chatId);
  if (!chat) return [];
  const names = chatNames(chatId);
  const res = resolver(chatId);
  // What lore already covers, by any key or alias.
  const covered = new Set<string>();
  for (const e of scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId })) for (const k of [...e.keys, ...(((e.extra ?? {}) as EntryExtra).aliases ?? []), e.comment]) if (k?.trim()) covered.add(norm(k));
  const asked = new Set(all<{ name: string; entity_id: string | null }>("SELECT name, entity_id FROM chronicle_proposals WHERE chat_id = ?", chatId).flatMap((r) => [norm(r.name), r.entity_id ?? ""]));
  const candidates = res.rows
    .filter((e) => ["person", "place", "object", "group"].includes(e.kind) && e.status !== "gone")
    .filter((e) => !parseJson<{ isUser?: boolean }>(e.data, {}).isUser && norm(e.name) !== norm(names.char) && norm(e.name) !== norm(names.user))
    .filter((e) => e.mentions >= 3 && !asked.has(e.id) && !res.namesOf(e).some((n) => covered.has(norm(n)) || asked.has(norm(n))))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, opts.max ?? 3);
  const made: ChronicleProposal[] = [];
  for (const e of candidates) {
    const facts = entityFacts(chatId, e, 12);
    let entry: ChronicleProposal["entry"] = {
      comment: e.name,
      keys: res.namesOf(e).slice(0, 6),
      content: [entityCard(e), ...facts.map((f) => f.content)].filter(Boolean).join("\n").slice(0, 1500),
      extra: { type: TYPE[e.kind], aliases: parseJson<string[]>(e.aliases, []), entity: e.name, essentials: entityCard(e).slice(0, 240) },
    };
    if (!shouldShed("verification", chatId) && facts.length >= 2) {
      try {
        const r = await callJson({
          task: "summarizer",
          kind: "chronicle",
          chatId,
          jobId: job?.id,
          name: "chronicle_entry",
          schema: entrySchema,
          system: `Write a lorebook entry for ${e.name} (${TYPE[e.kind] ?? e.kind}) from a story's notes, so the story can stay consistent about them. Third person, present tense, 60–140 words: who or what they are, how they look or work, what matters about them now. Only what the notes say; keep names and numbers exact. "keys": the names and short phrases that should trigger it. Reply with JSON only: {"comment": "${e.name}", "keys": ["…"], "content": "…"}`,
          user: `NOTES:\n${[entityCard(e), ...facts.map((f) => `- ${f.content}`)].join("\n")}`,
          maxTokens: 600,
        });
        // The entity's own names are the anchor: a title that drifts from them, or a "key" that's a sentence, is dropped.
        const c = r.data.comment.trim();
        const title = c && norm(c).includes(norm(e.name)) && c.split(/\s+/).length <= 6 && !/^[-•*]/.test(c) && !/[.!?]$/.test(c) ? c : e.name;
        const keys = r.data.keys.map((k) => k.trim()).filter((k) => k.length >= 2 && k.length <= 40 && !/[.!?]$/.test(k) && !/^[-•]/.test(k));
        entry = { ...entry, comment: title, keys: [...new Set([...entry.keys, ...keys])].slice(0, 8), content: r.data.content.trim() };
      } catch {
        // the notes make a fine draft
      }
    }
    const id = newId();
    run("INSERT INTO chronicle_proposals (id, chat_id, entity_id, name, entry, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)", id, chatId, e.id, e.name, JSON.stringify(entry), now(), now());
    made.push(out(one<Row>("SELECT * FROM chronicle_proposals WHERE id = ?", id)!));
  }
  if (made.length) publish({ type: "memory.changed", chatId });
  return made;
}

export function chronicleProposals(chatId: string, status = "open") {
  return all<Row>("SELECT * FROM chronicle_proposals WHERE chat_id = ? AND status = ? ORDER BY created_at DESC", chatId, status).map(out);
}

/** Accept (optionally edited): the entry goes into the chat's Chronicle book. */
export function acceptChronicle(id: string, edited?: Partial<ChronicleProposal["entry"]>) {
  const r = one<Row>("SELECT * FROM chronicle_proposals WHERE id = ?", id);
  if (!r) throw notFound("Proposal not found");
  const p = out(r);
  const entry = { ...p.entry, ...edited, extra: { ...p.entry.extra, ...(edited?.extra ?? {}) } };
  const bookId = chronicleBook(r.chat_id);
  const created = createEntry(bookId, { comment: entry.comment, keys: entry.keys, content: entry.content, extra: entry.extra as Record<string, unknown> });
  run("UPDATE chronicle_proposals SET status = 'accepted', entry = ?, updated_at = ? WHERE id = ?", JSON.stringify(entry), now(), id);
  return { bookId, entry: created };
}

export function rejectChronicle(id: string) {
  run("UPDATE chronicle_proposals SET status = 'rejected', updated_at = ? WHERE id = ?", now(), id);
}
