import { all, one, parseJson } from "../db/db";
import { doneLoops, openLoops, pastDue } from "../trackers/loops";
import { currentFold, trackerConfig } from "../trackers/store";
import type { Loop, WorldState } from "../trackers/types";
import type { HealthItem, Reply } from "./health";
import type { Finding } from "./promptcheck";

/**
 * docs/22 5.3: whether Mea notices when things finish, worked out from what's already kept. The target
 * is the first number: of 25 promises marked kept in Filed Under Stay, 12 were you, in a panel.
 */

/** How many of the latest closes are counted: they're rare, so 20 replies would say nothing. */
const CLOSES = 25;
/** Fewer closes than this say nothing about a share. */
const CLOSES_MIN = 5;
/** Replies a close may lag by before it's slow: a scene closes after the fact, and they run about this long. */
const LAG_OK = 20;

interface Reading {
  /** What the score loses for it. */
  cost: number;
  line: string;
  open?: HealthItem["open"];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const median = (ns: number[]) => [...ns].sort((a, b) => a - b)[Math.floor(ns.length / 2)]!;

/** Messages that came after a loop's message before a model's record of closing it was written. */
function closeLags(chatId: string, loops: Loop[]) {
  if (!loops.length) return [];
  const wanted = new Map(loops.map((l) => [l.id, l.closed!]));
  const events = all<{ subject: string | null; at: number }>(
    `SELECT json_extract(op, '$.subject') AS subject, created_at AS at FROM tracker_events
     WHERE chat_id = ? AND source IN ('model', 'inline', 'memory') AND json_extract(op, '$.op') = 'loop' AND json_extract(op, '$.args.action') = 'done'`,
    chatId,
  ).filter((e) => e.subject && wanted.has(e.subject));
  const messages = all<{ seq: number; created_at: number }>("SELECT seq, created_at FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId);
  return events.map((e) => messages.filter((m) => m.seq > wanted.get(e.subject!)! && m.created_at <= e.at).length);
}

/** Closed chapters the Story So Far hasn't taken in: a rollup that stopped. */
function storyBehind(chatId: string) {
  const story = one<{ end_seq: number | null }>("SELECT end_seq FROM summaries WHERE chat_id = ? AND level = 'story' AND state = 'ready'", chatId);
  if (story?.end_seq == null) return null;
  const chapters = one<{ n: number }>("SELECT COUNT(*) AS n FROM summaries WHERE chat_id = ? AND level = 'chapter' AND closed = 1 AND state = 'ready' AND end_seq > ?", chatId, story.end_seq)?.n ?? 0;
  return { at: story.end_seq, chapters };
}

/** Stale lines caught in the writer's prompts over these replies, and the plans sent back. */
function caught(chatId: string, replies: Reply[]) {
  if (!replies.length) return { hits: [] as { where: string; messageId: string }[], replans: 0 };
  const rows = all<{ message_id: string; outdated: string | null }>(
    `SELECT message_id, json_extract(trace, '$.outdated') AS outdated FROM generations WHERE chat_id = ? AND task = 'story' AND status = 'done' AND message_id IN (${replies.map(() => "?").join(",")})`,
    chatId,
    ...replies.map((r) => r.id),
  );
  const hits = rows.flatMap((r) => parseJson<Finding[]>(r.outdated, []).filter((f) => f.kind === "done").map((f) => ({ where: f.where, messageId: r.message_id })));
  const replans = one<{ n: number }>("SELECT COUNT(*) AS n FROM generations WHERE chat_id = ? AND kind = 'planner:replan' AND started_at >= ?", chatId, replies[0]!.created_at)?.n ?? 0;
  return { hits, replans };
}

function readings(chatId: string, st: WorldState, replies: Reply[]) {
  const out: Reading[] = [];
  const closes = doneLoops(st).slice(-CLOSES);
  const hand = closes.filter((l) => l.byHand).length;
  if (closes.length) out.push({ cost: closes.length >= CLOSES_MIN ? (hand / closes.length) * 50 : 0, line: `${hand} of the last ${plural(closes.length, "close")} by hand`, open: { dock: "story", section: "loops" } });

  const lags = closeLags(chatId, closes.filter((l) => !l.yours));
  if (lags.length) {
    const m = median(lags);
    out.push({ cost: Math.min(30, Math.max(0, m - LAG_OK)), line: `a close is noticed ${m ? `about ${plural(m, "message")} late` : "right away"}`, open: { dock: "story", section: "loops" } });
  }

  const behind = storyBehind(chatId);
  if (behind) out.push({ cost: Math.max(0, behind.chapters - 1) * 15, line: behind.chapters ? `Story So Far ends at #${behind.at}, ${plural(behind.chapters, "chapter")} behind` : `Story So Far is up to date, to #${behind.at}`, open: { dock: "memory" } });

  const { hits, replans } = caught(chatId, replies);
  const from = [...new Set(hits.map((h) => h.where))].slice(0, 3).join(", ");
  const last = hits.at(-1) ? replies.find((r) => r.id === hits.at(-1)!.messageId) : undefined;
  out.push({ cost: Math.min(30, (hits.length / Math.max(1, replies.length)) * 10 + replans * 5), line: `${plural(hits.length, "stale line")} caught${from ? ` (${from})` : ""}, ${plural(replans, "plan")} sent back`, ...(last ? { open: { messageId: last.id, seq: last.seq } } : {}) });

  const late = pastDue(st);
  out.push({ cost: Math.min(40, late.length * 8), line: late.length ? `${plural(late.length, "open loop")} past due, oldest: ${late[0]!.what}` : "nothing open past due", open: { dock: "story", section: "loops" } });
  return out;
}

/** Story health's Open loops. It opens the worst of them; a chat with no loops has nothing to say. */
export function loopsPart(chatId: string, replies: Reply[]): HealthItem | null {
  if (trackerConfig(chatId).mode === "off") return null;
  const st = currentFold(chatId).result.state;
  if (!openLoops(st).length && !doneLoops(st).length) return null;
  const list = readings(chatId, st, replies);
  const worst = list.reduce((a, b) => (b.cost > a.cost ? b : a));
  return {
    part: "loops",
    label: "Open loops",
    score: Math.round(Math.max(0, 100 - list.reduce((n, r) => n + r.cost, 0))),
    detail: worst.line,
    notes: list.filter((r) => r !== worst).map((r) => r.line),
    ...(worst.open ? { open: worst.open } : { open: { dock: "story" as const, section: "loops" } }),
  };
}
