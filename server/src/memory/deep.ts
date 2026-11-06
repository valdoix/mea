import { all } from "../db/db";
import { chatVectors, closestPassages, cosine, passageChunks } from "./embed";
import type { SummaryRow } from "./store";
import { cleanText, contentWords, ftsQuery } from "./text";

/**
 * Two-phase deep search (MEM-22): for material too old for the scene records to carry in detail,
 * find the chapters that match, then the scenes inside them, then quote the messages themselves.
 * Used by recall when the story reaches far back, and by the Archivist (CON-07).
 */

export interface DeepHit {
  chapterId: string | null;
  chapterTitle: string | null;
  sceneId: string;
  sceneTitle: string;
  messageId: string;
  seq: number;
  speaker: string;
  excerpt: string;
  score: number;
  reasons: string[];
}

const rrf = (rank: number) => 1 / (60 + rank);

function rank(chatId: string, rows: SummaryRow[], q: string | null, qvec: Float32Array | null) {
  const scores = new Map<string, { score: number; reasons: string[] }>();
  const bump = (id: string, n: number, why: string) => {
    const s = scores.get(id) ?? { score: 0, reasons: [] };
    s.score += n;
    s.reasons.push(why);
    scores.set(id, s);
  };
  const ids = new Set(rows.map((r) => r.id));
  if (q && rows.length) {
    all<{ id: string }>("SELECT id FROM summaries_fts WHERE summaries_fts MATCH ? AND chat_id = ? ORDER BY bm25(summaries_fts) LIMIT 60", q, chatId)
      .filter((h) => ids.has(h.id))
      .forEach((h, i) => bump(h.id, rrf(i), "keywords"));
  }
  if (qvec) {
    chatVectors(chatId)
      .filter((v) => v.ownerType === "summary" && ids.has(v.ownerId))
      .map((v) => ({ id: v.ownerId, sim: cosine(qvec, v.vector) }))
      .filter((s) => s.sim > 0.15)
      .sort((a, b) => b.sim - a.sim)
      .forEach((s, i) => bump(s.id, rrf(i) * 1.2, `meaning ${s.sim.toFixed(2)}`));
  }
  return rows
    .filter((r) => scores.has(r.id))
    .map((r) => ({ row: r, ...scores.get(r.id)! }))
    .sort((a, b) => b.score - a.score);
}

