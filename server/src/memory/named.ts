import { all, one, parseJson } from "../db/db";
import { sourcesLive } from "./atoms";
import { norm } from "./entities";
import { namedTerms } from "./text";

/**
 * What the memories say about a name just used, and who they have down as knowing it (docs/26 2.1).
 * Stances only exist when the tracker wrote a line, and at #89 it wrote none for the nickname Gabriel
 * had just told Buffy. The memory of that moment had who knew all along, and nothing read it for
 * knowledge. This goes in FACTS IN PLAY, so it reaches every reader whatever recall's budget does.
 */

/** A name in more memories than this is a regular, and "what's known about it" would be a list of everything. */
const NAMED_MEMORIES = 8;

export interface NamedFact {
  term: string;
  /** The latest fact that holds the name. */
  statement: string;
  knownBy: string[];
  firstSeq: number;
  lastSeq: number;
}

interface Row {
  type: string;
  content: string;
  known_by: string;
  max_seq: number | null;
}

/** The names in the text that a few memories hold, before this message. `skip`: names not worth a line (the cast's own). */
export function namedFacts(chatId: string, text: string | undefined, beforeSeq: number, skip: Set<string>, max = 2): NamedFact[] {
  if (!text?.trim()) return [];
  const out: NamedFact[] = [];
  for (const { term, proper } of namedTerms(text)) {
    if (out.length >= max) break;
    // This line is read as true over any guess, so only a word written as a name, and only that very word
    // ("Innocence" would otherwise find "innocent", and a quoted "Sorry" anything).
    if (!proper || skip.has(norm(term))) continue;
    const rows = all<Row>(
      `SELECT m.type, m.content, m.known_by, m.max_seq FROM memories_fts f JOIN memories m ON m.id = f.id
       WHERE memories_fts MATCH ? AND f.chat_id = ? AND m.deleted_at IS NULL AND m.status IN ('active', 'disputed') AND ${sourcesLive("m")}
       ORDER BY m.max_seq LIMIT ?`,
      `"${term.replaceAll('"', "")}"`,
      chatId,
      NAMED_MEMORIES + 1,
    );
    if (rows.length > NAMED_MEMORIES) continue;
    // A thread that took the word as its title ("Resolved: Brongel…") says nothing about it.
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const word = new RegExp(String.raw`(?<![\p{L}\p{N}])${escaped}(?![\p{L}\p{N}])`, "iu");
    const facts = rows.filter((r) => r.type === "fact" && (r.max_seq ?? 0) < beforeSeq && word.test(r.content));
    const last = facts.at(-1);
    if (!last) continue;
    const knownBy = new Map<string, string>();
    for (const r of facts) for (const k of parseJson<string[]>(r.known_by, [])) if (!knownBy.has(norm(k))) knownBy.set(norm(k), k);
    out.push({ term, statement: last.content, knownBy: [...knownBy.values()], firstSeq: facts[0]!.max_seq ?? 0, lastSeq: last.max_seq ?? 0 });
  }
  return out;
}

export interface NamesStats {
  /** Rare names the player used in these turns, that memories out of the window held. */
  used: number;
  /** How many of them reached the prompt as a memory. */
  reached: number;
  /** The newest one that didn't. */
  missed?: { messageId: string; seq: number; term: string };
}

/**
 * docs/26 5.2: names used against what recall brought back, from the requests already stored. Only a
 * reply's kept try counts, and a name still in the window is on the page, so it doesn't.
 */
export function namesStats(chatId: string, replies: { id: string; seq: number; idx: number }[]): NamesStats {
  const out: NamesStats = { used: 0, reached: 0 };
  for (const r of [...replies].sort((a, b) => a.seq - b.seq)) {
    const asked = one<{ content: string }>(
      `SELECT s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
       WHERE m.chat_id = ? AND m.seq < ? AND m.role = 'user' AND m.deleted_at IS NULL ORDER BY m.seq DESC LIMIT 1`,
      chatId,
      r.seq,
    );
    const generation = parseJson<{ generationId?: string }>(one<{ meta: string }>("SELECT meta FROM swipes WHERE message_id = ? AND idx = ?", r.id, r.idx)?.meta, {}).generationId;
    if (!asked || !generation) continue;
    const evicted = one<{ e: number | null }>("SELECT json_extract(trace, '$.memory.evictedThrough') AS e FROM generations WHERE id = ?", generation)?.e;
    if (evicted == null) continue;
    for (const { term, proper } of namedTerms(asked.content)) {
      if (!proper) continue;
      const held = all<{ id: string; min_seq: number | null }>(
        `SELECT m.id, m.min_seq FROM memories_fts f JOIN memories m ON m.id = f.id
         WHERE memories_fts MATCH ? AND f.chat_id = ? AND m.deleted_at IS NULL AND m.status IN ('active', 'disputed') AND ${sourcesLive("m")} LIMIT ?`,
        `"${term.replaceAll('"', "")}"`,
        chatId,
        NAMED_MEMORIES + 1,
      );
      if (held.length > NAMED_MEMORIES) continue;
      const usable = held.filter((h) => (h.min_seq ?? 0) <= evicted);
      if (!usable.length) continue;
      out.used++;
      const reached = one(`SELECT 1 FROM memory_usage WHERE generation_id = ? AND owner_type = 'memory' AND owner_id IN (${usable.map(() => "?").join(",")}) LIMIT 1`, generation, ...usable.map((h) => h.id));
      if (reached) out.reached++;
      else out.missed = { messageId: r.id, seq: r.seq, term };
    }
  }
  return out;
}
