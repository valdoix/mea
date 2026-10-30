import { all, one, parseJson } from "../db/db";
import { mustChat } from "../services/chats";
import { registerStatusTile } from "../services/status";
import { craftReport } from "../steer/craft";
import { lessonsFor } from "../steer/lessons";
import { trackerConfig } from "../trackers/store";
import type { Issue } from "./checker";
import { currentFold } from "../trackers/store";
import { loopsPart } from "./loophealth";
import { type RetellStats, retellStats } from "./retell";

/**
 * Story health (Almanac plan D3): one score for the last 20 replies, from what Mea already keeps:
 * continuity slips, leaks, repetition (the craft coach), replies the trackers didn't read, broken
 * lessons, and how full the prompts run. Each part says what drags it down and where to look.
 * Nothing new is stored; the weekly trend is worked out from the same records.
 */

export type HealthPart = "continuity" | "leaks" | "repetition" | "ledger" | "lessons" | "cost" | "loops";
export interface HealthItem {
  part: HealthPart;
  label: string;
  /** 0–100, higher is healthier. */
  score: number;
  /** What it counted ("3 slips in 20 replies"). */
  detail: string;
  /** Where the cause is: a reply, or a panel. */
  open?: { messageId: string; seq: number } | { dock: "chat" | "story" | "memory"; section?: string } | { href: string };
  /** For "Fix the top 3": what to ask Meus. */
  ask?: string;
  /** The numbers behind it, one a line. */
  notes?: string[];
}
export interface Health {
  score: number;
  level: "good" | "fair" | "poor";
  replies: number;
  parts: HealthItem[];
  /** One score per week, oldest first (the last eight weeks that had replies). */
  trend: { week: number; score: number }[];
  /** docs/20 6.2: the replies' retellings, and how many were told wrong. */
  retold?: RetellStats;
}

const WINDOW = 20;
const LEAKS = new Set(["leak", "offpage", "canon", "puppet"]);
const SLIPS = new Set(["trait", "dead", "time", "name", "place", "fact", "pov", "tense", "timeline", "nothere", "clockback", "past", "planning", "who", "ties", "retell", "undone"]);
const WEIGHTS: Record<HealthPart, number> = { continuity: 3, leaks: 3, repetition: 2, ledger: 1, lessons: 2, cost: 1, loops: 2 };

const level = (s: number): Health["level"] => (s >= 80 ? "good" : s >= 60 ? "fair" : "poor");
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export interface Reply {
  id: string;
  seq: number;
  idx: number;
  meta: string;
  created_at: number;
}

function repliesIn(chatId: string, opts: { limit?: number; from?: number; to?: number } = {}) {
  return all<Reply>(
    `SELECT m.id, m.seq, m.active_swipe AS idx, s.meta, m.created_at FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.role = 'assistant' AND m.deleted_at IS NULL AND s.status = 'done'${opts.from != null ? " AND m.created_at >= ?" : ""}${opts.to != null ? " AND m.created_at < ?" : ""}
     ORDER BY m.seq DESC LIMIT ?`,
    ...([chatId, ...(opts.from != null ? [opts.from] : []), ...(opts.to != null ? [opts.to] : []), opts.limit ?? WINDOW] as (string | number)[]),
  ).reverse();
}

/** The open findings on a set of replies (on the take that's showing). */
function openIssues(replies: Reply[]) {
  if (!replies.length) return [] as { issue: Issue; reply: Reply }[];
  const byId = new Map(replies.map((r) => [r.id, r]));
  const rows = all<{ message_id: string; swipe_idx: number; issues: string }>(`SELECT message_id, swipe_idx, issues FROM continuity_flags WHERE message_id IN (${replies.map(() => "?").join(",")})`, ...replies.map((r) => r.id));
  return rows.flatMap((f) => {
    const r = byId.get(f.message_id);
    if (!r || r.idx !== f.swipe_idx) return [];
    return parseJson<Issue[]>(f.issues, [])
      .filter((i) => !i.dismissed)
      .map((issue) => ({ issue, reply: r }));
  });
}

