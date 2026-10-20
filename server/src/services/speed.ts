import { all, now } from "../db/db";
import { countTokens } from "../lib/tokens";
import { getConnectionRow, resolveTaskChain, type Task } from "./connections";
import { assertQuota } from "./quota";
import { finishRequest, startRequest } from "./requests";

/**
 * Connection speed: how fast each model your tasks use is answering right now, next to how fast
 * it usually is. The history comes from request history (free); a live test sends one short
 * request. A provider having a slow day otherwise looks like Mea hanging on "Planning…".
 */

export const SPEED_TASKS: Task[] = ["story", "summarizer", "helper", "tracker", "world", "planner", "assistant"];

/** "Right now" is the last few hours; "usually" is the two weeks before that. */
const RECENT_MS = 3 * 3600_000;
const USUAL_MS = 14 * 24 * 3600_000;
/** Replies shorter than this say little about writing speed. */
const MIN_TOKENS = 100;

export interface SpeedStats {
  /** Replies counted. */
  n: number;
  /** Median seconds to the first word (thinking included). */
  firstWord: number | null;
  /** Median output tokens per second, start to finish. */
  tokensPerSec: number | null;
  /** Share of calls that failed (0–1). */
  errorRate: number;
}

export type SpeedVerdict = "normal" | "slow" | "very slow" | "failing" | "unknown";

export interface SpeedRoute {
  connectionId: string;
  connectionName: string;
  modelId: string;
  tasks: Task[];
  recent: SpeedStats;
  usual: SpeedStats;
  verdict: SpeedVerdict;
}

interface Row {
  status: string;
  error: string | null;
  started_at: number;
  first_token_at: number | null;
  finished_at: number | null;
  completion_tokens: number | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const round1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

export function statsOf(rows: Row[]): SpeedStats {
  // Stopped by you, or cut off by a restart, isn't the provider's doing.
  const counted = rows.filter((r) => r.status === "done" || (r.status === "error" && !/interrupted by restart/i.test(r.error ?? "")));
  const done = counted.filter((r) => r.status === "done" && r.finished_at);
  const waits = done.filter((r) => r.first_token_at).map((r) => (r.first_token_at! - r.started_at) / 1000);
  // A call over in under a second (a cache, a canned reply) gives a meaningless rate.
  const rates = done.filter((r) => (r.completion_tokens ?? 0) >= MIN_TOKENS && r.finished_at! - r.started_at >= 1000).map((r) => r.completion_tokens! / ((r.finished_at! - r.started_at) / 1000));
  return {
    n: counted.length,
    firstWord: round1(median(waits)),
    tokensPerSec: round1(median(rates)),
    errorRate: counted.length ? Math.round(((counted.length - done.length) / counted.length) * 100) / 100 : 0,
  };
}

export function verdictOf(recent: SpeedStats, usual: SpeedStats): SpeedVerdict {
  if (recent.n < 2) return "unknown";
  if (recent.errorRate >= 0.5) return "failing";
  const slowdown = (now: number | null, then: number | null, higherIsBetter: boolean) => (now == null || then == null || !now || !then ? 1 : higherIsBetter ? then / now : now / then);
  // Without a usual to compare to, only failures say anything.
  if (usual.n < 3) return "normal";
  const worst = Math.max(slowdown(recent.tokensPerSec, usual.tokensPerSec, true), slowdown(recent.firstWord, usual.firstWord, false));
  return worst >= 4 ? "very slow" : worst >= 2 ? "slow" : "normal";
}

/** The model each task's first profile uses, grouped: one row per connection and model. */
function routes(): { connectionId: string; modelId: string; tasks: Task[] }[] {
  const out: { connectionId: string; modelId: string; tasks: Task[] }[] = [];
  for (const task of SPEED_TASKS) {
    let r;
    try {
      r = resolveTaskChain(task)[0];
    } catch {
      continue;
    }
    if (!r) continue;
    const hit = out.find((x) => x.connectionId === r.connection.id && x.modelId === r.modelId);
    if (hit) hit.tasks.push(task);
    else out.push({ connectionId: r.connection.id, modelId: r.modelId, tasks: [task] });
  }
  return out;
}

export function speedReport(at = now()): SpeedRoute[] {
  return routes().map((r) => {
    const rows = all<Row>(
      "SELECT status, error, started_at, first_token_at, finished_at, completion_tokens FROM generations WHERE connection_id = ? AND model_id = ? AND started_at > ? AND status != 'running'",
      r.connectionId,
      r.modelId,
      at - RECENT_MS - USUAL_MS,
    );
    const recent = statsOf(rows.filter((x) => x.started_at > at - RECENT_MS));
    const usual = statsOf(rows.filter((x) => x.started_at <= at - RECENT_MS));
    return { ...r, connectionName: getConnectionRow(r.connectionId)?.name ?? "deleted connection", recent, usual, verdict: verdictOf(recent, usual) };
  });
}

export interface SpeedTest {
  connectionId: string;
  modelId: string;
  ok: boolean;
  error?: string;
  /** Seconds until anything came back (thinking included). */
  firstByte: number | null;
  /** Seconds until the first word of the answer. */
  firstWord: number | null;
  /** Answer tokens per second once it was writing. */
  tokensPerSec: number | null;
  total: number;
  tokens: number;
}

const TEST_TIMEOUT_MS = 120_000;

/** One short live request on the model a task uses. Shows up in request history as "speed-test". */
export async function speedTest(task: Task): Promise<SpeedTest> {
  const r = resolveTaskChain(task)[0]!;
  assertQuota(r.billing);
  const messages = [
    { role: "system" as const, content: "You are a writer. Answer directly." },
    { role: "user" as const, content: "Describe a harbor town waking up at dawn, in one paragraph of about 120 words." },
  ];
  // A route that reasons needs room to think before it writes.
  const params = { ...r.params, max_tokens: r.reasoning ? 4000 : 400, temperature: 0.7 };
  const id = startRequest({ kind: "speed-test", task, resolved: r, request: { model: r.modelId, messages, params } });
  const t0 = now();
  let firstByteAt: number | null = null;
  let firstWordAt: number | null = null;
  let text = "";
  const secs = (t: number | null) => (t == null ? null : round1((t - t0) / 1000));
  try {
    const res = await r.provider.stream({ model: r.modelId, messages, params, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) }, (d) => {
      if (d.text || d.reasoning) firstByteAt ??= now();
      if (d.text) {
        firstWordAt ??= now();
        text += d.text;
      }
    });
    const end = now();
    finishRequest(id, { status: "done", usage: res.usage, firstTokenAt: firstWordAt, response: text, pricing: r.pricing, billing: r.billing });
    const tokens = countTokens(text);
    const writing = firstWordAt != null ? (end - firstWordAt) / 1000 : 0;
    return { connectionId: r.connection.id, modelId: r.modelId, ok: true, firstByte: secs(firstByteAt), firstWord: secs(firstWordAt), tokensPerSec: writing > 0.05 && tokens ? round1(tokens / writing) : null, total: round1((end - t0) / 1000)!, tokens };
  } catch (e) {
    const timedOut = (e as Error).name === "TimeoutError";
    const error = timedOut ? `No full answer within ${TEST_TIMEOUT_MS / 1000} s` : (e as Error).message;
    finishRequest(id, { status: "error", error, firstTokenAt: firstWordAt, response: text || null });
    return { connectionId: r.connection.id, modelId: r.modelId, ok: false, error: error.slice(0, 300), firstByte: secs(firstByteAt), firstWord: secs(firstWordAt), tokensPerSec: null, total: round1((now() - t0) / 1000)!, tokens: countTokens(text) };
  }
}