/** The few sentences of a message that best match the query, about `size` characters. */
export function excerpt(text: string, words: Set<string>, size = 320) {
  const clean = cleanText(text).replace(/\s+/g, " ").trim();
  if (clean.length <= size) return clean;
  const sentences = clean.split(/(?<=[.!?…]["”')\]*]*)\s+/);
  let best = 0;
  let bestScore = -1;
  sentences.forEach((s, i) => {
    let n = 0;
    for (const w of contentWords(s)) if (words.has(w)) n++;
    if (n > bestScore) {
      bestScore = n;
      best = i;
    }
  });
  let out = sentences[best]!;
  let lo = best - 1;
  let hi = best + 1;
  while (out.length < size && (lo >= 0 || hi < sentences.length)) {
    if (hi < sentences.length && out.length + sentences[hi]!.length < size) out = `${out} ${sentences[hi++]}`;
    else if (lo >= 0 && out.length + sentences[lo]!.length < size) out = `${sentences[lo--]} ${out}`;
    else break;
  }
  return `${lo >= 0 ? "… " : ""}${out.slice(0, size + 80)}${hi < sentences.length ? " …" : ""}`;
}

/** Whether the point-of-view character heard a message; false keeps it out of the quotes (docs/27 Part 5). */
export type HeardFilter = (m: { seq: number; name: string | null; role: string }) => boolean;

interface Msg {
  id: string;
  seq: number;
  name: string | null;
  role: string;
  content: string;
}

interface Found {
  m: Msg;
  score: number;
  /** The passage that matched in meaning, quoted instead of the best-worded sentences. */
  passage?: string;
  reasons: string[];
}

/**
 * docs/27 Part 5: the old messages closest in meaning to the query, best first, each with the passage
 * that matched. Only live messages count: the active swipe, not deleted or hidden, before `beforeSeq`.
 */
function closestMessages(chatId: string, qvec: Float32Array, beforeSeq: number, heard: (m: Msg) => boolean) {
  const near = closestPassages(chatId, qvec, 80);
  if (!near.length) return [];
  const rows = all<Msg & { swipe: string }>(
    `SELECT s.id AS swipe, m.id, m.seq, m.name, m.role, s.content FROM swipes s JOIN messages m ON m.id = s.message_id AND s.idx = m.active_swipe
     WHERE s.id IN (${near.map(() => "?").join(",")}) AND m.chat_id = ? AND m.seq <= ? AND m.deleted_at IS NULL AND m.hidden = 0`,
    ...near.map((p) => p.swipeId),
    chatId,
    beforeSeq,
  );
  const bySwipe = new Map(rows.map((r) => [r.swipe, r]));
  const out: { m: Msg; passage: string; sim: number }[] = [];
  for (const p of near) {
    const m = bySwipe.get(p.swipeId);
    if (!m || !heard(m)) continue;
    out.push({ m, passage: passageChunks(m.content)[p.n] ?? m.content, sim: p.sim });
  }
  return out;
}

export function deepSearch(
  chatId: string,
  opts: { query: string; qvec: Float32Array | null; beforeSeq: number; quotes?: number; scenesPerChapter?: number; excerptSize?: number; heard?: HeardFilter | null },
) {
  const q = ftsQuery(opts.query, 20);
  if (!q && !opts.qvec) return [] as DeepHit[];
  const chapters = all<SummaryRow>(
    "SELECT * FROM summaries WHERE chat_id = ? AND level = 'chapter' AND closed = 1 AND state = 'ready' AND end_seq <= ? ORDER BY start_seq",
    chatId,
    opts.beforeSeq,
  );
  const scenes = all<SummaryRow>(
    "SELECT * FROM summaries WHERE chat_id = ? AND level = 'scene' AND closed = 1 AND state = 'ready' AND end_seq <= ? ORDER BY start_seq",
    chatId,
    opts.beforeSeq,
  );
  if (!scenes.length) return [];
  const heard = (m: Msg) => !opts.heard || opts.heard(m);

  // Phase 1: chapters. A short story without chapters goes straight to its scenes.
  const topChapters = chapters.length ? rank(chatId, chapters, q, opts.qvec).slice(0, 2) : [];
  const pool = topChapters.length
    ? topChapters.flatMap((c) =>
        rank(
          chatId,
          scenes.filter((s) => s.start_seq >= c.row.start_seq && (s.end_seq ?? 0) <= (c.row.end_seq ?? Infinity)),
          q,
          opts.qvec,
        )
          .slice(0, opts.scenesPerChapter ?? 2)
          .map((s) => ({ ...s, chapter: c })),
      )
    : rank(chatId, scenes, q, opts.qvec)
        .slice(0, 3)
        .map((s) => ({ ...s, chapter: null }));

  // Phase 2: the messages themselves, quoted, found by their words and (docs/27 Part 5) their meaning.
  const words = contentWords(opts.query);
  const near = opts.qvec ? closestMessages(chatId, opts.qvec, opts.beforeSeq, heard) : [];
  const byWords = (lo: number, hi: number, limit: number) =>
    q
      ? all<Msg>(
          `SELECT m.id, m.seq, m.name, m.role, s.content FROM swipes_fts f
           JOIN swipes s ON s.rowid = f.rowid JOIN messages m ON m.id = s.message_id AND s.idx = m.active_swipe
           WHERE swipes_fts MATCH ? AND m.chat_id = ? AND m.seq BETWEEN ? AND ? AND m.deleted_at IS NULL AND m.hidden = 0
           ORDER BY bm25(swipes_fts) LIMIT ?`,
          q,
          chatId,
          lo,
          hi,
          limit,
        ).filter(heard)
      : [];
  const fuse = (wordHits: Msg[], meaningHits: typeof near, weight: number) => {
    const found = new Map<string, Found>();
    const add = (m: Msg, n: number, why: string, passage?: string) => {
      const f = found.get(m.id) ?? { m, score: 0, reasons: [] };
      f.score += n;
      f.reasons.push(why);
      if (passage) f.passage = passage;
      found.set(m.id, f);
    };
    wordHits.forEach((m, i) => add(m, rrf(i) * weight, "keywords"));
    meaningHits.forEach((p, i) => add(p.m, rrf(i) * 1.2 * weight, `close in meaning ${p.sim.toFixed(2)}`, p.passage));
    return [...found.values()].sort((a, b) => b.score - a.score);
  };
  const hit = (f: Found, scene: SummaryRow, chapter: SummaryRow | null, score: number, reasons: string[]): DeepHit => ({
    chapterId: chapter?.id ?? null,
    chapterTitle: chapter?.title ?? null,
    sceneId: scene.id,
    sceneTitle: scene.title,
    messageId: f.m.id,
    seq: f.m.seq,
    speaker: f.m.name ?? (f.m.role === "user" ? "You" : f.m.role),
    excerpt: excerpt(f.passage ?? f.m.content, words, opts.excerptSize),
    score,
    reasons,
  });

  const hits: DeepHit[] = [];
  for (const s of pool) {
    const lo = s.row.start_seq;
    const hi = s.row.end_seq ?? s.row.start_seq;
    const inScene = near.filter((p) => p.m.seq >= lo && p.m.seq <= hi).slice(0, 4);
    for (const f of fuse(byWords(lo, hi, 4), inScene, 1).slice(0, 2)) {
      // L13: the best match in the scene gets the biggest bonus.
      hits.push(hit(f, s.row, s.chapter?.row ?? null, s.score + (s.chapter?.score ?? 0) + f.score, [s.chapter ? `chapter "${s.chapter.row.title}"` : "", `scene "${s.row.title}"`, ...f.reasons, ...s.reasons.slice(0, 2)].filter(Boolean)));
    }
  }
  // The records may not mention a small detail at all: search the old messages themselves, by their
  // words and their meaning, and say which scene and chapter each one belongs to.
  if (hits.length < (opts.quotes ?? 3)) {
    for (const f of fuse(byWords(0, opts.beforeSeq, 6), near.slice(0, 6), 0.8)) {
      if (hits.some((h) => h.messageId === f.m.id)) continue;
      const scene = [...scenes].reverse().find((s) => s.start_seq <= f.m.seq);
      if (!scene || (scene.end_seq ?? 0) < f.m.seq) continue;
      const chapter = [...chapters].reverse().find((c) => c.start_seq <= f.m.seq && (c.end_seq ?? Infinity) >= f.m.seq) ?? null;
      hits.push(hit(f, scene, chapter, f.score, [f.reasons.includes("keywords") ? "the words themselves" : "", ...f.reasons.filter((r) => r !== "keywords"), chapter ? `chapter "${chapter.title}"` : "", `scene "${scene.title}"`].filter(Boolean)));
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  return hits.filter((h) => !seen.has(h.messageId) && seen.add(h.messageId)).slice(0, opts.quotes ?? 3);
}

/** Words that suggest the story is reaching back ("remember when…", "the first time", "back then"). */
export const RECALL_CUE =
  /\b(remember|recall|back (?:then|when)|that time|the first time|long ago|years? ago|months? ago|weeks? ago|days? ago|used to|before (?:all this|we met)|promised|you (?:said|told me)|last (?:time|year|summer|winter))\b/i;
