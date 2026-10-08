import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";

/**
 * Persistent job queue (ARCH-03). Jobs live in SQLite, survive restarts,
 * retry with backoff, and never block request handling.
 */
export interface JobContext {
  id: string;
  /** Adds numbers shown in the job monitor, e.g. input tokens (CONN-21). */
  note(meta: Record<string, unknown>): void;
}
type Handler = (payload: Record<string, unknown>, job: JobContext) => Promise<void>;

/** Thrown by a handler to run again later without counting a failed attempt. */
export class Deferred extends Error {
  constructor(
    message: string,
    public delayMs: number,
  ) {
    super(message);
    this.name = "Deferred";
  }
}

interface JobRow {
  id: string;
  kind: string;
  payload: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_after: number;
  dedupe_key: string | null;
  last_error: string | null;
  chat_id: string | null;
  meta: string;
  created_at: number;
  updated_at: number;
}

const handlers = new Map<string, Handler>();
const running = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;
const CONCURRENCY = 2;

export function registerJob(kind: string, handler: Handler) {
  handlers.set(kind, handler);
}

export interface EnqueueOptions {
  priority?: number;
  delayMs?: number;
  dedupeKey?: string;
  maxAttempts?: number;
  chatId?: string | null;
}

export function enqueue(kind: string, payload: Record<string, unknown> = {}, opts: EnqueueOptions = {}): string | null {
  if (opts.dedupeKey && one("SELECT 1 FROM jobs WHERE dedupe_key = ? AND status IN ('queued', 'running')", opts.dedupeKey)) return null;
  const id = newId();
  const t = now();
  run(
    `INSERT INTO jobs (id, kind, payload, status, priority, attempts, max_attempts, run_after, dedupe_key, created_at, updated_at, chat_id)
     VALUES (?, ?, ?, 'queued', ?, 0, ?, ?, ?, ?, ?, ?)`,
    id,
    kind,
    JSON.stringify(payload),
    opts.priority ?? 0,
    opts.maxAttempts ?? 3,
    t + (opts.delayMs ?? 0),
    opts.dedupeKey ?? null,
    t,
    t,
    opts.chatId ?? (typeof payload.chatId === "string" ? payload.chatId : null),
  );
  queueMicrotask(tick);
  return id;
}

function activity() {
  const queued = one<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued'")?.n ?? 0;
  publish({ type: "jobs.activity", running: running.size, queued });
}

async function runJob(job: JobRow) {
  const handler = handlers.get(job.kind);
  running.add(job.id);
  run("UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?", now(), job.id);
  activity();
  const meta = parseJson<Record<string, unknown>>(job.meta, {});
  const ctx: JobContext = {
    id: job.id,
    note: (m) => {
      Object.assign(meta, m);
      run("UPDATE jobs SET meta = ? WHERE id = ?", JSON.stringify(meta), job.id);
    },
  };
  try {
    if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);
    await handler(parseJson(job.payload, {}), ctx);
    run("UPDATE jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?", now(), job.id);
  } catch (e) {
    if (e instanceof Deferred) {
      run("UPDATE jobs SET status = 'queued', attempts = attempts - 1, last_error = ?, run_after = ?, updated_at = ? WHERE id = ?", e.message, now() + e.delayMs, now(), job.id);
      return;
    }
    const attempts = job.attempts + 1;
    const failed = attempts >= job.max_attempts;
    const backoff = Math.min(15 * 60_000, 2 ** attempts * 5_000);
    run(
      "UPDATE jobs SET status = ?, last_error = ?, run_after = ?, updated_at = ? WHERE id = ?",
      failed ? "failed" : "queued",
      String((e as Error)?.message ?? e).slice(0, 1000),
      now() + backoff,
      now(),
      job.id,
    );
  } finally {
    running.delete(job.id);
    activity();
  }
}

