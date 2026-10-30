import { z } from "zod";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { notFound } from "../lib/http";
import { memoryConfig } from "../lib/settings";
import { createAtom } from "../memory/atoms";
import { chatNames } from "../memory/build";
import { deepSearch } from "../memory/deep";
import { embedQueries, embeddingsEnabled } from "../memory/embed";
import { entityCard, entityFacts, resolver } from "../memory/entities";
import { TimeIndex } from "../memory/format";
import { promises, secrets } from "../memory/ledgers";
import { lensOf, summaryText } from "../memory/openlist";
import { recall } from "../memory/recall";
import { memState, storyRow } from "../memory/store";
import { cleanText, contentWords, overlap } from "../memory/text";
import { formatStoryTime } from "../trackers/clock";
import { currentFold } from "../trackers/store";
import { type ChatSettings, getChatRow, mustChat, updateChat } from "../services/chats";
import { callJson } from "../services/llm";

/**
 * Ask the Archivist (CON-07): out-of-character questions about your story, answered from memory
 * with numbered citations and jump links. Answers stay out of the roleplay unless you push one
 * in, as an OOC note or a pinned memory.
 */

export interface ArchiveCitation {
  n: number;
  type: "memory" | "scene" | "chapter" | "quote" | "promise" | "secret" | "entity" | "story" | "state";
  label: string;
  excerpt: string;
  messageId: string | null;
  seq: number | null;
  ownerId: string | null;
}

interface Source extends Omit<ArchiveCitation, "n"> {
  key: string;
}

const answerSchema = z.object({
  answer: z.string().min(1),
  cites: z.array(z.coerce.number()).default([]),
  confidence: z.enum(["sure", "likely", "unknown"]).catch("likely"),
});

function seqMessage(chatId: string) {
  const m = new Map<number, string>();
  for (const r of all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)) m.set(r.seq, r.id);
  return m;
}

