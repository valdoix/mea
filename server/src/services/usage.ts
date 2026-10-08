import { readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { paths } from "../config";
import { all, now, run } from "../db/db";
import { getSetting } from "../lib/settings";
import { cachedQuota } from "./connections";
import { costOf } from "./requests";

/** Usage tracking (CONN-08): tokens per day, model, billing path, and chat. */
export function usageSummary(days = 7) {
  const since = now() - days * 24 * 3600_000;
  const byDay = all<{ day: string; requests: number; prompt: number; completion: number; cached: number; est: number }>(
    `SELECT strftime('%Y-%m-%d', started_at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS requests,
       COALESCE(SUM(prompt_tokens), 0) AS prompt, COALESCE(SUM(completion_tokens), 0) AS completion,
       COALESCE(SUM(cached_tokens), 0) AS cached, COALESCE(SUM(est_prompt_tokens), 0) AS est
     FROM generations WHERE started_at >= ? GROUP BY day ORDER BY day`,
    since,
  );
  const byModel = all<{ model_id: string; billing: string; requests: number; prompt: number; completion: number }>(
    `SELECT model_id, billing, COUNT(*) AS requests, COALESCE(SUM(prompt_tokens), 0) AS prompt, COALESCE(SUM(completion_tokens), 0) AS completion
     FROM generations WHERE started_at >= ? GROUP BY model_id, billing ORDER BY prompt DESC`,
    since,
  );
  const byKind = all<{ kind: string; requests: number; prompt: number }>(
    "SELECT kind, COUNT(*) AS requests, COALESCE(SUM(prompt_tokens), 0) AS prompt FROM generations WHERE started_at >= ? GROUP BY kind ORDER BY prompt DESC",
    since,
  );
  const byChat = all<{ chat_id: string; title: string | null; requests: number; prompt: number }>(
    `SELECT g.chat_id, c.title, COUNT(*) AS requests, COALESCE(SUM(g.prompt_tokens), 0) AS prompt
     FROM generations g LEFT JOIN chats c ON c.id = g.chat_id WHERE g.started_at >= ? GROUP BY g.chat_id ORDER BY prompt DESC LIMIT 10`,
    since,
  );
  const failures = all<{ count: number }>("SELECT COUNT(*) AS count FROM generations WHERE started_at >= ? AND status = 'error'", since)[0]?.count ?? 0;
  return { days, byDay, byModel, byKind, byChat, failures, quota: cachedQuota() };
}

/** SEC-06: request bodies go after N days, rows after M days (0 = keep the numbers forever), log files after K days. */
export function pruneGenerations() {
  const cfg = getSetting("privacy.requestLog");
  const day = 24 * 3600_000;
  run("UPDATE generations SET request = NULL, trace = NULL, response = NULL WHERE started_at < ? AND (request IS NOT NULL OR response IS NOT NULL)", now() - cfg.bodiesDays * day);
  if (cfg.rowsDays > 0) run("DELETE FROM generations WHERE started_at < ? AND status != 'running'", now() - cfg.rowsDays * day);
  try {
    const cutoff = new Date(now() - cfg.fileDays * day).toISOString().slice(0, 10);
    for (const f of readdirSync(paths.logs)) {
      const m = f.match(/^requests-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (m && m[1]! < cutoff) unlinkSync(join(paths.logs, f));
    }
  } catch {
    // no logs folder yet
  }
}

/**
 * Cache stats (CTX-09): hit rate and cached tokens per chat and model, with what caching
 * saved: money on paid routes, quota on the subscription (by the measured weight, CONN-22).
 */
export function cacheStats(days = 7, chatId?: string) {
  const since = now() - days * 24 * 3600_000;
  const where = chatId ? "AND g.chat_id = ?" : "";
  const params = chatId ? [since, chatId] : [since];
  const rows = all<{ chat_id: string | null; title: string | null; model_id: string; billing: string; requests: number; prompt: number; cached: number; writes: number; cost: number }>(
    `SELECT g.chat_id, c.title, g.model_id, g.billing, COUNT(*) AS requests, COALESCE(SUM(g.prompt_tokens), 0) AS prompt, COALESCE(SUM(g.cached_tokens), 0) AS cached,
       COALESCE(SUM(g.cache_write_tokens), 0) AS writes, COALESCE(SUM(g.cost), 0) AS cost
     FROM generations g LEFT JOIN chats c ON c.id = g.chat_id
     WHERE g.started_at >= ? AND g.task = 'story' AND g.prompt_tokens IS NOT NULL ${where}
     GROUP BY g.chat_id, g.model_id, g.billing ORDER BY prompt DESC`,
    ...params,
  );
  const weight = getSetting("quota.calibration").cachedWeight;
  const pricing = new Map(all<{ model_id: string; pricing: string }>("SELECT model_id, pricing FROM models").map((m) => [m.model_id, JSON.parse(m.pricing || "{}") as Record<string, unknown>]));
  const saved = (r: (typeof rows)[number]) => {
    if (r.billing === "subscription") return { quotaTokens: weight == null ? null : Math.round(r.cached * (1 - weight)), usd: null };
    const full = costOf(pricing.get(r.model_id) ?? {}, { promptTokens: r.prompt, cachedTokens: 0, cacheWriteTokens: 0 });
    const actual = costOf(pricing.get(r.model_id) ?? {}, { promptTokens: r.prompt, cachedTokens: r.cached, cacheWriteTokens: r.writes });
    return { quotaTokens: null, usd: full != null && actual != null ? Math.round((full - actual) * 10000) / 10000 : null };
  };
  const out = rows.map((r) => ({
    chatId: r.chat_id,
    title: r.title,
    model: r.model_id,
    billing: r.billing,
    requests: r.requests,
    promptTokens: r.prompt,
    cachedTokens: r.cached,
    cacheWriteTokens: r.writes,
    hitRate: r.prompt ? Math.round((r.cached / r.prompt) * 1000) / 1000 : 0,
    cost: Math.round(r.cost * 10000) / 10000,
    saved: saved(r),
  }));
  const prompt = rows.reduce((n, r) => n + r.prompt, 0);
  const cached = rows.reduce((n, r) => n + r.cached, 0);
  return { days, rows: out, total: { promptTokens: prompt, cachedTokens: cached, hitRate: prompt ? Math.round((cached / prompt) * 1000) / 1000 : 0 }, cachedWeight: weight };
}
