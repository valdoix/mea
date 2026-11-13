import { all, newId, now, one, parseJson, run } from "../db/db";
import type { Moment } from "./words";

/**
 * The play log (docs/34, 1.1): every song the soundtrack started, why, what else was close, and how
 * it ended. Written when a song starts and closed when the next one starts or you stop it, so the
 * picker can be judged on what it really did, not on what it would prefer.
 */

/** How a song came to play: the first song, a big moment's cut, the next song as one ended, or your hand. */
export type PlayHow = "start" | "big" | "next" | "skip" | "notFor" | "down";
/** How it ended: played out, skipped, Not for this scene, 👎, cut by a big moment, soundtrack off, or replaced some other way. */
export type PlayEnding = "played" | "skipped" | "notFor" | "down" | "cut" | "off" | "replaced";
/** 👍, 👎, and the answers to "Not for this scene" (docs/34, 5.2): wrong words, wrong sound, too much, just not now. */
export type PlayMark = "up" | "down" | "wrongWords" | "wrongSound" | "tooMuch" | "notNow";

/** What a pick's score was made of. */
export interface PlayParts {
  mood: number;
  words: number;
  motif: number;
  votes: number;
  preferred: number;
  /** docs/34 3.1: a sexual song with a child in the scene, far down the list. */
  heat?: number;
  /** docs/34 4.2: the whole song's card against the scene brief. */
  fit?: number;
  /** docs/34 4.3: where the judge put it (1-3), or 0 when it said nothing fits. */
  judge?: number;
}
export interface Runner {
  videoId: string;
  title: string;
  artist: string;
  score: number;
  why: string;
}
/** The cue as the log keeps it (what the picker saw). */
export interface PlayCue {
  moods: string[];
  intensity: number;
  place: string;
  present: string[];
  genre: string | null;
  key: string;
}

export interface PlayRow {
  id: string;
  chatId: string;
  messageId: string | null;
  videoId: string;
  title: string;
  artist: string;
  startedAt: number;
  how: PlayHow;
  why: string;
  cue: PlayCue | null;
  moment: Moment | null;
  score: number | null;
  parts: PlayParts | null;
  runners: Runner[];
  landed: number | null;
  endedAt: number | null;
  ending: PlayEnding | null;
  /** Seconds of the song heard before it ended. */
  heard: number | null;
  marks: PlayMark[];
}

interface Raw {
  id: string;
  chat_id: string;
  message_id: string | null;
  video_id: string;
  title: string;
  artist: string;
  started_at: number;
  how: string;
  why: string;
  cue: string;
  moment: string | null;
  score: number | null;
  parts: string | null;
  runners: string;
  landed: number | null;
  ended_at: number | null;
  ending: string | null;
  heard: number | null;
  marks: string;
}

const fromRaw = (r: Raw): PlayRow => ({
  id: r.id,
  chatId: r.chat_id,
  messageId: r.message_id,
  videoId: r.video_id,
  title: r.title,
  artist: r.artist,
  startedAt: r.started_at,
  how: r.how as PlayHow,
  why: r.why,
  cue: parseJson<PlayCue | null>(r.cue, null),
  moment: parseJson<Moment | null>(r.moment, null),
  score: r.score,
  parts: parseJson<PlayParts | null>(r.parts, null),
  runners: parseJson<Runner[]>(r.runners, []),
  landed: r.landed,
  endedAt: r.ended_at,
  ending: r.ending as PlayEnding | null,
  heard: r.heard,
  marks: parseJson<PlayMark[]>(r.marks, []),
});

const openRow = (chatId: string) => one<Raw>("SELECT * FROM song_plays WHERE chat_id = ? AND ended_at IS NULL ORDER BY started_at DESC, rowid DESC LIMIT 1", chatId);

/**
 * Ends the song playing in this chat's log, if any. `heard` is the player's own count when Mea
 * has it; otherwise the time since it started (plus where it was landed), which counts pauses too.
 */
export function closePlay(chatId: string, ending: PlayEnding, heard?: number | null) {
  const r = openRow(chatId);
  if (!r) return;
  const at = now();
  const secs = heard ?? (at - r.started_at) / 1000 + (r.landed ?? 0);
  run("UPDATE song_plays SET ended_at = ?, ending = ?, heard = ? WHERE id = ?", at, ending, Math.max(0, Math.round(secs * 10) / 10), r.id);
}

/** Starts a song in the log, ending the one before it as `ending`. */
export function openPlay(p: {
  chatId: string;
  messageId?: string | null;
  videoId: string;
  title: string;
  artist: string;
  how: PlayHow;
  why: string;
  cue?: PlayCue | null;
  moment?: Moment | null;
  score?: number | null;
  parts?: PlayParts | null;
  runners?: Runner[];
  landed?: number | null;
  ending?: PlayEnding;
  heard?: number | null;
}) {
  closePlay(p.chatId, p.ending ?? "replaced", p.heard);
  const id = newId();
  run(
    `INSERT INTO song_plays (id, chat_id, message_id, video_id, title, artist, started_at, how, why, cue, moment, score, parts, runners, landed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    p.chatId,
    p.messageId ?? null,
    p.videoId,
    p.title,
    p.artist,
    now(),
    p.how,
    p.why,
    JSON.stringify(p.cue ?? null),
    p.moment ? JSON.stringify(p.moment) : null,
    p.score ?? null,
    p.parts ? JSON.stringify(p.parts) : null,
    JSON.stringify((p.runners ?? []).slice(0, 5)),
    p.landed ?? null,
  );
  return id;
}

/** A 👍, 👎 or Wrong words on the song playing now, kept on its row. */
export function markPlay(chatId: string, mark: PlayMark) {
  const r = openRow(chatId);
  if (!r) return;
  const marks = parseJson<PlayMark[]>(r.marks, []);
  if (!marks.includes(mark)) run("UPDATE song_plays SET marks = ? WHERE id = ?", JSON.stringify([...marks, mark]), r.id);
}

/** The latest songs played in this story, newest first. */
export function playHistory(chatId: string, limit = 20): PlayRow[] {
  return all<Raw>("SELECT * FROM song_plays WHERE chat_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?", chatId, Math.max(1, Math.min(200, limit))).map(fromRaw);
}

/** Every logged play, oldest first (the replay bench). */
export function allPlays(): PlayRow[] {
  return all<Raw>("SELECT * FROM song_plays ORDER BY started_at, rowid").map(fromRaw);
}
