import { z } from "zod";
import { one, parseJson } from "../db/db";
import { badRequest } from "../lib/http";
import { getSetting, setSetting } from "../lib/settings";
import { callJson } from "../services/llm";
import { type ChatSettings, mustChat, updateChat } from "../services/chats";
import { Deferred, enqueue } from "../services/jobs";
import { storyDials } from "../services/layers";
import { embedQuery } from "../memory/embed";
import { seeded } from "../sim/dice";
import { currentFold } from "../trackers/store";
import type { WorldState } from "../trackers/types";
import { findLyrics, forgetLyrics, type LyricLine, lyricsFor, lyricsIndex, lyricsLines, MISS_TTL, pasteLyrics } from "./lyrics";
import type { Situation } from "./situations";
import { clashes, embedPassages, landingPoint, passageTimes, forgetPassageVectors, linesHash, type LyricSheet, type Moment, passageVectors, readMoment, readSongs, saveSheet, SHEET_BATCH, sheetFor, situationsFromRecords, songsToRead, wordsFit } from "./words";
import { command, detectApp, seekTo, playerState, playlistIdOf, queueNext, playlistSongs, requestCode, requestPearToken, requestToken, searchSongs, videoIdOf, YtmError, type YtmApp } from "./ytmusic";

/**
 * The soundtrack (Almanac plan J3), on YouTube Music: a cue read from the story (mood, intensity,
 * hour, weather, place, genre), a picker over your library (tracks you've tagged, leitmotifs
 * pinned to people and bonds, your taste and thumbs), and a director that changes the music on
 * story beats only: a new scene, a change of mood or time of day, or a big moment. Otherwise it
 * holds. Your preferred artists' songs join the library by themselves: th-ch's app finds them, and
 * the helper model tags their moods. Off by default; it talks to the YouTube Music app on this PC
 * (and to YouTube Music's website only to read a playlist link you paste).
 */

export const MOODS = ["calm", "tender", "melancholy", "tense", "dread", "bright", "epic", "mystery", "night"] as const;
export type Mood = (typeof MOODS)[number];

export const trackSchema = z.object({
  videoId: z.string().regex(/^[\w-]{11}$/),
  title: z.string().max(200),
  artist: z.string().max(120).default(""),
  moods: z.array(z.enum(MOODS)).max(9).default([]),
  instrumental: z.boolean().default(false),
});
export type Track = z.infer<typeof trackSchema>;

export const musicConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().min(1).max(65535).default(9863),
  library: z.array(trackSchema).max(500).default([]),
  /** A song pinned to a person ("Spike") or a bond ("Spike & Buffy"): it comes back when they share a scene. */
  leitmotifs: z.array(z.object({ who: z.string().max(120), videoId: z.string().regex(/^[\w-]{11}$/) })).max(100).default([]),
  taste: z.object({ preferred: z.array(z.string().max(80)).max(40).default([]), banned: z.array(z.string().max(80)).max(40).default([]), instrumentalInDialogue: z.boolean().default(false) }).default({ preferred: [], banned: [], instrumentalInDialogue: false }),
  /** docs/18, 1.2: look for the library's lyrics on LRCLIB and YouTube Music (title, artist and length only). */
  lyricsOnline: z.boolean().default(false),
  /** docs/18, 3.2: how much a song's words count: not at all, a little, or leaning in (the chorus that fits plays). */
  wordsDial: z.enum(["off", "little", "lean"]).default("little"),
  /** docs/18, 4.2: start a song at the passage that fits ("auto": only when the dial is Lean in). */
  landLine: z.enum(["auto", "on", "off"]).default("auto"),
});
export type MusicConfig = z.infer<typeof musicConfigSchema> & { token?: string | null; app?: YtmApp | null };

export function musicConfig(): MusicConfig {
  const raw = getSetting("music.config") as Partial<MusicConfig> | null;
  return { ...musicConfigSchema.parse(raw ?? {}), token: raw?.token ?? null, app: raw?.app ?? null };
}
/** What the browser sees: everything but the token. */
export function musicView() {
  const { token, app, ...rest } = musicConfig();
  const found = tasteCache();
  // Per preferred artist: their songs in the library, or null until they've been looked up.
  const tasteFound = Object.fromEntries(rest.taste.preferred.map((a) => [a, found[a.toLowerCase()] ? rest.library.filter((t) => byArtist(t, a)).length : null]));
  return { ...rest, connected: Boolean(token), canSearch: app === "pear", tasteFound, ...wordsView(rest.library) };
}
/**
 * Changes only the fields sent. Pass the request as it came: the schema fills in its defaults even
 * for fields left out (`enabled: false`, an empty library), so those must never be written.
 */
export function saveMusicConfig(patch: Partial<z.infer<typeof musicConfigSchema>> | Record<string, unknown>) {
  const cur = musicConfig();
  const ok = musicConfigSchema.partial().safeParse(patch);
  if (!ok.success) throw badRequest("Invalid music settings", z.treeifyError(ok.error));
  const parsed = ok.data as Record<string, unknown>;
  const sent = Object.keys(patch).filter((k) => k in musicConfigSchema.shape && (patch as Record<string, unknown>)[k] !== undefined);
  const next = { ...cur, ...Object.fromEntries(sent.map((k) => [k, parsed[k]])) };
  setSetting("music.config", next as never);
  if (sent.includes("taste")) void refreshTaste().catch(() => {});
  if (sent.includes("lyricsOnline")) lyricsSoon();
  return musicView();
}

// ---------- your preferred artists' songs ----------

/** Per preferred artist (lower-cased): when they were last looked up. */
type TasteCache = Record<string, { at: number; ids?: string[] }>;
const TASTE_TTL = 7 * 24 * 3600_000;
const TASTE_PER_ARTIST = 20;
const tasteCache = () => (getSetting("music.taste") as TasteCache | null) ?? {};
const byArtist = (t: Track, artist: string) => t.artist.toLowerCase().includes(artist.toLowerCase());
/** Songs you removed from the library yourself: a lookup never adds them back. */
const removedIds = () => new Set((getSetting("music.removed") as string[] | null) ?? []);
function markRemoved(videoId: string, removed: boolean) {
  const ids = removedIds();
  if (removed) ids.add(videoId);
  else ids.delete(videoId);
  setSetting("music.removed", [...ids].slice(-2000) as never);
}

const tagSchema = z.object({ songs: z.array(z.object({ id: z.string(), moods: z.array(z.string()).max(4).default([]), instrumental: z.boolean().default(false) })) });

