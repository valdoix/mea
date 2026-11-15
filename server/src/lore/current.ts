import { all } from "../db/db";
import type { ScanEntry } from "./activate";
import { isCurrent } from "./format";

/**
 * "Current" lore is how things stand when the story opens (a raid under way, who is hiding where,
 * what people wrongly believe). It used to go into every prompt forever: at message 982 of Buffy ×
 * Gabriel the writer was still told "the Hellions are raiding Sunnydale" and "Buffy is digging her
 * way out of her own coffin", and the corrections block then spent words saying they were old.
 *
 * Once the story is well past its opening, a Current entry stays only while the story keeps it up
 * to date: a "Now:" fact the keep-up wrote for it in this chat in the last stretch of messages.
 */
export const OPENING_MESSAGES = 60;
export const KEPT_UP_WITHIN = 60;

export function pastCurrent(chatId: string, entries: ScanEntry[], messageCount: number): Map<string, string> {
  const out = new Map<string, string>();
  if (messageCount <= OPENING_MESSAGES) return out;
  const current = entries.filter((e) => isCurrent(e));
  if (!current.length) return out;
  const latest = new Map(
    all<{ entry_id: string; seq: number | null }>(
      `SELECT entry_id, MAX(since_seq) AS seq FROM lore_facts WHERE chat_id = ? AND deleted_at IS NULL AND status = 'active' AND entry_id IN (${current.map(() => "?").join(",")}) GROUP BY entry_id`,
      chatId,
      ...current.map((e) => e.id),
    ).map((r) => [r.entry_id, r.seq]),
  );
  for (const e of current) {
    const seq = latest.get(e.id);
    if (seq != null && messageCount - seq <= KEPT_UP_WITHIN) continue;
    out.set(e.id, seq != null ? `last brought up to date at #${seq}` : "true at the opening");
  }
  return out;
}

/** Machine-written Chronicle entries this short say nothing ("stairs", "Winters table — also called Winters table"). */
export const STUB_CHARS = 60;
export function isStub(e: ScanEntry): boolean {
  return Boolean(e.book.chronicleFor) && (e.content ?? "").trim().length < STUB_CHARS;
}
