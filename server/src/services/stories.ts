import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { levelRows, storyRow } from "../memory/store";
import { ftsQuery } from "../memory/text";

/**
 * Your library of stories (Phase 3): auto-titled chats with optional covers (LIB-04), global
 * search across chats, characters, lore and memories (LIB-05), collections (LIB-06), and story
 * stats (LIB-07).
 */

// ---------- auto titles and covers (LIB-04) ----------

/** A title you set yourself is never replaced; otherwise the Story So Far (or the latest chapter) names the chat. */
export function autoTitle(chatId: string) {
  const c = one<{ title: string; title_locked: number }>("SELECT title, title_locked FROM chats WHERE id = ?", chatId);
  if (!c || c.title_locked) return null;
  const story = storyRow(chatId);
  const chapter = [...levelRows(chatId, "chapter")].reverse().find((r) => r.state === "ready" && r.title.trim());
  const title = (story?.state === "ready" && story.title.trim() ? story.title : chapter?.title)?.trim().replace(/^["“]|["”]$/g, "").slice(0, 120);
  if (!title || title === c.title) return null;
  run("UPDATE chats SET title = ?, updated_at = ? WHERE id = ?", title, now(), chatId);
  publish({ type: "chat.changed", chatId });
  return title;
}

export function lockTitle(chatId: string, locked = true) {
  run("UPDATE chats SET title_locked = ? WHERE id = ?", locked ? 1 : 0, chatId);
  if (!locked) autoTitle(chatId);
}

export function setCover(chatId: string, imageId: string | null) {
  if (imageId && !one("SELECT 1 FROM images WHERE id = ?", imageId)) throw notFound("Image not found");
  run("UPDATE chats SET cover_image_id = ?, updated_at = ? WHERE id = ?", imageId, now(), chatId);
  publish({ type: "chat.changed", chatId });
}

export function chatExtras(chatId: string) {
  const c = one<{ title_locked: number; cover_image_id: string | null }>("SELECT title_locked, cover_image_id FROM chats WHERE id = ?", chatId);
  return { titleLocked: Boolean(c?.title_locked), coverImageId: c?.cover_image_id ?? null, collections: collectionsOf(chatId) };
}

// ---------- collections (LIB-06) ----------

export interface Collection {
  id: string;
  name: string;
  builtin: string | null;
  sort: number;
  count: number;
}

export function listCollections(): Collection[] {
  return all<{ id: string; name: string; builtin: string | null; sort: number; count: number }>(
    `SELECT k.id, k.name, k.builtin, k.sort, (SELECT COUNT(*) FROM collection_chats cc JOIN chats c ON c.id = cc.chat_id WHERE cc.collection_id = k.id AND c.deleted_at IS NULL) AS count
     FROM collections k ORDER BY k.sort, k.created_at`,
  );
}

export function createCollection(name: string) {
  const id = newId();
  const sort = (one<{ m: number | null }>("SELECT MAX(sort) AS m FROM collections")?.m ?? 0) + 1;
  run("INSERT INTO collections (id, name, sort, builtin, created_at) VALUES (?, ?, ?, NULL, ?)", id, name.trim().slice(0, 60), sort, now());
  return listCollections().find((c) => c.id === id)!;
}

export function renameCollection(id: string, name: string) {
  if (!one("SELECT 1 FROM collections WHERE id = ?", id)) throw notFound("Collection not found");
  run("UPDATE collections SET name = ? WHERE id = ?", name.trim().slice(0, 60), id);
}

export function deleteCollection(id: string) {
  const c = one<{ builtin: string | null }>("SELECT builtin FROM collections WHERE id = ?", id);
  if (!c) throw notFound("Collection not found");
  if (c.builtin) throw badRequest("Built-in collections can be renamed, not deleted");
  run("DELETE FROM collections WHERE id = ?", id);
}

export function reorderCollections(ids: string[]) {
  ids.forEach((id, i) => run("UPDATE collections SET sort = ? WHERE id = ?", i, id));
}

export function collectionsOf(chatId: string) {
  return all<{ collection_id: string }>("SELECT collection_id FROM collection_chats WHERE chat_id = ?", chatId).map((r) => r.collection_id);
}

/** Puts a chat in (or takes it out of) a collection. Ongoing and Finished exclude each other. */
export function setChatCollection(chatId: string, collectionId: string, member: boolean) {
  const c = one<{ builtin: string | null }>("SELECT builtin FROM collections WHERE id = ?", collectionId);
  if (!c) throw notFound("Collection not found");
  if (member) {
    if (c.builtin === "ongoing" || c.builtin === "finished") {
      const other = c.builtin === "ongoing" ? "finished" : "ongoing";
      run("DELETE FROM collection_chats WHERE chat_id = ? AND collection_id IN (SELECT id FROM collections WHERE builtin = ?)", chatId, other);
    }
    run("INSERT OR IGNORE INTO collection_chats (collection_id, chat_id, added_at) VALUES (?, ?, ?)", collectionId, chatId, now());
  } else run("DELETE FROM collection_chats WHERE collection_id = ? AND chat_id = ?", collectionId, chatId);
  publish({ type: "chat.changed", chatId });
  return collectionsOf(chatId);
}

