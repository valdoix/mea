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

/** Sentence spans of `text`, cut where rules.ts's `sentences` cuts: end marks then a space, or a line break. */
function sentenceSpans(text: string) {
  const spans: { start: number; end: number }[] = [];
  let start = 0;
  for (const m of text.matchAll(/(?<=[.!?…]["”'’)\]*_]*)[ \t]+|\n+/g)) {
    spans.push({ start, end: m.index! });
    start = m.index! + m[0].length;
  }
  spans.push({ start, end: text.length });
  return spans.filter((s) => text.slice(s.start, s.end).trim());
}

// Single and double quotes fold together: the checker often retypes “My love.” as 'My love.'.
const FOLD: Record<string, string> = { "“": '"', "”": '"', "„": '"', "«": '"', "»": '"', "‘": '"', "’": '"', "'": '"', "—": "-", "–": "-" };

/**
 * `text` folded for matching (no markup or markdown marks, one plain quote mark, plain dashes, "..." as "…",
 * one space, lower case), with `at[i]` the index in `text` that folded character i came from.
 */
function fold(text: string) {
  let out = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text[i]!;
    if (c === "<") {
      const close = text.indexOf(">", i);
      if (close > i && /^<\/?[a-z]/i.test(text.slice(i, i + 3))) {
        i = close;
        c = " ";
      }
    }
    if (c === "*" || c === "_" || c === "~" || c === "`") continue;
    if (c === "." && text.startsWith("...", i)) {
      c = "…";
      i += 2;
    }
    c = FOLD[c] ?? c;
    if (/\s/.test(c)) {
      if (!out || out.endsWith(" ")) continue;
      c = " ";
    }
    out += c.toLowerCase();
    at.push(i);
  }
  return { out, at };
}

/** The sentence(s) of `text` the finding's claim comes from (claims can be clipped, cleaned or retyped). */
export function locateSentence(text: string, claim: string): { start: number; end: number; sentence: string } | null {
  const want = fold(cleanText(claim)).out.replace(/^[\s"…-]+|[\s"…]+$/g, "");
  if (!want) return null;
  const hay = fold(text);
  let from = -1;
  let to = -1;
  // The claim as quoted, else the longest piece of it a clipping "…" left whole.
  for (const piece of [want, ...want.split(/…|\s-\s/).map((p) => p.trim()).filter((p) => p.length >= 12).sort((a, b) => b.length - a.length)]) {
    const i = hay.out.indexOf(piece);
    if (i >= 0) {
      from = hay.at[i]!;
      to = hay.at[i + piece.length - 1]! + 1;
      break;
    }
  }
  const spans = sentenceSpans(text);
  if (from < 0) {
    // Retyped: the run of sentences holding most of the claim's words, if that's most of them
    // (the shortest run on a tie, so a one-sentence claim still lands on one sentence).
    const words = (s: string) => new Set(s.match(/[\p{L}\p{N}]+/gu) ?? []);
    const need = words(want);
    if (need.size < 3) return null;
    const own = spans.map((s) => words(fold(text.slice(s.start, s.end)).out));
    let best = 0;
    let runs = Infinity;
    for (let i = 0; i < spans.length; i++) {
      const have = new Set<string>();
      let size = 0;
      for (let j = i; j < spans.length && size < need.size * 2 + 10; j++) {
        for (const w of own[j]!) have.add(w);
        size += own[j]!.size;
        const share = [...need].filter((w) => have.has(w)).length / need.size;
        if (share > best || (share === best && j - i < runs)) [best, runs, from, to] = [share, j - i, spans[i]!.start, spans[j]!.end];
      }
    }
    if (best < 0.7) return null;
  }
  const first = spans.find((s) => s.end > from);
  const last = [...spans].reverse().find((s) => s.start < to);
  if (!first || !last) return null;
  // Whitespace at either end isn't part of the sentence.
  const raw = text.slice(first.start, last.end);
  const start = first.start + (raw.length - raw.trimStart().length);
  const end = last.end - (raw.length - raw.trimEnd().length);
  return { start, end, sentence: text.slice(start, end) };
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
    user: `THE REPLY (for context; don't rewrite it):\n${cleanText(o.text)}\n\nTHE SENTENCE:\n${o.sentence}\n\nINSTRUCTION: ${o.instruction}`,
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
