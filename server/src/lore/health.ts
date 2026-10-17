import { all, now, run, tx } from "../db/db";
import { getSetting } from "../lib/settings";
import { countTokens } from "../lib/tokens";
import { contentWords, overlap } from "../memory/text";
import { extraOf, keyMatches } from "./activate";
import { getLorebook } from "./service";

/**
 * Lorebook health check (LORE-13): duplicate keys, overlapping or possibly contradictory entries,
 * entries that never fire, oversized entries, and recursion loops, plus a token cost report.
 */

/** Which entries fired in which chat (fed after every reply). */
export function recordLoreHits(chatId: string, entryIds: string[]) {
  if (!entryIds.length) return;
  const t = now();
  tx(() => {
    for (const id of new Set(entryIds))
      run("INSERT INTO lore_hits (entry_id, chat_id, count, last_at) VALUES (?, ?, 1, ?) ON CONFLICT(entry_id, chat_id) DO UPDATE SET count = count + 1, last_at = excluded.last_at", id, chatId, t);
  });
}

/** docs/15, 6.3: how many messages since each entry last fired in this chat. */
export function loreFiredAgo(chatId: string): Map<string, number> {
  return new Map(
    all<{ entry_id: string; ago: number }>(
      "SELECT h.entry_id, (SELECT COUNT(*) FROM messages m WHERE m.chat_id = h.chat_id AND m.deleted_at IS NULL AND m.created_at > h.last_at) AS ago FROM lore_hits h WHERE h.chat_id = ?",
      chatId,
    ).map((r) => [r.entry_id, r.ago]),
  );
}

export interface HealthIssue {
  kind: "duplicate-key" | "overlap" | "contradiction" | "never-fires" | "oversized" | "recursion-loop" | "empty" | "no-keys";
  severity: "info" | "warn";
  entries: string[];
  message: string;
}

const ATTRS = ["eyes", "hair", "age", "years old", "born", "height", "tall", "capital", "ruler", "founded", "population"];
const VALUES = /\b(\d+|blue|green|brown|hazel|grey|gray|black|red|blonde?|white|silver|golden|amber|violet|auburn)\b/gi;

