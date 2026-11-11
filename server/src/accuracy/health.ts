import { all, one, parseJson } from "../db/db";
import { type ChatSettings, mustChat } from "../services/chats";
import { registerStatusTile } from "../services/status";
import { craftReport } from "../steer/craft";
import { lessonsFor } from "../steer/lessons";
import { foldConfigFor, trackerConfig } from "../trackers/store";
import { notPeopleNow, placesWithSeveralNames, rereadNow } from "./casthealth";
import type { Issue } from "./checker";
import { currentFold } from "../trackers/store";
import { loopsPart } from "./loophealth";
import { type FlagKind, flagKey, flagKinds, quietKeys } from "./quiet";
import { type NamesStats, namesStats } from "../memory/named";
import { type RetellStats, retellStats } from "./retell";

/**
 * Story health (Almanac plan D3): one score for the last 20 replies, from what Mea already keeps:
 * continuity slips, leaks, repetition (the craft coach), replies the trackers didn't read, broken
 * lessons, and how full the prompts run. Each part says what drags it down and where to look.
 * Nothing new is stored; the weekly trend is worked out from the same records.
 */

export type HealthPart = "continuity" | "leaks" | "repetition" | "ledger" | "lessons" | "cost" | "loops" | "notpeople" | "reread" | "placenames" | "offscene";
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
  /** docs/26 5.2: rare names the player used, and how many reached the prompt as a memory. */
  names?: NamesStats;
  /** docs/22 4.2: each kind of flag: how often you waved it off, and whether it's gone quiet. */
  flags: FlagKind[];
}

const WINDOW = 20;
const LEAKS = new Set(["leak", "offpage", "canon", "puppet"]);
const SLIPS = new Set(["trait", "dead", "time", "name", "place", "fact", "pov", "tense", "timeline", "nothere", "clockback", "past", "planning", "who", "ties", "retell", "undone", "known", "elsewhere", "weather", "daylight", "weekday", "period"]);
const WEIGHTS: Record<HealthPart, number> = { continuity: 3, leaks: 3, repetition: 2, ledger: 1, lessons: 2, cost: 1, loops: 2, notpeople: 1, reread: 1, placenames: 1, offscene: 1 };

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

/** The open findings on a set of replies (on the take that's showing). A quiet kind isn't one: nobody's going to dismiss what they can't see. */
function openIssues(quiet: Set<string>, replies: Reply[]) {
  if (!replies.length) return [] as { issue: Issue; reply: Reply }[];
  const byId = new Map(replies.map((r) => [r.id, r]));
  const rows = all<{ message_id: string; swipe_idx: number; issues: string }>(`SELECT message_id, swipe_idx, issues FROM continuity_flags WHERE message_id IN (${replies.map(() => "?").join(",")})`, ...replies.map((r) => r.id));
  return rows.flatMap((f) => {
    const r = byId.get(f.message_id);
    if (!r || r.idx !== f.swipe_idx) return [];
    return parseJson<Issue[]>(f.issues, [])
      .filter((i) => !i.dismissed && !quiet.has(flagKey(i)))
      .map((issue) => ({ issue, reply: r }));
  });
}

/**
 * docs/31 5.2: on these replies, the people Mea kept off a tracker's know, mood or bond lines (who it
 * didn't reach, who it asked about, who you said wasn't there), and by the model that wrote them.
 */
export function offScene(replies: Reply[]) {
  if (!replies.length) return { total: 0, models: [] as { model: string; n: number; replies: number; per100: number }[], last: null as Reply | null };
  const byId = new Map(replies.map((r) => [r.id, r]));
  const rows = all<{ message_id: string; swipe_idx: number; source: string; op: string }>(
    `SELECT message_id, swipe_idx, source, op FROM tracker_events WHERE message_id IN (${replies.map(() => "?").join(",")}) AND source IN ('model', 'inline')
       AND (op LIKE '%"away"%' OR op LIKE '%"unsure"%' OR op LIKE '%"notThere"%')`,
    ...replies.map((r) => r.id),
  );
  const modelOf = (messageId: string, task: string) => one<{ m: string | null }>("SELECT model_id AS m FROM generations WHERE message_id = ? AND task = ? ORDER BY started_at DESC LIMIT 1", messageId, task)?.m ?? "unknown";
  const per = new Map<string, number>();
  let total = 0;
  let last: Reply | null = null;
  for (const r of rows) {
    const reply = byId.get(r.message_id);
    if (!reply || (r.swipe_idx !== -1 && r.swipe_idx !== reply.idx)) continue;
    const args = parseJson<{ args?: Record<string, unknown> }>(r.op, {}).args ?? {};
    const k = (["away", "unsure", "notThere"] as const).reduce((a, key) => a + (Array.isArray(args[key]) ? (args[key] as unknown[]).length : 0), 0);
    if (!k) continue;
    total += k;
    const model = modelOf(r.message_id, r.source === "inline" ? "story" : "tracker");
    per.set(model, (per.get(model) ?? 0) + k);
    if (!last || reply.seq > last.seq) last = reply;
  }
  // Replies each model read, for its rate.
  const read = new Map<string, number>();
  for (const r of replies) {
    const m = one<{ m: string | null }>("SELECT model_id AS m FROM generations WHERE message_id = ? AND task = 'tracker' ORDER BY started_at DESC LIMIT 1", r.id)?.m;
    if (m) read.set(m, (read.get(m) ?? 0) + 1);
  }
  const models = [...per].map(([model, k]) => ({ model, n: k, replies: read.get(model) ?? replies.length, per100: (k * 100) / Math.max(1, read.get(model) ?? replies.length) })).sort((a, b) => b.n - a.n);
  return { total, models, last };
}

