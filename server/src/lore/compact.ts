import { z } from "zod";
import { all, now, one, parseJson } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { countTokens } from "../lib/tokens";
import type { JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { getLorebook, scanEntriesFor, updateEntry } from "./service";
import { getChatRow } from "../services/chats";
import type { LoreEntry } from "./types";

/**
 * Compaction with history (docs/15, 7.3): books that stay readable at message 5,000. An idle job
 * rewrites a long entry's text shorter; every name and number stays exact (a rewrite that drops one
 * is rejected), and the facts are untouched (what changed already lives in their History). Text you
 * wrote is offered as a diff in the Inbox; text Mea wrote (the Chronicle, the Studio's drafts) is
 * replaced, with Undo on the entry.
 */

/** A text is long enough to compact past this many tokens. */
export const COMPACT_OVER = 600;

interface Pending {
  content: string;
  at: number;
}
type CompactExtra = { compactProposal?: Pending; compactUndo?: Pending; writtenBy?: "mea" | "you" };

/** The names and numbers a text holds: capitalised words (not at a sentence start) and every number. */
export function namesAndNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b\d+(?:[.,:]\d+)*\b/g)) out.add(m[0]);
  for (const s of text.split(/(?<=[.!?])\s+|\n+/)) {
    const ws = s.trim().split(/\s+/);
    ws.forEach((w, i) => {
      const clean = w.replace(/^[^\p{L}]+|[^\p{L}'’]+$/gu, "").replace(/['’]s$/, "");
      if (i > 0 && /^\p{Lu}[\p{L}'’-]{1,}$/u.test(clean) && !/^(I|The|A|An)$/.test(clean)) out.add(clean);
    });
  }
  return [...out];
}

/** What a rewrite lost: names and numbers of the original it doesn't have. */
export function lostNames(before: string, after: string): string[] {
  const hay = after.toLowerCase();
  return namesAndNumbers(before).filter((n) => !hay.includes(n.toLowerCase()));
}

/** Whether Mea wrote this entry's text (the Chronicle's, a Studio draft's, or marked so). */
function meaWrote(e: LoreEntry, bookId: string) {
  const x = (e.extra ?? {}) as CompactExtra & { source?: unknown };
  if (x.writtenBy) return x.writtenBy === "mea";
  return Boolean(getLorebook(bookId)?.settings.chronicleFor);
}

const schema = z.object({ content: z.string().min(1) });

/**
 * Compacts one entry's text. Returns what happened: "replaced" (Mea's text, with Undo kept on the
 * entry), "proposed" (yours, waiting in the Inbox), "rejected" (the rewrite dropped a name or number),
 * or "skipped" (short already, or shedding).
 */
export async function compactEntry(entryId: string, opts: { job?: JobContext; rewrite?: (text: string) => Promise<string> } = {}) {
  const row = one<{ data: string; lorebook_id: string }>("SELECT data, lorebook_id FROM lorebook_entries WHERE id = ?", entryId);
  if (!row) throw notFound("Entry not found");
  const e = parseJson<LoreEntry>(row.data, {} as LoreEntry);
  const before = e.content.trim();
  if (countTokens(before) <= COMPACT_OVER) return { status: "skipped" as const, reason: "short enough" };
  if (!opts.rewrite && shouldShed("verification")) return { status: "skipped" as const, reason: "saving quota" };
  const rewrite =
    opts.rewrite ??
    (async (text: string) =>
      (
        await callJson({
          task: "summarizer",
          kind: "lore compaction",
          jobId: opts.job?.id,
          name: "lore_compact",
          schema,
          system: `Rewrite a lorebook entry about half as long. Keep every name, number, place, side and colour exactly as written; keep what matters now; drop repetition and old detail the story has moved past. Third person, present tense. Reply with JSON only: {"content": "…"}`,
          user: text,
          maxTokens: 1500,
        })
      ).data.content.trim());
  const after = (await rewrite(before)).trim();
  if (!after || countTokens(after) >= countTokens(before)) return { status: "skipped" as const, reason: "no shorter version" };
  const lost = lostNames(before, after);
  if (lost.length) return { status: "rejected" as const, reason: `it dropped ${lost.slice(0, 5).join(", ")}` };
  const x = (e.extra ?? {}) as CompactExtra;
  if (meaWrote(e, row.lorebook_id)) {
    updateEntry(entryId, { ...e, content: after, extra: { ...x, compactUndo: { content: before, at: now() }, compactProposal: undefined } });
    publish({ type: "library.changed", what: "lorebooks" });
    return { status: "replaced" as const, before, after };
  }
  updateEntry(entryId, { ...e, extra: { ...x, compactProposal: { content: after, at: now() } } });
  publish({ type: "inbox.changed" });
  return { status: "proposed" as const, before, after };
}

/** Keep (with your edits) or say no to a proposed compaction; or take back one Mea made. */
export function decideCompaction(entryId: string, action: "accept" | "reject" | "undo", edited?: string) {
  const row = one<{ data: string }>("SELECT data FROM lorebook_entries WHERE id = ?", entryId);
  if (!row) throw notFound("Entry not found");
  const e = parseJson<LoreEntry>(row.data, {} as LoreEntry);
  const x = { ...((e.extra ?? {}) as CompactExtra) };
  if (action === "undo") {
    if (!x.compactUndo) throw badRequest("There's no compaction to take back");
    const content = x.compactUndo.content;
    delete x.compactUndo;
    updateEntry(entryId, { ...e, content, extra: x });
  } else {
    if (!x.compactProposal) throw badRequest("Nothing is waiting here");
    const content = edited?.trim() || x.compactProposal.content;
    delete x.compactProposal;
    updateEntry(entryId, action === "accept" ? { ...e, content, extra: { ...x, compactUndo: { content: e.content, at: now() } } } : { ...e, extra: x });
  }
  publish({ type: "library.changed", what: "lorebooks" });
  publish({ type: "inbox.changed" });
}

/** Proposed compactions waiting in the Inbox (they belong to no chat). */
export function compactProposals() {
  return all<{ id: string; data: string; lorebook_id: string }>("SELECT id, data, lorebook_id FROM lorebook_entries WHERE data LIKE '%\"compactProposal\"%'")
    .map((r) => ({ entryId: r.id, bookId: r.lorebook_id, entry: parseJson<LoreEntry>(r.data, {} as LoreEntry) }))
    .filter((r) => (r.entry.extra as CompactExtra | undefined)?.compactProposal);
}

/** The idle job (beside consolidation): the longest texts in a chat's books, two at a time. */
export async function runCompactJob(chatId: string, job?: JobContext) {
  const chat = getChatRow(chatId);
  if (!chat || shouldShed("verification", chatId)) return [];
  const long = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId })
    .filter((e) => e.enabled && !(e.extra as CompactExtra).compactProposal && countTokens(e.content) > COMPACT_OVER)
    .sort((a, b) => countTokens(b.content) - countTokens(a.content))
    .slice(0, 2);
  const out = [];
  for (const e of long) out.push({ entryId: e.id, ...(await compactEntry(e.id, { job })) });
  return out;
}
