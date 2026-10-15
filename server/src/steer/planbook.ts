import { parsePlan, type PlanTier } from "../../../shared/plan";
import { all, parseJson } from "../db/db";
import { mustChat } from "../services/chats";

/**
 * The planner's log: how each plan turned out. Every story reply is planned first (its kept take
 * holds the plan as reasoning, and meta.plan says where it came from), and the story already keeps
 * what happened next: how many takes it took, whether you changed the one you kept, and what the
 * continuity checker found in it. A reply counts once you've answered it (a message of yours comes
 * after it), since only then is the take you kept the one you chose. Nothing is stored twice:
 * swipe again or edit later and the log follows.
 */

export interface PlanOutcome {
  messageId: string;
  chatId: string;
  seq: number;
  at: number;
  model: string | null;
  /** Where the kept take's plan came from (own, step, first, planner, rescue, none). */
  how: string | null;
  tier: PlanTier | null;
  /** Steps found in the kept take's plan (0: no readable plan). */
  steps: number;
  /** Takes written for this reply (1: kept the first). */
  tries: number;
  /** You (or the editor) changed the kept take after it was written. */
  edited: boolean;
  /** Continuity problems the checker found in the kept take, not dismissed, by kind. */
  slips: string[];
}

interface Row {
  id: string;
  chat_id: string;
  seq: number;
  created_at: number;
  reasoning: string | null;
  meta: string;
  tries: number;
  edited: number;
  issues: string | null;
}

/** The answered, planned replies of a chat, or of every chat written by one model, oldest first. */
export function planOutcomes(scope: { chatId: string } | { model: string }, limit = 2000): PlanOutcome[] {
  const where = "chatId" in scope ? "m.chat_id = ?" : "json_extract(s.meta, '$.model') = ?";
  const rows = all<Row>(
    `SELECT m.id, m.chat_id, m.seq, m.created_at, s.reasoning, s.meta,
       (SELECT COUNT(*) FROM swipes x WHERE x.message_id = m.id AND x.status = 'done') AS tries,
       EXISTS (SELECT 1 FROM swipe_edits e WHERE e.swipe_id = s.id) AS edited,
       (SELECT f.issues FROM continuity_flags f WHERE f.message_id = m.id AND f.swipe_idx = m.active_swipe) AS issues
     FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE ${where} AND m.role = 'assistant' AND m.deleted_at IS NULL AND m.hidden = 0 AND s.status = 'done'
       AND json_extract(s.meta, '$.plan') IS NOT NULL
       AND EXISTS (SELECT 1 FROM messages u WHERE u.chat_id = m.chat_id AND u.role = 'user' AND u.deleted_at IS NULL AND u.seq > m.seq)
     ORDER BY m.created_at DESC, m.seq DESC LIMIT ?`,
    "chatId" in scope ? scope.chatId : scope.model,
    limit,
  );
  return rows.reverse().map((r) => {
    const meta = parseJson<{ plan?: string; model?: string }>(r.meta, {});
    const plan = parsePlan(r.reasoning);
    const issues = parseJson<{ kind: string; dismissed?: boolean }[]>(r.issues ?? "[]", []);
    return {
      messageId: r.id,
      chatId: r.chat_id,
      seq: r.seq,
      at: r.created_at,
      model: meta.model ?? null,
      how: meta.plan ?? null,
      tier: plan.tier,
      steps: plan.steps.length,
      tries: Math.max(1, r.tries),
      edited: Boolean(r.edited),
      slips: issues.filter((i) => !i.dismissed).map((i) => i.kind),
    };
  });
}

export interface PlanStats {
  /** Replies counted. */
  n: number;
  /** Share kept on the first take and left as written (0–1). */
  firstTry: number | null;
  /** Extra takes per reply (swipes). */
  swipes: number | null;
  /** Continuity slips per 100 replies. */
  slips: number | null;
  /** Share with a readable plan (0–1): what mandatory planning is for. */
  planned: number | null;
}

export function planStats(list: PlanOutcome[]): PlanStats {
  const n = list.length;
  if (!n) return { n, firstTry: null, swipes: null, slips: null, planned: null };
  const share = (f: (o: PlanOutcome) => boolean) => list.filter(f).length / n;
  return {
    n,
    firstTry: share((o) => o.tries === 1 && !o.edited),
    swipes: list.reduce((a, o) => a + o.tries - 1, 0) / n,
    slips: (list.reduce((a, o) => a + o.slips.length, 0) * 100) / n,
    planned: share((o) => o.steps >= 2 || o.how === "planner" || o.how === "rescue"),
  };
}

export interface PlanTrendPoint extends PlanStats {
  /** The first and last reply in this stretch (message seq). */
  fromSeq: number;
  toSeq: number;
}

/**
 * The trend: the replies in consecutive stretches, about twelve of them, of five replies at least.
 * A last stretch shorter than half the others joins the one before, so it doesn't swing the line.
 */
export function planTrend(list: PlanOutcome[]): PlanTrendPoint[] {
  if (!list.length) return [];
  const size = Math.max(5, Math.ceil(list.length / 12));
  const groups: PlanOutcome[][] = [];
  for (let i = 0; i < list.length; i += size) groups.push(list.slice(i, i + size));
  if (groups.length > 1 && groups.at(-1)!.length < size / 2) groups.at(-2)!.push(...groups.pop()!);
  return groups.map((g) => ({ ...planStats(g), fromSeq: g[0]!.seq, toSeq: g.at(-1)!.seq }));
}

const by = <K extends string>(list: PlanOutcome[], key: (o: PlanOutcome) => K | null) => {
  const out: Partial<Record<K, PlanOutcome[]>> = {};
  for (const o of list) {
    const k = key(o);
    if (k) (out[k] ??= []).push(o);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, planStats(v as PlanOutcome[])])) as Partial<Record<K, PlanStats>>;
};

export interface Planbook {
  scope: "chat" | "model";
  model: string | null;
  all: PlanStats;
  /** The last 20 replies against everything before them: whether it's getting better. */
  recent: PlanStats;
  earlier: PlanStats;
  trend: PlanTrendPoint[];
  byTier: Partial<Record<PlanTier, PlanStats>>;
  byHow: Partial<Record<string, PlanStats>>;
  /** What the checker found most in the last 30 replies. */
  slipKinds: { kind: string; count: number }[];
}

/** The notebook for one chat, or for the model that wrote its latest reply across every chat. */
export function planbook(chatId: string, scope: "chat" | "model" = "chat"): Planbook {
  mustChat(chatId);
  const mine = planOutcomes({ chatId });
  const model = mine.at(-1)?.model ?? null;
  const list = scope === "model" && model ? planOutcomes({ model }) : mine;
  const kinds = new Map<string, number>();
  for (const o of list.slice(-30)) for (const k of o.slips) kinds.set(k, (kinds.get(k) ?? 0) + 1);
  return {
    scope: scope === "model" && model ? "model" : "chat",
    model,
    all: planStats(list),
    recent: planStats(list.slice(-20)),
    earlier: planStats(list.slice(0, -20)),
    trend: planTrend(list),
    byTier: by(list, (o) => o.tier),
    byHow: by(list, (o) => o.how),
    slipKinds: [...kinds].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count).slice(0, 5),
  };
}
