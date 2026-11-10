import { z } from "zod";
import { one } from "../db/db";
import { badRequest } from "../lib/http";
import { chatNames } from "../memory/build";
import { hashText } from "../memory/text";
import { lensOf, summaryText } from "../memory/openlist";
import { levelRows, memState, setMemState, storyRow } from "../memory/store";
import type { CardData } from "../cards/card";
import { getCard } from "../services/characters";
import { publish } from "../lib/events";
import { getChatRow } from "../services/chats";
import { enqueue, type JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { shouldShed } from "../services/quota";
import { currentFold, writeEvents } from "../trackers/store";
import type { Op } from "../trackers/types";
import { factsNow } from "./facts";
import { sinceCardEntry } from "./sincecard";

/**
 * docs/33 Part 1: the brief ages with the story. A card's last word (its post-history
 * instructions) and the wants, fears and tells it starts the character with are written for the
 * opening. "Show her tells: rubbing her raw wrist… no more than one crack per exchange" is right on
 * the night she claws out of the grave and wrong six story days and a romance later, and it was
 * still sent with every reply. The card is never edited (it's shared by every chat that plays it);
 * each chat keeps the brief as it stands now:
 *
 * - every line of the card's instructions is kept, revised or retired, with why;
 * - the starting want, fear and tell are replaced on the trackers when the story has moved on;
 * - looks that were the opening's condition ("pale", "hoarse from disuse") are dropped.
 *
 * A helper reads it once per chapter. A line you pin stays as the card wrote it.
 */

export interface BriefLine {
  /** The card's line. */
  orig: string;
  status: "kept" | "revised" | "retired";
  /** The line as it stands now (for "revised"). */
  now?: string;
  why?: string;
  /** You pinned it: it stays as the card wrote it, whatever the reading says. */
  pinned?: boolean;
}

export interface Brief {
  lines: BriefLine[];
  /** The last message the brief read up to. */
  seq: number;
  at: number;
  /** The card instructions it was read from: a changed card is read afresh. */
  cardHash: string;
  /** What else changed when it was read, for the panel. */
  drive?: { want?: string; fear?: string; tell?: string };
  traitsGone?: string[];
}

/** Read again after this many messages, at a chapter's end. */
export const BRIEF_EVERY = 40;

/** The card's instructions as lines ({{original}} is where the preset's own goes, not a line). */
export function instructionLines(phi: string): string[] {
  return phi
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\{\{original\}\}$/i.test(l));
}

export function briefOf(chatId: string): Brief | null {
  return memState(chatId).brief ?? null;
}

function saveBrief(chatId: string, brief: Brief) {
  setMemState(chatId, { brief });
  publish({ type: "chat.changed", chatId });
}

/**
 * The card as this chat should send it: its instructions with retired lines left out and revised
 * ones in their new words. A brief read from another version of the instructions is ignored.
 */
export function briefCard(chatId: string, card: CardData): CardData {
  const brief = briefOf(chatId);
  const phi = card.post_history_instructions ?? "";
  if (!brief || !phi.trim() || brief.cardHash !== hashText(phi)) return card;
  const byLine = new Map(brief.lines.map((l) => [l.orig, l]));
  const out: string[] = [];
  for (const raw of phi.split(/\n/)) {
    const l = byLine.get(raw.trim());
    if (!l || l.pinned || l.status === "kept") out.push(raw);
    else if (l.status === "revised" && l.now?.trim()) out.push(l.now.trim());
  }
  return { ...card, post_history_instructions: out.join("\n").replace(/\n{3,}/g, "\n\n") };
}

const lastSeq = (chatId: string) => one<{ s: number | null }>("SELECT MAX(seq) AS s FROM messages WHERE chat_id = ? AND deleted_at IS NULL", chatId)?.s ?? 0;

/** After a chapter closes: read the brief again if the story has gone far enough since. */
export function briefAfterChapter(chatId: string) {
  const chat = getChatRow(chatId);
  if (!chat?.character_id) return;
  const card = getCard(chat.character_id);
  if (!card) return;
  const b = briefOf(chatId);
  const fresh = !b || b.cardHash !== hashText(card?.post_history_instructions ?? "");
  if (fresh || lastSeq(chatId) - b.seq >= BRIEF_EVERY) enqueue("lore.brief", { chatId }, { dedupeKey: `lore.brief:${chatId}`, delayMs: 10_000, priority: 0, chatId, maxAttempts: 2 });
}

const readingSchema = z.object({
  lines: z.array(z.object({ i: z.number(), status: z.enum(["kept", "revised", "retired"]), now: z.string().default(""), why: z.string().default("") })).default([]),
  want: z.string().default(""),
  fear: z.string().default(""),
  tell: z.string().default(""),
  traitsGone: z.array(z.string()).default([]),
});