/** Moods for songs you haven't tagged: the helper model knows most songs. Left untagged if it can't. */
export async function tagMoods(songs: Track[]): Promise<Track[]> {
  const out = [...songs];
  for (let i = 0; i < songs.length; i += 40) {
    const batch = songs.slice(i, i + 40);
    try {
      const r = await callJson({
        task: "helper",
        kind: "soundtrack",
        name: "song_moods",
        schema: tagSchema,
        system: `You tag songs for a story's soundtrack. For each song, give 1-3 moods it suits, from: ${MOODS.join(", ")}. Mark it instrumental only if it has no vocals. Reply with JSON only: {"songs": [{"id": "…", "moods": ["tender"], "instrumental": false}]}`,
        user: batch.map((t) => `${t.videoId}: "${t.title}" by ${t.artist || "?"}`).join("\n"),
        maxTokens: 40 * batch.length + 200,
      });
      const by = new Map(r.data.songs.map((x) => [x.id, x]));
      batch.forEach((t, j) => {
        const tag = by.get(t.videoId);
        if (tag) out[i + j] = { ...t, moods: tag.moods.filter((m): m is Mood => (MOODS as readonly string[]).includes(m)), instrumental: tag.instrumental || t.instrumental };
      });
    } catch (e) {
      console.error("[mea] soundtrack: couldn't tag moods:", (e as Error).message);
    }
  }
  return out;
}

/** Adds tracks the library doesn't have yet, read fresh (it may have changed while they were tagged). */
function addToLibrary(tracks: Track[]) {
  const cfg = musicConfig();
  const have = new Set(cfg.library.map((t) => t.videoId));
  const add = tracks.filter((t) => !have.has(t.videoId)).slice(0, Math.max(0, 500 - cfg.library.length));
  if (add.length) setSetting("music.config", { ...cfg, library: [...cfg.library, ...add] } as never);
  if (add.length) lyricsSoon();
  return add.length;
}

async function refreshOnce() {
  const cfg = musicConfig();
  if (!cfg.token || cfg.app !== "pear") return;
  const cache = tasteCache();
  for (const artist of cfg.taste.preferred) {
    const k = artist.toLowerCase();
    // A look from before songs you removed were kept apart ("ids") is due again: it brings back songs lost then.
    if (cache[k] && !cache[k].ids && Date.now() - cache[k].at < TASTE_TTL) continue;
    try {
      const songs = (await searchSongs(cfg, artist)).filter((s) => s.artist.toLowerCase().includes(k)).slice(0, TASTE_PER_ARTIST);
      // Not songs already there, nor ones you removed yourself.
      const known = new Set([...removedIds(), ...musicConfig().library.map((t) => t.videoId)]);
      const fresh = songs.filter((s) => !known.has(s.videoId)).map((s) => trackSchema.parse({ videoId: s.videoId, title: s.title.slice(0, 200) || s.videoId, artist: s.artist.slice(0, 120), instrumental: /instrumental/i.test(s.title) }));
      addToLibrary(await tagMoods(fresh));
      cache[k] = { at: Date.now() };
    } catch {
      // YouTube Music not answering: try again in an hour.
      cache[k] = { at: Date.now() - TASTE_TTL + 3600_000 };
    }
    setSetting("music.taste", cache as never);
  }
  // Artists you took off the list are forgotten (their songs stay in the library until you remove them).
  const want = musicConfig().taste.preferred.map((a) => a.toLowerCase());
  for (const k of Object.keys(cache)) if (!want.includes(k)) delete cache[k];
  setSetting("music.taste", cache as never);
}

let running: Promise<void> | null = null;
let again = false;
/**
 * Looks up preferred artists not found yet (or found a week ago) and adds their songs to the
 * library. Only th-ch's app can search. A call while one runs makes it go round once more, so an
 * artist added meanwhile isn't missed.
 */
export function refreshTaste(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  const run = (async () => {
    do {
      again = false;
      await refreshOnce();
    } while (again);
  })().finally(() => {
    if (running === run) running = null;
  });
  running = run;
  return run;
}

// ---------- the cue ----------

export interface Cue {
  moods: Mood[];
  intensity: number;
  hour: number | null;
  weather: string;
  place: string;
  genre: string | null;
  present: string[];
  /** Changes on a story beat (scene, lead mood, time of day). */
  key: string;
}

const MOOD_WORDS: [RegExp, Mood][] = [
  [/\b(ang|furi|rage|irritat|hostil|tense|wary|on edge|guarded)/i, "tense"],
  [/\b(afraid|fear|terrif|scared|dread|panic|uneasy)/i, "dread"],
  [/\b(sad|grief|griev|mourn|lonely|melanchol|wistful|tired|weary|regret)/i, "melancholy"],
  [/\b(love|tender|fond|warm|affection|shy|flirt|longing)/i, "tender"],
  [/\b(happy|joy|playful|amused|giddy|cheer|excited|relieved)/i, "bright"],
  [/\b(calm|content|peace|relax|quiet|sleepy)/i, "calm"],
  [/\b(curious|suspicious|puzzled|thoughtful)/i, "mystery"],
];
const GENRE_MOODS: Record<string, Mood[]> = {
  horror: ["dread"], gothic: ["dread", "mystery"], romance: ["tender"], romcom: ["bright", "tender"], comedy: ["bright"], cozy: ["calm"], slice: ["calm"],
  thriller: ["tense"], psych: ["tense", "mystery"], mystery: ["mystery"], noir: ["mystery", "melancholy"], adventure: ["epic"], fantasy: ["epic"], epic: ["epic"],
  war: ["epic", "tense"], tragedy: ["melancholy"], drama: ["melancholy"], scifi: ["mystery"], action: ["tense", "epic"],
};

