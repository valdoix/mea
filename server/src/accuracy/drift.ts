import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { cosine, embeddingsEnabled, embedQueries } from "../memory/embed";
import { cleanText } from "../memory/text";
import { getCard } from "../services/characters";
import { characterSettings } from "../services/charsettings";
import { mustChat } from "../services/chats";
import { enqueue, type JobContext } from "../services/jobs";
import { guardsFor } from "./guards";
import { furthestVoiceSlot, voiceFacts } from "../lore/voice";

/**
 * The drift detector (CON-10). The character's recent lines are compared with their voice
 * samples (the voice lab's kept lines, then the card's example dialogue): style statistics
 * always, and meaning through embeddings when they're switched on. A drifting voice is shown in
 * the chat and makes the re-anchor (CON-03) stronger until the voice comes back.
 */

export interface StyleStats {
  words: number;
  sentences: number;
  /** Words per sentence. */
  sentLen: number;
  /** Letters per word. */
  wordLen: number;
  /** Contractions per 100 words. */
  contractions: number;
  /** Share of sentences ending in "!" / "?" / trailing off (… or —). */
  exclaim: number;
  question: number;
  trail: number;
  /** Formal connectives per 100 words ("however", "indeed", "shall"…). */
  formal: number;
}

const FEATURES: { key: keyof StyleStats; tol: number; more: string; less: string; fmt: (v: number) => string }[] = [
  { key: "sentLen", tol: 4, more: "longer sentences", less: "shorter sentences", fmt: (v) => `${v.toFixed(0)} words` },
  { key: "wordLen", tol: 0.45, more: "longer words", less: "plainer words", fmt: (v) => `${v.toFixed(1)} letters` },
  { key: "contractions", tol: 3, more: "more contractions", less: "fewer contractions", fmt: (v) => `${v.toFixed(1)} per 100 words` },
  { key: "exclaim", tol: 0.15, more: "more exclamations", less: "fewer exclamations", fmt: (v) => `${Math.round(v * 100)}% of lines` },
  { key: "question", tol: 0.15, more: "more questions", less: "fewer questions", fmt: (v) => `${Math.round(v * 100)}% of lines` },
  { key: "trail", tol: 0.15, more: "more trailing off (… —)", less: "less trailing off (… —)", fmt: (v) => `${Math.round(v * 100)}% of lines` },
  { key: "formal", tol: 1, more: "more formal", less: "less formal", fmt: (v) => `${v.toFixed(1)} formal words per 100` },
];

