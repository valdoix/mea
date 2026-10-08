import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";

/**
 * Persistent job queue (ARCH-03). Jobs live in SQLite, survive restarts,
 * retry with backoff, and never block request handling.
 */
type Handler = (payload: Record<string, unknown>) => Promise<void>;

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
}

export function enqueue(kind: string, payload: Record<string, unknown> = {}, opts: EnqueueOptions = {}): string | null {
  if (opts.dedupeKey && one("SELECT 1 FROM jobs WHERE dedupe_key = ? AND status IN ('queued', 'running')", opts.dedupeKey)) return null;
  const id = newId();
  const t = now();
  run(
    `INSERT INTO jobs (id, kind, payload, status, priority, attempts, max_attempts, run_after, dedupe_key, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', ?, 0, ?, ?, ?, ?, ?)`,
    id,
    kind,
    JSON.stringify(payload),
    opts.priority ?? 0,
    opts.maxAttempts ?? 3,
    t + (opts.delayMs ?? 0),
    opts.dedupeKey ?? null,
    t,
    t,
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
  try {
    if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);
    await handler(parseJson(job.payload, {}));
    run("UPDATE jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?", now(), job.id);
  } catch (e) {
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

export function pruneJobs() {
  run("DELETE FROM jobs WHERE status IN ('done') AND updated_at < ?", now() - 3 * 24 * 3600_000);
  run("DELETE FROM jobs WHERE status IN ('failed') AND updated_at < ?", now() - 30 * 24 * 3600_000);
}
