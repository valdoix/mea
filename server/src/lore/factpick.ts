import { one } from "../db/db";
import { badRequest } from "../lib/http";
import { resolver } from "../memory/entities";
import { getMessageRow, mustChat } from "../services/chats";
import { extraOf, keyMatches, type ScanEntry } from "./activate";
import { scanEntriesFor } from "./service";

/**
 * "Remember as a fact" (docs/15, 1.4): select text in a reply and keep it as a fact on an entry.
 * Which entry: the people and things named in the selection first, then the ones named in the
 * rest of the message, then whoever wrote it. The selection becomes the fact, with the message
 * (and the swipe shown) as its source.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/** The names an entry answers to: its keys (not regexes), aliases, linked entity, and title. */
const namesOf = (e: ScanEntry) =>
  [...e.keys.filter((k) => !/^\/.*\/[a-z]*$/.test(k.trim())), ...(extraOf(e).aliases ?? []), extraOf(e).entity ?? "", e.comment].map((n) => n.trim()).filter((n) => n.length >= 2);

/** The selected words as a fact: one line, capitalised, without the closing stop. */
export const factFromSelection = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim().replace(/[.,;:!?…]+$/, "").slice(0, 300);
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export interface FactPick {
  value: string;
  messageId: string;
  candidates: { entryId: string; bookId: string; bookName: string; title: string; why: string }[];
}

export function pickFactEntry(chatId: string, messageId: string, text: string): FactPick {
  const chat = mustChat(chatId);
  const msg = getMessageRow(messageId);
  if (!msg || msg.chat_id !== chatId || msg.deleted_at) throw badRequest("That message isn't in this chat");
  const value = factFromSelection(text);
  if (!value) throw badRequest("Select some text first");
  const body = one<{ content: string }>("SELECT content FROM swipes WHERE message_id = ? AND idx = ?", messageId, msg.active_swipe)?.content ?? "";
  const entries = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId });
  // Entities named in the text count with every alias the Codex knows for them.
  let known: { names: string[] }[] = [];
  try {
    const r = resolver(chatId);
    known = [...r.mentionedIn(text), ...r.mentionedIn(body)].map((x) => ({ names: r.namesOf(x) }));
  } catch {
    known = [];
  }
  const speaker = msg.role === "assistant" ? (msg.name ?? "") : "";
  const scored = entries.map((e) => {
    const names = namesOf(e);
    const keys = new Set(names.map(norm));
    const named = (hay: string) => names.find((n) => keyMatches(n, hay, false, true));
    const viaCodex = (hay: string) => known.some((k) => k.names.some((n) => keys.has(norm(n))) && k.names.some((n) => keyMatches(n, hay, false, true)));
    const inSel = named(text);
    if (inSel) return { e, score: 3, why: `“${inSel}” is in what you selected` };
    if (viaCodex(text)) return { e, score: 3, why: "named in what you selected" };
    const inMsg = named(body);
    if (inMsg) return { e, score: 2, why: `“${inMsg}” is in this message` };
    if (speaker && keys.has(norm(speaker))) return { e, score: 2, why: `${speaker} wrote this message` };
    if (viaCodex(body)) return { e, score: 1, why: "named in this message" };
    return { e, score: 0, why: "" };
  });
  const candidates = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ e, why }) => ({ entryId: e.id, bookId: e.bookId, bookName: e.bookName, title: e.comment || e.keys[0] || "(untitled)", why }));
  return { value, messageId, candidates };
}
