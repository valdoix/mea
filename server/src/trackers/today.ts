import { z } from "zod";
import { all } from "../db/db";
import { chatNames } from "../memory/build";
import { cleanText } from "../memory/text";
import { lane, registerLane } from "../prompt/lanes";
import { countTokens } from "../lib/tokens";
import { enqueue, type JobContext } from "../services/jobs";
import { callJson } from "../services/llm";
import { currentFold, hasEvents, linesToOps, writeEvents } from "./store";
import type { Beat, WorldState } from "./types";

/**
 * TODAY SO FAR (docs/20 1.2): the story day in order, one beat per reply, each with its time and
 * place. Told only "Buffy promised to tell Dawn about the jealousy question", the planner set the
 * question at the faucet that morning; the day in order says it was asked in the car, before the
 * faucet. The writer, the planner and the checker read the same lines.
 */

const DAY = 1440;
/** How far back "today" reaches when the day has only just begun: last night still counts. */
const LOOKBACK = 18 * 60;
export const TODAY_TOKENS = 600;

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (m: number) => `${pad(Math.floor((((m % DAY) + DAY) % DAY) / 60))}:${pad(m % 60)}`;
/** The last two parts of a place: "Revello Drive › kitchen", "Sunnydale › Gabriel's car". */
const placeName = (p: string[]) => p.slice(-2).join(" › ");

/** The beats of the story's current day (and of the night before, early on), oldest first. */
export function todaysBeats(st: WorldState): Beat[] {
  const beats = st.beats ?? [];
  const now = st.time?.minutes;
  if (now == null) return beats.slice(-20);
  const from = Math.min(Math.floor(now / DAY) * DAY, now - LOOKBACK);
  // A beat before the clock was set, or on the other clock form, can't be placed in the day.
  return beats.filter((b) => b.minutes != null && b.form === st.time!.form && b.minutes >= from && b.minutes <= now);
}

export interface TodayLine {
  /** "B1", for the checker's citations. */
  ref: string;
  seq: number;
  text: string;
}

/**
 * The day as lines, within a budget: "13:10 · Sunnydale › Gabriel's car (#467): …". Over budget,
 * the oldest hours fold into one line each (the first words of each beat), then the oldest go.
 */
export function todayLines(st: WorldState, nameOf: (id: string) => string, budget = TODAY_TOKENS): TodayLine[] {
  const beats = todaysBeats(st);
  if (!beats.length) return [];
  const now = st.time?.minutes ?? null;
  const day = now == null ? null : Math.floor(now / DAY);
  const when = (b: Beat) => (b.minutes == null ? "" : `${day != null && Math.floor(b.minutes / DAY) < day ? "yesterday " : ""}${hhmm(b.minutes)}`);
  const head = (b: Beat, prev?: Beat) => {
    const place = placeName(b.place);
    const moved = !prev || placeName(prev.place) !== place;
    const who = moved && b.who.length ? `, with ${b.who.map(nameOf).join(", ")}` : "";
    return [when(b), moved && place ? `${place}${who}` : ""].filter(Boolean).join(" · ");
  };
  type Group = { beats: Beat[]; folded: boolean };
  const groups: Group[] = beats.map((b) => ({ beats: [b], folded: false }));
  const render = (g: Group, prev?: Beat) => {
    const first = g.beats[0]!;
    const last = g.beats.at(-1)!;
    const span = first.seq === last.seq ? `#${first.seq}` : `#${first.seq}–${last.seq}`;
    const text = g.folded ? g.beats.map((b) => b.text.split(/;\s*/)[0]!.split(/\s+/).slice(0, 10).join(" ")).join("; ") : first.text;
    return `${head(first, prev)} (${span}): ${text}`;
  };
  const lines = () => groups.map((g, i) => render(g, groups[i - 1]?.beats.at(-1)));
  const cost = () => countTokens(lines().join("\n"));
  // Fold the oldest hour that isn't folded yet, then drop the oldest line.
  while (groups.length > 1 && cost() > budget) {
    const i = groups.findIndex((g, k) => !g.folded && groups.slice(k + 1).some((h) => sameHour(h.beats[0]!, g.beats[0]!)));
    if (i >= 0) {
      const hour = groups.filter((g) => sameHour(g.beats[0]!, groups[i]!.beats[0]!));
      const merged: Group = { beats: hour.flatMap((g) => g.beats), folded: true };
      groups.splice(groups.indexOf(hour[0]!), hour.length, merged);
    } else groups.shift();
  }
  return lines().map((text, i) => ({ ref: `B${i + 1}`, seq: groups[i]!.beats[0]!.seq, text }));
}

const sameHour = (a: Beat, b: Beat) => a.minutes != null && b.minutes != null && Math.floor(a.minutes / 60) === Math.floor(b.minutes / 60);

