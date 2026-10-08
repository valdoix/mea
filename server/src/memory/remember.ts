import { all, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { type AtomRow, atomOut, atomSources, getAtom, insertAtom, supersede } from "./atoms";
import { resolver } from "./entities";
import { touchMemory } from "./store";
import { contentWords, ftsQuery, overlap } from "./text";

/**
 * "Remember this" / "That's wrong" (MEM-41): select text in any message and make it a memory,
 * pin it, or correct what memory got wrong, in two taps. Corrections are your edits (MEM-27):
 * they supersede the wrong memories and never fade (MEM-19).
 */

function guessType(text: string) {
  if (/\b(promise[ds]?|swear|swore|vow(?:ed)?|i'?ll be there|i will)\b/i.test(text)) return "promise";
  if (/\b(secret|don'?t tell|nobody knows|no one knows|hid(?:den|es)?)\b/i.test(text)) return "secret";
  if (/\b(loves?|hates?|likes?|prefers?|favou?rite|can'?t stand|allergic)\b/i.test(text)) return "preference";
  if (/^["“]/.test(text.trim())) return "quote";
  return "fact";
}

export function rememberSelection(chatId: string, input: { messageId: string; text: string; pin?: boolean; note?: string }) {
  const msg = one<{ id: string; seq: number; name: string | null }>("SELECT id, seq, name FROM messages WHERE id = ? AND chat_id = ?", input.messageId, chatId);
  if (!msg) throw notFound("Message not found");
  const text = input.text.replace(/\s+/g, " ").trim();
  if (text.length < 3) throw badRequest("Select a little more text");
  const type = guessType(text);
  const content = input.note?.trim() || (type === "quote" && msg.name ? `${msg.name} said: ${text}` : text);
  const entities = resolver(chatId)
    .mentionedIn(`${content} ${msg.name ?? ""}`)
    .map((e) => e.name)
    .slice(0, 8);
  const id = insertAtom(chatId, null, { type, content, entities, importance: input.pin ? 9 : 7, pinned: input.pin, userEdited: true, confidence: 1 }, [{ id: msg.id, seq: msg.seq }]);
  touchMemory(chatId);
  publish({ type: "memory.changed", chatId });
  return atomOut(getAtom(id)!, { sources: atomSources(id) });
}

/** Memories that say the wrong thing: ones citing the message, and ones that share its words. */
export function findWrong(chatId: string, wrong: string, messageId?: string) {
  const words = contentWords(wrong);
  const byMessage = messageId
    ? all<AtomRow>(
        "SELECT m.* FROM memory_sources s JOIN memories m ON m.id = s.memory_id WHERE s.message_id = ? AND m.deleted_at IS NULL AND m.status IN ('active', 'disputed')",
        messageId,
      )
    : [];
  const q = ftsQuery(wrong, 12);
  const byText = q
    ? all<AtomRow>(
        "SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.id WHERE memories_fts MATCH ? AND f.chat_id = ? AND m.deleted_at IS NULL AND m.status IN ('active', 'disputed') ORDER BY bm25(memories_fts) LIMIT 20",
        q,
        chatId,
      )
    : [];
  const seen = new Set<string>();
  return [...byMessage, ...byText]
    .filter((a) => !seen.has(a.id) && seen.add(a.id))
    .map((a) => ({ a, score: overlap(words, contentWords(a.content)) + (byMessage.some((b) => b.id === a.id) ? 0.15 : 0) + (a.content.toLowerCase().includes(wrong.toLowerCase().slice(0, 60)) ? 0.4 : 0) }))
    .filter((x) => x.score >= 0.2)
    .sort((x, y) => y.score - x.score)
    .slice(0, 6);
}

/** "That's wrong": the right version becomes a confirmed memory and the wrong ones are superseded. */
export function correctMemory(chatId: string, input: { wrong: string; right: string; messageId?: string; memoryIds?: string[] }) {
  if (!input.right.trim()) throw badRequest("Write what's right");
  const targets = input.memoryIds?.length
    ? input.memoryIds.map((id) => getAtom(id)).filter((a): a is AtomRow => Boolean(a && a.chat_id === chatId && !a.deleted_at))
    : findWrong(chatId, input.wrong, input.messageId).map((x) => x.a);
  const sources = new Map<string, number>();
  for (const t of targets) for (const s of atomSources(t.id)) sources.set(s.messageId, s.seq);
  if (input.messageId) {
    const m = one<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE id = ? AND chat_id = ?", input.messageId, chatId);
    if (m) sources.set(m.id, m.seq);
  }
  const entities = [...new Set([...targets.flatMap((t) => parseJson<string[]>(t.entities, [])), ...resolver(chatId).mentionedIn(input.right).map((e) => e.name)])].slice(0, 12);
  let id = "";
  tx(() => {
    id = insertAtom(
      chatId,
      targets[0]?.scene_id ?? null,
      {
        type: targets[0]?.type ?? guessType(input.right),
        content: input.right.trim(),
        entities,
        importance: Math.max(9, ...targets.map((t) => t.importance)),
        knownBy: [...new Set(targets.flatMap((t) => parseJson<string[]>(t.known_by, [])))],
        userEdited: true,
        confidence: 1,
      },
      [...sources.entries()].map(([mid, seq]) => ({ id: mid, seq })),
    );
    for (const t of targets) supersede(t.id, id);
    run("UPDATE memories SET updated_at = ? WHERE id = ?", now(), id);
  });
  touchMemory(chatId);
  publish({ type: "memory.changed", chatId });
  return { memory: atomOut(getAtom(id)!, { sources: atomSources(id) }), superseded: targets.map((t) => atomOut(t)) };
}
