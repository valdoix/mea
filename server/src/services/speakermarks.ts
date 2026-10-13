import { z } from "zod";
import { one, parseJson } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { quotedLines, type RosterVoice, speakerFromLabel, type SpokenLine, TONES } from "../lib/speakers";
import { updateSwipe } from "./chats";
import { enqueue, type JobContext } from "./jobs";
import { callJson } from "./llm";
import { budgetMode } from "./quota";

/**
 * Speaker marks a reply forgot, filled in by the helper (lib/speakers.ts). The story model marks
 * who says each line; when a reply comes back with dialogue and no marks, the page would have to
 * guess from the prose and gets it wrong in crowded scenes. Here the helper reads the reply with
 * each line numbered and names the speakers, and they're saved as if the reply had marked them.
 */

const MAX_LINES = 120;

export function scheduleSpeakerMarks(chatId: string, messageId: string, swipeIdx: number, roster: RosterVoice[]) {
  enqueue("speakers.mark", { chatId, messageId, swipeIdx, roster }, { chatId, delayMs: 500, priority: 1, dedupeKey: `speakers.mark:${messageId}:${swipeIdx}` });
}

const schema = z.object({ lines: z.array(z.object({ n: z.coerce.number(), name: z.string() })) });

export async function runSpeakerMarksJob(p: { chatId: string; messageId: string; swipeIdx: number; roster: RosterVoice[] }, job?: JobContext) {
  const sw = one<{ content: string; meta: string }>("SELECT content, meta FROM swipes WHERE message_id = ? AND idx = ?", p.messageId, p.swipeIdx);
  if (!sw || parseJson<{ speakers?: unknown[] }>(sw.meta, {}).speakers?.length || budgetMode(p.chatId)) return;
  const quotes = quotedLines(sw.content).slice(0, MAX_LINES);
  if (!quotes.length) return;
  // The reply with each line numbered where it stands.
  let numbered = "";
  let at = 0;
  quotes.forEach((q, i) => {
    const k = sw.content.indexOf(q, at);
    numbered += `${sw.content.slice(at, k)}⟦${i + 1}⟧${q}`;
    at = k + q.length;
  });
  numbered += sw.content.slice(at);
  const before = one<{ content: string }>(
    `SELECT s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.seq < (SELECT seq FROM messages WHERE id = ?) ORDER BY m.seq DESC LIMIT 1`,
    p.chatId,
    p.messageId,
  )?.content;
  const r = await callJson({
    task: "helper",
    kind: "speakers",
    chatId: p.chatId,
    jobId: job?.id,
    name: "speaker_marks",
    schema,
    system: `You read a story passage and say who speaks each numbered line of dialogue (⟦1⟧"…", ⟦2⟧"…"). The speaker is the person whose dialogue tag ("she said", "Nat snaps") or action beat sits beside the line, or, in a back-and-forth, whose turn it is. A name called out or talked about inside a line is not its speaker. Words someone only remembers someone else saying are that other person's. Name each speaker exactly as in the cast list (Name#N); someone not in it, by the name the passage gives them; an unseen or truly uncertain speaker is "?". Reply with JSON only: {"lines":[{"n":1,"name":"Name#N"}]} covering every number.`,
    user: `CAST: ${p.roster.map((v) => `${v.name}#${v.slot}${v.aliases.length ? ` (also ${v.aliases.join(", ")})` : ""}`).join("; ")}\n\n${before ? `JUST BEFORE (for context):\n${before.slice(-1500)}\n\n` : ""}PASSAGE:\n${numbered}`,
    maxTokens: quotes.length * 24 + 200,
  });
  // The reply may have changed while the helper read it (an edit, a continue): then it's left alone.
  const now = one<{ content: string; meta: string }>("SELECT content, meta FROM swipes WHERE message_id = ? AND idx = ?", p.messageId, p.swipeIdx);
  if (!now || now.content !== sw.content || parseJson<{ speakers?: unknown[] }>(now.meta, {}).speakers?.length) return;
  const named = new Map(r.data.lines.map((l) => [l.n, l.name]));
  const speakers: SpokenLine[] = quotes.map((text, i) => ({ text, name: speakerFromLabel(named.get(i + 1) ?? "?", p.roster) }));
  if (!speakers.some((s) => s.name)) return;
  updateSwipe(p.messageId, p.swipeIdx, { meta: { speakers, speakersBy: "helper" } });
  publish({ type: "message.changed", chatId: p.chatId, messageId: p.messageId });
}

/**
 * Who says each line, as you set it by tapping a line on the page. The page sends every line with
 * its speaker as it reads them now, so lines you didn't touch keep their colour. Each line must
 * still stand in the text, in order; one that doesn't is dropped.
 */
export function setSpeakers(messageId: string, lines: SpokenLine[]) {
  const m = one<{ chat_id: string; active_swipe: number; deleted_at: string | null }>("SELECT chat_id, active_swipe, deleted_at FROM messages WHERE id = ?", messageId);
  if (!m || m.deleted_at) throw notFound("Message not found");
  const sw = one<{ content: string; status: string }>("SELECT content, status FROM swipes WHERE message_id = ? AND idx = ?", messageId, m.active_swipe);
  if (!sw) throw notFound("Message has no content");
  if (sw.status === "streaming") throw badRequest("Wait for the reply to finish first");
  const speakers: SpokenLine[] = [];
  let at = 0;
  for (const l of lines) {
    const i = sw.content.indexOf(l.text, at);
    if (!l.text || i < 0) continue;
    speakers.push({ text: l.text, name: l.name?.trim() || null, ...(l.tone && (TONES as readonly string[]).includes(l.tone) ? { tone: l.tone } : {}) });
    at = i + l.text.length;
  }
  updateSwipe(messageId, m.active_swipe, { meta: { speakers, speakersBy: "you" } });
  publish({ type: "message.changed", chatId: m.chat_id, messageId });
}
