import { all } from "../db/db";
import { mentions } from "./mentions";
import type { Op, WorldState } from "./types";

/**
 * docs/31 Part 3: someone the scene still has (@spot or @peri) whom the story hasn't named in a while.
 * Presence is only as good as the cast lines, and a person who slipped out without one stays "here",
 * hearing everything said to "everyone". The tracker can't tell, because it keeps writing a think
 * line for whoever the state says is here, so this reads the messages themselves.
 */
export interface QuietPerson {
  id: string;
  name: string;
  /** The last message (seq) that named them, if any in the stretch read. */
  lastNamed: number | null;
  /** How many replies since they were last named (or the whole stretch read). */
  replies: number;
}

/** "everyone" stops reaching someone the story hasn't named in this many replies. */
export const QUIET_REPLIES = 6;
/** The Cast tab asks "still here?" after this many. */
export const ASK_REPLIES = 10;

/**
 * The present people not named in the last `replies` replies (and the messages between them), up to
 * `uptoSeq`. Your character never goes quiet, nor does someone you said is here since then (a cast line
 * of yours). A story shorter than that has nobody quiet yet.
 */
export function quietPeople(chatId: string, st: WorldState, o: { replies?: number; uptoSeq?: number } = {}): QuietPerson[] {
  const want = o.replies ?? QUIET_REPLIES;
  const here = Object.values(st.chars).filter((c) => (c.tier === "spot" || c.tier === "peri") && !c.dead && !c.isUser);
  if (!here.length) return [];
  const rows = all<{ seq: number; role: string; content: string }>(
    `SELECT m.seq, m.role, s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.hidden = 0 AND m.seq <= ? ORDER BY m.seq DESC LIMIT ?`,
    chatId,
    o.uptoSeq ?? Number.MAX_SAFE_INTEGER,
    want * 2 + 2,
  );
  // The stretch: back to the `want`th reply.
  const stretch: typeof rows = [];
  let replies = 0;
  for (const r of rows) {
    stretch.push(r);
    if (r.role === "assistant" && ++replies >= want) break;
  }
  if (replies < want) return [];
  const from = stretch.at(-1)!.seq;
  const said = new Set<string>();
  for (const r of all<{ op: string }>("SELECT e.op FROM tracker_events e LEFT JOIN messages m ON m.id = e.message_id WHERE e.chat_id = ? AND e.source = 'user' AND (m.seq IS NULL OR m.seq >= ?) AND e.op LIKE '%\"op\":\"cast\"%'", chatId, from)) {
    const op = JSON.parse(r.op) as Op;
    for (const x of (op.args.list ?? []) as { name: string; tier: string }[]) if (/^(spot|peri|arrive)/.test(x.tier)) said.add(x.name.toLowerCase());
  }
  const out: QuietPerson[] = [];
  for (const c of here) {
    const names = [c.name, ...c.aliases];
    if (names.some((n) => said.has(n.toLowerCase()))) continue;
    const hit = stretch.find((r) => names.some((n) => mentions(r.content, n)));
    if (hit) continue;
    out.push({ id: c.id, name: c.name, lastNamed: null, replies });
  }
  return out;
}

/** For the Cast tab: how long each quiet person has gone unnamed, reading further back. */
export function stillHere(chatId: string, st: WorldState): QuietPerson[] {
  const quiet = quietPeople(chatId, st, { replies: ASK_REPLIES });
  if (!quiet.length) return [];
  const rows = all<{ seq: number; role: string; content: string }>(
    `SELECT m.seq, m.role, s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.hidden = 0 ORDER BY m.seq DESC LIMIT 400`,
    chatId,
  );
  return quiet.map((q) => {
    const c = st.chars[q.id]!;
    let replies = 0;
    for (const r of rows) {
      if ([c.name, ...c.aliases].some((n) => mentions(r.content, n))) return { ...q, lastNamed: r.seq, replies };
      if (r.role === "assistant") replies++;
    }
    return { ...q, replies };
  });
}