export function cueFrom(st: WorldState, genre: string | null): Cue {
  const here = Object.values(st.chars).filter((c) => (c.tier === "spot" || c.tier === "peri") && !c.dead);
  const score = new Map<Mood, number>();
  const bump = (m: Mood, n = 1) => score.set(m, (score.get(m) ?? 0) + n);
  for (const c of here) for (const [re, m] of MOOD_WORDS) if (c.mood?.name && re.test(c.mood.name)) bump(m, c.isUser ? 1 : 2);
  const mode = (st.mode ?? "").toLowerCase();
  if (/conflict|fight|combat|chase/.test(mode)) bump("tense", 3);
  if (/intimacy|romance/.test(mode)) bump("tender", 3);
  if (/investigation|mystery/.test(mode)) bump("mystery", 3);
  if (/travel|journey/.test(mode)) bump("epic", 2);
  const wx = (st.weather?.now ?? "").toLowerCase();
  if (/storm|thunder/.test(wx)) bump("tense", 2);
  else if (/rain|drizzle|fog|mist/.test(wx)) bump("melancholy", 1);
  const hour = st.time ? (((st.time.minutes % 1440) + 1440) % 1440) / 60 : null;
  const night = hour != null && (hour >= 21 || hour < 5);
  if (night) bump("night", 1);
  for (const m of GENRE_MOODS[genre ?? ""] ?? []) bump(m, 1);
  if (!score.size) bump("calm", 1);
  const moods = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m).slice(0, 3);
  const cracking = here.some((c) => c.pressure?.stage === "cracking" || c.pressure?.stage === "head");
  const hot = Object.values(st.exposure ?? {}).some((x) => x.cur >= x.max - 1);
  const intensity = Math.min(3, (moods[0] === "tense" || moods[0] === "dread" ? 1 : 0) + (cracking ? 1 : 0) + (hot ? 1 : 0) + (/storm/.test(wx) ? 1 : 0));
  const daypart = hour == null ? "?" : hour < 5 ? "night" : hour < 11 ? "morning" : hour < 17 ? "day" : hour < 21 ? "evening" : "night";
  return { moods, intensity, hour, weather: st.weather?.now ?? "", place: st.place.join(" › "), genre, present: here.map((c) => c.name), key: `${st.sceneNo}|${moods[0]}|${daypart}` };
}

// ---------- the picker ----------

interface ChatMusic {
  on?: boolean;
  votes?: Record<string, number>;
  /** "Not for this scene": by cue key. */
  notFor?: Record<string, string[]>;
  recent?: string[];
  lastKey?: string;
  /** The scene the director last looked at: a new one is a beat. */
  lastScene?: number;
  now?: { videoId: string; title: string; artist: string; key: string; why: string; at: number; words?: PickWords; /** Seconds in the song was started at (4.2). */ landed?: number } | null;
  /** The scene a song was last started at its passage: the next song in it plays from the top. */
  landedScene?: number;
  /** docs/18, 2.3: what was happening at the last beat. */
  moment?: Moment | null;
  /** docs/18, 3.3: "Wrong words": by situation, passages ("videoId#index") that don't count for it in this story. */
  wordsNo?: Record<string, string[]>;
  /** 👍 on a song picked by its words: by situation, how much each passage is raised. */
  wordsYes?: Record<string, Record<string, number>>;
}

/** Why the words chose a song: its passage that fits, and for what. */
export interface PickWords {
  passage: number;
  situations: Situation[];
  score: number;
}
const chatMusic = (chatId: string) => (parseJson<ChatSettings>(mustChat(chatId).settings, {}).music ?? {}) as ChatMusic;
const setChatMusic = (chatId: string, patch: Partial<ChatMusic>) => updateChat(chatId, { settings: { music: { ...chatMusic(chatId), ...patch } } as ChatSettings });

/** Present people a leitmotif names: a person, or both of a bond ("A & B"). */
function leitmotifFor(cfg: MusicConfig, present: string[]) {
  const here = new Set(present.map((p) => p.toLowerCase()));
  const fits = cfg.leitmotifs.filter((l) => l.who.split(/\s*(?:&|and|\+)\s*/i).every((n) => here.has(n.trim().toLowerCase())));
  // A bond (two names) beats one person.
  return fits.sort((a, b) => b.who.split(/&|and|\+/).length - a.who.split(/&|and|\+/).length)[0] ?? null;
}

// ---------- the words (docs/18, Part 3) ----------

/** Everything the picker needs to score songs by their words at this beat. */
export interface WordsCtx {
  moment: Moment;
  /** How much the words count: 0.5 (a little) or 1 (lean in). */
  weight: number;
  lean: boolean;
  sheets: Map<string, LyricSheet>;
  lines: Map<string, LyricLine[]>;
  vectors: Map<string, Map<number, Float32Array>>;
  momentVec: Float32Array | null;
  present: number;
  no: Record<string, string[]>;
  yes: Record<string, Record<string, number>>;
}

const WEIGHT = { off: 0, little: 0.5, lean: 1 } as const;

/** The moment is this scene's (a moment from an earlier scene says nothing about this one). */
const momentHere = (m: Moment | null | undefined, cue: Cue) => (m?.situations.length && m.key.split("|")[1] === cue.key.split("|")[0] ? m : null);

/**
 * The words at this beat, or null when they can't help: the dial is off, nothing is happening that
 * a song could be about (a quiet scene picks by mood, 3.2), or no song has been read. With
 * embeddings on, the moment's gist is embedded (briefly waited for) so meaning counts too.
 */
