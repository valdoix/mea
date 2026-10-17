import { z } from "zod";
import { all, now, one, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { getCard } from "../services/characters";
import type { JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { stashRestore } from "../services/undo";
import { extraOf } from "./activate";
import { createFact, factsNow, type LoreFact } from "./facts";
import { createEntry, getLorebook } from "./service";
import { slotDef, slotsFor } from "./slots";
import { defaultEntry } from "./types";

/**
 * Invented details at build time (docs/15, 3.2). When a companion book is built, the slots the card
 * states become canon facts (from the card), and the ones it leaves open are drafted, marked
 * *invented*, so the model doesn't invent a different childhood home in every chat. Unconfirmed
 * ones are sent as "likely", not as fact, until you keep them (one card, Keep all) or clear them.
 */

const detailsSchema = z.object({
  card: z.array(z.object({ slot: z.string(), value: z.string() })).default([]),
  invented: z.array(z.object({ slot: z.string(), value: z.string() })).default([]),
});

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/** The entry a character's details live on: theirs in the book, or a small one made for them. */
export function detailsEntry(bookId: string, name: string) {
  const book = getLorebook(bookId);
  if (!book) throw notFound("Lorebook not found");
  const n = norm(name);
  const own = book.entries.find((e) => [e.comment, ...e.keys, extraOf(e).entity ?? ""].some((k) => norm(k) === n));
  if (own) return own.id;
  // The companion book has no entry for the character (the card covers them): one holds the detail sheet.
  return createEntry(
    bookId,
    defaultEntry({
      comment: name,
      keys: [name],
      content: `${name}'s small details: the things the card leaves open, kept the same in every chat.`,
      order: 90,
      extra: { type: "character", entity: name, essentials: `${name}'s small details.` },
    }),
  ).id;
}

/**
 * Drafts the detail sheet for a character's entry: what the card states (canon) and what it
 * leaves open (invented, to confirm). Slots that already have a fact are left alone.
 */
export async function draftDetails(entryId: string, characterId: string, job?: JobContext): Promise<{ card: LoreFact[]; invented: LoreFact[] }> {
  const card = getCard(characterId);
  if (!card) throw notFound("Character not found");
  const row = one<{ data: string }>("SELECT data FROM lorebook_entries WHERE id = ?", entryId);
  if (!row) throw notFound("Entry not found");
  if (shouldShed("verification")) return { card: [], invented: [] };
  const slots = slotsFor("character");
  const have = new Set(factsNow(entryId, null).map((f) => f.slot).filter(Boolean));
  const open = slots.filter((s) => !have.has(s.key));
  if (!open.length) return { card: [], invented: [] };
  const r = await callJson({
    task: "helper",
    kind: "lore details",
    jobId: job?.id,
    name: "lore_details",
    schema: detailsSchema,
    system: `Fill in a character's detail sheet so every chat keeps the small things the same. "card": slots the card states, word for word as the card says them. "invented": slots it leaves open, filled with one short, specific, plausible value that fits the card (never contradicting it). Keep values short ("grey", "a scar across her left palm", "hums when nervous"). Skip a slot if nothing fits. Use only the slot keys given. Reply with JSON only: {"card": [{"slot": "eyes", "value": "…"}], "invented": [{"slot": "…", "value": "…"}]}`,
    user: `CHARACTER: ${card.name}\n${[card.description, card.personality, card.scenario].filter((x) => x.trim()).join("\n\n").slice(0, 6000)}\n\nSLOTS:\n${open.map((s) => `- ${s.key}: ${s.label.replace("{{user}}", "the user")} (e.g. ${s.hint})`).join("\n")}`,
    maxTokens: 900,
    temperature: 0.7,
  });
  const out = { card: [] as LoreFact[], invented: [] as LoreFact[] };
  const used = new Set<string>();
  const take = (list: { slot: string; value: string }[], origin: "card" | "invented") => {
    for (const x of list) {
      const def = slotDef(x.slot);
      const value = x.value.replace(/\s+/g, " ").trim().slice(0, 200);
      if (!def || !value || have.has(def.key) || (!def.list && used.has(def.key))) continue;
      used.add(def.key);
      out[origin].push(createFact(entryId, { value, slot: def.key, kind: def.kind, origin }).fact);
    }
  };
  take(r.data.card, "card");
  take(r.data.invented, "invented");
  if (out.invented.length) publish({ type: "inbox.changed" });
  return out;
}

/** The job after a companion book is built: its character's detail sheet. */
export async function runDetailsJob(p: { bookId: string; characterId: string }, job?: JobContext) {
  const card = getCard(p.characterId);
  if (!card || !getLorebook(p.bookId)) return null;
  return draftDetails(detailsEntry(p.bookId, card.name), p.characterId, job);
}

// ---------- confirming them ----------

/** Invented facts still waiting for your yes, by entry. */
export function inventedFacts() {
  const rows = all<{ entry_id: string; name: string; book_id: string }>(
    `SELECT DISTINCT f.entry_id, COALESCE(json_extract(e.data, '$.comment'), '') AS name, e.lorebook_id AS book_id FROM lore_facts f JOIN lorebook_entries e ON e.id = f.entry_id
     JOIN lorebooks b ON b.id = e.lorebook_id WHERE f.status = 'invented' AND f.deleted_at IS NULL AND f.chat_id IS NULL AND b.deleted_at IS NULL`,
  );
  return rows.map((r) => ({ entryId: r.entry_id, name: r.name, bookId: r.book_id, facts: factsNow(r.entry_id, null).filter((f) => f.status === "invented") })).filter((x) => x.facts.length);
}

/** Keep (with your edits, one line per fact in order), or clear, an entry's invented facts. */
export function decideDetails(entryId: string, action: "accept" | "reject", opts: { edited?: string; slot?: string; value?: string } = {}) {
  const facts = factsNow(entryId, null).filter((f) => f.status === "invented" && (!opts.slot || f.slot === opts.slot));
  if (!facts.length) throw badRequest("Nothing is waiting for a yes here");
  const lines = opts.edited?.split("\n").map((l) => l.trim()).filter(Boolean) ?? [];
  const before = facts.map((f) => ({ id: f.id, value: f.value }));
  const t = now();
  facts.forEach((f, i) => {
    if (action === "reject") return run("UPDATE lore_facts SET deleted_at = ?, updated_at = ? WHERE id = ?", t, t, f.id);
    const line = opts.value ?? lines[i]?.replace(/^[-•]\s*/, "");
    const value = line ? (f.slot && line.toLowerCase().startsWith(`${f.slot}:`) ? line.slice(f.slot.length + 1).trim() : line.replace(/^[^:]{1,30}:\s*/, (m) => (slotDef(m.slice(0, -1).trim().toLowerCase()) ? "" : m))) : f.value;
    run("UPDATE lore_facts SET status = 'active', value = ?, updated_at = ? WHERE id = ?", value || f.value, t, f.id);
  });
  publish({ type: "lore.facts", entryId, chatId: null });
  publish({ type: "inbox.changed" });
  return stashRestore(action === "accept" ? "Kept" : "Cleared", () => {
    for (const b of before) run("UPDATE lore_facts SET status = 'invented', value = ?, deleted_at = NULL, updated_at = ? WHERE id = ?", b.value, now(), b.id);
    publish({ type: "lore.facts", entryId, chatId: null });
  });
}
