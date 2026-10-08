import { all, now, run } from "../db/db";
import { cachedQuota } from "./connections";

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

export function pruneGenerations() {
  // Keep request bodies for the inspector for 30 days; keep the numbers forever.
  run("UPDATE generations SET request = NULL, trace = NULL WHERE started_at < ? AND request IS NOT NULL", now() - 30 * 24 * 3600_000);
}