/** The lane's text, or "" when the day has no beats yet. */
export function todayText(st: WorldState, nameOf: (id: string) => string, budget = TODAY_TOKENS) {
  const lines = todayLines(st, nameOf, budget);
  if (!lines.length) return "";
  return `What has happened today, in order (the record: retell it as it happened here, never as anyone guesses or misremembers it):\n${lines.map((l) => `- ${l.text}`).join("\n")}`;
}

/** A name for a beat's people: the player's character by the persona's name. */
export function beatNames(chatId: string, st: WorldState) {
  const names = chatNames(chatId);
  return (id: string) => (st.chars[id]?.isUser ? names.user : (st.chars[id]?.name ?? id));
}

// ---------- backfill ----------

/** Replies per backfill call, and how much of each it reads. */
const BACKFILL_BATCH = 30;
const BACKFILL_CHARS = 1400;

/**
 * Today's replies the trackers read before beats existed: they have tracker lines but no beat.
 * A reply the trackers haven't read yet is left out (its own update writes its beat).
 */
export function missingBeats(chatId: string) {
  const fold = currentFold(chatId);
  const st = fold.result.state;
  const now = st.time?.minutes;
  if (now == null) return [];
  const from = Math.min(Math.floor(now / DAY) * DAY, now - LOOKBACK);
  const have = new Set((st.beats ?? []).map((b) => b.seq));
  const rows = all<{ id: string; seq: number; active_swipe: number }>(
    "SELECT id, seq, active_swipe FROM messages WHERE chat_id = ? AND role = 'assistant' AND deleted_at IS NULL AND hidden = 0 ORDER BY seq",
    chatId,
  );
  return rows.filter((r) => {
    const t = fold.times[r.id];
    const at = t ? Number(t.split(":")[0]) : null;
    return at != null && at >= from && at <= now && !have.has(r.seq) && hasEvents(chatId, r.id, r.active_swipe);
  });
}

const backfillSchema = z.object({ beats: z.array(z.object({ seq: z.number(), text: z.string() })).default([]) });

const BACKFILL_SYSTEM = `You write the beats of a roleplay: one line per numbered reply, saying what happened in it and in the player's message before it, in order. At most 25 words, plain facts with the names: who did or said what, where it matters. A line said that matters goes in as said. Never how it read, never what comes next.
Reply with JSON only: {"beats":[{"seq":467,"text":"…"}]}`;

/** One call for up to 30 of today's replies without a beat; each beat goes on its reply as a tracker line. */
export async function backfillBeats(chatId: string, job?: JobContext) {
  const missing = missingBeats(chatId).slice(-BACKFILL_BATCH);
  if (!missing.length) return;
  const names = chatNames(chatId);
  const want = new Set(missing.map((m) => m.seq));
  const lo = missing[0]!.seq;
  const hi = missing.at(-1)!.seq;
  const msgs = all<{ seq: number; role: string; content: string }>(
    `SELECT m.seq, m.role, s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.hidden = 0 AND m.seq BETWEEN ? AND ? AND m.role IN ('user', 'assistant') ORDER BY m.seq`,
    chatId,
    lo - 1,
    hi,
  );
  const shown = msgs.map((m) => {
    const text = cleanText(m.content);
    const body = text.length <= BACKFILL_CHARS ? text : `${text.slice(0, 500).trimEnd()} […] ${text.slice(-(BACKFILL_CHARS - 500)).trimStart()}`;
    return m.role === "user" ? `${names.user}: ${body}` : `#${m.seq}${want.has(m.seq) ? "" : " (already has a beat)"} ${names.char}: ${body}`;
  });
  const r = await callJson({ task: "tracker", kind: "beats", chatId, jobId: job?.id ?? null, name: "beats", schema: backfillSchema, system: BACKFILL_SYSTEM, user: `Write a beat for each of: ${[...want].map((s) => `#${s}`).join(", ")}.\n\n${shown.join("\n\n")}`, maxTokens: 60 * missing.length + 200, temperature: 0.2 });
  for (const b of r.data.beats) {
    const m = missing.find((x) => x.seq === b.seq);
    const text = b.text.replace(/\s+/g, " ").trim();
    if (!m || !text) continue;
    writeEvents(chatId, { messageId: m.id, swipeIdx: m.active_swipe }, linesToOps([`beat: ${text}`]).ops, "model");
  }
}

/** After a tracker update: today's earlier replies with no beat get one (once; the job dedupes per chat). */
export function beatsAfterUpdate(chatId: string) {
  if (missingBeats(chatId).length >= 2) enqueue("tracker.beats", { chatId }, { dedupeKey: `tracker.beats:${chatId}`, priority: 7, chatId });
}

registerLane("today", (ctx) => {
  if (ctx.kind !== "story" && ctx.kind !== "continue") return null;
  const st = ctx.state;
  if (!st) return null;
  return lane("today", null, todayText(st, beatNames(ctx.chatId, st)), { depth: 1 });
});