function tick() {
  if (running.size >= CONCURRENCY) return;
  const ready = all<JobRow>(
    "SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY priority DESC, run_after LIMIT ?",
    now(),
    CONCURRENCY - running.size,
  );
  for (const job of ready) if (!running.has(job.id)) void runJob(job);
}

export function startJobs() {
  // Jobs that were running when the app stopped go back to the queue.
  run("UPDATE jobs SET status = 'queued' WHERE status = 'running'");
  if (!timer) timer = setInterval(tick, 1000);
  tick();
}

export function stopJobs() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Recurring jobs: enqueued on an interval, deduplicated so they never pile up. */
const schedules: { kind: string; everyMs: number; last: number; payload?: Record<string, unknown> }[] = [];
let scheduleTimer: ReturnType<typeof setInterval> | null = null;

export function schedule(kind: string, everyMs: number, opts: { runNow?: boolean; payload?: Record<string, unknown> } = {}) {
  schedules.push({ kind, everyMs, last: opts.runNow ? 0 : now(), payload: opts.payload });
  if (!scheduleTimer)
    scheduleTimer = setInterval(() => {
      const t = now();
      for (const s of schedules) {
        if (t - s.last >= s.everyMs) {
          s.last = t;
          enqueue(s.kind, s.payload ?? {}, { dedupeKey: `schedule:${s.kind}` });
        }
      }
    }, 15_000);
}

export function jobStats() {
  const counts = all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status");
  const recentFailures = all<{ kind: string; last_error: string; updated_at: number }>(
    "SELECT kind, last_error, updated_at FROM jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 10",
  );
  return { counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), running: running.size, recentFailures };
}

/** Job monitor (DBG-03). */
export function listJobs(opts: { status?: string; chatId?: string; limit?: number } = {}) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.status) {
    where.push("status = ?");
    params.push(opts.status);
  }
  if (opts.chatId) {
    where.push("chat_id = ?");
    params.push(opts.chatId);
  }
  const rows = all<JobRow>(
    `SELECT * FROM jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END, updated_at DESC LIMIT ?`,
    ...params,
    Math.min(500, opts.limit ?? 100),
  );
  const tokens = new Map(
    all<{ job_id: string; p: number; c: number }>(
      `SELECT job_id, COALESCE(SUM(COALESCE(prompt_tokens, est_prompt_tokens)), 0) AS p, COALESCE(SUM(completion_tokens), 0) AS c FROM generations
       WHERE job_id IN (${rows.map(() => "?").join(",") || "''"}) GROUP BY job_id`,
      ...rows.map((r) => r.id),
    ).map((t) => [t.job_id, t]),
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    priority: r.priority,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    runAfter: r.run_after,
    lastError: r.last_error,
    chatId: r.chat_id,
    payload: parseJson<Record<string, unknown>>(r.payload, {}),
    meta: parseJson<Record<string, unknown>>(r.meta, {}),
    inputTokens: tokens.get(r.id)?.p ?? 0,
    outputTokens: tokens.get(r.id)?.c ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function retryJob(id: string) {
  run("UPDATE jobs SET status = 'queued', attempts = 0, run_after = ?, updated_at = ? WHERE id = ? AND status IN ('failed', 'queued')", now(), now(), id);
  queueMicrotask(tick);
}

export function cancelJob(id: string) {
  run("UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'queued'", now(), id);
  activity();
}

/** Drops queued jobs for a chat (e.g. when its memory is rebuilt from scratch). */
export function cancelChatJobs(chatId: string, kinds: string[]) {
  run(`UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE chat_id = ? AND status = 'queued' AND kind IN (${kinds.map(() => "?").join(",")})`, now(), chatId, ...kinds);
}

export function pruneJobs() {
  run("DELETE FROM jobs WHERE status IN ('done', 'cancelled') AND updated_at < ?", now() - 3 * 24 * 3600_000);
  run("DELETE FROM jobs WHERE status IN ('failed') AND updated_at < ?", now() - 30 * 24 * 3600_000);
}