export async function wordsContext(cfg: MusicConfig, music: ChatMusic, cue: Cue): Promise<WordsCtx | null> {
  const weight = WEIGHT[cfg.wordsDial];
  const moment = momentHere(music.moment, cue);
  if (!weight || !moment) return null;
  const sheets = new Map(cfg.library.map((t) => [t.videoId, sheetFor(t.videoId)] as const).filter((x): x is [string, LyricSheet] => Boolean(x[1])));
  if (!sheets.size) return null;
  const momentVec = moment.gist ? await embedQuery(moment.gist, 3_000).catch(() => null) : null;
  const vectors = momentVec ? new Map([...sheets.keys()].map((id) => [id, passageVectors(id)])) : new Map<string, Map<number, Float32Array>>();
  return { moment, weight, lean: cfg.wordsDial === "lean", sheets, lines: lyricsLines([...sheets.keys()]), vectors, momentVec, present: cue.present.length, no: music.wordsNo ?? {}, yes: music.wordsYes ?? {} };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * A song's words score for this beat, its best passage and that passage's first line. Passages
 * marked Wrong words for one of the moment's situations don't count; ones you 👍'd for it count more.
 */
export function wordsScore(ctx: WordsCtx | null, videoId: string): { score: number; words: PickWords; line: string } | null {
  const sheet = ctx?.sheets.get(videoId);
  if (!ctx || !sheet) return null;
  const sits = ctx.moment.situations;
  const skip = new Set(sheet.passages.map((_, i) => i).filter((i) => sits.some((s) => ctx.no[s]?.includes(`${videoId}#${i}`))));
  const fit = wordsFit(sheet, ctx.moment, { vectors: ctx.vectors.get(videoId), momentVec: ctx.momentVec, present: ctx.present, skip });
  if (fit.passage == null || fit.score <= 0) return null;
  const p = sheet.passages[fit.passage]!;
  const liked = Math.min(2, sits.reduce((n, s) => n + (ctx.yes[s]?.[`${videoId}#${fit.passage}`] ?? 0), 0));
  const score = fit.score * ctx.weight + (ctx.lean && p.peak ? 0.5 : 0) + liked;
  const shared = p.situations.filter((s) => sits.includes(s));
  const line = (ctx.lines.get(videoId) ?? []).slice(p.from, p.to + 1).find((l) => l.text)?.text ?? "";
  return { score, words: { passage: fit.passage, situations: shared.length ? shared : sheet.situations.filter((s) => sits.includes(s)), score: fit.score }, line };
}

export function pickTrack(cfg: MusicConfig, cue: Cue, music: ChatMusic, opts: { dialogue?: boolean; exclude?: string[]; words?: WordsCtx | null; rand?: () => number } = {}): Pick | null {
  const banned = cfg.taste.banned.map((a) => a.toLowerCase());
  const preferred = cfg.taste.preferred.map((a) => a.toLowerCase());
  const skip = new Set([...(music.notFor?.[cue.key] ?? []), ...(opts.exclude ?? [])]);
  const motif = leitmotifFor(cfg, cue.present);
  // "Hozier & Bear McCreary" is a Hozier song.
  const byAny = (names: string[], artist: string) => names.some((a) => a && artist.toLowerCase().includes(a));
  const allowed = cfg.library.filter((t) => !skip.has(t.videoId) && !byAny(banned, t.artist) && !(opts.dialogue && cfg.taste.instrumentalInDialogue && !t.instrumental));
  // Songs played lately sit out, the latest first: as many as leaves a few that suit the lead mood
  // (or, with none that do, a few of any), and always the last one if there's another.
  const leads = allowed.filter((t) => cue.moods[0] && t.moods.includes(cue.moods[0]));
  const pool = leads.length ? leads : allowed;
  const recent = music.recent ?? [];
  const out = new Set(recent.filter((v) => pool.some((t) => t.videoId === v)).slice(0, Math.max(Math.min(1, pool.length - 1), pool.length - FRESH_POOL)));
  const moodScore = (t: Track) => t.moods.filter((m) => cue.moods.includes(m)).length * 2 + (t.moods[0] && t.moods[0] === cue.moods[0] ? 1 : 0);
  const fresh = allowed.filter((t) => !out.has(t.videoId));
  // The words lift a song only if its sound is close: they never drag in one in the wrong mood.
  const bestMood = Math.max(0, ...fresh.map(moodScore));
  const scored = fresh.map((t) => {
    const overlap = t.moods.filter((m) => cue.moods.includes(m));
    let score = moodScore(t);
    let why = overlap.length ? `fits: ${overlap.join(", ")}` : "nothing closer";
    const w = score >= bestMood - 2 ? wordsScore(opts.words ?? null, t.videoId) : null;
    if (w) {
      score += w.score;
      if (w.score >= 0.5) why = `fits: ${[...overlap, ...w.words.situations].join(", ")}${w.line ? ` — "${clip(w.line, 60)}"` : ""}`;
    }
    if (motif?.videoId === t.videoId) {
      score += 6;
      why = `${motif.who}'s theme`;
    }
    score += (music.votes?.[t.videoId] ?? 0) + (byAny(preferred, t.artist) ? 1 : 0);
    return { track: t, score, why, words: w?.words, lead: Boolean(cue.moods[0] && t.moods.includes(cue.moods[0])) };
  });
  if (!scored.length) return null;
  // The theme of the people here comes back whenever it hasn't played lately.
  const theme = scored.find((s) => s.track.videoId === motif?.videoId);
  if (theme) return { track: theme.track, why: theme.why, ...(theme.words ? { words: theme.words } : {}) };
  // Not always the one best fit: any song close to it can play, the closer the likelier, and one
  // still in the history (played a while ago) less so. One that misses the lead mood never stands
  // in for one that has it.
  const top = Math.max(...scored.map((s) => s.score));
  const lead = scored.some((s) => s.lead && s.score === top);
  const near = scored.filter((s) => s.score >= top - 2 && (s.lead || !lead)).map((s) => ({ ...s, weight: 3 ** (s.score - top) * (recent.includes(s.track.videoId) ? 0.4 : 1) }));
  let roll = (opts.rand ?? Math.random)() * near.reduce((n, s) => n + s.weight, 0);
  const pick = near.find((s) => (roll -= s.weight) < 0) ?? near.at(-1)!;
  return { track: pick.track, why: pick.why, ...(pick.words ? { words: pick.words } : {}) };
}

/** How many songs a play history leaves to choose from, and how far back it goes. */
const FRESH_POOL = 3;
const HISTORY = 60;

/**
 * The song playing still suits the scene: it's the theme of the people here, its words fit what's
 * happening, or it's the lead mood and its words don't go against it (a celebration over grief).
 */
export function stillFits(cfg: MusicConfig, cue: Cue, videoId: string, words: WordsCtx | null = null) {
  if (leitmotifFor(cfg, cue.present)?.videoId === videoId) return true;
  if (words && clashes(words.sheets.get(videoId) ?? null, words.moment)) return false;
  if ((wordsScore(words, videoId)?.words.score ?? 0) >= 1) return true;
  const t = cfg.library.find((x) => x.videoId === videoId);
  return Boolean(t && cue.moods[0] && t.moods.includes(cue.moods[0]));
}

/** A big moment in this reply's records: someone died, a secret came out, a promise kept or broken, romance moved. */
export function bigMoment(messageId: string, chatId: string) {
  const changes = currentFold(chatId).result.changes[messageId] ?? [];
  return changes.some((c) => (c.kind === "secret" && /revealed/i.test(c.text)) || c.kind === "death" || c.kind === "romance" || ((c.kind === "promise" || c.kind === "owe") && /kept|broken|stood up/i.test(c.text)) || (c.kind === "scene" && c.newScene));
}

/** Mostly dialogue: instrumental-only taste applies. */
const dialogueHeavy = (text: string) => (text.match(/[“"][^”"]+[”"]/g) ?? []).join("").length > text.length * 0.4;

type Pick = { track: Track; why: string; words?: PickWords };

/** What's playing for this chat now (the header shows it), and what's played lately. */
function remember(chatId: string, pick: Pick, key: string, landed?: number) {
  const m = chatMusic(chatId);
  setChatMusic(chatId, { lastKey: key, recent: [pick.track.videoId, ...(m.recent ?? []).filter((v) => v !== pick.track.videoId)].slice(0, HISTORY), now: { videoId: pick.track.videoId, title: pick.track.title, artist: pick.track.artist, key, why: pick.why, at: Date.now(), ...(pick.words ? { words: pick.words } : {}), ...(landed != null ? { landed } : {}) } });
}

/** How long to wait for the app to be on the new song before moving it to the passage. */
const LAND_WAIT_MS = 5_000;

async function play(chatId: string, cfg: MusicConfig, pick: Pick, key: string, opts: { land?: { at: number; scene: number } | null } = {}) {
  if (!cfg.token) return;
  await command(cfg, { command: "changeVideo", data: { videoId: pick.track.videoId } });
  // A song already queued in the app still follows this one, so it stays lined up.
  if (!pending?.queued || pending.track.videoId === pick.track.videoId) pending = null;
  const landed = opts.land ? await landAt(cfg, pick.track.videoId, opts.land.at) : false;
  remember(chatId, pick, key, landed ? opts.land!.at : undefined);
  if (landed) setChatMusic(chatId, { landedScene: opts.land!.scene });
  watch(chatId);
}

/** Once the app is on the song, moves it to the passage. False (the song plays from the top) if the app never gets there or can't seek. */
async function landAt(cfg: MusicConfig, videoId: string, at: number) {
  try {
    const until = Date.now() + LAND_WAIT_MS;
    for (;;) {
      if ((await playerState(cfg)).videoId === videoId) break;
      if (Date.now() >= until) return false;
      await Bun.sleep(LAND_POLL_MS);
    }
    await seekTo(cfg, at);
    return true;
  } catch (e) {
    if (!(e instanceof YtmError)) console.error("[mea] soundtrack: couldn't land the line:", (e as Error).message);
    return false;
  }
}
let LAND_POLL_MS = 200;
/** Tests: no waiting between looks at the player. */
export const landPollForTests = (ms: number) => void (LAND_POLL_MS = ms);

/**
 * Where to start a pick (4.2), or null for the top: on a cut only (never the next song lined up, nor
 * a skip), with Land the line on, timed words whose passage fits well (1.5 or more), not the theme of
 * the people here coming back, and not twice in one scene.
 */
export function landingFor(cfg: MusicConfig, music: ChatMusic, pick: Pick, sceneNo: number): number | null {
  const on = cfg.landLine === "on" || (cfg.landLine === "auto" && cfg.wordsDial === "lean");
  const w = pick.words;
  if (!on || !w || w.score < 1.5 || music.landedScene === sceneNo) return null;
  if (pick.why.endsWith("'s theme")) return null;
  const sheet = sheetFor(pick.track.videoId);
  const lyrics = lyricsFor(pick.track.videoId);
  if (!sheet || !lyrics?.timed) return null;
  return landingPoint(sheet, lyrics.lines, w.passage, lyrics.duration);
}

// ---------- one song after another ----------

/** The chat whose soundtrack is playing, and the song lined up to follow this one. */
let active: string | null = null;
let pending: (Pick & { key: string; chatId: string; queued: boolean }) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
/** Seconds before the end that the next song is lined up. */
const LINE_UP = 12;
const WATCH_MS = 4_000;

/** Keeps the music going for this chat: a song that ends is followed by the next one that fits. */
function watch(chatId: string) {
  active = chatId;
  if (timer) return;
  timer = setInterval(() => void musicTick(), WATCH_MS);
  (timer as { unref?: () => void }).unref?.();
}
function unwatch() {
  if (timer) clearInterval(timer);
  timer = null;
  active = null;
  pending = null;
}

/**
 * One look at the player. Near the end of the song Mea chose, the next song for the scene is lined
 * up after it (so the app plays it straight on); once the app is on it, the header says so. If the
 * song ended and nothing followed, the next one is played. Something you put on yourself is left alone.
 */
export async function musicTick() {
  if (ticking || !active) return;
  ticking = true;
  try {
    const chatId = active;
    const cfg = musicConfig();
    const m = (() => {
      try {
        return chatMusic(chatId);
      } catch {
        return null;
      }
    })();
    if (!cfg.enabled || !cfg.token || !m?.on || !m.now) return unwatch();
    const s = await playerState(cfg);
    if (pending?.chatId === chatId && s.videoId === pending.track.videoId) {
      remember(chatId, pending, pending.key);
      pending = null;
      return;
    }
    if (s.videoId !== m.now.videoId || s.duration == null || s.elapsed == null || !s.duration) return;
    const left = s.duration - s.elapsed;
    const ended = !s.playing && left <= 2;
    if (left > LINE_UP && !ended) return;
    if (!pending || pending.chatId !== chatId) {
      const cue = cueFrom(currentFold(chatId).result.state, storyDials(mustChat(chatId)).genre);
      const pick = pickTrack(cfg, cue, m, { exclude: [m.now.videoId], words: await wordsContext(cfg, m, cue) });
      if (!pick) return;
      pending = { ...pick, key: cue.key, chatId, queued: false };
    }
    if (!ended && !pending.queued) {
      pending.queued = await queueNext(cfg, pending.track.videoId);
      if (pending.queued) return;
    }
    if (ended) await play(chatId, cfg, pending, pending.key);
  } catch (e) {
    if (!(e instanceof YtmError)) console.error("[mea] soundtrack:", (e as Error).message);
  } finally {
    ticking = false;
  }
}

/**
 * The director (an onTrackerUpdate hook). A song plays to its end unless the story turns: a new
 * scene or a big moment cuts to a new song, and only if the one playing doesn't suit it. A mood or
 * the time of day shifting within a scene doesn't cut; the next song, picked as this one ends, follows
 * it. Never throws; YouTube Music not answering just means the music holds.
 */
export function musicAfterReply(chatId: string, messageId: string) {
  void (async () => {
    const cfg = musicConfig();
    if (!cfg.enabled || !cfg.token) return;
    const music = chatMusic(chatId);
    if (!music.on) return;
    if (music.now) watch(chatId);
    // Preferred artists due a look are found in the background; their songs are there next time.
    if (cfg.taste.preferred.length) void refreshTaste().catch(() => {});
    if (!cfg.library.length) return;
    const st = currentFold(chatId).result.state;
    const cue = cueFrom(st, storyDials(mustChat(chatId)).genre);
    const start = !music.now || !music.lastKey;
    const turn = (music.lastScene !== undefined && st.sceneNo !== music.lastScene) || bigMoment(messageId, chatId);
    const text = one<{ content: string }>("SELECT s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.id = ?", messageId)?.content ?? "";
    // A beat (or the start): what's happening now, for picking by the words.
    if (start || turn) await momentAt(chatId, messageId, st, cue, text, music.moment ?? null);
    const words = start || turn ? await wordsContext(cfg, chatMusic(chatId), cue) : null;
    if (!start && !(turn && !stillFits(cfg, cue, music.now!.videoId, words))) return void setChatMusic(chatId, { lastScene: st.sceneNo });
    // The same reply picks the same song on every swipe (3.1).
    const seq = one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", messageId)?.seq ?? 0;
    const pick = pickTrack(cfg, cue, music, { dialogue: dialogueHeavy(text), exclude: [music.now?.videoId, pending?.queued ? pending.track.videoId : undefined].filter((v): v is string => Boolean(v)), words, rand: seeded(chatId, seq, `music:${cue.key}`) });
    if (pick) {
      const at = landingFor(cfg, chatMusic(chatId), pick, st.sceneNo);
      await play(chatId, cfg, pick, cue.key, { land: at != null ? { at, scene: st.sceneNo } : null });
    }
    setChatMusic(chatId, { lastScene: st.sceneNo });
  })().catch((e) => {
    if (!(e instanceof YtmError)) console.error("[mea] soundtrack:", (e as Error).message);
  });
}

// ---------- your hand ----------

export type MusicAction = "on" | "off" | "playPause" | "skip" | "up" | "down" | "notForScene" | "wrongWords";

export async function musicAction(chatId: string, action: MusicAction) {
  const cfg = musicConfig();
  const music = chatMusic(chatId);
  if (action === "on" || action === "off") {
    setChatMusic(chatId, { on: action === "on", ...(action === "on" ? { lastKey: "" } : {}) });
    if (action === "on") watch(chatId);
    else if (active === chatId) unwatch();
    return chatMusicView(chatId);
  }
  // Wrong words: the song stays, but this passage stops counting for what's happening (3.3).
  if (action === "wrongWords") {
    const w = music.now?.words;
    if (!w) throw badRequest("This song wasn't picked for its words");
    const key = `${music.now!.videoId}#${w.passage}`;
    const no = { ...(music.wordsNo ?? {}) };
    for (const s of w.situations) no[s] = [...new Set([...(no[s] ?? []), key])];
    setChatMusic(chatId, { wordsNo: no, now: { ...music.now!, words: undefined } });
    return chatMusicView(chatId);
  }
  if (!cfg.token) throw badRequest("Connect YouTube Music first (Settings › Music)");
  const cue = cueFrom(currentFold(chatId).result.state, storyDials(mustChat(chatId)).genre);
  const cur = music.now?.videoId;
  if (action === "playPause") await command(cfg, { command: "playPause" });
  else if (action === "up" || action === "down") {
    if (!cur) throw badRequest("Nothing Mea chose is playing");
    setChatMusic(chatId, { votes: { ...(music.votes ?? {}), [cur]: (music.votes?.[cur] ?? 0) + (action === "up" ? 1 : -1) } });
    // 👍 on a song picked by its words raises that passage for what's happening.
    const w = music.now?.words;
    if (action === "up" && w) {
      const yes = { ...(music.wordsYes ?? {}) };
      for (const s of w.situations) yes[s] = { ...(yes[s] ?? {}), [`${cur}#${w.passage}`]: (yes[s]?.[`${cur}#${w.passage}`] ?? 0) + 1 };
      setChatMusic(chatId, { wordsYes: yes });
    }
    if (action === "down") return musicAction(chatId, "skip");
  } else {
    if (action === "notForScene" && cur) setChatMusic(chatId, { notFor: { ...(music.notFor ?? {}), [cue.key]: [...(music.notFor?.[cue.key] ?? []), cur] } });
    const now = chatMusic(chatId);
    const pick = pickTrack(cfg, cue, now, { exclude: cur ? [cur] : [], words: await wordsContext(cfg, now, cue) });
    if (!pick) throw badRequest("Nothing else in your library fits");
    await play(chatId, cfg, pick, cue.key);
  }
  return chatMusicView(chatId);
}

export function chatMusicView(chatId: string) {
  const cfg = musicConfig();
  const m = chatMusic(chatId);
  let cue: Cue | null = null;
  try {
    cue = cueFrom(currentFold(chatId).result.state, storyDials(mustChat(chatId)).genre);
  } catch {
    cue = null;
  }
  // The chat is open with its music on: keep it going (also after Mea restarts).
  if (cfg.enabled && cfg.token && m.on && m.now) watch(chatId);
  return { available: cfg.enabled && Boolean(cfg.token), on: Boolean(m.on), now: m.now ?? null, cue, vote: m.now ? (m.votes?.[m.now.videoId] ?? 0) : 0, moment: m.moment ?? null };
}

// ---------- connecting, and the library ----------

/** The Companion Server answers with a code to approve; th-ch's app asks you to allow Mea and connects right away. */
export async function connectStart(): Promise<{ code: string } | { code?: undefined; connected: ReturnType<typeof musicView> }> {
  const cfg = musicConfig();
  const app = await detectApp(cfg.port);
  if (app === "ytmd") return { code: await requestCode(cfg.port) };
  const token = await requestPearToken(cfg.port);
  setSetting("music.config", { ...cfg, token, app, enabled: true } as never);
  return { connected: musicView() };
}
export async function connectFinish(code: string) {
  const cfg = musicConfig();
  const token = await requestToken(cfg.port, code);
  setSetting("music.config", { ...cfg, token, app: "ytmd", enabled: true } as never);
  return musicView();
}
export function disconnect() {
  setSetting("music.config", { ...musicConfig(), token: null, app: null } as never);
  return musicView();
}

/**
 * Add a whole playlist: each song joins the library, tagged with the moods you picked, or, with
 * none picked, the moods the helper model hears in it. Songs already in the library keep their tags.
 */
async function addPlaylist(listId: string, input: { moods?: Mood[]; instrumental?: boolean }) {
  const songs = await playlistSongs(listId);
  if (!songs.length) throw badRequest("That playlist is empty, private, or not one YouTube Music can show without signing in");
  const cfg = musicConfig();
  const have = new Set(cfg.library.map((t) => t.videoId));
  let fresh = songs.filter((s) => !have.has(s.videoId)).map((s) => trackSchema.parse({ videoId: s.videoId, title: s.title.slice(0, 200) || s.videoId, artist: s.artist.slice(0, 120), moods: input.moods ?? [], instrumental: input.instrumental || /instrumental/i.test(s.title) }));
  const room = 500 - cfg.library.length;
  if (room <= 0) throw badRequest("The library is full (500 songs)");
  fresh = fresh.slice(0, room);
  if (!input.moods?.length) fresh = await tagMoods(fresh);
  // Re-read: the library may have changed while the playlist loaded.
  const now = musicConfig();
  const ids = new Set(now.library.map((t) => t.videoId));
  setSetting("music.config", { ...now, library: [...now.library, ...fresh.filter((t) => !ids.has(t.videoId))].slice(0, 500) } as never);
  // Added by hand: a song you'd removed before is yours again.
  const removed = removedIds();
  if (fresh.some((t) => removed.has(t.videoId))) setSetting("music.removed", [...removed].filter((id) => !fresh.some((t) => t.videoId === id)) as never);
  if (fresh.length) lyricsSoon();
  return { ...musicView(), added: fresh.length };
}

/** Add a track: a pasted link or id, a playlist link, or whatever YouTube Music is playing now. */
export async function addTrack(input: { link?: string; moods?: Mood[]; instrumental?: boolean; title?: string; artist?: string }) {
  const cfg = musicConfig();
  let videoId = input.link ? videoIdOf(input.link) : null;
  // A song's link can carry the list it was played from; only a link with no song in it is a playlist.
  const listId = input.link && !videoId ? playlistIdOf(input.link) : null;
  if (listId) return addPlaylist(listId, input);
  let title = input.title ?? "";
  let artist = input.artist ?? "";
  if (!videoId) {
    if (!cfg.token) throw badRequest("Paste a YouTube Music link, or connect the app to add what's playing");
    const s = await playerState(cfg);
    if (!s.videoId) throw badRequest("Nothing is playing in YouTube Music");
    videoId = s.videoId;
    title ||= s.title ?? "";
    artist ||= s.author ?? "";
  }
  const track = trackSchema.parse({ videoId, title: title || videoId, artist, moods: input.moods ?? [], instrumental: input.instrumental ?? false });
  // Re-read: the library may have changed while YouTube Music answered.
  const now = musicConfig();
  setSetting("music.config", { ...now, library: [...now.library.filter((t) => t.videoId !== videoId), track] } as never);
  markRemoved(videoId, false);
  lyricsSoon();
  return musicView();
}

/**
 * One song's moods or instrumental flag. Edits go song by song: a whole library sent from the
 * page could be seconds old and drop songs a lookup added since.
 */
export function retagTrack(videoId: string, patch: { moods?: Mood[]; instrumental?: boolean }) {
  const cfg = musicConfig();
  if (!cfg.library.some((t) => t.videoId === videoId)) throw badRequest("That song isn't in the library");
  setSetting("music.config", { ...cfg, library: cfg.library.map((t) => (t.videoId === videoId ? { ...t, ...patch } : t)) } as never);
  return musicView();
}

/** Takes songs out of the library; a lookup for their artists won't add them back. */
export function removeTracks(videoIds: string[]) {
  const gone = new Set(videoIds);
  const cfg = musicConfig();
  setSetting("music.config", { ...cfg, library: cfg.library.filter((t) => !gone.has(t.videoId)) } as never);
  setSetting("music.removed", [...new Set([...removedIds(), ...gone])].slice(-2000) as never);
  forgetLyrics(videoIds);
  forgetPassageVectors(videoIds);
  return musicView();
}
export const removeTrack = (videoId: string) => removeTracks([videoId]);

// ---------- the songs' words (docs/18, Part 1) ----------

export type WordsState = "timed" | "plain" | "none" | "instrumental" | "pending";

/** Per song: whether Mea has its words, and how many it has. */
function wordsView(library: Track[]) {
  const idx = lyricsIndex();
  const unread = new Set(songsToRead(library.map((t) => t.videoId)).map((s) => s.videoId));
  const words: Record<string, WordsState> = {};
  for (const t of library) {
    const l = idx.get(t.videoId);
    words[t.videoId] = t.instrumental ? "instrumental" : !l ? "pending" : l.source === "none" ? "none" : l.timed ? "timed" : "plain";
  }
  const states = Object.values(words);
  const count = (s: WordsState) => states.filter((x) => x === s).length;
  const have = count("timed") + count("plain");
  return { words, wordsCount: { have, timed: count("timed"), pending: count("pending"), of: library.filter((t) => !t.instrumental).length, read: have - library.filter((t) => unread.has(t.videoId) && !t.instrumental).length } };
}

/** The next song to look up: one never looked for, then a miss from long enough ago. Not instrumentals, not words you pasted. */
function dueForWords(cfg: MusicConfig): Track | null {
  const idx = lyricsIndex();
  const songs = cfg.library.filter((t) => !t.instrumental);
  return songs.find((t) => !idx.has(t.videoId)) ?? songs.find((t) => idx.get(t.videoId)?.source === "none" && Date.now() - idx.get(t.videoId)!.fetchedAt > MISS_TTL) ?? null;
}

/** Looks the library's words up in the background (one job, one song at a time), when the switch is on. */
export function lyricsSoon() {
  if (!musicConfig().lyricsOnline) return;
  enqueue("music.lyrics", {}, { dedupeKey: "music.lyrics", priority: -1, maxAttempts: 5 });
}

/** LRCLIB says a song has no words: it's an instrumental. */
function markInstrumental(videoId: string) {
  const cfg = musicConfig();
  setSetting("music.config", { ...cfg, library: cfg.library.map((t) => (t.videoId === videoId ? { ...t, instrumental: true } : t)) } as never);
}

/** Between songs, so the lyrics sites aren't asked for a whole library at once. */
const WORDS_GAP_MS = 2_000;

/**
 * The `music.lyrics` job: one song's words, then the job comes round again for the next one. A site
 * not answering waits ten minutes; turning the switch off ends it.
 */
export async function lyricsStep() {
  const cfg = musicConfig();
  if (!cfg.lyricsOnline) return;
  const t = dueForWords(cfg);
  if (!t) return;
  try {
    const found = await findLyrics(t);
    if (found.instrumental) markInstrumental(t.videoId);
    else if (found.lines.length) sheetsSoon();
  } catch (e) {
    if (e instanceof YtmError) throw new Deferred(`Lyrics: ${e.message}`, 10 * 60_000);
    throw e;
  }
  if (dueForWords(musicConfig())) throw new Deferred("Looking up the next song's lyrics", WORDS_GAP_MS);
}

const inLibrary = (videoId: string) => {
  const t = musicConfig().library.find((x) => x.videoId === videoId);
  if (!t) throw badRequest("That song isn't in the library");
  return t;
};

/** A song's words as Mea has them (null: not looked up yet), and its lyric sheet once it's been read. */
export function songWords(videoId: string) {
  inLibrary(videoId);
  return { words: lyricsFor(videoId), sheet: sheetFor(videoId) };
}

/** Words you paste for a song (plain or LRC); empty text forgets them, and they're looked up again. */
export function setSongWords(videoId: string, text: string) {
  inLibrary(videoId);
  pasteLyrics(videoId, text);
  if (!text.trim()) lyricsSoon();
  else sheetsSoon();
  return { words: lyricsFor(videoId), sheet: sheetFor(videoId), view: musicView() };
}

/** Find again: forgets what Mea has (pasted words too) and looks the song up now. */
export async function findSongWords(videoId: string) {
  const t = inLibrary(videoId);
  if (!musicConfig().lyricsOnline) throw badRequest("Turn on Find lyrics online first");
  const found = await findLyrics(t);
  if (found.instrumental) markInstrumental(videoId);
  else if (found.lines.length) sheetsSoon();
  return { words: lyricsFor(videoId), sheet: sheetFor(videoId), view: musicView() };
}

// ---------- reading the songs (docs/18, 2.1-2.2) ----------

/** Reads songs with words and no sheet in the background, a few per helper call. */
export function sheetsSoon() {
  if (!songsToRead(musicConfig().library.filter((t) => !t.instrumental).map((t) => t.videoId)).length) return;
  enqueue("music.sheets", {}, { dedupeKey: "music.sheets", priority: -1 });
}

/**
 * The `music.sheets` job: one helper call's worth of songs, then round again for the next few. A
 * song whose words suggest a mood it isn't tagged with gains it (one at most, never replacing yours).
 * With embeddings on, the passages get vectors; an embedding failure never loses a sheet.
 */
export async function sheetsStep() {
  const cfg = musicConfig();
  const todo = songsToRead(cfg.library.filter((t) => !t.instrumental).map((t) => t.videoId)).slice(0, SHEET_BATCH);
  if (todo.length) {
    const byId = new Map(cfg.library.map((t) => [t.videoId, t]));
    const read = await readSongs(
      todo.map((s) => ({ ...s, title: byId.get(s.videoId)?.title ?? "", artist: byId.get(s.videoId)?.artist ?? "" })),
      MOODS,
    );
    for (const s of todo) {
      const r = read.get(s.videoId);
      if (r) saveSheet(s.videoId, r.sheet, linesHash(s.lines));
    }
    const fresh = musicConfig();
    const extra = new Map([...read].filter(([id, r]) => r.mood && !fresh.library.find((t) => t.videoId === id)?.moods.includes(r.mood as Mood)).map(([id, r]) => [id, r.mood as Mood]));
    if (extra.size) setSetting("music.config", { ...fresh, library: fresh.library.map((t) => (extra.has(t.videoId) && t.moods.length < 9 ? { ...t, moods: [...t.moods, extra.get(t.videoId)!] } : t)) } as never);
  }
  try {
    await embedPassages(musicConfig().library.map((t) => ({ videoId: t.videoId, sheet: sheetFor(t.videoId) })).filter((x): x is { videoId: string; sheet: NonNullable<typeof x.sheet> } => Boolean(x.sheet)));
  } catch (e) {
    console.error("[mea] soundtrack: couldn't embed passages:", (e as Error).message);
  }
  if (songsToRead(musicConfig().library.filter((t) => !t.instrumental).map((t) => t.videoId)).length) throw new Deferred("Reading the next songs' lyrics", 1_000);
}

/** Any song in the library has a sheet: only then is the moment worth a helper call. */
const anySheets = (cfg: MusicConfig) => cfg.library.some((t) => sheetFor(t.videoId));

// ---------- the moment (docs/18, 2.3) ----------

/**
 * What's happening at a beat: the records first (free); with fewer than two situations from them,
 * one helper call reads the end of the reply. A swipe of the same beat reuses the moment. Without
 * any song read for its words, only the records are looked at. Never throws.
 */
export async function momentAt(chatId: string, messageId: string, st: WorldState, cue: Cue, text: string, prev: Moment | null) {
  try {
    if (prev?.key === `${messageId}|${cue.key}`) return prev;
    const changes = currentFold(chatId).result.changes[messageId] ?? [];
    const records = situationsFromRecords(changes, st, prev);
    let moment: Moment = { situations: records, gist: "", key: `${messageId}|${cue.key}`, from: "records", at: Date.now() };
    if (records.length < 2 && text.trim() && anySheets(musicConfig())) {
      try {
        const r = await readMoment(text, cue, chatId);
        const both = [...records, ...r.situations.filter((x) => !records.includes(x))].slice(0, 4);
        moment = { ...moment, situations: both, gist: r.gist, from: records.length ? "both" : "reply" };
      } catch (e) {
        console.error("[mea] soundtrack: couldn't read the moment:", (e as Error).message);
      }
    }
    setChatMusic(chatId, { moment });
    return moment;
  } catch {
    return prev;
  }
}

// ---------- the line as it's sung (docs/18, 4.3) ----------

/**
 * While the passage that fits plays (timed words only): the line being sung and the next, for the
 * chip's lyric strip. Null outside the passage, or when the app is on another song.
 */
export async function nowSinging(chatId: string): Promise<{ current: string; next: string; elapsed: number } | null> {
  const cfg = musicConfig();
  const m = chatMusic(chatId);
  const w = m.now?.words;
  if (!cfg.token || !m.now || !w) return null;
  const lyrics = lyricsFor(m.now.videoId);
  const sheet = sheetFor(m.now.videoId);
  if (!lyrics?.timed || !sheet) return null;
  const at = passageTimes(sheet, lyrics.lines, w.passage);
  const s = await playerState(cfg);
  if (!at || s.videoId !== m.now.videoId || s.elapsed == null) return null;
  if (s.elapsed < at.start - 1 || s.elapsed > at.end + 6) return null;
  const p = sheet.passages[w.passage]!;
  const rows = lyrics.lines.slice(p.from, p.to + 1).filter((l) => l.text && l.t != null);
  const i = rows.findLastIndex((l) => l.t! <= s.elapsed!);
  return { current: rows[i]?.text ?? "", next: rows[i + 1]?.text ?? "", elapsed: s.elapsed };
}
