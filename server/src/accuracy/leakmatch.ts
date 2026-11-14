import { all, one } from "../db/db";
import { cleanText, contentWords } from "../memory/text";
import { carryingWords, stem } from "../trackers/secretwords";

/**
 * docs/35 Part 3: a secret matched on what it says, not on its vocabulary. "Buffy clawed out of her own
 * grave" once flagged Ruth's line about a town "that doesn't know she's alive": two shared words are a
 * low bar. A word the story uses all the time says little; one it rarely uses says a lot.
 */

type Rarity = { n: number; seq: number; df: Map<string, number> };
const cache = new Map<string, Rarity>();

/** How rare each stem is in this story: how many replies use it, read once and kept until the story grows. */
function rarityOf(chatId: string): Rarity {
  const last = one<{ s: number | null; n: number }>("SELECT MAX(seq) AS s, COUNT(*) AS n FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId);
  const seq = last?.s ?? 0;
  const hit = cache.get(chatId);
  // A few new replies barely move the counts: read again every 25.
  if (hit && Math.abs(seq - hit.seq) < 25) return hit;
  const df = new Map<string, number>();
  const rows = all<{ content: string }>(
    "SELECT s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.chat_id = ? AND m.deleted_at IS NULL",
    chatId,
  );
  for (const r of rows) for (const w of new Set([...contentWords(cleanText(r.content), 4)].map(stem))) df.set(w, (df.get(w) ?? 0) + 1);
  const out = { n: rows.length, seq, df };
  cache.set(chatId, out);
  return out;
}

/** A stem's weight: rare in this story is heavy. A short story weighs every word the same. */
export function weigher(chatId: string | null): (stem: string) => number {
  if (!chatId) return () => 1;
  const r = rarityOf(chatId);
  if (r.n < 20) return () => 1;
  return (w) => Math.max(0.1, Math.log((r.n + 1) / ((r.df.get(w) ?? 0) + 0.5)) / Math.log(r.n + 1));
}

/** Not the secret said: a question ("Is she alive?"), a denial ("she isn't alive"), or a memory of something else. */
export function notStating(sentence: string): boolean {
  const s = sentence.replace(/[*_]/g, "").trim();
  if (/\?\s*["”’)]*\s*$/.test(s) || /\?["”’]/.test(s)) return true;
  if (/\b(?:not|never|no longer|isn['’]t|wasn['’]t|aren['’]t|doesn['’]t|didn['’]t|can['’]t|couldn['’]t|won['’]t|hasn['’]t|haven['’]t)\b/i.test(s)) return true;
  return /\b(?:used to|remember(?:s|ed)?|recall(?:s|ed)?|back when|years ago|as a kid|when (?:she|he|they) was)\b/i.test(s);
}

export interface LeakHit {
  hits: string[];
  /** The share of the secret's weight the sentence carries, 0 to 1. */
  share: number;
  leak: boolean;
}

/** Whether a sentence says this secret, by weight: two words or more, and most of what makes it this secret. */
export function leakMatch(secret: string, sentence: string, o: { names: Set<string>; weight: (stem: string) => number; min?: number }): LeakHit {
  const S = [...carryingWords(secret, o.names).keys()];
  const T = new Set([...contentWords(sentence, 4)].map(stem));
  const hits = S.filter((w) => T.has(w));
  const total = S.reduce((a, w) => a + o.weight(w), 0);
  const share = total ? hits.reduce((a, w) => a + o.weight(w), 0) / total : 0;
  return { hits, share, leak: hits.length >= 2 && share >= (o.min ?? 0.4) };
}

/** docs/35 3.4: a one-word secret about someone being somewhere or alive ("Buffy is alive"): who, and the word. */
const SHORT = /^((?:\S+\s+){0,3}?\S+)\s+(?:is|was|'s|’s)\s+(?:still\s+|really\s+)?(alive|back|here|home|in town|not dead|living|awake|pregnant|married|engaged|dying|sick|a vampire|a slayer|a witch|human)\b/i;

export function shortSecret(statement: string): { who: string; what: string } | null {
  const m = SHORT.exec(statement.trim());
  return m ? { who: m[1]!, what: m[2]!.toLowerCase() } : null;
}

/** A sentence that says a short secret: its person (by a name of theirs, or "she"/"he" right after one) with its word. */
export function saysShort(sentence: string, s: { what: string }, names: string[]): boolean {
  const low = sentence.toLowerCase();
  if (!new RegExp(`\\b${s.what.replace(/\s+/g, "\\s+")}\\b`, "i").test(low)) return false;
  return names.some((n) => n.length > 2 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(sentence));
}
