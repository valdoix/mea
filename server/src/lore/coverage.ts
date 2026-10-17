import { all, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { resolver } from "../memory/entities";
import { getChatRow } from "../services/chats";
import { enqueue } from "../services/jobs";
import { stashRestore } from "../services/undo";
import { extraOf, type ScanEntry } from "./activate";
import { decideDetails } from "./details";
import { factsNowFor } from "./facts";
import { loreFiredAgo } from "./health";
import { scanEntriesFor, updateEntry } from "./service";
import { normalizeValue } from "./slots";
import type { LoreEntry } from "./types";

/**
 * Coverage findings (docs/15, 7.1): what lore health sees once it can look at a chat. Busy people
 * and places with thin entries, entries whose entity is active but that haven't fired in a while,
 * facts that disagree across books, the same alias in two books, and invented facts still waiting
 * for a yes. Each comes with a fix: Draft facts, Add key, Merge, Confirm.
 */

export type FindingKind = "thin" | "quiet" | "fact-conflict" | "alias-twice" | "invented";
export type FixAction = "draft-facts" | "add-key" | "merge" | "confirm";

export interface Finding {
  key: string;
  kind: FindingKind;
  chatId: string;
  entries: { id: string; title: string; bookName: string }[];
  message: string;
  fix: FixAction;
  fixLabel: string;
  /** add-key: the names to add. */
  names?: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const QUIET_AFTER = 20;
const FIX_LABEL: Record<FixAction, string> = { "draft-facts": "Draft facts", "add-key": "Add key", merge: "Merge", confirm: "Confirm" };

const namesOf = (e: ScanEntry) => [...new Set([e.comment, ...e.keys.filter((k) => !/^\/.*\/[a-z]*$/.test(k.trim())), ...(extraOf(e).aliases ?? []), extraOf(e).entity ?? ""].map((n) => n.trim()).filter((n) => n.length >= 2))];

/** The findings for one chat's lore. */
export function coverageFindings(chatId: string): Finding[] {
  const chat = getChatRow(chatId);
  if (!chat || chat.deleted_at) return [];
  const entries = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId }).filter((e) => e.enabled && !(e.extra as { bond?: string }).bond);
  if (!entries.length) return [];
  const out: Finding[] = [];
  const ref = (e: ScanEntry) => ({ id: e.id, title: e.comment || e.keys[0] || "(untitled)", bookName: e.bookName });
  const push = (f: Omit<Finding, "chatId" | "fixLabel">) => out.push({ ...f, chatId, fixLabel: FIX_LABEL[f.fix] });
  const facts = factsNowFor(entries.map((e) => e.id), chatId);
  let latest = 0;
  latest = one<{ s: number | null }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0;
  const ago = loreFiredAgo(chatId);
  let res: ReturnType<typeof resolver> | null = null;
  try {
    res = resolver(chatId);
  } catch {
    res = null;
  }
  // Entities by any of their names.
  const byName = new Map<string, NonNullable<typeof res>["rows"][number]>();
  for (const r of res?.rows ?? []) for (const n of res!.namesOf(r)) byName.set(norm(n), r);
  const entityOf = (e: ScanEntry) => namesOf(e).map((n) => byName.get(norm(n))).find(Boolean);

  for (const e of entries) {
    const ent = entityOf(e);
    if (!ent) continue;
    const factCount = facts.get(e.id)?.length ?? 0;
    // Busy, but the entry is thin: little text and few facts.
    if (ent.mentions >= 10 && words(e.content) < 40 && factCount < 3)
      push({ key: `thin:${chatId}:${e.id}`, kind: "thin", entries: [ref(e)], message: `${ent.name} comes up a lot (${ent.mentions} mentions), but "${ref(e).title}" says little.`, fix: "draft-facts" });
    // Active lately, but the entry hasn't fired: its keys may miss how the story names them.
    const active = ent.last_seq != null && latest - ent.last_seq <= QUIET_AFTER;
    const quiet = (ago.get(e.id) ?? Number.MAX_SAFE_INTEGER) > QUIET_AFTER;
    if (active && quiet && !e.constant) {
      const missing = res!.namesOf(ent).filter((n) => !namesOf(e).some((k) => norm(k) === norm(n)));
      push({ key: `quiet:${chatId}:${e.id}`, kind: "quiet", entries: [ref(e)], message: `${ent.name} is in the story lately, but "${ref(e).title}" hasn't fired in ${QUIET_AFTER}+ messages.${missing.length ? ` The story also calls them ${missing.slice(0, 3).join(", ")}.` : ""}`, fix: "add-key", names: missing.length ? missing.slice(0, 5) : [ent.name] });
    }
  }
  // Across books: the same alias, and facts that disagree.
  const seen = new Map<string, ScanEntry>();
  const pairs = new Set<string>();
  for (const e of entries)
    for (const n of namesOf(e)) {
      const other = seen.get(norm(n));
      if (other && other.bookId !== e.bookId && other.id !== e.id && !pairs.has(`${other.id}|${e.id}`)) {
        pairs.add(`${other.id}|${e.id}`);
        push({ key: `alias-twice:${chatId}:${other.id}|${e.id}`, kind: "alias-twice", entries: [ref(other), ref(e)], message: `"${n}" is in two books: ${other.bookName} and ${e.bookName}.`, fix: "merge" });
        // Facts the two disagree on, slot by slot.
        const a = facts.get(other.id) ?? [];
        const b = facts.get(e.id) ?? [];
        for (const fa of a) {
          const fb = b.find((x) => x.slot && x.slot === fa.slot && normalizeValue(x.slot, x.value) !== normalizeValue(fa.slot, fa.value));
          if (fb) push({ key: `fact-conflict:${chatId}:${fa.id}|${fb.id}`, kind: "fact-conflict", entries: [ref(other), ref(e)], message: `${fa.slot}: ${other.bookName} says “${fa.value}”, ${e.bookName} says “${fb.value}”.`, fix: "merge" });
        }
      }
      if (!other) seen.set(norm(n), e);
    }
  // Invented details still waiting.
  for (const e of entries) {
    const waiting = (facts.get(e.id) ?? []).filter((f) => f.status === "invented");
    if (waiting.length) push({ key: `invented:${chatId}:${e.id}`, kind: "invented", entries: [ref(e)], message: `${waiting.length} drafted detail${waiting.length === 1 ? "" : "s"} on "${ref(e).title}" still sent as “likely”: ${waiting.slice(0, 3).map((f) => f.value).join(", ")}.`, fix: "confirm" });
  }
  const gone = new Set(all<{ key: string }>("SELECT key FROM inbox_dismissed WHERE key LIKE 'lore-health:%'").map((r) => r.key.slice("lore-health:".length)));
  return out.filter((f) => !gone.has(f.key));
}

