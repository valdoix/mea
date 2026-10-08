import { all, now, one, run } from "../db/db";
import { HttpError } from "../lib/http";
import { getSetting, setSetting } from "../lib/settings";
import type { Quota } from "../providers/nanogpt";
import { cachedQuota, listProfiles, resolveProfile } from "./connections";

const WEEK = 7 * 24 * 3600_000;
const DAY = 24 * 3600_000;

/**
 * Optional helpers, in the order they are shed as the quota runs low (CONN-20).
 * Trackers, the summarizer, and the story reply are kept until the quota is gone.
 * Phase 1 runs "gates" (scene-break checks) and "verification"; the rest arrive later.
 */
export const SHED_ORDER = ["advisor", "librarian", "gates", "drift", "continuity", "verification"] as const;
export type Sheddable = (typeof SHED_ORDER)[number];

export interface QuotaState {
  known: boolean;
  /** Share of the tightest window used, 0..1. */
  used: number | null;
  exhausted: boolean;
  resetAt: number | null;
  window: "daily" | "weekly" | null;
  degradeAt: number;
  shed: Sheddable[];
}

export function quotaState(q: Quota | null = cachedQuota()): QuotaState {
  const degradeAt = getSetting("quota.degradeAt");
  if (!q || (!q.weekly && !q.daily)) return { known: false, used: null, exhausted: false, resetAt: null, window: null, degradeAt, shed: [] };
  const share = (w: Quota["weekly"]) => (w?.limit ? (w.used ?? 0) / w.limit : w?.percentUsed != null ? (w.percentUsed > 1 ? w.percentUsed / 100 : w.percentUsed) : null);
  const weekly = share(q.weekly);
  const daily = share(q.daily);
  const window = daily != null && (weekly == null || daily > weekly) ? "daily" : "weekly";
  const used = Math.max(weekly ?? 0, daily ?? 0);
  const w = window === "daily" ? q.daily : q.weekly;
  const exhausted = used >= 0.999 || (w?.remaining != null && w.remaining <= 0);
  const step = (1 - degradeAt) / (SHED_ORDER.length + 1);
  const shed = SHED_ORDER.filter((_, i) => used >= degradeAt + i * step);
  return { known: true, used, exhausted, resetAt: w?.resetAt ?? null, window, degradeAt, shed: exhausted ? [...SHED_ORDER] : shed };
}

export function shouldShed(feature: Sheddable) {
  return quotaState().shed.includes(feature);
}

