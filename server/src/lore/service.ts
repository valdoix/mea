import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import type { ScanEntry, TimedState } from "./activate";
import { exportStWorldInfo, importLorebook, toCardBook } from "./convert";
import { defaultEntry, type LoreEntry, type LorebookSettings } from "./types";

export type LinkType = "global" | "character" | "persona" | "chat";

export interface LorebookRow {
  id: string;
  name: string;
  description: string;
  settings: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface LorebookLink {
  target_type: LinkType;
  target_id: string;
}

export interface EntryRecord extends LoreEntry {
  id: string;
}

const changed = () => publish({ type: "library.changed", what: "lorebooks" });

export function listLorebooks(opts: { deleted?: boolean } = {}) {
  const rows = all<LorebookRow & { entry_count: number }>(
    `SELECT b.*, (SELECT COUNT(*) FROM lorebook_entries e WHERE e.lorebook_id = b.id) AS entry_count
     FROM lorebooks b WHERE ${opts.deleted ? "b.deleted_at IS NOT NULL" : "b.deleted_at IS NULL"} ORDER BY b.name COLLATE NOCASE`,
  );
  const links = all<LorebookLink & { lorebook_id: string }>("SELECT * FROM lorebook_links");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    settings: parseJson<LorebookSettings>(r.settings, {}),
    entryCount: r.entry_count,
    links: links.filter((l) => l.lorebook_id === r.id).map((l) => ({ type: l.target_type, id: l.target_id })),
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }));
}

export function getLorebook(id: string) {
  const row = one<LorebookRow>("SELECT * FROM lorebooks WHERE id = ?", id);
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    settings: parseJson<LorebookSettings>(row.settings, {}),
    deletedAt: row.deleted_at,
    links: all<LorebookLink>("SELECT target_type, target_id FROM lorebook_links WHERE lorebook_id = ?", id).map((l) => ({ type: l.target_type, id: l.target_id })),
    entries: getEntries(id),
  };
}

export function getEntries(bookId: string): EntryRecord[] {
  return all<{ id: string; data: string }>("SELECT id, data FROM lorebook_entries WHERE lorebook_id = ? ORDER BY sort, created_at", bookId).map((r) => ({
    ...defaultEntry(parseJson<Partial<LoreEntry>>(r.data, {})),
    id: r.id,
  }));
}

export function createLorebook(input: { name: string; description?: string; settings?: LorebookSettings; entries?: LoreEntry[]; links?: LorebookLink[] }): string {
  const id = newId();
  const t = now();
  tx(() => {
    run("INSERT INTO lorebooks (id, name, description, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", id, input.name, input.description ?? "", JSON.stringify(input.settings ?? {}), t, t);
    (input.entries ?? []).forEach((e, i) => insertEntry(id, e, i));
    for (const l of input.links ?? []) linkLorebook(id, l.target_type, l.target_id);
  });
  changed();
  return id;
}

function insertEntry(bookId: string, entry: LoreEntry, sort: number): string {
  const id = newId();
  const t = now();
  run("INSERT INTO lorebook_entries (id, lorebook_id, data, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", id, bookId, JSON.stringify(entry), sort, t, t);
  return id;
}

export function updateLorebook(id: string, patch: { name?: string; description?: string; settings?: LorebookSettings }) {
  const cur = one<LorebookRow>("SELECT * FROM lorebooks WHERE id = ?", id);
  if (!cur) return false;
  run(
    "UPDATE lorebooks SET name = ?, description = ?, settings = ?, updated_at = ? WHERE id = ?",
    patch.name ?? cur.name,
    patch.description ?? cur.description,
    patch.settings ? JSON.stringify(patch.settings) : cur.settings,
    now(),
    id,
  );
  changed();
  return true;
}

export function createEntry(bookId: string, partial: Partial<LoreEntry> = {}): EntryRecord {
  const maxSort = one<{ m: number | null }>("SELECT MAX(sort) AS m FROM lorebook_entries WHERE lorebook_id = ?", bookId)?.m ?? -1;
  const maxUid = Math.max(-1, ...getEntries(bookId).map((e) => e.uid));
  const entry = defaultEntry({ ...partial, uid: maxUid + 1 });
  const id = insertEntry(bookId, entry, maxSort + 1);
  touch(bookId);
  return { ...entry, id };
}

export function updateEntry(entryId: string, entry: LoreEntry) {
  const { id: _ignore, ...data } = entry as EntryRecord;
  const res = run("UPDATE lorebook_entries SET data = ?, updated_at = ? WHERE id = ?", JSON.stringify(data), now(), entryId);
  const book = one<{ lorebook_id: string }>("SELECT lorebook_id FROM lorebook_entries WHERE id = ?", entryId);
  if (book) touch(book.lorebook_id);
  return res.changes > 0;
}

