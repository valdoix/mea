import { all } from "../db/db";
import { currentFold } from "./store";

/**
 * A record's moment (docs/20 2.2, 2.3): the message it came from, with the story time and place of
 * that message. "Buffy promised Gabriel: tell Dawn about the jealousy question" said nothing of
 * where; "(made #467, 11:57 at Summers Residence › Front Yard)" does, and a planner retelling it
 * has no room to guess.
 */

const DAY = 1440;
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (m: number) => `${pad(Math.floor((((m % DAY) + DAY) % DAY) / 60))}:${pad(m % 60)}`;

/** The index of the latest seq at or before this one, or -1. */
function latest(seqs: number[], seq: number) {
  let lo = 0;
  let hi = seqs.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (seqs[mid]! <= seq) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/** "#467" alone, for a story with no clock or places yet. */
export const bareMoment = (seq: number) => `#${seq}`;

/**
 * Turns a message number into its moment: "#467, 11:57 at Summers Residence › Front Yard" today,
 * "#259, yesterday 20:33 at Winters House › Gabriel's bedroom", "#120, 3 days ago at the diner".
 * The time and place (its last two parts) are the latest the trackers knew at or before it.
 */
export function momentsOf(chatId: string): (seq: number) => string {
  let times: Record<string, string | null> = {};
  let places: Record<string, string> = {};
  try {
    const f = currentFold(chatId);
    times = f.times;
    places = f.places ?? {};
  } catch {
    return bareMoment;
  }
  const tSeqs: number[] = [];
  const tMin: number[] = [];
  const pSeqs: number[] = [];
  const pName: string[] = [];
  for (const r of all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY seq", chatId)) {
    const t = times[r.id];
    if (t) {
      tSeqs.push(r.seq);
      tMin.push(Number(t.split(":")[0]));
    }
    const p = places[r.id];
    if (p) {
      pSeqs.push(r.seq);
      pName.push(p.split(" › ").slice(-2).join(" › "));
    }
  }
  const now = tMin.at(-1);
  return (seq: number) => {
    const ti = latest(tSeqs, seq);
    const pi = latest(pSeqs, seq);
    const at = ti >= 0 ? tMin[ti]! : null;
    let when = "";
    if (at != null && now != null) {
      const days = Math.floor(now / DAY) - Math.floor(at / DAY);
      when = days <= 0 ? hhmm(at) : days === 1 ? `yesterday ${hhmm(at)}` : `${days} days ago`;
    }
    const where = pi >= 0 ? `at ${pName[pi]}` : "";
    return [`#${seq}`, [when, where].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  };
}