export function chatIdsIn(collectionId: string) {
  return new Set(all<{ chat_id: string }>("SELECT chat_id FROM collection_chats WHERE collection_id = ?", collectionId).map((r) => r.chat_id));
}

// ---------- stats (LIB-07) ----------

const SESSION_GAP = 30 * 60_000;

function words(text: string) {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

/** Messages, words, tokens, cost, time spent and days active for one chat, or for everything. */
export function storyStats(chatId?: string) {
  const where = chatId ? "m.chat_id = ?" : "1 = 1";
  const params = chatId ? [chatId] : [];
  const msgs = all<{ role: string; content: string; created_at: number; chat_id: string }>(
    `SELECT m.role, s.content, m.created_at, m.chat_id FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     JOIN chats c ON c.id = m.chat_id WHERE ${where} AND m.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY m.chat_id, m.created_at`,
    ...params,
  );
  let wordsYou = 0;
  let wordsChar = 0;
  let spent = 0;
  const days = new Set<string>();
  let prev: { at: number; chat: string } | null = null;
  for (const m of msgs) {
    const w = words(m.content);
    if (m.role === "user") wordsYou += w;
    else if (m.role === "assistant") wordsChar += w;
    days.add(new Date(m.created_at).toISOString().slice(0, 10));
    // Time spent: the gaps between messages within a sitting, plus a minute for each message.
    if (prev && prev.chat === m.chat_id && m.created_at - prev.at < SESSION_GAP) spent += m.created_at - prev.at;
    else spent += 60_000;
    prev = { at: m.created_at, chat: m.chat_id };
  }
  const gen = one<{ n: number; prompt: number; completion: number; cached: number; cost: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(prompt_tokens), 0) AS prompt, COALESCE(SUM(completion_tokens), 0) AS completion, COALESCE(SUM(cached_tokens), 0) AS cached, COALESCE(SUM(cost), 0) AS cost
     FROM generations WHERE ${chatId ? "chat_id = ?" : "1 = 1"} AND status IN ('done', 'stopped')`,
    ...params,
  )!;
  const swipes = one<{ n: number }>(`SELECT COUNT(*) AS n FROM swipes s JOIN messages m ON m.id = s.message_id WHERE ${where} AND m.deleted_at IS NULL`, ...params)?.n ?? 0;
  const memories = one<{ n: number }>(`SELECT COUNT(*) AS n FROM memories WHERE ${chatId ? "chat_id = ?" : "1 = 1"} AND deleted_at IS NULL AND status = 'active'`, ...params)?.n ?? 0;
  const scenes = one<{ n: number }>(`SELECT COUNT(*) AS n FROM summaries WHERE ${chatId ? "chat_id = ?" : "1 = 1"} AND level = 'scene' AND closed = 1`, ...params)?.n ?? 0;
  // The longest run of consecutive days with a message.
  const sorted = [...days].sort();
  let streak = 0;
  let run1 = 0;
  for (let i = 0; i < sorted.length; i++) {
    run1 = i > 0 && Date.parse(sorted[i]!) - Date.parse(sorted[i - 1]!) === 86_400_000 ? run1 + 1 : 1;
    streak = Math.max(streak, run1);
  }
  return {
    messages: msgs.length,
    yourMessages: msgs.filter((m) => m.role === "user").length,
    words: wordsYou + wordsChar,
    yourWords: wordsYou,
    characterWords: wordsChar,
    swipes: Math.max(0, swipes - msgs.length),
    tokens: { prompt: gen.prompt, completion: gen.completion, cached: gen.cached, requests: gen.n },
    cost: Math.round(gen.cost * 10000) / 10000,
    minutesSpent: Math.round(spent / 60_000),
    daysActive: days.size,
    longestStreak: streak,
    firstAt: msgs[0]?.created_at ?? null,
    lastAt: msgs.at(-1)?.created_at ?? null,
    memories,
    scenes,
  };
}

// ---------- global search (LIB-05) ----------

export interface SearchHit {
  kind: "message" | "character" | "lore" | "memory" | "summary";
  id: string;
  title: string;
  snippet: string;
  chatId: string | null;
  chatTitle: string | null;
  link: string;
  seq?: number | null;
}

function snip(text: string, q: string, size = 180) {
  const t = text.replace(/\s+/g, " ");
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  const at = Math.max(0, ...words.map((w) => t.toLowerCase().indexOf(w)).filter((i) => i >= 0).slice(0, 1));
  const start = Math.max(0, at - 60);
  return `${start > 0 ? "…" : ""}${t.slice(start, start + size)}${start + size < t.length ? "…" : ""}`;
}

/** One search box for everything you've made (FTS5 where it exists, plain matching elsewhere). */
export function globalSearch(q: string, opts: { limit?: number; kinds?: SearchHit["kind"][] } = {}) {
  const text = q.trim();
  if (text.length < 2) return { results: [] as SearchHit[], counts: {} as Record<string, number> };
  const limit = Math.min(50, opts.limit ?? 20);
  const want = (k: SearchHit["kind"]) => !opts.kinds?.length || opts.kinds.includes(k);
  const like = `%${text.replace(/[%_\\]/g, (x) => `\\${x}`)}%`;
  // Exact phrase first, then the content words.
  const phrase = `"${text.replace(/"/g, "")}"`;
  const fts = ftsQuery(text) ?? phrase;
  const results: SearchHit[] = [];
  const tryFts = <T>(fn: (m: string) => T[]): T[] => {
    for (const m of [phrase, fts]) {
      try {
        const r = fn(m);
        if (r.length) return r;
      } catch {
        // a query FTS can't parse: try the next form
      }
    }
    return [];
  };

  if (want("message")) {
    const rows = tryFts((m) =>
      all<{ id: string; chat_id: string; seq: number; name: string | null; role: string; content: string; title: string }>(
        `SELECT m.id, m.chat_id, m.seq, m.name, m.role, s.content, c.title FROM swipes_fts f JOIN swipes s ON s.rowid = f.rowid
         JOIN messages m ON m.id = s.message_id AND s.idx = m.active_swipe JOIN chats c ON c.id = m.chat_id
         WHERE swipes_fts MATCH ? AND m.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY bm25(swipes_fts) LIMIT ?`,
        m,
        limit,
      ),
    );
    for (const r of rows) results.push({ kind: "message", id: r.id, title: `${r.name ?? r.role} · ${r.title}`, snippet: snip(r.content, text), chatId: r.chat_id, chatTitle: r.title, link: `/chat/${r.chat_id}?m=${r.id}`, seq: r.seq });
  }
  if (want("character")) {
    for (const r of all<{ id: string; name: string; card: string }>("SELECT id, name, card FROM characters WHERE deleted_at IS NULL AND (name LIKE ? ESCAPE '\\' OR card LIKE ? ESCAPE '\\') ORDER BY name LIMIT ?", like, like, limit)) {
      const d = parseJson<{ description?: string; personality?: string; scenario?: string }>(r.card, {});
      results.push({ kind: "character", id: r.id, title: r.name, snippet: snip(`${d.description ?? ""} ${d.personality ?? ""} ${d.scenario ?? ""}`, text), chatId: null, chatTitle: null, link: `/character/${r.id}` });
    }
  }
  if (want("lore")) {
    for (const r of all<{ id: string; lorebook_id: string; data: string; name: string }>(
      "SELECT e.id, e.lorebook_id, e.data, b.name FROM lorebook_entries e JOIN lorebooks b ON b.id = e.lorebook_id WHERE b.deleted_at IS NULL AND e.data LIKE ? ESCAPE '\\' LIMIT ?",
      like,
      limit,
    )) {
      const d = parseJson<{ comment?: string; keys?: string[]; content?: string }>(r.data, {});
      results.push({ kind: "lore", id: r.id, title: `${d.comment || d.keys?.[0] || "Entry"} · ${r.name}`, snippet: snip(d.content ?? "", text), chatId: null, chatTitle: null, link: `/lorebooks/${r.lorebook_id}?entry=${r.id}` });
    }
  }
  if (want("memory")) {
    const rows = tryFts((m) =>
      all<{ id: string; chat_id: string; content: string; title: string; max_seq: number | null }>(
        `SELECT x.id, x.chat_id, x.content, c.title, x.max_seq FROM memories_fts f JOIN memories x ON x.id = f.id JOIN chats c ON c.id = x.chat_id
         WHERE memories_fts MATCH ? AND x.deleted_at IS NULL AND x.status IN ('active', 'disputed') AND c.deleted_at IS NULL ORDER BY bm25(memories_fts) LIMIT ?`,
        m,
        limit,
      ),
    );
    for (const r of rows) results.push({ kind: "memory", id: r.id, title: `Memory · ${r.title}`, snippet: snip(r.content, text), chatId: r.chat_id, chatTitle: r.title, link: `/chat/${r.chat_id}/memory?memory=${r.id}`, seq: r.max_seq });
  }
  if (want("summary")) {
    const rows = tryFts((m) =>
      all<{ id: string; chat_id: string; title: string; content: string; level: string; chat_title: string }>(
        `SELECT s.id, s.chat_id, s.title, s.content, s.level, c.title AS chat_title FROM summaries_fts f JOIN summaries s ON s.id = f.id JOIN chats c ON c.id = s.chat_id
         WHERE summaries_fts MATCH ? AND c.deleted_at IS NULL ORDER BY bm25(summaries_fts) LIMIT ?`,
        m,
        limit,
      ),
    );
    for (const r of rows) results.push({ kind: "summary", id: r.id, title: `${r.level[0]!.toUpperCase()}${r.level.slice(1)}: ${r.title || "Untitled"} · ${r.chat_title}`, snippet: snip(r.content, text), chatId: r.chat_id, chatTitle: r.chat_title, link: `/chat/${r.chat_id}/memory?summary=${r.id}` });
  }
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  return { results, counts };
}
