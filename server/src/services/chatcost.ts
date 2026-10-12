import { all, one } from "../db/db";
import { badRequest } from "../lib/http";
import { getSetting, setSetting } from "../lib/settings";
import { cachedQuota, listProfiles, resolveProfile, resolveTaskChain } from "./connections";
import { costOf } from "./requests";
import { registerStatusTile } from "./status";

/**
 * Per-chat cost guard (Almanac plan H2). What one chat's background calls (summaries, the
 * archivist, checks, lessons, telling…) took today, as a share of the day's quota; a warning past
 * the share you set, with Use a cheaper model for these; and a cost-per-reply line for the
 * Inspector (the writer, the planner, and the background work the reply set off).
 */

const DAY = 24 * 3600_000;
const BACKGROUND = ["summarizer", "helper", "tracker", "world", "assistant"] as const;

interface Row {
  task: string;
  kind: string;
  billing: string;
  prompt: number;
  completion: number;
  cached: number;
  cost: number | null;
  n: number;
}

/** Quota tokens: what the subscription counts (cached input at the measured weight). */
function quotaTokens(r: { prompt: number; cached: number }) {
  const w = getSetting("quota.calibration").cachedWeight ?? 1;
  return Math.max(0, r.prompt - r.cached) + r.cached * w;
}

/** The day's limit in quota tokens (the daily window, else a seventh of the weekly). */
function dailyLimit(): number | null {
  const q = cachedQuota();
  if (q?.daily?.limit) return q.daily.limit;
  if (q?.weekly?.limit) return q.weekly.limit / 7;
  return null;
}

export function chatCostToday(chatId: string) {
  const rows = all<Row>(
    `SELECT task, kind, billing, COALESCE(SUM(prompt_tokens), 0) AS prompt, COALESCE(SUM(completion_tokens), 0) AS completion, COALESCE(SUM(cached_tokens), 0) AS cached, SUM(cost) AS cost, COUNT(*) AS n
     FROM generations WHERE chat_id = ? AND started_at >= ? AND status NOT IN ('error', 'replaced') GROUP BY task, kind, billing`,
    chatId,
    Date.now() - DAY,
  );
  const bg = rows.filter((r) => r.task !== "story");
  const story = rows.filter((r) => r.task === "story");
  const sum = (xs: Row[], f: (r: Row) => number) => xs.reduce((n, r) => n + f(r), 0);
  const bgQuota = sum(bg.filter((r) => r.billing === "subscription"), quotaTokens);
  const limit = dailyLimit();
  const share = limit ? bgQuota / limit : null;
  const threshold = getSetting("quota.chatShare");
  const byKind = new Map<string, { kind: string; tokens: number; requests: number; cost: number }>();
  for (const r of bg) {
    const k = r.kind.split(":")[0] || r.task;
    const cur = byKind.get(k) ?? { kind: k, tokens: 0, requests: 0, cost: 0 };
    cur.tokens += r.prompt + r.completion;
    cur.requests += r.n;
    cur.cost += r.cost ?? 0;
    byKind.set(k, cur);
  }
  return {
    story: { tokens: sum(story, (r) => r.prompt + r.completion), requests: sum(story, (r) => r.n), cost: sum(story, (r) => r.cost ?? 0) },
    background: { tokens: sum(bg, (r) => r.prompt + r.completion), requests: sum(bg, (r) => r.n), cost: sum(bg, (r) => r.cost ?? 0), quotaTokens: Math.round(bgQuota), byKind: [...byKind.values()].sort((a, b) => b.tokens - a.tokens) },
    share,
    threshold,
    over: share != null && share >= threshold,
  };
}

/** A profile's price for a typical helper call (1M in, 250k out), null when unknown. */
function priceOf(profileId: string): number | null {
  try {
    const r = resolveProfile(profileId);
    return costOf(r.pricing as Record<string, unknown>, { promptTokens: 1_000_000, completionTokens: 250_000 });
  } catch {
    return null;
  }
}

/** "Use a cheaper model for these": the cheapest priced profile that isn't what background work uses now. */
export function cheaperProfile() {
  const now = resolveTaskChain("helper")[0];
  const nowPrice = now ? priceOf(now.profile.id) : null;
  const priced = listProfiles()
    .map((p) => ({ id: p.id, name: p.name, price: priceOf(p.id) }))
    .filter((p): p is { id: string; name: string; price: number } => p.price != null && p.id !== now?.profile.id)
    .sort((a, b) => a.price - b.price);
  const pick = priced.find((p) => nowPrice == null || p.price < nowPrice) ?? null;
  return { current: now ? { id: now.profile.id, name: now.profile.name, price: nowPrice } : null, pick };
}

/** Writes routing.tasks: summaries, helpers, trackers and the world all go to that profile. */
export function useForBackground(profileId: string) {
  resolveProfile(profileId);
  const prev = getSetting("routing.tasks");
  const next = { ...prev };
  for (const t of BACKGROUND) if (t !== "assistant") next[t] = profileId;
  setSetting("routing.tasks", next);
  return { previous: prev, routing: next };
}
export function cheaperForBackground() {
  const { pick } = cheaperProfile();
  if (!pick) throw badRequest("There's no cheaper model set up. Add a profile with a cheaper model in Settings › Models first.");
  return { profile: pick, ...useForBackground(pick.id) };
}

/** Cost per reply: the writer, the planner (the advisor's plan for that turn), and the background work it set off. */
export function replyCost(generationId: string) {
  const g = one<{ id: string; chat_id: string | null; message_id: string | null; prompt_tokens: number | null; completion_tokens: number | null; cost: number | null; started_at: number }>(
    "SELECT id, chat_id, message_id, prompt_tokens, completion_tokens, cost, started_at FROM generations WHERE id = ?",
    generationId,
  );
  if (!g) return null;
  const planner = g.chat_id
    ? one<{ tokens: number; cost: number | null }>(
        "SELECT COALESCE(SUM(COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0)), 0) AS tokens, SUM(cost) AS cost FROM generations WHERE chat_id = ? AND kind LIKE 'advisor%' AND started_at BETWEEN ? AND ?",
        g.chat_id,
        g.started_at - 10 * 60_000,
        g.started_at,
      )
    : null;
  const bg = g.message_id
    ? one<{ tokens: number; cost: number | null; n: number }>(
        "SELECT COALESCE(SUM(COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0)), 0) AS tokens, SUM(cost) AS cost, COUNT(*) AS n FROM generations WHERE message_id = ? AND task != 'story' AND id != ?",
        g.message_id,
        g.id,
      )
    : null;
  const writer = { tokens: (g.prompt_tokens ?? 0) + (g.completion_tokens ?? 0), cost: g.cost };
  const total = { tokens: writer.tokens + (planner?.tokens ?? 0) + (bg?.tokens ?? 0), cost: (g.cost ?? 0) + (planner?.cost ?? 0) + (bg?.cost ?? 0) };
  return { writer, planner: planner ? { tokens: planner.tokens, cost: planner.cost } : null, background: bg ? { tokens: bg.tokens, cost: bg.cost, requests: bg.n } : null, total };
}

registerStatusTile((chatId) => {
  const c = chatCostToday(chatId);
  if (!c.over || c.share == null) return null;
  return { id: "cost", n: 1, value: `${Math.round(c.share * 100)}%`, label: "of today's quota on background work", tone: c.share >= c.threshold * 2 ? "red" : "amber", open: { dock: "chat", section: "cost" }, order: 40, title: c.background.byKind.slice(0, 4).map((k) => `${k.kind}: ${k.tokens} tokens`).join("\n") };
});
