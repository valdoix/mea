import { all, one, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { Folder, reachOn } from "./fold";
import { mentions } from "./mentions";
import { QUIET_REPLIES } from "./stillhere";
import { branchEvents, foldConfigFor, invalidate } from "./store";
import type { Op } from "./types";

/**
 * docs/31 Part 4: the lines filed before Mea checked who a reply reached. Each older know, mood and bond
 * line the tracker wrote is checked the way a new one is (groupReach), against the state and the
 * messages as they were then. Nothing changes until you fix a finding, and a fix can be taken back.
 */
export interface SweepFinding {
  eventId: string;
  messageId: string;
  seq: number;
  line: string;
  /** People the line would no longer reach (a group's members, or quiet people for "everyone"). */
  away: string[];
  /** People named on it who weren't in the scene or the messages: their chips would ask. */
  unsure: string[];
}

/** Keys a fix or your answers put on a line: once there, the sweep has already had its say. */
const HANDLED = ["away", "unsure", "notThere", "swept", "sweepOk"] as const;
const handled = (op: Op) => HANDLED.some((k) => op.args[k] != null);

const cache = new Map<string, { key: string; findings: SweepFinding[] }>();

export function reachSweep(chatId: string): SweepFinding[] {
  const key = sweepKey(chatId);
  const hit = cache.get(chatId);
  if (hit?.key === key) {
    // A swiped or deleted reply takes its lines with it.
    const live = new Set(all<{ id: string }>("SELECT id FROM tracker_events WHERE chat_id = ? AND (op LIKE '%\"op\":\"know\"%' OR op LIKE '%\"op\":\"mood\"%' OR op LIKE '%\"op\":\"bond\"%')", chatId).map((r) => r.id));
    return hit.findings.filter((x) => live.has(x.eventId));
  }
  const cfg = foldConfigFor(chatId);
  const events = branchEvents(chatId);
  const msgs = all<{ id: string; seq: number; role: string; content: string }>(
    `SELECT m.id, m.seq, m.role, s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.hidden = 0 ORDER BY m.seq`,
    chatId,
  );
  const at = new Map(msgs.map((m, i) => [m.id, i]));
  /** What the tracker read for a reply: it and the messages since the reply before it. */
  const textOf = (messageId: string) => {
    const i = at.get(messageId);
    if (i == null) return "";
    let j = i;
    while (j > 0 && msgs[j - 1]!.role !== "assistant") j--;
    return msgs.slice(j, i + 1).map((m) => m.content).join("\n\n");
  };
  /** The present people the messages before this one haven't named in QUIET_REPLIES replies. */
  const quietAt = (f: Folder, messageId: string) => {
    const i = at.get(messageId);
    if (i == null) return [];
    const stretch: string[] = [];
    let replies = 0;
    for (let j = i - 1; j >= 0 && replies < QUIET_REPLIES; j--) {
      stretch.push(msgs[j]!.content);
      if (msgs[j]!.role === "assistant") replies++;
    }
    if (replies < QUIET_REPLIES) return [];
    return Object.values(f.state.chars)
      .filter((c) => (c.tier === "spot" || c.tier === "peri") && !c.dead && !c.isUser)
      .filter((c) => !stretch.some((t) => [c.name, ...c.aliases].some((n) => mentions(t, n))))
      .map((c) => c.name);
  };

  // Each reply's cast lines go along with its lines, as they did when it was filed.
  const castOf = new Map<string, Op[]>();
  for (const ev of events) if (ev.messageId && ev.op.op === "cast") castOf.set(ev.messageId, [...(castOf.get(ev.messageId) ?? []), ev.op]);
  const f = new Folder(cfg);
  const out: SweepFinding[] = [];
  for (const ev of events) {
    const mine = (ev.source === "model" || ev.source === "inline") && ev.messageId && ["know", "mood", "bond"].includes(ev.op.op) && ev.op.subject && !handled(ev.op);
    if (mine) {
      const op = reachOn(f, [...(castOf.get(ev.messageId!) ?? []), ev.op], textOf(ev.messageId!), quietAt(f, ev.messageId!)).at(-1);
      const away = (op!.args.away as string[] | undefined) ?? [];
      const unsure = (op!.args.unsure as string[] | undefined) ?? [];
      if (away.length || unsure.length) out.push({ eventId: ev.id, messageId: ev.messageId!, seq: ev.seq, line: ev.op.raw ?? "", away, unsure });
    }
    f.apply(ev);
  }
  cache.set(chatId, { key, findings: out });
  if (cache.size > 10) cache.delete(cache.keys().next().value!);
  return out;
}

/**
 * Changes when an answer lands on a line (a fix, Leave, "wasn't there"), not with every new reply: new
 * lines are checked as they're filed, so they can't add findings. It folds the whole story (about two
 * seconds on a long one), so it shouldn't run after every message.
 */
function sweepKey(chatId: string) {
  const s = one<{ n: number }>("SELECT COUNT(*) AS n FROM tracker_events WHERE chat_id = ? AND (op LIKE '%\"swept\"%' OR op LIKE '%\"sweepOk\"%' OR op LIKE '%\"notThere\"%')", chatId);
  return `${s?.n}`;
}

function rewrite(chatId: string, ids: string[], change: (op: Op, f?: SweepFinding) => Op | null, findings?: SweepFinding[]) {
  const by = new Map((findings ?? []).map((x) => [x.eventId, x]));
  let n = 0;
  tx(() => {
    for (const id of ids) {
      const row = one<{ op: string }>("SELECT op FROM tracker_events WHERE chat_id = ? AND id = ?", chatId, id);
      if (!row) continue;
      const next = change(JSON.parse(row.op) as Op, by.get(id));
      if (!next) continue;
      run("UPDATE tracker_events SET op = ? WHERE chat_id = ? AND id = ?", JSON.stringify(next), chatId, id);
      n++;
    }
  });
  if (n) {
    cache.delete(chatId);
    invalidate(chatId);
    publish({ type: "trackers.changed", chatId });
  }
  return n;
}

/** Fixes findings (all of them without ids): their people go on the line's away and unsure, marked as the sweep's. */
export function fixSweep(chatId: string, ids?: string[]) {
  const findings = reachSweep(chatId);
  const pick = ids ? findings.filter((x) => ids.includes(x.eventId)) : findings;
  return rewrite(
    chatId,
    pick.map((x) => x.eventId),
    (op, x) => (x ? { ...op, args: { ...op.args, ...(x.away.length ? { away: x.away } : {}), ...(x.unsure.length ? { unsure: x.unsure } : {}), swept: { away: x.away, unsure: x.unsure } } } : null),
    pick,
  );
}

/** Takes fixes back: the line is as the tracker wrote it, and the sweep lists it again. */
export function undoSweep(chatId: string, ids: string[]) {
  return rewrite(chatId, ids, (op) => {
    if (!op.args.swept) return null;
    const { away: _a, unsure: _u, swept: _s, ...rest } = op.args;
    return { ...op, args: rest };
  });
}

/** "Leave it": the line stays as written and the sweep stops listing it. */
export function leaveSweep(chatId: string, ids: string[]) {
  return rewrite(chatId, ids, (op) => ({ ...op, args: { ...op.args, sweepOk: true } }));
}
