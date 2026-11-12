import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "../config";
import { type ChatMusic, type Cue, type InRoll, type Mood, MOODS, type MusicConfig, rankTracks, themesFor, wordsContext } from "./director";
import type { PlayRow } from "./plays";
import { situationsOf } from "./situations";
import type { Moment } from "./words";

/**
 * The replay bench (docs/34, 1.3-1.4): scenes the soundtrack has read, run back through today's
 * picker, and a marked set of them (each scene's likely songs marked fits, fine or wrong) to score
 * each change to the picker against. The marked set holds story text and notes on your songs, so it
 * lives in the data folder (`evals/music-bench.json`), never in the repository.
 */

export type BenchMark = "fits" | "fine" | "wrong";
export const BENCH_MARKS: BenchMark[] = ["fits", "fine", "wrong"];

/** One scene the soundtrack read: what the picker saw, and the end of the reply it was read from. */
export interface BenchScene {
  /** The logged call's or play's id. */
  id: string;
  chatId: string | null;
  at: number;
  moods: Mood[];
  present: string[];
  place: string;
  situations: string[];
  gist: string;
  /** The end of the reply the scene was read from (not kept for plays). */
  excerpt: string;
  from: "reading" | "play";
}

export interface MarkedSong {
  mark: BenchMark | null;
  /** "claude": marked by Claude; "you": set or checked by you on the Settings page. */
  by: "claude" | "you" | null;
  note?: string;
  title?: string;
  artist?: string;
}
export interface MarkedScene extends BenchScene {
  songs: Record<string, MarkedSong>;
  /** You looked this scene over on the Settings page. */
  checked?: boolean;
}
export interface MarkedSet {
  version: 1;
  made: number;
  scenes: MarkedScene[];
}

export const benchFile = (dataDir = config.dataDir) => join(dataDir, "evals", "music-bench.json");

export function readMarked(file = benchFile()): MarkedSet | null {
  if (!existsSync(file)) return null;
  try {
    const s = JSON.parse(readFileSync(file, "utf8")) as MarkedSet;
    return s?.version === 1 && Array.isArray(s.scenes) ? s : null;
  } catch {
    return null;
  }
}

/** Written whole to a temporary file first, so a crash never leaves half a set. */
export function writeMarked(set: MarkedSet, file = benchFile()) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(set, null, 1));
  renameSync(`${file}.tmp`, file);
}

const asMoods = (xs: string[]) => xs.map((m) => m.trim()).filter((m): m is Mood => (MOODS as readonly string[]).includes(m));

/**
 * A scene from a logged `story_moment` call: the cue lines it was sent (place, who's here, mood)
 * and the situations and gist it answered. Null for anything else.
 */
export function sceneFromReading(row: { id: string; chat_id: string | null; started_at: number; request: string; response: string | null }): BenchScene | null {
  try {
    const req = JSON.parse(row.request) as { messages?: { role: string; content: string }[] };
    const sys = req.messages?.find((m) => m.role === "system")?.content ?? "";
    if (!/^You choose music for a story/.test(sys)) return null;
    const user = req.messages?.find((m) => m.role === "user")?.content ?? "";
    const line = (k: string) => new RegExp(`^${k}: (.*)$`, "m").exec(user)?.[1]?.trim() ?? "";
    const res = JSON.parse(/\{[\s\S]*\}/.exec(row.response ?? "")?.[0] ?? "null") as { gist?: string; situations?: (string | { s?: string; strength?: string })[] } | null;
    if (!res) return null;
    const moods = asMoods(line("Mood").split(","));
    if (!moods.length) return null;
    const here = line("Here");
    return {
      id: row.id,
      chatId: row.chat_id,
      at: row.started_at,
      moods,
      present: here && here !== "?" ? here.split(",").map((s) => s.trim()).filter(Boolean) : [],
      place: line("Place") === "?" ? "" : line("Place"),
      situations: situationsOf((res.situations ?? []).map((x) => (typeof x === "string" ? x : /slight/i.test(x.strength ?? "") ? "" : (x.s ?? ""))), 4),
      gist: String(res.gist ?? "").trim(),
      // The replies it read (since docs/34 Part 3, the last three, each under a "---" heading).
      excerpt: user.split("\n\n").slice(1).join("\n\n").replace(/^--- .*\n/gm, "").trim(),
      from: "reading",
    };
  } catch {
    return null;
  }
}

/** A scene from a logged play: the cue and the moment the picker had. */
export function sceneFromPlay(p: PlayRow): BenchScene | null {
  const moods = asMoods(p.cue?.moods ?? []);
  if (!p.cue || !moods.length) return null;
  return { id: p.id, chatId: p.chatId, at: p.startedAt, moods, present: p.cue.present, place: p.cue.place, situations: p.moment?.situations ?? [], gist: p.moment?.gist ?? "", excerpt: "", from: "play" };
}

/** The picker's cue and this chat's music for a scene, keyed so its moment counts as this scene's. */
export function sceneInputs(s: BenchScene): { cue: Cue; music: ChatMusic } {
  const key = `bench|${s.moods[0]}|day`;
  const cue: Cue = { moods: s.moods, intensity: 0, hour: null, weather: "", place: s.place, genre: null, present: s.present, key };
  const moment: Moment | null = s.situations.length ? { situations: s.situations as Moment["situations"], gist: s.gist, key: `${s.id}|${key}`, from: "reply", at: s.at } : null;
  return { cue, music: { on: true, moment } };
}

