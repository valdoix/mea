import { all, now, parseJson, run } from "../db/db";
import { countTokens } from "../lib/tokens";
import { describeMinutes, formatStoryTime } from "../trackers/clock";
import { currentFold } from "../trackers/store";
import { norm } from "./entities";
import { getSummary, type SummaryRow, touchMemory } from "./store";

/**
 * Reconcile scene records with the trackers (SUM-22). The story clock and the scene tracker are
 * a higher authority than a summary (CON-01), so:
 *   - a record without a story time gets the tracker's span,
 *   - a scene where a day or more passed must say so (a "Time" line is added if it doesn't),
 *   - a record whose time words or places contradict the trackers is flagged for review.
 */

export interface ReconcileIssue {
  kind: "time" | "place";
  message: string;
  severity: "minor" | "major";
}

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, several: 3, few: 3, couple: 2 };
const UNIT: Record<string, number> = { minute: 1, hour: 60, day: 1440, night: 1440, week: 10080, month: 43200, year: 525600 };

/** Rough elapsed time a text claims, in minutes ([low, high]), or null when it says nothing. */
export function claimedElapsed(text: string): [number, number] | null {
  const t = text.toLowerCase();
  let low = 0;
  let high = 0;
  let found = false;
  for (const m of t.matchAll(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|several|few|couple(?: of)?)\s+(minute|hour|day|night|week|month|year)s?\s+(?:later|passed|pass|went by|go by|of travel|on the road|afterwards?)\b/g)) {
    const n = Number(m[1]) || NUM[m[1]!.replace(" of", "")] || 1;
    const mins = n * UNIT[m[2]!]!;
    low += mins * 0.6;
    high += mins * 1.6;
    found = true;
  }
  if (/\b(next|following) (morning|day)\b|\bthe day after\b|\bovernight\b|\bat dawn\b/.test(t)) {
    low += 360;
    high += 1800;
    found = true;
  }
  if (/\b(that|the same) (night|evening|afternoon)\b|\blater that day\b/.test(t)) {
    high += 1080;
    found = true;
  }
  return found ? [low, Math.max(high, low)] : null;
}

const TIME_WORDS = /\b(minute|hour|day|night|week|month|year|morning|evening|afternoon|dawn|dusk|midnight|noon|later|overnight|tomorrow|yesterday)s?\b/i;

export function reconcileScene(summaryId: string) {
  const row = getSummary(summaryId);
  if (!row || row.level !== "scene" || row.state !== "ready") return [] as ReconcileIssue[];
  let fold: ReturnType<typeof currentFold>;
  try {
    fold = currentFold(row.chat_id);
  } catch {
    return [];
  }
  const msgs = all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL AND seq <= ? ORDER BY seq", row.chat_id, row.end_seq ?? Number.MAX_SAFE_INTEGER);
  const minutesAt = (pred: (seq: number) => boolean) => {
    let v: { minutes: number; form: "date" | "day" } | null = null;
    for (const m of msgs) {
      if (!pred(m.seq)) continue;
      const t = fold.times[m.id];
      if (t) v = { minutes: Number(t.split(":")[0]), form: t.split(":")[1] as "date" | "day" };
    }
    return v;
  };
  // Story time just before the scene, and at its last message.
  const start = minutesAt((s) => s < row.start_seq) ?? minutesAt((s) => s === row.start_seq);
  const end = minutesAt((s) => s <= (row.end_seq ?? s));
  if (!start || !end) return [];
  const elapsed = Math.max(0, end.minutes - start.minutes);
  const data = parseJson<{ storyTime?: string; locations?: string[] }>(row.data, {});
  const text = `${row.content}\n${data.storyTime ?? ""}`;
  const issues: ReconcileIssue[] = [];

  const claim = claimedElapsed(text);
  if (claim && elapsed > 0) {
    const [lo, hi] = claim;
    if ((elapsed < lo * 0.5 && lo - elapsed > 360) || (elapsed > hi * 2 && elapsed - hi > 360)) {
      issues.push({ kind: "time", severity: "major", message: `The record suggests ${describeMinutes(Math.round((lo + hi) / 2))} passed; the story clock says ${describeMinutes(elapsed)}.` });
    }
  }

  // Places: the record's locations should overlap the places the trackers saw in this scene.
  const seen = new Set<string>();
  for (const m of msgs) if (m.seq >= row.start_seq) for (const c of fold.result.changes[m.id] ?? []) if (c.kind === "place" && typeof c.to === "string") for (const p of c.to.split(" › ")) seen.add(norm(p));
  const locs = (data.locations ?? []).map(norm).filter(Boolean);
  if (seen.size && locs.length && !locs.some((l) => [...seen].some((p) => p.includes(l) || l.includes(p)))) {
    issues.push({ kind: "place", severity: "minor", message: `The record places this at ${data.locations!.join(", ")}; the scene tracker has ${[...seen].join(", ")}.` });
  }

  // Fixes that follow the higher authority without asking (your edited summaries are left alone).
  let content = row.content;
  let storyTime = row.story_time;
  if (!row.user_edited) {
    if (!storyTime) storyTime = `${formatStoryTime(start)} → ${formatStoryTime(end)}`;
    if (elapsed >= 1440 && !TIME_WORDS.test(row.content) && !/^Time passing:/m.test(row.content)) content = `${row.content}\nTime passing: about ${describeMinutes(elapsed)} (story clock).`;
  }
  const verification = { ...parseJson<Record<string, unknown>>(row.verification ?? "{}", {}), reconcile: { issues, elapsed, at: now() } };
  run("UPDATE summaries SET content = ?, tokens = ?, story_time = ?, verification = ?, updated_at = ? WHERE id = ?", content, countTokens(content), storyTime, JSON.stringify(verification), now(), row.id);
  if (content !== row.content || issues.length) touchMemory(row.chat_id);
  return issues;
}

/** Scenes whose records disagree with the trackers, for the inspector. */
export function reconcileIssues(chatId: string) {
  return all<SummaryRow>("SELECT * FROM summaries WHERE chat_id = ? AND level = 'scene' AND verification LIKE '%\"reconcile\"%'", chatId)
    .map((r) => ({ id: r.id, title: r.title, startSeq: r.start_seq, endSeq: r.end_seq, issues: parseJson<{ reconcile?: { issues: ReconcileIssue[] } }>(r.verification ?? "{}", {}).reconcile?.issues ?? [] }))
    .filter((r) => r.issues.length);
}