export function deleteEntry(entryId: string) {
  const book = one<{ lorebook_id: string }>("SELECT lorebook_id FROM lorebook_entries WHERE id = ?", entryId);
  run("DELETE FROM lorebook_entries WHERE id = ?", entryId);
  if (book) touch(book.lorebook_id);
}

export function reorderEntries(bookId: string, ids: string[]) {
  tx(() => ids.forEach((id, i) => run("UPDATE lorebook_entries SET sort = ? WHERE id = ? AND lorebook_id = ?", i, id, bookId)));
  touch(bookId);
}

function touch(bookId: string) {
  run("UPDATE lorebooks SET updated_at = ? WHERE id = ?", now(), bookId);
  changed();
}

export function softDeleteLorebook(id: string) {
  run("UPDATE lorebooks SET deleted_at = ? WHERE id = ?", now(), id);
  changed();
}

export function restoreLorebook(id: string) {
  run("UPDATE lorebooks SET deleted_at = NULL WHERE id = ?", id);
  changed();
}

export function linkLorebook(bookId: string, type: LinkType, targetId = "") {
  run("INSERT OR IGNORE INTO lorebook_links (lorebook_id, target_type, target_id) VALUES (?, ?, ?)", bookId, type, type === "global" ? "" : targetId);
  changed();
}

export function unlinkLorebook(bookId: string, type: LinkType, targetId = "") {
  run("DELETE FROM lorebook_links WHERE lorebook_id = ? AND target_type = ? AND target_id = ?", bookId, type, type === "global" ? "" : targetId);
  changed();
}

export function linkedBooks(type: LinkType, targetId: string) {
  return all<{ id: string; name: string }>(
    `SELECT b.id, b.name FROM lorebooks b JOIN lorebook_links l ON l.lorebook_id = b.id
     WHERE l.target_type = ? AND l.target_id = ? AND b.deleted_at IS NULL ORDER BY b.name`,
    type,
    type === "global" ? "" : targetId,
  );
}

export function importLorebookJson(json: unknown, fallbackName: string, links: LorebookLink[] = []): string {
  const book = importLorebook(json, fallbackName);
  return createLorebook({ name: book.name, description: book.description, settings: book.settings, entries: book.entries, links });
}

export function exportLorebook(id: string, format: "st" | "card" = "st") {
  const book = getLorebook(id);
  if (!book) return undefined;
  const entries = book.entries.map(({ id: _id, ...e }) => e);
  return format === "card" ? toCardBook(book.name, book.description, book.settings, entries) : exportStWorldInfo(book.name, book.description, entries);
}

/** All entries active for a chat: global + character + persona + chat scopes (LORE-02). */
export function scanEntriesFor(scope: { characterId?: string | null; personaId?: string | null; chatId?: string | null }): ScanEntry[] {
  const targets: [LinkType, string][] = [["global", ""]];
  if (scope.characterId) targets.push(["character", scope.characterId]);
  if (scope.personaId) targets.push(["persona", scope.personaId]);
  if (scope.chatId) targets.push(["chat", scope.chatId]);
  const seen = new Set<string>();
  const out: ScanEntry[] = [];
  for (const [type, id] of targets) {
    for (const b of linkedBooks(type, id)) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      const book = getLorebook(b.id)!;
      for (const e of book.entries) out.push({ ...e, bookId: book.id, bookName: book.name, book: book.settings });
    }
  }
  return out;
}

export function loadLoreState(chatId: string): Record<string, TimedState> {
  const rows = all<{ entry_id: string; sticky_until: number | null; cooldown_until: number | null }>("SELECT * FROM lore_state WHERE chat_id = ?", chatId);
  return Object.fromEntries(rows.map((r) => [r.entry_id, { stickyUntil: r.sticky_until, cooldownUntil: r.cooldown_until }]));
}

export function saveLoreState(chatId: string, updates: Record<string, TimedState>) {
  tx(() => {
    for (const [entryId, s] of Object.entries(updates)) {
      run(
        `INSERT INTO lore_state (chat_id, entry_id, sticky_until, cooldown_until) VALUES (?, ?, ?, ?)
         ON CONFLICT(chat_id, entry_id) DO UPDATE SET sticky_until = excluded.sticky_until, cooldown_until = excluded.cooldown_until`,
        chatId,
        entryId,
        s.stickyUntil ?? null,
        s.cooldownUntil ?? null,
      );
    }
  });
}
