import { z } from "zod";
import { one, parseJson } from "../db/db";
import { badRequest, notFound } from "../lib/http";
import { cleanText } from "../memory/text";
import { editMessage, getMessageRow } from "../services/chats";
import { callJson } from "../services/llm";
import { dismissIssue, type FlagRow, type Issue } from "./checker";

/**
 * Fix one sentence (Almanac plan B1's "Reword this sentence", D1's "Fix this sentence"): the
 * helper rewrites only the sentence a finding quotes, following its fix, and every other word of
 * the reply stays as it was. The edit goes through the usual edit (history kept, memory notified).
 */

const sentences = (t: string) => t.match(/[^.!?…\n]+(?:[.!?…]+["”')\]*]*)?/g) ?? [];

/** The sentence of `text` the finding's claim comes from (claims can be clipped or cleaned). */
export function locateSentence(text: string, claim: string): { start: number; end: number; sentence: string } | null {
  const want = cleanText(claim).replace(/\s+/g, " ").trim().slice(0, 80);
  if (!want) return null;
  let at = 0;
  for (const s of sentences(text)) {
    const start = text.indexOf(s, at);
    at = start + s.length;
    const flat = cleanText(s).replace(/\s+/g, " ").trim();
    if (flat && (flat.includes(want) || want.includes(flat.slice(0, 80)))) {
      // Leading whitespace isn't part of the sentence.
      const lead = s.length - s.trimStart().length;
      return { start: start + lead, end: start + s.trimEnd().length, sentence: s.trim() };
    }
  }
  return null;
}

const schema = z.object({ sentence: z.string() });

export async function rewriteSentence(o: { chatId: string; text: string; sentence: string; instruction: string }) {
  const r = await callJson({
    task: "helper",
    kind: "fix",
    chatId: o.chatId,
    name: "fix_sentence",
    schema,
    system: `You correct one sentence of a roleplay reply. Rewrite only that sentence so it follows the instruction, in the same voice, tense and point of view, keeping it about as long and keeping whatever in it doesn't need to change. Reply with JSON only: {"sentence": "…"}`,
    user: `THE REPLY (for context; don't rewrite it):\n${cleanText(o.text).slice(0, 4000)}\n\nTHE SENTENCE:\n${o.sentence}\n\nINSTRUCTION: ${o.instruction}`,
    maxTokens: 300,
  });
  const out = r.data.sentence.trim();
  if (!out) throw badRequest("The helper didn't write a sentence; try again");
  return out;
}

/** Fixes the sentence one finding quotes, in the reply it was found in, and marks the finding done. */
export async function fixIssueSentence(flagId: string, issueId: string) {
  const f = one<FlagRow>("SELECT * FROM continuity_flags WHERE id = ?", flagId);
  if (!f) throw notFound("Check not found");
  const issue = parseJson<Issue[]>(f.issues, []).find((i) => i.id === issueId);
  if (!issue) throw notFound("Issue not found");
  const m = getMessageRow(f.message_id);
  if (!m || m.deleted_at) throw notFound("Message not found");
  if (m.active_swipe !== f.swipe_idx) throw badRequest("Show that version of the reply first");
  const sw = one<{ content: string; status: string }>("SELECT content, status FROM swipes WHERE message_id = ? AND idx = ?", m.id, m.active_swipe);
  if (!sw || sw.status === "streaming") throw badRequest("Wait for the reply to finish");
  const at = locateSentence(sw.content, issue.claim);
  if (!at) throw badRequest("Couldn't find that sentence in the reply any more");
  const fixed = await rewriteSentence({ chatId: f.chat_id, text: sw.content, sentence: at.sentence, instruction: issue.fix });
  const text = sw.content.slice(0, at.start) + fixed + sw.content.slice(at.end);
  editMessage(m.id, text);
  return { flag: dismissIssue(flagId, issueId), before: at.sentence, after: fixed };
}
