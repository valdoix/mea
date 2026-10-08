import { all, now, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { notFound } from "../lib/http";

/**
 * Undo for deletes that remove rows for good (QOL-05). Before the delete, the rows (and the rows
 * that would go with them) are kept in memory for 15 minutes; the toast's Undo puts them back.
 * Things with a trash (chats, characters, personas, lorebooks, messages, memories, notes) use
 * their own restore instead.
 */

const TABLES = new Set(["archivist", "variants", "presets", "lorebook_entries", "lorebook_links", "profiles", "connections", "secrets", "models", "collections", "collection_chats", "lore_drafts", "tracker_templates"]);
const TTL = 15 * 60_000;

interface Part {
  table: string;
  where: string;
  params: (string | number | null)[];
}
interface Stash {
  label: string;
  rows: { table: string; rows: Record<string, unknown>[] }[];
  expires: number;
  what?: "characters" | "personas" | "lorebooks" | "presets" | "connections";
}

const stashes = new Map<string, Stash>();

/** Keeps the rows a delete is about to remove. Returns the token for the Undo button. */
export function stash(label: string, parts: Part[], what?: Stash["what"]): string {
  for (const [k, s] of stashes) if (s.expires < now()) stashes.delete(k);
  const rows = parts.map((p) => {
    if (!TABLES.has(p.table)) throw new Error(`Undo isn't set up for ${p.table}`);
    return { table: p.table, rows: all<Record<string, unknown>>(`SELECT * FROM ${p.table} WHERE ${p.where}`, ...p.params) };
  });
  const token = crypto.randomUUID();
  stashes.set(token, { label, rows, expires: now() + TTL, what });
  return token;
}

/** Puts the rows back (as they were, ids and all). */
export function restoreStash(token: string) {
  const s = stashes.get(token);
  if (!s || s.expires < now()) throw notFound("It's too late to undo that.");
  tx(() => {
    for (const part of s.rows)
      for (const row of part.rows) {
        const cols = Object.keys(row);
        run(`INSERT OR REPLACE INTO ${part.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...(cols.map((c) => row[c]) as never[]));
      }
  });
  stashes.delete(token);
  if (s.what) publish({ type: "library.changed", what: s.what });
  return { ok: true, label: s.label };
}