/** Everything the archive knows that bears on a question, numbered for citation. */
export async function gatherSources(chatId: string, question: string, limit = 18) {
  const cfg = memoryConfig();
  const msg = seqMessage(chatId);
  const sources: Source[] = [];
  const push = (s: Source) => {
    if (!sources.some((x) => x.key === s.key)) sources.push(s);
  };
  const qvecs = embeddingsEnabled() ? await embedQueries([question], 4000) : [null];
  const lastSeq = one<{ s: number }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0;

  // Memories and records: the Archivist sees everything (it's your story), at a generous budget.
  const r = recall({
    chatId,
    evicted: lastSeq,
    budget: 2200,
    queries: [{ text: question, weight: 1, label: "your question" }],
    qvecs,
    excludeSummaryIds: new Set(),
    seed: `${chatId}:archivist`,
    cfg: { ...cfg, entityRecall: true, deepSearch: false, slots: { recent: 0, relevant: 1, serendipity: 0 } },
    pov: null,
    present: [],
    mood: null,
    librarian: null,
    times: new TimeIndex(chatId),
    skipCards: new Set(),
    povName: null,
  });
  // A memory cites the message it came from (its latest source), not a guess from its position.
  const sourceOf = (memoryId: string) => one<{ message_id: string; seq: number }>("SELECT message_id, seq FROM memory_sources WHERE memory_id = ? ORDER BY seq DESC LIMIT 1", memoryId);
  for (const it of r.items.sort((a, b) => b.score - a.score)) {
    if (it.ownerType === "memory") {
      const src = sourceOf(it.id);
      push({ key: `memory:${it.id}`, type: "memory", label: it.type, excerpt: it.content, seq: src?.seq ?? it.seq, messageId: src?.message_id ?? (it.seq != null ? (msg.get(it.seq) ?? null) : null), ownerId: it.id });
    }
    else if (it.ownerType === "summary")
      push({ key: `summary:${it.id}`, type: it.type === "chapter" ? "chapter" : "scene", label: it.content.match(/"([^"]+)"/)?.[1] ?? it.type, excerpt: it.content.replace(/^Earlier, [^:]+: /, ""), seq: it.seq, messageId: null, ownerId: it.id });
    else if (it.ownerType === "entity") push({ key: `entity:${it.id}`, type: "entity", label: it.content.split(" — ")[0] ?? "", excerpt: it.content, seq: it.seq, messageId: null, ownerId: it.id });
  }
  // The exact words, from deep search (MEM-22).
  for (const h of deepSearch(chatId, { query: question, qvec: qvecs[0] ?? null, beforeSeq: lastSeq, quotes: 4, excerptSize: 360 }))
    push({ key: `quote:${h.messageId}`, type: "quote", label: `${h.speaker}, #${h.seq}`, excerpt: h.excerpt, seq: h.seq, messageId: h.messageId, ownerId: h.messageId });
  // Promises and secrets that share words with the question.
  const qw = contentWords(question);
  for (const p of promises(chatId)) if (overlap(qw, contentWords(`${p.who} ${p.whom} ${p.what}`)) > 0.08 || /promise/i.test(question))
    push({ key: `promise:${p.key}`, type: "promise", label: `promise (${p.status})`, excerpt: `${p.who ?? "?"} → ${p.whom ?? "?"}: ${p.what} — ${p.status}`, seq: p.seq, messageId: p.messageId, ownerId: p.key });
  for (const s of secrets(chatId)) if (overlap(qw, contentWords(s.statement)) > 0.08 || /secret/i.test(question))
    push({ key: `secret:${s.key}`, type: "secret", label: "secret", excerpt: `${s.statement} (kept by ${s.keepers.join(", ") || "?"}${s.revealed.length ? `; revealed to ${s.revealed.flatMap((x) => x.to).join(", ")}` : ""})`, seq: s.seq, messageId: s.messageId, ownerId: s.key });
  // People and places the question names.
  const res = resolver(chatId);
  for (const e of res.mentionedIn(question).slice(0, 3)) push({ key: `entity:${e.id}`, type: "entity", label: e.name, excerpt: entityCard(e, entityFacts(chatId, e, 2)), seq: e.last_seq, messageId: null, ownerId: e.id });
  // What's happening now: the story state and the latest messages (questions are often about them).
  try {
    const st = currentFold(chatId).result.state;
    const here = Object.values(st.chars).filter((c) => !c.isUser && (c.tier === "spot" || c.tier === "peri")).map((c) => c.name);
    const bits = [st.place.length ? `at ${st.place.join(" › ")}` : "", st.time ? formatStoryTime(st.time) : "", here.length ? `with ${here.join(", ")}` : "", st.weather ? `weather: ${st.weather.now}` : ""].filter(Boolean);
    if (bits.length) push({ key: "state:now", type: "state", label: "story state now", excerpt: `Now: ${bits.join("; ")}`, seq: lastSeq, messageId: null, ownerId: null });
  } catch {
    // no trackers in this chat
  }
  const recent = all<{ id: string; seq: number; name: string | null; role: string; content: string }>(
    `SELECT m.id, m.seq, m.name, m.role, s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.hidden = 0 ORDER BY m.seq DESC LIMIT 8`,
    chatId,
  );
  const ranked = recent.map((m) => ({ m, score: overlap(qw, contentWords(m.content)) })).sort((a, b) => b.score - a.score || b.m.seq - a.m.seq);
  for (const { m } of ranked.slice(0, 4))
    push({ key: `quote:${m.id}`, type: "quote", label: `${m.name ?? m.role}, #${m.seq}`, excerpt: cleanText(m.content).replace(/\s+/g, " ").slice(0, 400), seq: m.seq, messageId: m.id, ownerId: m.id });
  const story = storyRow(chatId);
  if (story?.content && sources.length < 6) push({ key: `story:${story.id}`, type: "story", label: "The story so far", excerpt: summaryText(story, lensOf(chatId, null)).slice(0, 1200), seq: story.end_seq, messageId: null, ownerId: story.id });
  return sources.slice(0, limit).map((s, i): ArchiveCitation & { key: string } => ({ ...s, n: i + 1 }));
}

export async function askArchivist(chatId: string, question: string) {
  mustChat(chatId);
  const names = chatNames(chatId);
  const sources = await gatherSources(chatId, question);
  const res = await callJson({
    task: "helper",
    kind: "archivist",
    chatId,
    name: "archivist_answer",
    schema: answerSchema,
    system: `You are the Archivist of a roleplay between ${names.char} and ${names.user}. Answer the player's out-of-character question using ONLY the numbered sources. Cite the sources you used, like [2] [5], in the answer, and list their numbers in "cites". If the sources don't establish it, say so plainly and set "confidence" to "unknown". Be brief and concrete. Reply with JSON only: {"answer": "…", "cites": [1], "confidence": "sure"}`,
    user: `SOURCES:\n${sources.map((s) => `[${s.n}] (${s.type}${s.seq != null ? `, #${s.seq}` : ""}) ${s.excerpt.slice(0, 600)}`).join("\n")}\n\nQUESTION: ${question}`,
    maxTokens: 700,
  });
  // Cited sources first; numbers in the answer that point nowhere are dropped.
  const cited = new Set([...res.data.cites, ...[...res.data.answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))].filter((n) => sources.some((s) => s.n === n)));
  const citations = sources.filter((s) => cited.has(s.n)).map(({ key: _k, ...s }) => s);
  const id = newId();
  run("INSERT INTO archivist (id, chat_id, question, answer, citations, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, chatId, question, res.data.answer, JSON.stringify({ citations, confidence: res.data.confidence, all: sources.map(({ key: _k, ...s }) => s) }), now());
  return archiveOut(one<ArchiveRow>("SELECT * FROM archivist WHERE id = ?", id)!);
}

interface ArchiveRow {
  id: string;
  chat_id: string;
  question: string;
  answer: string;
  citations: string;
  created_at: number;
}

export function archiveOut(r: ArchiveRow) {
  const c = parseJson<{ citations: ArchiveCitation[]; confidence: string; all: ArchiveCitation[] }>(r.citations, { citations: [], confidence: "likely", all: [] });
  return { id: r.id, question: r.question, answer: r.answer, citations: c.citations, sources: c.all, confidence: c.confidence, createdAt: r.created_at };
}

export function listArchive(chatId: string) {
  return all<ArchiveRow>("SELECT * FROM archivist WHERE chat_id = ? ORDER BY created_at DESC LIMIT 100", chatId).map(archiveOut);
}

export function deleteArchive(id: string) {
  run("DELETE FROM archivist WHERE id = ?", id);
}

/** Push an answer into the story: as a standing OOC note, or as a pinned memory with its sources. */
export function pushArchive(id: string, as: "ooc" | "memory") {
  const r = one<ArchiveRow>("SELECT * FROM archivist WHERE id = ?", id);
  if (!r) throw notFound("Answer not found");
  const a = archiveOut(r);
  const text = a.answer.replace(/\s*\[\d+\]/g, "").trim();
  if (as === "ooc") {
    const chat = getChatRow(r.chat_id)!;
    const settings = parseJson<ChatSettings>(chat.settings, {});
    const ooc = [...(settings.ooc ?? []), { id: newId().slice(0, 8), text: `Established: ${text}`.slice(0, 600) }].slice(-20);
    updateChat(r.chat_id, { settings: { ooc } });
    publish({ type: "chat.changed", chatId: r.chat_id });
    return { ok: true, as };
  }
  const memory = createAtom(r.chat_id, { type: "fact", content: text.slice(0, 1000), pinned: true, importance: 8, messageIds: a.citations.map((c) => c.messageId).filter((x): x is string => Boolean(x)) });
  return { ok: true, as, memory };
}

/** For callers that only want text (the /ask command). */
export async function quickAnswer(chatId: string, question: string) {
  const a = await askArchivist(chatId, question);
  return { answer: a.answer, citations: a.citations, id: a.id, evicted: memState(chatId).evictedThrough };
}