function compute(chatId: string, replies: Reply[], live: boolean): Omit<Health, "trend"> {
  const n = replies.length;
  const issues = openIssues(replies);
  const parts: HealthItem[] = [];
  const latest = (pred: (i: Issue) => boolean) => [...issues].reverse().find((x) => pred(x.issue));

  const slips = issues.filter((x) => SLIPS.has(x.issue.kind));
  const s1 = latest((i) => SLIPS.has(i.kind));
  parts.push({
    part: "continuity",
    label: "Continuity",
    score: clamp(100 - (slips.length / Math.max(1, n)) * 60),
    detail: `${slips.length} slip${slips.length === 1 ? "" : "s"} in ${n} replies`,
    ...(s1 ? { open: { messageId: s1.reply.id, seq: s1.reply.seq }, ask: `#${s1.reply.seq}: ${s1.issue.conflict} (${s1.issue.fix})` } : {}),
  });
  const leaks = issues.filter((x) => LEAKS.has(x.issue.kind));
  const l1 = latest((i) => LEAKS.has(i.kind));
  parts.push({
    part: "leaks",
    label: "Leaks",
    score: clamp(100 - (leaks.length / Math.max(1, n)) * 100),
    detail: `${leaks.length} leak${leaks.length === 1 ? "" : "s"} (secrets, later canon, writing for you)`,
    ...(l1 ? { open: { messageId: l1.reply.id, seq: l1.reply.seq }, ask: `#${l1.reply.seq}: ${l1.issue.conflict} (${l1.issue.fix})` } : {}),
  });
  if (live) {
    const habits = craftReport(chatId).habits;
    parts.push({ part: "repetition", label: "Repetition", score: clamp(100 - habits.length * 12), detail: habits.length ? habits.slice(0, 2).map((h) => h.detail).join("; ") : "nothing repeated much", open: { dock: "chat", section: "craft" }, ...(habits[0] ? { ask: `the replies keep using ${habits[0].avoid} (${habits[0].detail})` } : {}) });
  }
  // Replies the trackers didn't read (the story state falls behind).
  let tracked = n;
  try {
    if (trackerConfig(chatId).mode !== "off" && n) {
      const read = new Set(all<{ message_id: string }>(`SELECT DISTINCT message_id FROM tracker_events WHERE message_id IN (${replies.map(() => "?").join(",")})`, ...replies.map((r) => r.id)).map((r) => r.message_id));
      // The card's greeting (the chat's first message) is read as the starting state, not a reply.
      tracked = replies.filter((r) => read.has(r.id) || r.seq === 1).length;
      // The newest reply may still be being read.
      if (!read.has(replies.at(-1)!.id)) tracked++;
    }
  } catch {
    tracked = n;
  }
  const missed = Math.max(0, n - tracked);
  parts.push({ part: "ledger", label: "Story records", score: clamp(n ? (tracked / n) * 100 : 100), detail: missed ? `${missed} repl${missed === 1 ? "y" : "ies"} the trackers didn't read` : "every reply read", open: { dock: "story" }, ...(missed ? { ask: `${missed} recent replies have no story-state records; check the clock, place and cast are right` } : {}) });
  const broken = issues.filter((x) => x.issue.kind === "lesson");
  const strong = (() => {
    try {
      return lessonsFor(chatId).filter((l) => l.status === "kept" && l.strength >= 3).length;
    } catch {
      return 0;
    }
  })();
  parts.push({ part: "lessons", label: "Lessons", score: clamp(100 - (broken.length / Math.max(1, n)) * 80 - strong * 5), detail: `${broken.length} broken${strong ? ` · ${strong} keep${strong === 1 ? "s" : ""} slipping` : ""}`, open: { dock: "story", section: "lessons" }, ...(broken[0] ? { ask: `#${broken.at(-1)!.reply.seq} broke a kept lesson: ${broken.at(-1)!.issue.fix}` } : {}) });
  // Cost: how full the prompts run, and what replies cost when they're paid.
  const gens = all<{ prompt_tokens: number | null; est: number | null; cost: number | null; trace: string | null }>(
    `SELECT prompt_tokens, est_prompt_tokens AS est, cost, json_extract(trace, '$.budget.contextTarget') AS trace FROM generations WHERE chat_id = ? AND task = 'story' AND status = 'done' ORDER BY started_at DESC LIMIT ?`,
    chatId,
    WINDOW,
  );
  const full = gens.map((g) => ((g.prompt_tokens ?? g.est ?? 0) && Number(g.trace) ? (g.prompt_tokens ?? g.est ?? 0) / Number(g.trace) : null)).filter((x): x is number => x != null);
  const avgFull = full.length ? full.reduce((a, b) => a + b, 0) / full.length : 0;
  const paid = gens.filter((g) => g.cost != null && g.cost > 0);
  const avgCost = paid.length ? paid.reduce((a, g) => a + g.cost!, 0) / paid.length : 0;
  parts.push({ part: "cost", label: "Cost", score: clamp(100 - Math.max(0, avgFull - 0.75) * 300), detail: `prompts ${Math.round(avgFull * 100)}% full${avgCost ? ` · $${avgCost.toFixed(3)} a reply` : ""}`, open: { href: "/settings/usage" } });

  const loops = live ? loopsPart(chatId, replies) : null;
  if (loops) parts.push(loops);

  const weight = parts.reduce((a, p) => a + WEIGHTS[p.part], 0);
  const score = clamp(parts.reduce((a, p) => a + p.score * WEIGHTS[p.part], 0) / Math.max(1, weight));
  return { score, level: level(score), replies: n, parts };
}