const FORMAL = /\b(however|therefore|indeed|moreover|furthermore|shall|perhaps|certainly|nevertheless|thus|whom|whilst|hence|regarding|quite|rather)\b/gi;
const CONTRACTION = /\b\w+(?:n['’]t|['’](?:re|ll|m|ve|d))\b|\b(?:it|that|he|she|there|what|who|here|let)['’]s\b/gi;

/** Style statistics of some lines of dialogue. */
export function styleStats(texts: string[]): StyleStats {
  const sents = texts.flatMap((t) => t.split(/(?<=[.!?…—])\s+|\n+/)).map((s) => s.trim()).filter((s) => /\p{L}/u.test(s));
  const words = sents.flatMap((s) => s.match(/[\p{L}'’]+/gu) ?? []);
  const n = Math.max(1, words.length);
  const k = Math.max(1, sents.length);
  const joined = sents.join(" ");
  return {
    words: words.length,
    sentences: sents.length,
    sentLen: words.length / k,
    wordLen: words.reduce((a, w) => a + w.replace(/['’]/g, "").length, 0) / n,
    contractions: ((joined.match(CONTRACTION) ?? []).length / n) * 100,
    exclaim: sents.filter((s) => /!["”']*$/.test(s)).length / k,
    question: sents.filter((s) => /\?["”']*$/.test(s)).length / k,
    trail: sents.filter((s) => /(…|\.\.\.|—|--)["”']*$/.test(s)).length / k,
    formal: ((joined.match(FORMAL) ?? []).length / n) * 100,
  };
}

/** How far apart two styles are, 0 (same) to 1 (nothing alike), with the biggest differences in words. */
export function styleDistance(ref: StyleStats, cur: StyleStats) {
  const parts = FEATURES.map((f) => {
    const z = Math.abs(cur[f.key] - ref[f.key]) / f.tol;
    return { f, z, dir: cur[f.key] > ref[f.key] ? "more" : "less" };
  });
  const score = parts.reduce((a, p) => a + Math.min(p.z, 3) / 3, 0) / parts.length;
  const reasons = parts
    .filter((p) => p.z >= 1.5)
    .sort((a, b) => b.z - a.z)
    .slice(0, 3)
    .map((p) => `${p.dir === "more" ? p.f.more : p.f.less} (${p.f.fmt(cur[p.f.key])} vs ${p.f.fmt(ref[p.f.key])})`);
  return { score, reasons };
}

/** The spoken part of a reply: quoted speech when there is any, else the text without *actions*. */
export function spokenPart(text: string) {
  const t = cleanText(text);
  const quotes = [...t.matchAll(/"([^"\n]{2,})"|“([^”\n]{2,})”/g)].map((m) => (m[1] ?? m[2] ?? "").trim());
  if (quotes.length) return quotes.join(" ");
  return t.replace(/\*[^*\n]+\*/g, " ").replace(/\s+/g, " ").trim();
}

/** The character's voice samples: kept voice-lab lines, then the card's example dialogue. */
export function voiceSamples(characterId: string | null): { lines: string[]; source: "voice lab" | "examples" | "both" | "none" } {
  if (!characterId) return { lines: [], source: "none" };
  const kept = (characterSettings(characterId).voice?.kept ?? []).map((v) => v.line.trim()).filter(Boolean);
  const card = getCard(characterId);
  const name = card?.name ?? "";
  const examples: string[] = [];
  for (const chunk of (card?.mes_example ?? "").split(/<START>/i)) {
    for (const line of chunk.split("\n")) {
      const m = line.match(/^\s*(?:\{\{char\}\}|<BOT>|([^:]{1,40})):\s*(.+)$/i);
      if (!m) continue;
      if (m[1] && name && m[1].trim().toLowerCase() !== name.toLowerCase()) continue;
      examples.push(m[2]!.trim());
    }
  }
  const lines = [...kept, ...examples].filter((l) => l.length > 3);
  return { lines, source: kept.length && examples.length ? "both" : kept.length ? "voice lab" : examples.length ? "examples" : "none" };
}

export interface DriftReading {
  id: string;
  seq: number;
  score: number;
  drifting: boolean;
  reasons: string[];
  semantic: number | null;
  style: number;
  samples: number;
  replies: number;
  at: number;
}

interface Row {
  id: string;
  chat_id: string;
  seq: number;
  score: number;
  drifting: number;
  details: string;
  created_at: number;
}

const out = (r: Row): DriftReading => {
  const d = parseJson<{ reasons?: string[]; semantic?: number | null; style?: number; samples?: number; replies?: number }>(r.details, {});
  return { id: r.id, seq: r.seq, score: r.score, drifting: Boolean(r.drifting), reasons: d.reasons ?? [], semantic: d.semantic ?? null, style: d.style ?? r.score, samples: d.samples ?? 0, replies: d.replies ?? 0, at: r.created_at };
};

export function driftHistory(chatId: string, limit = 30): DriftReading[] {
  return all<Row>("SELECT * FROM drift_checks WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?", chatId, limit).map(out).reverse();
}

/** The latest reading, if it still counts (a newer reading replaces it). */
export function driftState(chatId: string): DriftReading | null {
  const r = one<Row>("SELECT * FROM drift_checks WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1", chatId);
  return r ? out(r) : null;
}

type ReplyRow = { content: string; seq: number };
function characterReplies(chatId: string, limit: number, order: "ASC" | "DESC") {
  return all<ReplyRow>(
    `SELECT s.content, m.seq FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.role = 'assistant' AND m.deleted_at IS NULL AND m.hidden = 0 AND s.status = 'done' AND TRIM(s.content) != ''
     ORDER BY m.seq ${order} LIMIT ?`,
    chatId,
    limit,
  );
}

export type DriftResult = { status: "ok"; reading: DriftReading } | { status: "insufficient"; reason: string };

/** Measures the voice now. Saves a reading when there's enough to compare. */
export async function checkDrift(chatId: string, opts: { job?: JobContext; recent?: number } = {}): Promise<DriftResult> {
  const chat = mustChat(chatId);
  const cfg = guardsFor(chatId);
  const samples = voiceSamples(chat.character_id);
  const refText = samples.lines.map(spokenPart).filter(Boolean);
  const ref = styleStats(refText);
  if (ref.words < 25) return { status: "insufficient", reason: "Not enough voice samples yet: keep a few lines in the voice lab, or add example dialogue to the card." };
  const n = opts.recent ?? 8;
  const recentRows = characterReplies(chatId, n, "DESC");
  const recentText = recentRows.map((r) => spokenPart(r.content)).filter(Boolean);
  const cur = styleStats(recentText);
  if (cur.words < 60) return { status: "insufficient", reason: "Not enough of the character's lines in this chat yet." };
  const style = styleDistance(ref, cur);

  // Meaning (optional): has the voice moved away from the samples since the chat began?
  let semantic: number | null = null;
  const total = one<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND role = 'assistant' AND deleted_at IS NULL", chatId)?.n ?? 0;
  if (embeddingsEnabled() && total >= n * 3) {
    const early = characterReplies(chatId, n, "ASC").map((r) => spokenPart(r.content)).join(" ").slice(0, 4000);
    const [vr, vc, ve] = await embedQueries([refText.join(" ").slice(0, 4000), recentText.join(" ").slice(0, 4000), early], 10_000);
    if (vr && vc && ve) semantic = Math.max(0, Math.min(1, (cosine(vr, ve) - cosine(vr, vc)) / 0.12));
  }
  const score = semantic == null ? style.score : 0.65 * style.score + 0.35 * semantic;
  // docs/15, 3.5: the voice slot (from their lore) the replies are furthest from, by name.
  const slotReason = chat.character_id ? furthestVoiceSlot(voiceFacts(chatId, getCard(chat.character_id)?.name ?? ""), recentRows.map((r) => r.content).join(" ")) : null;
  const reasons = [...style.reasons, ...(semantic != null && semantic >= 0.5 ? ["what they talk about and how has moved away from the samples"] : []), ...(slotReason ? [slotReason] : [])];
  const drifting = score >= cfg.driftThreshold;
  const id = newId();
  run(
    "INSERT INTO drift_checks (id, chat_id, seq, score, drifting, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    chatId,
    recentRows[0]?.seq ?? 0,
    score,
    drifting ? 1 : 0,
    JSON.stringify({ reasons, semantic, style: style.score, samples: samples.lines.length, replies: recentRows.length, ref, cur }),
    now(),
  );
  // Keep a short history per chat.
  run("DELETE FROM drift_checks WHERE chat_id = ? AND id NOT IN (SELECT id FROM drift_checks WHERE chat_id = ? ORDER BY created_at DESC LIMIT 60)", chatId, chatId);
  opts.job?.note({ drift: Math.round(score * 100) / 100 });
  publish({ type: "chat.changed", chatId });
  return { status: "ok", reading: out(one<Row>("SELECT * FROM drift_checks WHERE id = ?", id)!) };
}

/** After a reply: every few of the character's replies, measure again (in the background). */
export function scheduleDrift(chatId: string) {
  const cfg = guardsFor(chatId);
  if (!cfg.drift) return;
  const n = one<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND role = 'assistant' AND deleted_at IS NULL", chatId)?.n ?? 0;
  if (n < 4 || n % cfg.driftEvery !== 0) return;
  enqueue("accuracy.drift", { chatId }, { delayMs: 4000, chatId, dedupeKey: `accuracy.drift:${chatId}` });
}

export async function runDriftJob(chatId: string, job?: JobContext) {
  if (!guardsFor(chatId).drift) return;
  await checkDrift(chatId, { job });
}