export async function runBriefJob(p: { chatId: string }, job?: JobContext) {
  const chat = getChatRow(p.chatId);
  if (!chat?.character_id || shouldShed("lessons", p.chatId)) return;
  const card = getCard(chat.character_id);
  if (!card) return;
  const names = chatNames(p.chatId);
  const old = briefOf(p.chatId);
  const phi = card.post_history_instructions ?? "";
  const lines = instructionLines(phi);
  let st;
  try {
    st = currentFold(p.chatId).result.state;
  } catch {
    st = null;
  }
  const me = st ? Object.values(st.chars).find((c) => !c.isUser && c.name.split(" ")[0]?.toLowerCase() === card.name.split(" ")[0]?.toLowerCase()) : undefined;
  const fromCard = me?.traits.filter((t) => t.by === "card").map((t) => t.text) ?? [];
  if (!lines.length && !me) return;
  const entry = sinceCardEntry(p.chatId, "character", false);
  const since = entry ? factsNow(entry, p.chatId).map((f) => `- ${f.value}`) : [];
  const lens = lensOf(p.chatId, st);
  const chapters = levelRows(p.chatId, "chapter")
    .filter((c) => c.state === "ready")
    .slice(-3)
    .map((c) => `${c.title}: ${summaryText(c, lens).slice(0, 900)}`);
  const storyR = storyRow(p.chatId);
  const story = storyR ? summaryText(storyR, lens).slice(0, 1500) : "";
  const user = [
    `CARD INSTRUCTIONS (numbered):\n${lines.map((l, i) => `${i}. ${l}`).join("\n") || "(none)"}`,
    me ? `HOW THE CARD STARTS ${me.name.toUpperCase()}:\nwant: ${me.drives.want ?? ""}\nfear: ${me.drives.fear ?? ""}\ntell: ${me.mask?.tell ?? ""}\nlooks: ${fromCard.join("; ")}` : "",
    since.length ? `WHO ${names.char.toUpperCase()} IS NOW (the story's own record):\n${since.join("\n")}` : "",
    story ? `THE STORY SO FAR:\n${story}` : "",
    chapters.length ? `LATEST CHAPTERS:\n${chapters.join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const r = await callJson({
    task: "helper",
    kind: "brief",
    chatId: p.chatId,
    jobId: job?.id,
    name: "brief_reading",
    schema: readingSchema,
    system: `A character card was written for the opening of a story; the story has gone on since. Read each numbered card instruction against who ${names.char} is now, and say for each: "kept" (still right), "revised" (still useful, but in its words for now: give the new line, same length or shorter, same style), or "retired" (true only of the opening; following it now would drag ${names.char} back there). Keep what is about voice, style and limits unless the story has plainly changed it; revise or retire what was about a state the story has moved past. Never add new instructions. Then the starting want, fear and tell: give a new one only where the story has moved past the card's, else "". And list the card's looks that were only the opening's condition (a wound, a pallor, a hoarse voice) and no longer hold, word for word as given; leave lasting looks out. Reply with JSON: {"lines":[{"i":0,"status":"kept","now":"","why":"a few words"}],"want":"","fear":"","tell":"","traitsGone":[]}.`,
    user,
    maxTokens: 1500,
  });
  job?.note({ inputTokens: r.inputTokens });
  const pinned = new Set((old?.lines ?? []).filter((l) => l.pinned).map((l) => l.orig));
  const got = new Map(r.data.lines.map((l) => [l.i, l]));
  const brief: Brief = {
    lines: lines.map((orig, i) => {
      const g = got.get(i);
      const status = g?.status === "revised" && !g.now.trim() ? "kept" : (g?.status ?? "kept");
      return { orig, status, ...(status === "revised" ? { now: g!.now.trim() } : {}), ...(g?.why ? { why: g.why } : {}), ...(pinned.has(orig) ? { pinned: true } : {}) };
    }),
    seq: lastSeq(p.chatId),
    at: Date.now(),
    cardHash: hashText(phi),
  };
  // The trackers carry the want, fear, tell and looks, so the change is made there, after the last message.
  if (me) {
    const ops: Op[] = [];
    const drive = [r.data.want && `want: ${r.data.want}`, r.data.fear && `fear: ${r.data.fear}`].filter(Boolean);
    if (drive.length) ops.push({ op: "drive", subject: me.name, args: { ...(r.data.want ? { want: r.data.want } : {}), ...(r.data.fear ? { fear: r.data.fear } : {}) }, raw: `drive ${me.name}: ${drive.join("; ")}` });
    if (r.data.tell) ops.push({ op: "mask", subject: me.name, args: { tell: r.data.tell }, raw: `mask ${me.name}: tell: ${r.data.tell}` });
    const gone = r.data.traitsGone.filter((t) => fromCard.some((c) => c.toLowerCase() === t.trim().toLowerCase()));
    if (gone.length) ops.push({ op: "trait", subject: me.name, args: { list: gone.map((g) => `-${g.trim()}`) }, raw: `trait ${me.name}: ${gone.map((g) => `-${g.trim()}`).join("; ")}` });
    const last = one<{ id: string; active_swipe: number }>("SELECT id, active_swipe FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1", p.chatId);
    if (ops.length && last) writeEvents(p.chatId, { messageId: last.id, swipeIdx: last.active_swipe }, ops, "memory");
    brief.drive = { ...(r.data.want ? { want: r.data.want } : {}), ...(r.data.fear ? { fear: r.data.fear } : {}), ...(r.data.tell ? { tell: r.data.tell } : {}) };
    if (gone.length) brief.traitsGone = gone;
  }
  saveBrief(p.chatId, brief);
}

/** Pin a line (it stays as the card wrote it) or unpin it. */
export function pinBriefLine(chatId: string, orig: string, pinned: boolean): Brief {
  const b = briefOf(chatId);
  const l = b?.lines.find((x) => x.orig === orig);
  if (!b || !l) throw badRequest("No such line in this story's brief");
  l.pinned = pinned || undefined;
  saveBrief(chatId, b);
  return b;
}