const WEEK = 7 * 24 * 3600_000;

/** Story health now, and week by week. */
export function storyHealth(chatId: string): Health {
  mustChat(chatId);
  const replies = repliesIn(chatId);
  const now = compute(chatId, replies, true);
  let retold: RetellStats | undefined;
  try {
    retold = retellStats(chatId, currentFold(chatId).result.state, replies);
  } catch {
    retold = undefined;
  }
  const trend: Health["trend"] = [];
  const first = one<{ t: number | null }>("SELECT MIN(created_at) AS t FROM messages WHERE chat_id = ? AND role = 'assistant' AND deleted_at IS NULL", chatId)?.t;
  if (first != null) {
    const end = Date.now();
    for (let w = 7; w >= 0; w--) {
      const to = end - w * WEEK;
      const from = to - WEEK;
      if (to < first) continue;
      const rs = repliesIn(chatId, { from, to, limit: 200 });
      if (rs.length) trend.push({ week: from, score: compute(chatId, rs, false).score });
    }
  }
  return { ...now, trend, ...(retold?.found ? { retold } : {}) };
}

/** The dot on Home's chat cards, cached a few minutes (it's read for many chats at once). */
const dots = new Map<string, { at: number; v: { score: number; level: Health["level"] } | null }>();
export function healthDot(chatId: string) {
  const c = dots.get(chatId);
  if (c && Date.now() - c.at < 5 * 60_000) return c.v;
  let v: { score: number; level: Health["level"] } | null = null;
  try {
    const n = repliesIn(chatId);
    if (n.length >= 3) {
      const h = compute(chatId, n, false);
      v = { score: h.score, level: h.level };
    }
  } catch {
    v = null;
  }
  dots.set(chatId, { at: Date.now(), v });
  return v;
}

registerStatusTile((chatId) => {
  const n = repliesIn(chatId, { limit: 3 }).length;
  if (n < 3) return null;
  const h = storyHealth(chatId);
  return { id: "health", n: h.level === "good" ? 0 : 1, value: String(h.score), label: "story health", tone: h.level === "poor" ? "red" : "amber", open: { dock: "chat", section: "health" }, order: 5, title: h.parts.filter((p) => p.score < 80).map((p) => `${p.label}: ${p.detail}`).join("\n") || "All healthy" };
});