/** Today's picker on one scene: every song in the roll with its chance, best first. No play history or thumbs. */
export async function rankScene(cfg: MusicConfig, s: BenchScene): Promise<(InRoll & { chance: number })[]> {
  const { cue, music } = sceneInputs(s);
  const r = rankTracks(cfg, cue, music, { words: await wordsContext(cfg, music, cue), themes: themesFor(cfg) });
  if (!r) return [];
  if (r.theme) return [{ ...r.theme, weight: 1, chance: 1 }];
  const total = r.roll.reduce((n, x) => n + x.weight, 0) || 1;
  return r.roll.map((x) => ({ ...x, chance: x.weight / total })).sort((a, b) => b.chance - a.chance || b.score - a.score);
}

export interface SceneScore {
  id: string;
  /** Chance the song played is marked each way, or not marked at all. */
  fits: number;
  fine: number;
  wrong: number;
  unmarked: number;
  /** A song marked wrong is among the three likeliest. */
  wrongInTop3: boolean;
  topWrong: boolean;
  roll: number;
}

export function scoreScene(scene: MarkedScene, ranked: { track: { videoId: string }; chance: number }[]): SceneScore {
  const out = { fits: 0, fine: 0, wrong: 0, unmarked: 0 };
  for (const r of ranked) {
    const m = scene.songs[r.track.videoId]?.mark;
    out[m ?? "unmarked"] += r.chance;
  }
  const markOf = (i: number) => (ranked[i] ? scene.songs[ranked[i]!.track.videoId]?.mark : undefined);
  return { id: scene.id, ...out, wrongInTop3: [0, 1, 2].some((i) => markOf(i) === "wrong"), topWrong: markOf(0) === "wrong", roll: ranked.length };
}

export interface BenchSummary {
  scenes: number;
  /** Average chance, over the marked scenes, that the song played is marked each way. */
  fits: number;
  fine: number;
  wrong: number;
  unmarked: number;
  wrongInTop3: number;
  topWrong: number;
  /** Average number of songs in the roll. */
  roll: number;
}

export function summarize(scores: SceneScore[]): BenchSummary {
  const n = scores.length || 1;
  const avg = (f: (s: SceneScore) => number) => Math.round((scores.reduce((t, s) => t + f(s), 0) / n) * 1000) / 1000;
  return { scenes: scores.length, fits: avg((s) => s.fits), fine: avg((s) => s.fine), wrong: avg((s) => s.wrong), unmarked: avg((s) => s.unmarked), wrongInTop3: scores.filter((s) => s.wrongInTop3).length, topWrong: scores.filter((s) => s.topWrong).length, roll: avg((s) => s.roll) };
}

/**
 * Scenes worth marking: spread over the stories, the lead moods and what was happening, newest
 * first within each kind, and never two with the same gist. Takes from each kind in turn.
 */
export function chooseScenes(scenes: BenchScene[], n: number): BenchScene[] {
  const seen = new Set<string>();
  const groups = new Map<string, BenchScene[]>();
  for (const s of [...scenes].sort((a, b) => b.at - a.at)) {
    const g = s.gist.toLowerCase().replace(/\W+/g, " ").trim();
    if (!g || seen.has(g)) continue;
    seen.add(g);
    const k = `${s.moods[0]}|${s.situations[0] ?? "-"}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  // The biggest kinds first, so the set looks like the stories do, then round and round.
  const lists = [...groups.values()].sort((a, b) => b.length - a.length);
  const out: BenchScene[] = [];
  for (let i = 0; out.length < n && lists.some((l) => l.length > i); i++) for (const l of lists) if (l[i] && out.length < n) out.push(l[i]!);
  return out;
}

/** Your mark on one song of one scene (the Settings page). Null clears it. */
export function setMark(sceneId: string, videoId: string, mark: BenchMark | null, file = benchFile()) {
  const set = readMarked(file);
  const scene = set?.scenes.find((s) => s.id === sceneId);
  if (!set || !scene) return null;
  scene.songs[videoId] = { ...(scene.songs[videoId] ?? {}), mark, by: mark ? "you" : null };
  writeMarked(set, file);
  return set;
}

/** You looked a scene over (or not). */
export function setChecked(sceneId: string, checked: boolean, file = benchFile()) {
  const set = readMarked(file);
  const scene = set?.scenes.find((s) => s.id === sceneId);
  if (!set || !scene) return null;
  scene.checked = checked;
  writeMarked(set, file);
  return set;
}

/** The marked set as the Settings page shows it: each scene's end of reply, and its songs with their marks. */
export function benchView(file = benchFile()) {
  const set = readMarked(file);
  const scenes = (set?.scenes ?? []).map((s) => ({
    id: s.id,
    at: s.at,
    moods: s.moods,
    situations: s.situations,
    gist: s.gist,
    excerpt: s.excerpt.slice(-600),
    checked: Boolean(s.checked),
    songs: Object.entries(s.songs).map(([videoId, x]) => ({ videoId, title: x.title ?? videoId, artist: x.artist ?? "", mark: x.mark, by: x.by })),
  }));
  const songs = scenes.flatMap((s) => s.songs);
  return { scenes, counts: { scenes: scenes.length, checked: scenes.filter((s) => s.checked).length, songs: songs.length, byYou: songs.filter((x) => x.by === "you").length } };
}
