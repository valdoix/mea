import { all, newId, now, one, parseJson, run } from "../db/db";
import type { Usage } from "../providers/types";

/**
 * Every model request is logged here (DBG-01 inspector, DBG-02 request history, CONN-08 usage).
 * Keys never appear: only the body Mea built and what came back.
 */
export function startRequest(input: {
  chatId?: string | null;
  messageId?: string | null;
  swipeId?: string | null;
  kind: string;
  task: string;
  resolved: { connection: { id: string }; modelId: string; billing: string; profile: { id: string } };
  request: unknown;
  trace?: unknown;
  estPromptTokens?: number;
  jobId?: string | null;
}): string {
  const id = newId();
  run(
    `INSERT INTO generations (id, chat_id, message_id, swipe_id, kind, task, connection_id, model_id, billing, request, trace, est_prompt_tokens, status, started_at, profile_id, job_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
    id,
    input.chatId ?? null,
    input.messageId ?? null,
    input.swipeId ?? null,
    input.kind,
    input.task,
    input.resolved.connection.id,
    input.resolved.modelId,
    input.resolved.billing,
    JSON.stringify(input.request),
    input.trace === undefined ? null : JSON.stringify(input.trace),
    input.estPromptTokens ?? null,
    now(),
    input.resolved.profile.id,
    input.jobId ?? null,
  );
  return id;
}

export function finishRequest(
  id: string,
  r: { status: string; error?: string; usage?: Usage; firstTokenAt?: number | null; sentBody?: unknown; response?: string | null; pricing?: Record<string, unknown>; billing?: string },
) {
  const cost = r.billing && r.billing !== "subscription" && r.pricing ? costOf(r.pricing, r.usage) : null;
  run(
    `UPDATE generations SET status = ?, error = ?, prompt_tokens = ?, completion_tokens = ?, cached_tokens = ?, cache_write_tokens = ?, first_token_at = ?, finished_at = ?,
       request = COALESCE(?, request), response = COALESCE(?, response), cost = ? WHERE id = ?`,
    r.status,
    r.error ?? null,
    r.usage?.promptTokens ?? null,
    r.usage?.completionTokens ?? null,
    r.usage?.cachedTokens ?? null,
    r.usage?.cacheWriteTokens ?? null,
    r.firstTokenAt ?? null,
    now(),
    r.sentBody ? JSON.stringify(r.sentBody) : null,
    r.response != null ? r.response.slice(0, 200_000) : null,
    cost,
    id,
  );
}

/** Per-million-token prices from the catalog; NanoGPT and OpenRouter-style shapes both appear. */
function price(p: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = Number(p[k]);
    if (Number.isFinite(v) && v > 0) return v < 0.001 ? v * 1_000_000 : v;
  }
  return null;
}

/** Informational cost estimate in USD for pay-as-you-go requests (CONN-15 lite). */
export function costOf(pricing: Record<string, unknown>, usage?: Usage): number | null {
  if (!usage?.promptTokens && !usage?.completionTokens) return null;
  const input = price(pricing, ["prompt", "input", "input_price", "inputPrice"]);
  const output = price(pricing, ["completion", "output", "output_price", "outputPrice"]);
  if (input == null && output == null) return null;
  const cachedRead = price(pricing, ["cache_read", "input_cache_read", "cached_input", "cacheRead"]) ?? (input ?? 0) * 0.1;
  const cachedWrite = price(pricing, ["cache_write", "input_cache_write", "cacheWrite"]) ?? (input ?? 0) * 1.25;
  const read = usage.cachedTokens ?? 0;
  const write = usage.cacheWriteTokens ?? 0;
  const plain = Math.max(0, (usage.promptTokens ?? 0) - read - write);
  const usd = (plain * (input ?? 0) + read * cachedRead + write * cachedWrite + (usage.completionTokens ?? 0) * (output ?? 0)) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

interface GenRow {
  id: string;
  chat_id: string | null;
  kind: string;
  task: string;
  model_id: string | null;
  billing: string;
  est_prompt_tokens: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cached_tokens: number | null;
  cache_write_tokens: number | null;
  cost: number | null;
  status: string;
  error: string | null;
  started_at: number;
  first_token_at: number | null;
  finished_at: number | null;
  title?: string | null;
}

/** Request history (DBG-02): newest first, without bodies. */
export function listRequests(opts: { chatId?: string; task?: string; limit?: number; before?: number } = {}) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.chatId) {
    where.push("g.chat_id = ?");
    params.push(opts.chatId);
  }
  if (opts.task) {
    where.push("g.task = ?");
    params.push(opts.task);
  }
  if (opts.before) {
    where.push("g.started_at < ?");
    params.push(opts.before);
  }
  const rows = all<GenRow>(
    `SELECT g.id, g.chat_id, g.kind, g.task, g.model_id, g.billing, g.est_prompt_tokens, g.prompt_tokens, g.completion_tokens, g.cached_tokens,
       g.cache_write_tokens, g.cost, g.status, g.error, g.started_at, g.first_token_at, g.finished_at, c.title
     FROM generations g LEFT JOIN chats c ON c.id = g.chat_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY g.started_at DESC LIMIT ?`,
    ...params,
    Math.min(500, opts.limit ?? 100),
  );
  return rows.map((r) => ({
    id: r.id,
    chatId: r.chat_id,
    chatTitle: r.title ?? null,
    kind: r.kind,
    task: r.task,
    model: r.model_id,
    billing: r.billing,
    estPromptTokens: r.est_prompt_tokens,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    cachedTokens: r.cached_tokens,
    cacheWriteTokens: r.cache_write_tokens,
    cost: r.cost,
    status: r.status,
    error: r.error,
    startedAt: r.started_at,
    ttftMs: r.first_token_at ? r.first_token_at - r.started_at : null,
    durationMs: r.finished_at ? r.finished_at - r.started_at : null,
  }));
}

export function getRequest(id: string) {
  const r = one<Record<string, unknown> & { request: string | null; trace: string | null }>("SELECT * FROM generations WHERE id = ?", id);
  if (!r) return undefined;
  return { ...r, request: parseJson(r.request, null), trace: parseJson(r.trace, null) };
}