function compute(chatId: string, replies: Reply[], live: boolean, quiet: Set<string>): Omit<Health, "trend" | "flags"> {
  const n = replies.length;
  const issues = openIssues(quiet, replies);
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
  // docs/31 5.2: people a tracker line gave something they weren't there for, held back or taken off.
  const off = offScene(replies);
  parts.push({
    part: "offscene",
    label: "Off-scene knowledge",
    score: clamp(100 - (off.total * 100) / Math.max(1, n) * 0.5),
    detail: off.total
      ? `${off.total} ${off.total === 1 ? "person" : "people"} kept from lines they weren't there for in ${n} replies${off.models.length ? ` · ${off.models.map((m) => `${m.model} ${m.per100.toFixed(0)} per 100 replies`).join(", ")}` : ""}`
      : "nobody learned what they weren't there for",
    ...(off.last ? { open: { messageId: off.last.id, seq: off.last.seq } } : {}),
  });
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
  // docs/30 4.2: the cast and the places, as they stand now (not week by week).
  if (live) parts.push(...castParts(chatId));

  const weight = parts.reduce((a, p) => a + WEIGHTS[p.part], 0);
  const score = clamp(parts.reduce((a, p) => a + p.score * WEIGHTS[p.part], 0) / Math.max(1, weight));
  return { score, level: level(score), replies: n, parts };
}

/** docs/30 4.2: "Not people" (should stay at 0) and "Places with several names". */
function castParts(chatId: string): HealthItem[] {
  let st;
  try {
    st = currentFold(chatId).result.state;
  } catch {
    return [];
  }
  const fc = foldConfigFor(chatId);
  const notPeople = notPeopleNow(st, { factions: (fc.factions ?? []).flatMap((f) => [f.name, ...(f.aliases ?? [])]), people: fc.people });
  const AS = { group: "a group", faction: "a faction", place: "a place", field: "a field name" } as const;
  const reread = rereadNow(st, parseJson<ChatSettings>(mustChat(chatId).settings, {}).castTidy?.seen);
  const drift = placesWithSeveralNames(st);
  const twice = drift.reduce((n, d) => n + d.names.length, 0);
  return [
    {
      part: "notpeople",
      label: "Not people",
      score: clamp(100 - notPeople.length * 25),
      detail: notPeople.length ? `${notPeople.length} in the cast that ${notPeople.length === 1 ? "isn't a person" : "aren't people"}: ${notPeople.slice(0, 3).map((x) => x.name).join(", ")}` : "everyone in the cast is a person",
      open: { href: `/chat/${chatId}/story?tab=cast` },
      ...(notPeople.length ? { ask: `the cast has entries that aren't people (${notPeople.slice(0, 4).map((x) => `${x.name}: ${AS[x.as]}`).join("; ")}); sort out the cast`, notes: notPeople.map((x) => `${x.name}: ${AS[x.as]}`) } : {}),
    },
    {
      part: "reread",
      label: "Names read as someone else",
      score: clamp(100 - reread.length * 10),
      detail: reread.length ? `${reread.length} name${reread.length === 1 ? "" : "s"} the tracker wrote that nobody has: ${reread.slice(0, 3).map((x) => `${x.name} (${x.as ? `read as ${x.as}` : "nobody"})`).join(", ")}` : "every name the tracker wrote is someone's",
      open: { href: `/chat/${chatId}/story?tab=cast` },
      ...(reread.length ? { notes: reread.map((x) => `${x.name}: ${x.as ? `read as ${x.as}` : "nobody was added"}`) } : {}),
    },
    {
      part: "placenames",
      label: "Places with several names",
      score: clamp(100 - twice * 8),
      detail: twice ? `${twice} room${twice === 1 ? "" : "s"} made twice in ${drift.length} building${drift.length === 1 ? "" : "s"}${drift[0] ? `: ${drift[0].building} has ${drift[0].names.slice(0, 2).map((x) => `${x.name} ×${x.count}`).join(", ")}` : ""}` : "one place, one name",
      open: { href: `/chat/${chatId}/story?tab=cast` },
      ...(twice ? { ask: `rooms were made twice inside one building (${drift.slice(0, 2).map((d) => `${d.building}: ${d.names.slice(0, 3).map((x) => x.paths.join(" / ")).join("; ")}`).join(" · ")}); sort out the places`, notes: drift.flatMap((d) => d.names.map((x) => `${d.building}: ${x.paths.join(" / ")}`)) } : {}),
    },
  ];
}

const WEEK = 7 * 24 * 3600_000;

/** Story health now, and week by week. */
export function storyHealth(chatId: string): Health {
  mustChat(chatId);
  const replies = repliesIn(chatId);
  const flags = flagKinds(chatId);
  const quiet = new Set(flags.filter((k) => k.quiet).map((k) => k.key));
  const now = compute(chatId, replies, true, quiet);
  let retold: RetellStats | undefined;
  try {
    retold = retellStats(chatId, currentFold(chatId).result.state, replies);
  } catch {
    retold = undefined;
  }
  let names: NamesStats | undefined;
  try {
    names = namesStats(chatId, replies);
  } catch {
    names = undefined;
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
      if (rs.length) trend.push({ week: from, score: compute(chatId, rs, false, quiet).score });
    }
  }
  return { ...now, trend, flags, ...(retold?.found ? { retold } : {}), ...(names?.used ? { names } : {}) };
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
      const h = compute(chatId, n, false, quietKeys(chatId));
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
