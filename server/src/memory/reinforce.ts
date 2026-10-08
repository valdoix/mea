import { all, parseJson, run, tx } from "../db/db";
import type { AtomRow } from "./atoms";
import { norm } from "./entities";
import { contentWords } from "./text";

/**
 * Reinforcement (MEM-19): after a reply, the memories it was given count as recalled, and the
 * ones it actually drew on count as used. Used memories rise in later rankings; trivia that is
 * never used fades (recall.ts), but nothing is ever deleted.
 */

/** Words that show up in any story and prove nothing on their own. */
const COMMON = new Set(
  "look looked looks smile smiled eyes hand hands voice room door back away again something nothing everything someone thing things moment little long time softly quietly slowly really right left feel felt know knew think thought want wanted make made take took come came going went tell told asks asked turn turned head face around towards toward".split(" "),
);

/** Did the reply draw on this memory? Shared rare words, numbers and multi-word names. */
export function referenced(memory: string, entities: string[], reply: string) {
  const replyWords = contentWords(reply, 4);
  const replyNorm = ` ${norm(reply)} `;
  const words = [...contentWords(memory, 4)].filter((w) => !COMMON.has(w));
  if (!words.length) return false;
  let hits = 0;
  for (const w of words) if (replyWords.has(w)) hits += /\d/.test(w) ? 2 : 1;
  // A multi-word name or a number from the memory, word for word, is strong evidence.
  const exact = entities.filter((e) => norm(e).includes(" ") && replyNorm.includes(` ${norm(e)} `)).length;
  const numbers = (memory.match(/\b\d[\d,.:]*\b/g) ?? []).filter((n) => reply.includes(n)).length;
  const need = Math.max(2, Math.ceil(words.length * 0.4));
  return hits + exact * 2 + numbers * 2 >= Math.min(need, 4);
}

/** Records what a reply was given and what it used. Returns the ids it used. */
export function reinforce(chatId: string, generationId: string, reply: string, seq: number) {
  const ids = all<{ owner_id: string }>("SELECT owner_id FROM memory_usage WHERE generation_id = ? AND owner_type = 'memory'", generationId).map((r) => r.owner_id);
  if (!ids.length || !reply.trim()) return [] as string[];
  const rows = all<AtomRow>(`SELECT * FROM memories WHERE id IN (${ids.map(() => "?").join(",")}) AND chat_id = ?`, ...ids, chatId);
  const used: string[] = [];
  tx(() => {
    for (const a of rows) {
      const hit = referenced(a.content, parseJson<string[]>(a.entities, []), reply);
      if (hit) used.push(a.id);
      run(
        `UPDATE memories SET recall_count = recall_count + 1, last_recalled_seq = ?${hit ? ", ref_count = ref_count + 1, last_ref_seq = ?" : ""} WHERE id = ?`,
        ...(hit ? [seq, seq, a.id] : [seq, a.id]),
      );
    }
  });
  return used;
}
