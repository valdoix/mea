import { all, parseJson } from "../db/db";
import { type ChatSettings, mustChat } from "../services/chats";
import type { Citation, Issue } from "./checker";

/**
 * docs/22 4.2: a kind of flag you keep waving off stops interrupting, and stays in Story health with
 * the reason. A flag nobody trusts hides the one that matters.
 *
 * Worked out from the flags themselves, with one thing stored: when you asked to see a kind again.
 * What counts is a flag waved off with the reply left as it was. `dismissed` alone would say 96% of
 * Filed Under Stay's `fact` flags were waved off, when 103 of those 110 were on a reply you then
 * edited or had their canon accepted: they were the flags working.
 */

/** Fewer flags than this say nothing about a kind. */
const QUIET_AFTER = 20;
/** More than this share waved off, and the kind goes quiet. */
const QUIET_SHARE = 0.8;
/** How many of a quiet kind's flags Story health lists. */
const WAITING = 3;

type Flagged = Pick<Issue, "kind" | "by"> & { citations?: Pick<Citation, "ref" | "type">[] };

/** A citation of what's finished: `undone`'s loop, or a D line of the checker's fact sheet. */
const closedRef = (c: Pick<Citation, "ref" | "type">) => c.type === "tracker" && (c.ref === "L" || /^D\d+$/.test(c.ref));
/** The flag cites a closed record, so the story's older words can't settle it and a guess's record doesn't speak for it. */
export const citesClosed = (i: Flagged) => Boolean(i.citations?.some(closedRef));

export type FlagSource = "record" | "rules" | "model";
const sourceOf = (i: Flagged): FlagSource => (citesClosed(i) ? "record" : i.by);
/** What's measured together: rules that cite a closed record are measured apart from the model's guesses. */
export const flagKey = (i: Flagged) => `${i.kind}:${sourceOf(i)}`;

export interface FlagKind {
  key: string;
  kind: string;
  source: FlagSource;
  /** Flags that were showing, since you last asked to see this kind. */
  flags: number;
  waved: number;
  quiet: boolean;
  reason?: string;
  /** The newest of this kind not showing because it's quiet. */
  waiting: { messageId: string; seq: number; claim: string }[];
  /** How many there are. */
  waitingCount: number;
}

interface Row {
  issues: string;
  created_at: number;
  message_id: string;
  seq: number;
  showing: number;
  edited: number;
}

/**
 * Every kind on a chat, oldest flag first. Once a kind goes quiet its count stops: a flag nobody sees
 * can't be waved off, and counting those would bring the kind back on its own. Asking to see it again
 * starts the count over.
 */
export function flagKinds(chatId: string): FlagKind[] {
  const back = parseJson<ChatSettings>(mustChat(chatId).settings, {}).flagsBack ?? {};
  const rows = all<Row>(
    `SELECT f.issues, f.created_at, m.id AS message_id, m.seq, m.active_swipe = f.swipe_idx AS showing,
       EXISTS (SELECT 1 FROM swipe_edits e JOIN swipes s ON s.id = e.swipe_id WHERE s.message_id = m.id AND s.idx = f.swipe_idx) AS edited
     FROM continuity_flags f JOIN messages m ON m.id = f.message_id WHERE f.chat_id = ? AND m.deleted_at IS NULL ORDER BY f.created_at, f.rowid`,
    chatId,
  );
  if (!rows.length) return [];
  const accepted = new Set(all<{ content: string }>("SELECT content FROM memories WHERE chat_id = ? AND user_edited = 1 AND deleted_at IS NULL", chatId).map((m) => m.content));
  const kinds = new Map<string, FlagKind>();
  for (const r of rows)
    for (const i of parseJson<Issue[]>(r.issues, [])) {
      const key = flagKey(i);
      let k = kinds.get(key);
      if (!k) kinds.set(key, (k = { key, kind: i.kind, source: sourceOf(i), flags: 0, waved: 0, quiet: false, waiting: [], waitingCount: 0 }));
      if (r.created_at < (back[key] ?? 0)) continue;
      if (k.quiet) continue;
      k.flags++;
      if (i.dismissed && !i.settled && !r.edited && !(i.canon?.memory && accepted.has(i.canon.memory))) k.waved++;
      if (k.flags >= QUIET_AFTER && k.waved / k.flags > QUIET_SHARE) {
        k.quiet = true;
        k.reason = `You waved off ${k.waved} of ${k.flags} with the reply left as it was, so these stopped showing on replies.`;
      }
    }
  // Quiet covers its open flags from any time: the ones already on old replies are the same kind.
  for (const r of rows) {
    if (!r.showing) continue;
    for (const i of parseJson<Issue[]>(r.issues, [])) {
      const k = kinds.get(flagKey(i));
      if (!k?.quiet || i.dismissed) continue;
      k.waitingCount++;
      k.waiting.unshift({ messageId: r.message_id, seq: r.seq, claim: i.claim });
    }
  }
  for (const k of kinds.values()) k.waiting = k.waiting.slice(0, WAITING);
  return [...kinds.values()];
}

export const quietKeys = (chatId: string) => new Set(flagKinds(chatId).filter((k) => k.quiet).map((k) => k.key));

/**
 * What you've waved through: someone lying, misremembering, or a thing that really does come round
 * again. A loop's id, or the wording of a line with no id. Rewriting the sentence isn't waving it through.
 */
export function wavedThrough(chatId: string) {
  const out = new Set<string>();
  for (const r of all<{ issues: string }>("SELECT issues FROM continuity_flags WHERE chat_id = ? AND issues LIKE '%\"dismissed\":true%'", chatId))
    for (const i of parseJson<Issue[]>(r.issues, [])) if (i.dismissed && i.settled !== "fixed") for (const c of i.citations ?? []) if (closedRef(c)) out.add(c.id ?? c.label);
  return out;
}
