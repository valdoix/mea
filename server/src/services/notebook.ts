import { all, newId, now, one, run } from "../db/db";
import { publish } from "../lib/events";
import { notFound } from "../lib/http";
import { extraOf } from "../lore/activate";
import { listLorebooks, getLorebook } from "../lore/service";
import { norm, resolver } from "../memory/entities";
import { getMessageRow } from "./chats";

/**
 * The notebook (QOL-01): notes per chat and global ones (plans, ideas, what-ifs). [[Name]] links
 * to a person or place in the chat's Codex, or to a lorebook entry. Never sent to the model.
 *
 * Highlights (QOL-02): passages you mark in a message. With bookmarks they make the "best moments"
 * reel, and the memories they come from count for more in recall.
 */

interface NoteRow {
  id: string;
  chat_id: string | null;
  title: string;
  body: string;
  pinned: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface NoteLink {
  text: string;
  href: string | null;
  kind: "entity" | "lore" | "missing";
}

/** What each [[Name]] in a note points at: the chat's people and places first, then lore. */
function linksFor(body: string, chatId: string | null): NoteLink[] {
  const names = [...new Set([...body.matchAll(/\[\[([^\]|]{1,80})(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]!.trim()))];
  if (!names.length) return [];
  const res = chatId ? resolver(chatId) : null;
  let loreIndex: Map<string, { bookId: string; entryId: string }> | null = null;
  const lore = () => {
    if (!loreIndex) {
      loreIndex = new Map();
      for (const b of listLorebooks()) {
        const book = getLorebook(b.id);
        for (const e of book?.entries ?? []) for (const n of [e.comment, ...e.keys, ...(extraOf(e).aliases ?? [])]) if (n?.trim() && !loreIndex.has(norm(n))) loreIndex.set(norm(n), { bookId: b.id, entryId: e.id });
      }
    }
    return loreIndex;
  };
  return names.map((text) => {
    const ent = res?.find(text);
    if (ent && chatId) return { text, href: `/chat/${chatId}/codex?entity=${ent.id}`, kind: "entity" as const };
    const hit = lore().get(norm(text));
    if (hit) return { text, href: `/lorebooks/${hit.bookId}?entry=${hit.entryId}`, kind: "lore" as const };
    return { text, href: null, kind: "missing" as const };
  });
}

const noteOut = (r: NoteRow) => ({ id: r.id, chatId: r.chat_id, title: r.title, body: r.body, pinned: Boolean(r.pinned), createdAt: r.created_at, updatedAt: r.updated_at, links: linksFor(r.body, r.chat_id) });
export type NoteOut = ReturnType<typeof noteOut>;

export function listNotes(opts: { chatId?: string | null; scope?: "chat" | "global" | "all"; deleted?: boolean } = {}) {
  const where: string[] = [opts.deleted ? "deleted_at IS NOT NULL" : "deleted_at IS NULL"];
  const params: string[] = [];
  if (opts.scope === "global") where.push("chat_id IS NULL");
  else if (opts.chatId) {
    where.push(opts.scope === "chat" ? "chat_id = ?" : "(chat_id = ? OR chat_id IS NULL)");
    params.push(opts.chatId);
  }
  return all<NoteRow>(`SELECT * FROM notes WHERE ${where.join(" AND ")} ORDER BY pinned DESC, updated_at DESC LIMIT 500`, ...params).map(noteOut);
}

export function createNote(input: { chatId?: string | null; title?: string; body?: string; pinned?: boolean }) {
  const id = newId();
  const t = now();
  run("INSERT INTO notes (id, chat_id, title, body, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, input.chatId ?? null, input.title ?? "", input.body ?? "", input.pinned ? 1 : 0, t, t);
  return getNote(id)!;
}

export function getNote(id: string) {
  const r = one<NoteRow>("SELECT * FROM notes WHERE id = ?", id);
  return r ? noteOut(r) : undefined;
}

export function updateNote(id: string, patch: { title?: string; body?: string; pinned?: boolean; chatId?: string | null }) {
  const r = one<NoteRow>("SELECT * FROM notes WHERE id = ?", id);
  if (!r) throw notFound("Note not found");
  run(
    "UPDATE notes SET title = ?, body = ?, pinned = ?, chat_id = ?, updated_at = ? WHERE id = ?",
    patch.title ?? r.title,
    patch.body ?? r.body,
    patch.pinned === undefined ? r.pinned : patch.pinned ? 1 : 0,
    patch.chatId === undefined ? r.chat_id : patch.chatId,
    now(),
    id,
  );
  return getNote(id)!;
}

/** Soft delete, so the undo toast can bring it back (QOL-05); the trash purge removes it later. */
export function deleteNote(id: string) {
  run("UPDATE notes SET deleted_at = ? WHERE id = ?", now(), id);
}
export function restoreNote(id: string) {
  run("UPDATE notes SET deleted_at = NULL, updated_at = ? WHERE id = ?", now(), id);
  return getNote(id);
}

// ---------- highlights & best moments (QOL-02) ----------

interface HighlightRow {
  id: string;
  chat_id: string;
  message_id: string;
  text: string;
  note: string;
  created_at: number;
}

export function addHighlight(messageId: string, text: string, note = "") {
  const m = getMessageRow(messageId);
  if (!m) throw notFound("Message not found");
  // The same passage marked twice is one highlight.
  const same = one<HighlightRow>("SELECT * FROM highlights WHERE message_id = ? AND text = ?", messageId, text.trim().slice(0, 4000));
  if (same) return { id: same.id, chatId: same.chat_id, messageId, text: same.text, note: same.note };
  const id = newId();
  run("INSERT INTO highlights (id, chat_id, message_id, text, note, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, m.chat_id, messageId, text.trim().slice(0, 4000), note.slice(0, 1000), now());
  publish({ type: "message.changed", chatId: m.chat_id, messageId });
  return { id, chatId: m.chat_id, messageId, text: text.trim(), note };
}

export function deleteHighlight(id: string) {
  const r = one<HighlightRow>("SELECT * FROM highlights WHERE id = ?", id);
  if (!r) return null;
  run("DELETE FROM highlights WHERE id = ?", id);
  publish({ type: "message.changed", chatId: r.chat_id, messageId: r.message_id });
  return { id: r.id, chatId: r.chat_id, messageId: r.message_id, text: r.text, note: r.note };
}

export function highlightsFor(messageIds: string[]) {
  if (!messageIds.length) return [];
  return all<HighlightRow>(`SELECT * FROM highlights WHERE message_id IN (${messageIds.map(() => "?").join(",")})`, ...messageIds).map((h) => ({ id: h.id, messageId: h.message_id, text: h.text, note: h.note }));
}

/** The best moments reel: bookmarked messages and highlighted passages, in story order. */
export function moments(opts: { chatId?: string; limit?: number } = {}) {
  const where = opts.chatId ? "AND m.chat_id = ?" : "";
  const params = opts.chatId ? [opts.chatId] : [];
  const marked = all<{ id: string; chat_id: string; seq: number; role: string; name: string | null; content: string; created_at: number; title: string }>(
    `SELECT m.id, m.chat_id, m.seq, m.role, m.name, s.content, m.created_at, c.title FROM messages m
     JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe JOIN chats c ON c.id = m.chat_id
     WHERE m.deleted_at IS NULL AND c.deleted_at IS NULL AND m.bookmarked = 1 ${where} ORDER BY m.created_at DESC LIMIT ?`,
    ...params,
    opts.limit ?? 200,
  );
  const hl = all<HighlightRow & { seq: number; role: string; name: string | null; title: string }>(
    `SELECT h.*, m.seq, m.role, m.name, c.title FROM highlights h JOIN messages m ON m.id = h.message_id JOIN chats c ON c.id = h.chat_id
     WHERE m.deleted_at IS NULL AND c.deleted_at IS NULL ${opts.chatId ? "AND h.chat_id = ?" : ""} ORDER BY h.created_at DESC LIMIT ?`,
    ...params,
    opts.limit ?? 200,
  );
  const items = [
    ...marked.map((m) => ({ kind: "bookmark" as const, id: m.id, chatId: m.chat_id, chatTitle: m.title, messageId: m.id, seq: m.seq, who: m.name ?? (m.role === "user" ? "You" : ""), text: m.content, note: "", at: m.created_at })),
    ...hl.map((h) => ({ kind: "highlight" as const, id: h.id, chatId: h.chat_id, chatTitle: h.title, messageId: h.message_id, seq: h.seq, who: h.name ?? (h.role === "user" ? "You" : ""), text: h.text, note: h.note, at: h.created_at })),
  ];
  return opts.chatId ? items.sort((a, b) => a.seq - b.seq) : items.sort((a, b) => b.at - a.at);
}

/** QOL-02: the messages you marked (bookmarked or highlighted), for recall and the summarizer. */
export function markedMessageIds(chatId: string): Set<string> {
  return new Set(
    all<{ id: string }>("SELECT id FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND (bookmarked = 1 OR EXISTS (SELECT 1 FROM highlights h WHERE h.message_id = messages.id))", chatId).map((r) => r.id),
  );
}

/** The passages you highlighted in a range of messages, for the scene summarizer. */
export function highlightsInRange(chatId: string, from: number, to: number) {
  return all<{ text: string; seq: number }>(
    "SELECT h.text, m.seq FROM highlights h JOIN messages m ON m.id = h.message_id WHERE h.chat_id = ? AND m.seq BETWEEN ? AND ? ORDER BY m.seq",
    chatId,
    from,
    to,
  );
}