export function loreHealth(bookId: string) {
  const book = getLorebook(bookId);
  if (!book) return null;
  const budget = book.settings.tokenBudget ?? getSetting("lore.defaults").tokenBudget;
  const entries = book.entries;
  const issues: HealthIssue[] = [];
  const title = (e: (typeof entries)[number]) => e.comment || e.keys.slice(0, 2).join(", ") || "(untitled)";
  const tokens = new Map(entries.map((e) => [e.id, countTokens(e.content)]));

  // Duplicate keys: the same key on several entries.
  const byKey = new Map<string, string[]>();
  for (const e of entries) for (const k of [...e.keys, ...(extraOf(e).aliases ?? [])]) {
    const n = k.trim().toLowerCase();
    if (!n) continue;
    byKey.set(n, [...(byKey.get(n) ?? []), e.id]);
  }
  for (const [k, ids] of byKey) {
    const uniq = [...new Set(ids)];
    if (uniq.length > 1) issues.push({ kind: "duplicate-key", severity: "info", entries: uniq, message: `"${k}" triggers ${uniq.length} entries: ${uniq.map((id) => title(entries.find((e) => e.id === id)!)).join(", ")}` });
  }

  // Overlap and possible contradictions between entries that share keys or most of their words.
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!;
      const b = entries[j]!;
      if (!a.content.trim() || !b.content.trim()) continue;
      const shared = a.keys.filter((k) => b.keys.some((x) => x.trim().toLowerCase() === k.trim().toLowerCase()));
      const sim = overlap(contentWords(a.content), contentWords(b.content));
      if (sim >= 0.6) issues.push({ kind: "overlap", severity: "warn", entries: [a.id, b.id], message: `"${title(a)}" and "${title(b)}" say mostly the same thing (${Math.round(sim * 100)}% shared words).` });
      if (shared.length) {
        for (const attr of ATTRS) {
          const near = (t: string) => {
            const at = t.toLowerCase().indexOf(attr);
            if (at < 0) return null;
            const window = t.slice(Math.max(0, at - 40), at + attr.length + 40);
            return new Set((window.match(VALUES) ?? []).map((v) => v.toLowerCase().replace("gray", "grey")));
          };
          const va = near(a.content);
          const vb = near(b.content);
          if (va?.size && vb?.size && ![...va].some((v) => vb.has(v))) {
            issues.push({ kind: "contradiction", severity: "warn", entries: [a.id, b.id], message: `"${title(a)}" and "${title(b)}" may disagree about ${attr}: ${[...va].join("/")} vs ${[...vb].join("/")}.` });
            break;
          }
        }
      }
    }

  // Never fires: no hits in any chat, though the book is linked somewhere with a real story.
  const hits = new Map(all<{ entry_id: string; n: number }>(`SELECT entry_id, SUM(count) AS n FROM lore_hits WHERE entry_id IN (${entries.map(() => "?").join(",") || "''"}) GROUP BY entry_id`, ...entries.map((e) => e.id)).map((r) => [r.entry_id, r.n]));
  const chatMessages = all<{ n: number }>(
    `SELECT COALESCE(SUM(c.message_count), 0) AS n FROM lorebook_links l JOIN chats c ON
       (l.target_type = 'chat' AND c.id = l.target_id) OR (l.target_type = 'character' AND c.character_id = l.target_id) OR (l.target_type = 'global')
     WHERE l.lorebook_id = ? AND c.deleted_at IS NULL`,
    bookId,
  )[0]?.n ?? 0;
  for (const e of entries) {
    if (!e.enabled) continue;
    if (!e.content.trim()) issues.push({ kind: "empty", severity: "warn", entries: [e.id], message: `"${title(e)}" has no content.` });
    else if (!e.constant && !e.keys.length && !(extraOf(e).aliases ?? []).length && !extraOf(e).semantic && !extraOf(e).entity && !extraOf(e).trackerWhen && !book.settings.semantic)
      issues.push({ kind: "no-keys", severity: "warn", entries: [e.id], message: `"${title(e)}" has no keys, so it can never fire.` });
    else if (!e.constant && chatMessages >= 30 && !hits.get(e.id)) issues.push({ kind: "never-fires", severity: "info", entries: [e.id], message: `"${title(e)}" hasn't fired in ${chatMessages} messages of linked chats.` });
    const t = tokens.get(e.id) ?? 0;
    if (t > 600 || (budget > 0 && t > budget * 0.3)) issues.push({ kind: "oversized", severity: "warn", entries: [e.id], message: `"${title(e)}" is ${t} tokens${budget ? ` (${Math.round((t / budget) * 100)}% of the lore budget)` : ""}; add short "essentials" or split it.` });
  }

  // Recursion loops: A's text triggers B and B's triggers A (directly or around a cycle).
  const edges = new Map<string, string[]>();
  for (const a of entries) {
    if (a.preventRecursion) continue;
    edges.set(
      a.id,
      entries.filter((b) => b.id !== a.id && !b.excludeRecursion && [...b.keys, ...(extraOf(b).aliases ?? [])].some((k) => keyMatches(k, a.content, false, true))).map((b) => b.id),
    );
  }
  const seen = new Set<string>();
  const loops: string[][] = [];
  const dfs = (id: string, path: string[]) => {
    if (loops.length > 10) return;
    const at = path.indexOf(id);
    if (at >= 0) {
      const loop = path.slice(at);
      const key = [...loop].sort().join("|");
      if (!seen.has(key)) {
        seen.add(key);
        loops.push(loop);
      }
      return;
    }
    if (path.length > 6) return;
    for (const n of edges.get(id) ?? []) dfs(n, [...path, id]);
  };
  for (const e of entries) dfs(e.id, []);
  for (const loop of loops) issues.push({ kind: "recursion-loop", severity: "info", entries: loop, message: `Entries trigger each other in a loop: ${loop.map((id) => title(entries.find((e) => e.id === id)!)).join(" → ")} → back. Fine with a recursion limit, but costly.` });

  // Cost report.
  const constant = entries.filter((e) => e.enabled && e.constant).reduce((n, e) => n + (tokens.get(e.id) ?? 0), 0);
  const total = entries.filter((e) => e.enabled).reduce((n, e) => n + (tokens.get(e.id) ?? 0), 0);
  const fired = entries.filter((e) => hits.get(e.id));
  return {
    bookId,
    entries: entries.length,
    issues,
    cost: {
      constantTokens: constant,
      totalTokens: total,
      budget,
      averageTriggeredTokens: fired.length ? Math.round(fired.reduce((n, e) => n + (tokens.get(e.id) ?? 0), 0) / fired.length) : 0,
      top: entries
        .map((e) => ({ id: e.id, title: title(e), tokens: tokens.get(e.id) ?? 0, hits: hits.get(e.id) ?? 0, constant: e.constant }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 8),
    },
  };
}