/** The fix button. Returns an Undo token where there's something to take back. */
export function fixFinding(chatId: string, key: string): { undo: string | null; message: string } {
  const f = coverageFindings(chatId).find((x) => x.key === key);
  if (!f) throw notFound("That finding is gone");
  const first = f.entries[0]!;
  if (f.fix === "add-key") {
    const row = one<{ data: string }>("SELECT data FROM lorebook_entries WHERE id = ?", first.id);
    if (!row) throw notFound("Entry not found");
    const before = parseJson<LoreEntry>(row.data, {} as LoreEntry);
    const keys = [...new Set([...before.keys, ...(f.names ?? [])])];
    updateEntry(first.id, { ...before, keys });
    return { undo: stashRestore("Keys", () => updateEntry(first.id, before)), message: `Added ${f.names?.join(", ")} as keys` };
  }
  if (f.fix === "confirm") return { undo: decideDetails(first.id, "accept"), message: "Kept: they're sent as fact now" };
  if (f.fix === "merge") {
    const r = mergeEntries(first.id, f.entries[1]!.id);
    return { undo: r.undo, message: `Merged into "${first.title}" (${first.bookName})` };
  }
  // Draft facts: read the story's memories about it again, from the start (the keep-up pass makes cards).
  run("UPDATE lore_keepup SET atoms_at = 0, updated_at = ? WHERE entry_id = ? AND chat_id = ?", now(), first.id, chatId);
  enqueue("lore.keepup", { chatId }, { dedupeKey: `lore.keepup:${chatId}`, priority: 2, chatId });
  return { undo: null, message: "Drafting facts from the story: they'll wait in the Inbox" };
}

/**
 * 7.2: two entries for one entity become one, in the book of the first (`keepId`): every fact moves
 * over with its history and source, keys and aliases join, and the other entry goes. Undo puts both
 * back as they were.
 */
export function mergeEntries(keepId: string, otherId: string) {
  if (keepId === otherId) throw badRequest("Pick two different entries");
  const keep = one<{ id: string; data: string; lorebook_id: string }>("SELECT id, data, lorebook_id FROM lorebook_entries WHERE id = ?", keepId);
  const other = one<Record<string, unknown> & { id: string; data: string }>("SELECT * FROM lorebook_entries WHERE id = ?", otherId);
  if (!keep || !other) throw notFound("Entry not found");
  const a = parseJson<LoreEntry>(keep.data, {} as LoreEntry);
  const b = parseJson<LoreEntry>(other.data, {} as LoreEntry);
  const moved = all<{ id: string }>("SELECT id FROM lore_facts WHERE entry_id = ?", otherId).map((r) => r.id);
  const ax = (a.extra ?? {}) as { aliases?: string[]; essentials?: string };
  const bx = (b.extra ?? {}) as { aliases?: string[]; essentials?: string };
  const merged: LoreEntry = {
    ...a,
    keys: [...new Set([...a.keys, ...b.keys])],
    content: a.content.trim().includes(b.content.trim()) ? a.content : [a.content.trim(), b.content.trim()].filter(Boolean).join("\n\n"),
    extra: { ...b.extra, ...a.extra, aliases: [...new Set([...(ax.aliases ?? []), ...(bx.aliases ?? [])])], ...(ax.essentials || bx.essentials ? { essentials: ax.essentials || bx.essentials } : {}) },
  };
  tx(() => {
    run("UPDATE lore_facts SET entry_id = ?, updated_at = ? WHERE entry_id = ?", keepId, now(), otherId);
    updateEntry(keepId, merged);
    // The facts moved already, so deleting the other entry takes none with it.
    run("DELETE FROM lorebook_entries WHERE id = ?", otherId);
  });
  publish({ type: "library.changed", what: "lorebooks" });
  publish({ type: "lore.facts", entryId: keepId, chatId: null });
  const undo = stashRestore("Merge", () => {
    const cols = Object.keys(other);
    run(`INSERT OR REPLACE INTO lorebook_entries (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...(cols.map((c) => other[c]) as never[]));
    if (moved.length) run(`UPDATE lore_facts SET entry_id = ? WHERE id IN (${moved.map(() => "?").join(",")})`, otherId, ...moved);
    updateEntry(keepId, a);
    publish({ type: "library.changed", what: "lorebooks" });
  });
  return { entryId: keepId, moved: moved.length, undo };
}
