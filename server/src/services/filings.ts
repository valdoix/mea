import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";

/**
 * P1: what Mea files from a message (a lesson, a promise, a truth, a day on the calendar…). Each
 * filing shows as a chip on its message with Undo, and "That's not what I meant" where the reader
 * guessed. The feature that filed it registers how to undo it.
 */

export interface FilingRow {
  id: string;
  chat_id: string;
  message_id: string | null;
  kind: string;
  label: string;
  data: string;
  status: string;
  created_at: number;
}

export interface Filing {
  id: string;
  chatId: string;
  messageId: string | null;
  kind: string;
  label: string;
  data: Record<string, unknown>;
  status: "filed" | "undone";
  createdAt: number;
}

interface FilingKind {
  /** Takes the filing back (the toast's and the chip's Undo). */
  undo: (f: Filing) => void;
  /** The reader guessed wrong: undo, and remember not to guess this again. Defaults to undo. */
  notMeant?: (f: Filing) => void;
}
const kinds = new Map<string, FilingKind>();

export function registerFilingKind(kind: string, k: FilingKind) {
  kinds.set(kind, k);
}

const view = (r: FilingRow): Filing => ({ id: r.id, chatId: r.chat_id, messageId: r.message_id, kind: r.kind, label: r.label, data: parseJson(r.data, {}), status: r.status as Filing["status"], createdAt: r.created_at });

export function fileItem(chatId: string, o: { messageId?: string | null; kind: string; label: string; data?: Record<string, unknown> }): Filing {
  const id = newId();
  run("INSERT INTO filings (id, chat_id, message_id, kind, label, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'filed', ?)", id, chatId, o.messageId ?? null, o.kind, o.label.slice(0, 200), JSON.stringify(o.data ?? {}), now());
  publish({ type: "filings.changed", chatId });
  return view(one<FilingRow>("SELECT * FROM filings WHERE id = ?", id)!);
}

/** The filings still standing in a chat, for the chips under messages. */
export function filingsFor(chatId: string): Filing[] {
  return all<FilingRow>("SELECT * FROM filings WHERE chat_id = ? AND status = 'filed' ORDER BY created_at", chatId).map(view);
}

export function getFiling(id: string) {
  const r = one<FilingRow>("SELECT * FROM filings WHERE id = ?", id);
  return r ? view(r) : undefined;
}

export function undoFiling(id: string, how: "undo" | "notMeant" = "undo") {
  const f = getFiling(id);
  if (!f) throw notFound("That's gone already");
  if (f.status === "undone") return f;
  const k = kinds.get(f.kind);
  if (!k) throw badRequest("Mea can't take this one back");
  (how === "notMeant" ? (k.notMeant ?? k.undo) : k.undo)(f);
  run("UPDATE filings SET status = 'undone' WHERE id = ?", id);
  publish({ type: "filings.changed", chatId: f.chatId });
  return { ...f, status: "undone" as const };
}

/** A filing whose thing went away by another road (deleted in its own panel) stops showing. */
export function dropFilings(kind: string, match: (data: Record<string, unknown>) => boolean, chatId: string) {
  for (const f of filingsFor(chatId).filter((x) => x.kind === kind && match(x.data))) run("UPDATE filings SET status = 'undone' WHERE id = ?", f.id);
  publish({ type: "filings.changed", chatId });
}