export class QuotaExhausted extends HttpError {
  constructor(public resetAt: number | null) {
    const when = resetAt ? new Date(resetAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : null;
    super(429, `Your NanoGPT subscription quota is used up${when ? `. It resets ${when}` : ""}.`, {
      code: "quota_exhausted",
      resetAt,
      alternatives: listProfiles()
        .map((p) => {
          try {
            const r = resolveProfile(p.id);
            return r.billing === "subscription" ? null : { id: p.id, name: p.name, model: r.modelId, billing: r.billing };
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    });
  }
}

/** Throws when a subscription request would certainly fail on quota. */
export function assertQuota(billing: string) {
  if (billing !== "subscription") return;
  const s = quotaState();
  if (s.exhausted) throw new QuotaExhausted(s.resetAt);
}

// ---------- Samples & calibration (CONN-22) ----------

export function recordQuotaSample(q: Quota) {
  const prev = one<{ taken_at: number; weekly_used: number | null }>("SELECT taken_at, weekly_used FROM quota_samples ORDER BY id DESC LIMIT 1");
  run(
    "INSERT INTO quota_samples (taken_at, weekly_used, weekly_limit, daily_used, daily_limit) VALUES (?, ?, ?, ?, ?)",
    q.fetchedAt,
    q.weekly?.used ?? null,
    q.weekly?.limit ?? null,
    q.daily?.used ?? null,
    q.daily?.limit ?? null,
  );
  run("DELETE FROM quota_samples WHERE taken_at < ?", now() - 30 * DAY);
  if (prev?.weekly_used != null && q.weekly?.used != null && q.fetchedAt - prev.taken_at < 30 * 60_000) {
    calibrate(prev.taken_at, q.fetchedAt, q.weekly.used - prev.weekly_used);
  }
}

/**
 * Measures how much of the cached input counts toward the quota by comparing the quota's
 * growth with the tokens Mea sent between two readings. Noisy windows are skipped.
 */
export function calibrate(from: number, to: number, delta: number) {
  if (delta < 0) return;
  const running = one<{ n: number }>("SELECT COUNT(*) AS n FROM generations WHERE status = 'running' AND billing = 'subscription'")?.n ?? 0;
  if (running) return;
  const s = one<{ p: number | null; c: number | null; n: number }>(
    "SELECT SUM(prompt_tokens) AS p, SUM(cached_tokens) AS c, COUNT(*) AS n FROM generations WHERE billing = 'subscription' AND finished_at > ? AND finished_at <= ?",
    from,
    to,
  );
  const p = s?.p ?? 0;
  const c = s?.c ?? 0;
  if (!s?.n || p < 2000 || c < p * 0.2) return;
  const weight = Math.max(0, Math.min(1, (delta - (p - c)) / c));
  const cur = getSetting("quota.calibration");
  const next = cur.cachedWeight == null ? weight : cur.cachedWeight * 0.7 + weight * 0.3;
  setSetting("quota.calibration", { cachedWeight: Math.round(next * 100) / 100, samples: cur.samples + 1, updatedAt: now() });
}

// ---------- Planner (CONN-19) ----------

export interface PlannerFeature {
  task: string;
  kind: string;
  perTurn: number;
}

/** "≈ N turns/day at current settings", from the last week of real requests (or estimates before there are any). */
export function quotaPlanner() {
  const since = now() - WEEK;
  const q = cachedQuota();
  const state = quotaState(q);
  const cal = getSetting("quota.calibration");
  const w = cal.cachedWeight ?? 1;
  const rows = all<{ task: string; kind: string; n: number; p: number; c: number; est: number }>(
    `SELECT task, kind, COUNT(*) AS n, COALESCE(SUM(prompt_tokens), 0) AS p, COALESCE(SUM(cached_tokens), 0) AS c, COALESCE(SUM(est_prompt_tokens), 0) AS est
     FROM generations WHERE started_at >= ? AND billing = 'subscription' AND status != 'error' GROUP BY task, kind`,
    since,
  );
  const counted = (r: { p: number; c: number; est: number }) => (r.p ? r.p - r.c + r.c * w : r.est);
  const turns = rows.filter((r) => r.task === "story" && (r.kind === "new" || r.kind === "continue")).reduce((n, r) => n + r.n, 0);
  const swipes = rows.filter((r) => r.task === "story" && r.kind === "swipe").reduce((n, r) => n + r.n, 0);
  const storyRows = rows.filter((r) => r.task === "story");
  const storyCalls = storyRows.reduce((n, r) => n + r.n, 0);
  const storyTokens = storyRows.reduce((n, r) => n + counted(r), 0);

  let target = 48_000;
  try {
    target = resolveProfile().contextTarget;
  } catch {
    // no model yet
  }
  const measured = turns >= 3;
  const avgStory = measured && storyCalls ? storyTokens / storyCalls : target;
  const features: PlannerFeature[] = measured
    ? rows.filter((r) => r.task !== "story").map((r) => ({ task: r.task, kind: r.kind, perTurn: Math.round(counted(r) / turns) }))
    : [
        { task: "summarizer", kind: "scene + verification (estimate)", perTurn: 1500 },
        { task: "helper", kind: "scene-break checks (estimate)", perTurn: 300 },
      ];
  const helpersPerTurn = features.reduce((n, f) => n + f.perTurn, 0);
  const swipeRatio = measured && turns ? swipes / turns : 0.3;
  const perTurn = Math.round(avgStory * (1 + swipeRatio) + helpersPerTurn);

  const weeklyLimit = q?.weekly?.limit ?? null;
  const weeklyRemaining = q?.weekly?.remaining ?? (weeklyLimit != null && q?.weekly?.used != null ? weeklyLimit - q.weekly.used : null);
  const dailyRemaining = q?.daily?.remaining ?? null;

  // Weekly pacing: a gentle hint when well ahead of an even pace.
  let pacing: { ahead: boolean; usedShare: number; elapsedShare: number; resetAt: number | null } | null = null;
  if (q?.weekly?.limit && q.weekly.resetAt) {
    const elapsedShare = Math.max(0, Math.min(1, 1 - (q.weekly.resetAt - now()) / WEEK));
    const usedShare = (q.weekly.used ?? 0) / q.weekly.limit;
    pacing = { ahead: usedShare > 0.3 && usedShare > elapsedShare + 0.15, usedShare, elapsedShare, resetAt: q.weekly.resetAt };
  }

  return {
    measured,
    turns,
    swipes,
    swipeRatio: Math.round(swipeRatio * 100) / 100,
    avgStoryPrompt: Math.round(avgStory),
    features,
    perTurn,
    turnsPerDay: weeklyLimit ? Math.floor(weeklyLimit / 7 / perTurn) : null,
    turnsLeftThisWeek: weeklyRemaining != null ? Math.max(0, Math.floor(weeklyRemaining / perTurn)) : null,
    turnsLeftToday: dailyRemaining != null ? Math.max(0, Math.floor(dailyRemaining / perTurn)) : null,
    calibration: cal,
    pacing,
    state,
    estimateFor: (storyTarget: number) => Math.floor((weeklyLimit ?? 60_000_000) / 7 / Math.max(1, storyTarget * (1 + swipeRatio) + helpersPerTurn)),
  };
}

/** Serializable planner (drops the helper function). */
export function quotaPlannerJson(targets: number[] = [32_000, 48_000, 64_000]) {
  const { estimateFor, ...rest } = quotaPlanner();
  return { ...rest, scenarios: targets.map((t) => ({ target: t, turnsPerDay: estimateFor(t) })) };
}
