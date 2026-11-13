import { z } from "zod";
import { all, one, parseJson, run } from "../db/db";
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
import { findLyrics, forgetLyrics, type LyricLine, lyricsFor, lyricsIndex, lyricsLines, MISS_TTL, moveLyrics, pasteLyrics } from "./lyrics";
import type { Situation } from "./situations";
import { closePlay, markPlay, openPlay, type PlayCue, type PlayEnding, type PlayHow, type PlayParts, type Runner } from "./plays";
import { bareTitle, blockedVersion, firstArtist, sameCut, songKey, type Version, VERSIONS } from "./versions";
import { briefLine, readBrief, recordsBrief } from "./brief";
import { allCards, type Bond, cardLine, cardOf, cardPatch, cardText, dropOldMoods, editCard, saveReadCard, type SongCard, SOUND_FIELDS, type StoredCard } from "./cards";
import { background, type Brief, cardFit, gateOf, JUDGE_TOP, judgeSongs, NOTHING_FITS, type Verdict } from "./fit";
import { cardVector, clashes, embedCards, embedPassages, songThemes, landingPoint, passageTimes, forgetPassageVectors, movePassageVectors, linesHash, type LyricSheet, type Moment, passageVectors, readSongs, saveSheet, SHEET_BATCH, recordsSay, sheetFor, songsToRead, wordsFit } from "./words";
import { command, detectApp, seekTo, trimQueue, playerState, playlistIdOf, queueNext, playlistSongs, publicSongs, requestCode, requestPearToken, requestToken, searchSongs, videoIdOf, YtmError, type YtmApp, type YtmSong } from "./ytmusic";

/**
 * The soundtrack (Almanac plan J3), on YouTube Music: a cue read from the story (mood, intensity,
 * hour, weather, place, genre), a picker over your library (tracks you've tagged, leitmotifs
 * pinned to people and bonds, your taste and thumbs), and a director that lets each song play to
 * its end, cutting only for a rare big moment. Your preferred artists' songs join the library by themselves: th-ch's app finds them, and
 * the helper model tags their moods. Off by default; it talks to the YouTube Music app on this PC
 * (and to YouTube Music's website only to read a playlist link you paste, and to find a song's
 * explicit version by its title and artist).
 */

export const MOODS = ["calm", "tender", "melancholy", "tense", "dread", "bright", "epic", "mystery", "night"] as const;
export type Mood = (typeof MOODS)[number];

export const trackSchema = z.object({
  videoId: z.string().regex(/^[\w-]{11}$/),
  title: z.string().max(200),
  artist: z.string().max(120).default(""),
  moods: z.array(z.enum(MOODS)).max(9).default([]),
  instrumental: z.boolean().default(false),
  /** True: this is the explicit version. False: Mea looked, and there's none to play instead. Unset: not looked yet. */
  explicit: z.boolean().optional(),
  /** docs/34 2.2: you set these moods yourself, so a song card's guess never replaces them. */
  moodsByHand: z.boolean().optional(),
});
export type Track = z.infer<typeof trackSchema>;

export const musicConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().min(1).max(65535).default(9863),
  library: z.array(trackSchema).max(500).default([]),
  /** A song pinned to a person ("Spike") or a bond ("Spike & Buffy"): it comes back when they share a scene. */
  leitmotifs: z.array(z.object({ who: z.string().max(120), videoId: z.string().regex(/^[\w-]{11}$/) })).max(100).default([]),
  taste: z
    .object({
      preferred: z.array(z.string().max(80)).max(40).default([]),
      banned: z.array(z.string().max(80)).max(40).default([]),
      instrumentalInDialogue: z.boolean().default(false),
      /** Versions never played (nor added by a lookup): live recordings, remixes, acoustic takes, sped-up edits, demos. */
      blockVersions: z.array(z.enum(VERSIONS)).max(VERSIONS.length).default([]),
    })
    .default({ preferred: [], banned: [], instrumentalInDialogue: false, blockVersions: [] }),
  /** docs/18, 1.2: look for the library's lyrics on LRCLIB and YouTube Music (title, artist and length only). */
  lyricsOnline: z.boolean().default(false),
  /** docs/18, 3.2: how much a song's words count: not at all, a little, or leaning in (the chorus that fits plays). */
  wordsDial: z.enum(["off", "little", "lean"]).default("little"),
  /** docs/18, 4.2: start a song at the passage that fits ("auto": only when the dial is Lean in). */
  landLine: z.enum(["auto", "on", "off"]).default("auto"),
  /** Library songs with an explicit version play that one, not the censored copy. */
  preferExplicit: z.boolean().default(true),
  /** docs/34 3.1: with a child in the scene, sexual songs drop far down the list. */
  childLean: z.boolean().default(true),
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
  return { ...rest, connected: Boolean(token), canSearch: app === "pear", tasteFound, explicitPending: explicitDue({ ...rest, token, app }).length, ...wordsView(rest.library) };
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
  explicitSoon();
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
  if (add.length) explicitSoon();
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
      const fresh = songs.filter((s) => !known.has(s.videoId) && !blockedVersion(s.title, cfg.taste.blockVersions as Version[])).map((s) => trackSchema.parse({ videoId: s.videoId, title: s.title.slice(0, 200) || s.videoId, artist: s.artist.slice(0, 120), instrumental: /instrumental/i.test(s.title), explicit: s.explicit }));
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
  if (/aftermath/.test(mode)) bump("melancholy", 3);
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

export interface ChatMusic {
  on?: boolean;
  votes?: Record<string, number>;
  /** "Not for this scene": by cue key. */
  notFor?: Record<string, string[]>;
  recent?: string[];
  lastKey?: string;
  now?: { videoId: string; title: string; artist: string; key: string; why: string; at: number; words?: PickWords; /** Seconds in the song was started at (4.2). */ landed?: number } | null;
  /** The scene a song was last started at its passage: the next song in it plays from the top. */
  landedScene?: number;
  /** docs/18, 2.3: what was happening at the last beat. */
  moment?: Moment | null;
  /** docs/18, 3.3: "Wrong words": by situation, passages ("videoId#index") that don't count for it in this story. */
  wordsNo?: Record<string, string[]>;
  /** 👍 on a song picked by its words: by situation, how much each passage is raised. */
  wordsYes?: Record<string, Record<string, number>>;
  /** docs/34 4.3: the judge's last verdict, kept with the reply it was made at, so a swipe keeps the song. */
  judged?: Verdict & { key: string };
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
const briefHere = (m: Moment | null | undefined, cue: Cue) => (m && m.key.split("|")[1] === cue.key.split("|")[0] ? m : null);
/** This scene's moment, when something is happening a song's words could be about. */
const momentHere = (m: Moment | null | undefined, cue: Cue) => (briefHere(m, cue)?.situations.length ? m! : null);
/** How far a sexual song sinks with a child in the scene: more than the mood can make up. */
const CHILD_HEAT = 4.5;

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

export type PickOpts = {
  dialogue?: boolean;
  exclude?: string[];
  words?: WordsCtx | null;
  themes?: Map<string, Situation[]> | null;
  rand?: () => number;
  /** docs/34 4.2: the song may start at its passage (a cut with Land the line on), so the passage counts in full. */
  land?: boolean;
};
/** One song as the picker scored it. */
export interface Scored {
  track: Track;
  score: number;
  why: string;
  words?: PickWords;
  lead: boolean;
  parts: PlayParts;
  /** docs/34 4.1: why the scene rules it out (it's only scored when nothing passes). */
  gate?: string;
  /** docs/34 4.4: safe under anything with this mood. */
  safe?: boolean;
}
/** One song in the roll, with its chance against the others'. */
export type InRoll = Scored & { weight: number };

/** The best few songs after the pick, for the log. */
const runnersOf = (scored: Scored[], picked: string): Runner[] =>
  scored
    .filter((s) => s.track.videoId !== picked)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => ({ videoId: s.track.videoId, title: s.track.title, artist: s.track.artist, score: Math.round(s.score * 100) / 100, why: s.why }));

const toPick = (s: Scored, scored: Scored[]): Pick => ({ track: s.track, why: s.why, ...(s.words ? { words: s.words } : {}), score: Math.round(s.score * 100) / 100, parts: s.parts, runners: runnersOf(scored, s.track.videoId) });

export function pickTrack(cfg: MusicConfig, cue: Cue, music: ChatMusic, opts: PickOpts = {}): Pick | null {
  const r = rankTracks(cfg, cue, music, opts);
  if (!r) return null;
  if (r.theme) return toPick(r.theme, r.scored);
  let roll = (opts.rand ?? Math.random)() * r.roll.reduce((n, s) => n + s.weight, 0);
  const pick = r.roll.find((s) => (roll -= s.weight) < 0) ?? r.roll.at(-1)!;
  return toPick(pick, r.scored);
}

/**
 * Every song the picker could play at this beat, scored, and the roll it chooses from: the theme of
 * the people here when it's due (it always plays), otherwise the songs near the top. The replay
 * bench reads the roll's weights to say how likely each song was.
 */
export function rankTracks(cfg: MusicConfig, cue: Cue, music: ChatMusic, opts: PickOpts = {}): { scored: Scored[]; roll: InRoll[]; theme: Scored | null; pool: Scored[]; brief: Moment | null; nothing: boolean } | null {
  const banned = cfg.taste.banned.map((a) => a.toLowerCase());
  const preferred = cfg.taste.preferred.map((a) => a.toLowerCase());
  // Every copy of a song (a live take, the album cut) is the same song: skipping or having played one counts for all.
  const keyOf = new Map(cfg.library.map((t) => [t.videoId, songKey(t)]));
  const key = (videoId: string) => keyOf.get(videoId) ?? videoId;
  const skip = new Set([...(music.notFor?.[cue.key] ?? []), ...(opts.exclude ?? [])].map(key));
  const motif = leitmotifFor(cfg, cue.present);
  // "Hozier & Bear McCreary" is a Hozier song.
  const byAny = (names: string[], artist: string) => names.some((a) => a && artist.toLowerCase().includes(a));
  const blocked = cfg.taste.blockVersions as Version[];
  const allowed = cfg.library.filter((t) => !skip.has(key(t.videoId)) && !byAny(banned, t.artist) && !blockedVersion(t.title, blocked) && !(opts.dialogue && cfg.taste.instrumentalInDialogue && !t.instrumental));
  // A song mostly about something the lead mood can't hold (grief under a tender scene) doesn't count as that mood.
  const moment = opts.words?.moment ?? null;
  const off = (t: Track) => offTheme(cue, opts.themes?.get(t.videoId) ?? opts.words?.sheets.get(t.videoId)?.situations ?? null, moment);
  const isLead = (t: Track) => Boolean(cue.moods[0] && t.moods.includes(cue.moods[0]) && !off(t));
  // Songs played lately sit out, the latest first: as many as leaves a few that suit the lead mood
  // (or, with none that do, a few of any), and always the last one if there's another.
  const leads = allowed.filter(isLead);
  const poolKeys = new Set((leads.length ? leads : allowed).map((t) => key(t.videoId)));
  const recent = [...new Set((music.recent ?? []).map(key))];
  const out = new Set(recent.filter((k) => poolKeys.has(k)).slice(0, Math.max(Math.min(1, poolKeys.size - 1), poolKeys.size - FRESH_POOL)));
  const moodScore = (t: Track) => t.moods.filter((m) => cue.moods.includes(m)).length * 2 + (t.moods[0] && t.moods[0] === cue.moods[0] ? 1 : 0) - (off(t) ? OFF_THEME : 0);
  const fresh = allowed.filter((t) => !out.has(key(t.videoId)));
  const brief = briefHere(music.moment, cue);
  const cards = brief ? allCards() : null;
  const cardFor = (t: Track) => cards?.get(key(t.videoId))?.card ?? null;
  // docs/34 3.1: a child is here, so a sexual song sinks far down the list (not out: the heat gate stands aside), a flirting one a little.
  const heatCost = (t: Track) => {
    if (!cfg.childLean || !brief?.child) return 0;
    const heat = cardFor(t)?.heat;
    return heat === "sexual" ? -CHILD_HEAT : heat === "flirting" ? -CHILD_HEAT / 3 : 0;
  };
  // docs/34 4.2: the brief's gist against each whole song, with embeddings on.
  const gistVec = opts.words?.momentVec ?? null;
  // The words lift a song only if its sound is close: they never drag in one in the wrong mood.
  const bestMood = Math.max(0, ...fresh.map(moodScore));
  const scored = fresh.map((t): Scored => {
    const overlap = t.moods.filter((m) => cue.moods.includes(m));
    const heat = heatCost(t);
    const card = cardFor(t);
    const isMotif = motif?.videoId === t.videoId;
    // docs/34 4.1: out before scoring if it would grate. A leitmotif passes every gate: you pinned it.
    const gate = isMotif ? null : gateOf(card, brief);
    const fit = card && brief ? cardFit(card, brief, { fromTop: !opts.land, cardVec: gistVec ? cardVector(key(t.videoId)) : null, gistVec }) : null;
    const parts: PlayParts = { mood: moodScore(t), words: 0, motif: 0, votes: music.votes?.[t.videoId] ?? 0, preferred: byAny(preferred, t.artist) ? 1 : 0, ...(heat ? { heat } : {}), ...(fit ? { fit: fit.score } : {}) };
    let why = overlap.length ? `fits: ${overlap.join(", ")}` : "nothing closer";
    const w = parts.mood >= bestMood - 2 ? wordsScore(opts.words ?? null, t.videoId) : null;
    if (w) {
      // 4.2: a passage counts in full only when the song will start there; played from the top, the card's opening counts instead.
      parts.words = card && !opts.land ? Math.round(w.score * 50) / 100 : w.score;
      if (w.score >= 0.5) why = `fits: ${[...overlap, ...w.words.situations].join(", ")}${w.line ? ` — "${clip(w.line, 60)}"` : ""}`;
    } else if (fit?.shared.length) why = `fits: ${[...overlap, ...fit.shared].join(", ")}`;
    if (isMotif) {
      parts.motif = 6;
      why = `${motif.who}'s theme`;
    }
    const score = parts.mood + parts.words + parts.motif + parts.votes + parts.preferred + (parts.heat ?? 0) + (parts.fit ?? 0);
    return { track: t, score, why, ...(w ? { words: w.words } : {}), lead: isLead(t), parts, ...(gate ? { gate } : {}), ...(background(card, brief) && !gate ? { safe: true } : {}) };
  });
  if (!scored.length) return null;
  // The theme of the people here comes back whenever it hasn't played lately.
  const theme = scored.find((s) => s.track.videoId === motif?.videoId) ?? null;
  // 4.1 / 4.4: only songs past the gates. If none pass, the ones safe under anything; if none of
  // those, every song as before (it still plays something), and either way the chip says nothing fits.
  const passed = scored.filter((s) => !s.gate);
  const safeAny = scored.filter((s) => background(cardFor(s.track), brief));
  const nothing = !passed.length;
  const pool = passed.length ? passed : safeAny.length ? safeAny : scored;
  // Not always the one best fit: any song close to it can play, the closer the likelier, and one
  // still in the history (played a while ago) less so. A song without the lead mood never stands
  // in for one with it (4.2): with any lead song left, only lead songs roll.
  const leadPool = pool.filter((s) => s.lead);
  const from = leadPool.length ? leadPool : pool;
  const top = Math.max(...from.map((s) => s.score));
  const roll = from
    .filter((s) => s.score >= top - 2)
    .map((s) => ({ ...s, ...(nothing ? { why: NOTHING_FITS } : {}), weight: 3 ** (s.score - top) * (recent.includes(key(s.track.videoId)) ? 0.4 : 1) }));
  return { scored, roll, theme, pool: from, brief, nothing };
}

/**
 * docs/34 4.3-4.5: a song for this change, with the judge. The best few past the gates go to the
 * helper with the brief and their cards; the song plays from its top three (the first most often,
 * with its one line of reason), or, when it says none fit, from the songs safe under anything, and
 * the chip says so. The verdict is kept under `judgeKey` (the reply), so a swipe keeps the song. No
 * brief the helper read, fewer than two songs with cards, or a failed call: the fit score picks.
 */
export async function chooseTrack(cfg: MusicConfig, cue: Cue, music: ChatMusic, opts: PickOpts & { chatId: string; judgeKey?: string }): Promise<Pick | null> {
  const r = rankTracks(cfg, cue, music, opts);
  if (!r) return null;
  if (r.theme) return toPick(r.theme, r.scored);
  const fallback = () => pickTrack(cfg, cue, music, opts);
  const brief = r.brief;
  if (!brief || brief.readSeq == null || r.nothing) return fallback();
  const top = [...r.pool].sort((a, b) => b.score - a.score).slice(0, JUDGE_TOP);
  const cards = allCards();
  const songs = top.map((s) => ({ videoId: s.track.videoId, title: s.track.title, artist: s.track.artist, card: cards.get(songKey(s.track))?.card ?? null }));
  if (songs.filter((s) => s.card).length < 2) return fallback();
  let verdict: Verdict;
  const kept = opts.judgeKey && music.judged?.key === opts.judgeKey ? music.judged : null;
  if (kept && kept.order.every((v) => songs.some((s) => s.videoId === v))) verdict = kept;
  else {
    try {
      verdict = await judgeSongs(brief, cue.moods, songs, opts.chatId);
    } catch (e) {
      console.error("[mea] soundtrack: the judge didn't answer:", (e as Error).message);
      return fallback();
    }
    if (opts.judgeKey) setChatMusic(opts.chatId, { judged: { key: opts.judgeKey, ...verdict } });
  }
  const rand = opts.rand ?? Math.random;
  const recent = music.recent ?? [];
  if (verdict.none) {
    // 4.4: for the mood, from the songs safe under anything (the lead mood first); never a claimed fit.
    const safe = r.pool.filter((s) => s.safe);
    const from = safe.length ? safe : r.pool;
    const best = Math.max(...from.map((s) => s.score));
    const near = from.filter((s) => s.score >= best - 2);
    let roll = rand() * near.reduce((n, s) => n + 3 ** (s.score - best), 0);
    const s = near.find((x) => (roll -= 3 ** (x.score - best)) < 0) ?? near.at(-1)!;
    return { ...toPick({ ...s, why: NOTHING_FITS }, r.scored), parts: { ...s.parts, judge: 0 } };
  }
  // The roll is among the judge's top three, the first most often.
  const three = verdict.order.slice(0, 3).map((v) => top.find((s) => s.track.videoId === v)!);
  const weights = three.map((s, i) => [6, 2, 1][i]! * (recent.includes(s.track.videoId) ? 0.4 : 1));
  let roll = rand() * weights.reduce((n, w) => n + w, 0);
  const i = Math.max(0, weights.findIndex((w) => (roll -= w) < 0));
  const s = three[i] ?? three[0]!;
  return { ...toPick({ ...s, why: i === 0 && verdict.reason ? verdict.reason : s.why }, r.scored), parts: { ...s.parts, judge: i + 1 } };
}

/**
 * What a song is mostly about (its sheet's first two situations) that a lead mood can't hold: a
 * grief or heartbreak song doesn't suit a tender scene, a celebration doesn't suit dread. Unless
 * it's what's happening: a heartbreak song is right when the moment is heartbreak.
 */
const AGAINST: Partial<Record<Mood, Situation[]>> = {
  tender: ["grief", "heartbreak", "betrayal", "revenge", "the fight", "jealousy"],
  bright: ["grief", "heartbreak", "betrayal", "fear", "guilt"],
  calm: ["the fight", "revenge", "fear", "betrayal"],
  tense: ["peace", "celebration"],
  dread: ["peace", "celebration", "first love"],
};
/** How far a song about the wrong thing drops: below every song that suits the mood. */
const OFF_THEME = 3;
export function offTheme(cue: { moods: Mood[] }, about: Situation[] | null, moment: { situations: Situation[] } | null) {
  const against = cue.moods[0] ? AGAINST[cue.moods[0]] : undefined;
  if (!against || !about?.length) return false;
  return about.slice(0, 2).some((s) => against.includes(s) && !moment?.situations.includes(s));
}

/** How many songs a play history leaves to choose from, and how far back it goes. */
const FRESH_POOL = 3;
const HISTORY = 60;

/**
 * The song playing still suits the scene: it's the theme of the people here, or it passes the scene's
 * gates and its words fit what's happening, or it's the lead mood and its words don't go against it
 * (a celebration over grief).
 */
export function stillFits(cfg: MusicConfig, cue: Cue, videoId: string, words: WordsCtx | null = null, themes: Map<string, Situation[]> | null = null, brief: Brief | null = null) {
  if (leitmotifFor(cfg, cue.present)?.videoId === videoId) return true;
  // docs/34 4.6: the same gates as the picker, so a big moment cuts a song that now grates.
  const playing = cfg.library.find((x) => x.videoId === videoId);
  if (playing && gateOf(cardOf(playing)?.card ?? null, brief)) return false;
  if (words && clashes(words.sheets.get(videoId) ?? null, words.moment)) return false;
  if (offTheme(cue, themes?.get(videoId) ?? words?.sheets.get(videoId)?.situations ?? null, words?.moment ?? null)) return false;
  if ((wordsScore(words, videoId)?.words.score ?? 0) >= 1) return true;
  const t = cfg.library.find((x) => x.videoId === videoId);
  return Boolean(t && cue.moods[0] && t.moods.includes(cue.moods[0]));
}

/**
 * A moment big enough to stop a song partway: someone died, or a secret came out. Only these: new
 * scenes and romance steps come in about every other reply, so cutting on them changed the song
 * long before it could end.
 */
export function bigMoment(messageId: string, chatId: string) {
  const changes = currentFold(chatId).result.changes[messageId] ?? [];
  return changes.some((c) => c.kind === "death" || (c.kind === "secret" && /revealed/i.test(c.text)));
}

/** Mostly dialogue: instrumental-only taste applies. */
const dialogueHeavy = (text: string) => (text.match(/[“"][^”"]+[”"]/g) ?? []).join("").length > text.length * 0.4;

/** A song chosen, why, and (for the log) its score, what made it, and what came close. */
type Pick = { track: Track; why: string; words?: PickWords; score?: number; parts?: PlayParts; runners?: Runner[] };

/** The cue as the play log keeps it. */
const playCue = (cue: Cue): PlayCue => ({ moods: cue.moods, intensity: cue.intensity, place: cue.place, present: cue.present, genre: cue.genre, key: cue.key });

/** What each song is about, for the theme check (none with the words dial off). */
export const themesFor = (cfg: MusicConfig) => (cfg.wordsDial === "off" ? null : songThemes(cfg.library.map((t) => t.videoId)));

/** What's playing for this chat now (the header shows it), and what's played lately. */
function remember(chatId: string, pick: Pick, key: string, landed?: number) {
  const m = chatMusic(chatId);
  setChatMusic(chatId, { lastKey: key, recent: [pick.track.videoId, ...(m.recent ?? []).filter((v) => v !== pick.track.videoId)].slice(0, HISTORY), now: { videoId: pick.track.videoId, title: pick.track.title, artist: pick.track.artist, key, why: pick.why, at: Date.now(), ...(pick.words ? { words: pick.words } : {}), ...(landed != null ? { landed } : {}) } });
}

/** How long to wait for the app to be on the new song before moving it to the passage. */
const LAND_WAIT_MS = 5_000;

/** How a song came to play and how the one before it ended, for the play log (docs/34, 1.1). */
type PlayNote = { how: PlayHow; ending: PlayEnding; cue: Cue; messageId?: string | null; heard?: number | null };

/** A song starts in the play log, ending the one before it. Never stops the music. */
function logPlay(chatId: string, pick: Pick, note: PlayNote, landed?: number) {
  try {
    openPlay({ chatId, messageId: note.messageId ?? null, videoId: pick.track.videoId, title: pick.track.title, artist: pick.track.artist, how: note.how, why: pick.why, cue: playCue(note.cue), moment: chatMusic(chatId).moment ?? null, score: pick.score ?? null, parts: pick.parts ?? null, runners: pick.runners ?? [], landed: landed ?? null, ending: note.ending, heard: note.heard });
  } catch (e) {
    console.error("[mea] soundtrack: couldn't log the play:", (e as Error).message);
  }
}

async function play(chatId: string, cfg: MusicConfig, pick: Pick, key: string, note: PlayNote, opts: { land?: { at: number; scene: number } | null } = {}) {
  if (!cfg.token) return;
  await command(cfg, { command: "changeVideo", data: { videoId: pick.track.videoId } });
  // A song already queued in the app still follows this one, so it stays lined up.
  if (!pending?.queued || pending.track.videoId === pick.track.videoId) pending = null;
  // Nothing else is left to follow it: an old album in the queue would play the moment Mea is late.
  await trimQueue(cfg, pending?.queued ? [pending.track.videoId] : []).catch(() => 0);
  const landed = opts.land ? await landAt(cfg, pick.track.videoId, opts.land.at) : false;
  remember(chatId, pick, key, landed ? opts.land!.at : undefined);
  logPlay(chatId, pick, note, landed ? opts.land!.at : undefined);
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
  const w = pick.words;
  if (!mayLand(cfg, music, sceneNo) || !w || w.score < 1.5) return null;
  if (pick.why.endsWith("'s theme")) return null;
  const sheet = sheetFor(pick.track.videoId);
  const lyrics = lyricsFor(pick.track.videoId);
  if (!sheet || !lyrics?.timed) return null;
  return landingPoint(sheet, lyrics.lines, w.passage, lyrics.duration);
}

/** A song picked now could start at its passage: Land the line is on and hasn't landed in this scene. */
const mayLand = (cfg: MusicConfig, music: ChatMusic, sceneNo: number) => (cfg.landLine === "on" || (cfg.landLine === "auto" && cfg.wordsDial === "lean")) && music.landedScene !== sceneNo;

// ---------- one song after another ----------

/** The chat whose soundtrack is playing, and the song lined up to follow this one. */
let active: string | null = null;
let pending: (Pick & { key: string; chatId: string; queued: boolean; cue: Cue }) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
/** The song Mea chose was near its end at the last look: if the app is on another song now, it moved on by itself. */
let nearEnd: { chatId: string; videoId: string } | null = null;
/** Seconds before the end that the next song is lined up. */
const LINE_UP = 12;
const WATCH_MS = 4_000;
/** With no queue to line a song up in: how near the end to stay and wait, and how early to start the next one. */
const LAST_SECONDS = WATCH_MS / 1000 + 1;
const START_EARLY = 0.5;
/** How far from the end the app can say a song is after that wait (its clock runs about a second behind). */
const AT_THE_END = 2;

/**
 * Waits out a song's last seconds, for an app with no queue. If Mea looked after the song ended, the
 * app would already be a few seconds into a song of its own when Mea changed it. False if it isn't
 * in its last seconds, or you paused it, moved it or changed it meanwhile.
 */
async function reachedEnd(cfg: MusicConfig, videoId: string) {
  const secondsLeft = async () => {
    const s = await playerState(cfg);
    return s.videoId === videoId && s.playing && s.duration && s.elapsed != null ? s.duration - s.elapsed : null;
  };
  const left = await secondsLeft();
  if (left == null || left > LAST_SECONDS) return false;
  await Bun.sleep(Math.max(0, left - START_EARLY) * 1000);
  const after = await secondsLeft();
  return after != null && after <= AT_THE_END;
}

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
  nearEnd = null;
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
      logPlay(chatId, pending, { how: "next", ending: "played", cue: pending.cue });
      pending = null;
      return;
    }
    // The app went on to a song of its own (autoplay, or a queue from before) as Mea's ended: Mea takes over again.
    const wandered = s.videoId !== m.now.videoId && nearEnd?.chatId === chatId && nearEnd.videoId === m.now.videoId;
    if (!wandered && (s.videoId !== m.now.videoId || s.duration == null || s.elapsed == null || !s.duration)) return;
    const left = wandered ? 0 : s.duration! - s.elapsed!;
    const ended = wandered || (!s.playing && left <= 2);
    nearEnd = left <= LINE_UP && !wandered ? { chatId, videoId: m.now.videoId } : null;
    if (left > LINE_UP && !ended) return;
    if (!pending || pending.chatId !== chatId) {
      const st = currentFold(chatId).result.state;
      const cue = cueFrom(st, storyDials(mustChat(chatId)).genre);
      await momentNow(chatId, st, cue);
      const music = chatMusic(chatId);
      const pick = await chooseTrack(cfg, cue, music, { chatId, exclude: [m.now.videoId], words: await wordsContext(cfg, music, cue), themes: themesFor(cfg) });
      if (!pick) return;
      pending = { ...pick, key: cue.key, chatId, queued: false, cue };
    }
    if (!ended && !pending.queued) {
      pending.queued = await queueNext(cfg, pending.track.videoId);
      if (pending.queued) return;
    }
    if (ended || (!pending.queued && (await reachedEnd(cfg, m.now.videoId)))) await play(chatId, cfg, pending, pending.key, { how: "next", ending: "played", cue: pending.cue });
  } catch (e) {
    if (!(e instanceof YtmError)) console.error("[mea] soundtrack:", (e as Error).message);
  } finally {
    ticking = false;
  }
}

/**
 * The director (an onTrackerUpdate hook). A song plays to its end: a new scene or a shift of mood
 * or time doesn't cut, and the next song, picked as this one ends, follows the story. Only a big
 * moment cuts to a new song, and only if the one playing doesn't suit it. Never throws; YouTube
 * Music not answering just means the music holds.
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
    explicitSoon();
    if (!cfg.library.length) return;
    const st = currentFold(chatId).result.state;
    const cue = cueFrom(st, storyDials(mustChat(chatId)).genre);
    const start = !music.now || !music.lastKey;
    const turn = bigMoment(messageId, chatId);
    const text = one<{ content: string }>("SELECT s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.id = ?", messageId)?.content ?? "";
    // A beat (or the start): what's happening now, for picking by the words.
    if (start || turn) await momentAt(chatId, messageId, st, cue, text, music.moment ?? null);
    const words = start || turn ? await wordsContext(cfg, chatMusic(chatId), cue) : null;
    const themes = themesFor(cfg);
    if (!start && !(turn && !stillFits(cfg, cue, music.now!.videoId, words, themes, briefHere(chatMusic(chatId).moment, cue)))) return;
    // The same reply picks the same song on every swipe (3.1).
    const seq = one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", messageId)?.seq ?? 0;
    const now = chatMusic(chatId);
    const pick = await chooseTrack(cfg, cue, now, {
      chatId,
      judgeKey: `${messageId}|${cue.key}`,
      dialogue: dialogueHeavy(text),
      exclude: [music.now?.videoId, pending?.queued ? pending.track.videoId : undefined].filter((v): v is string => Boolean(v)),
      words,
      themes,
      land: mayLand(cfg, now, st.sceneNo),
      rand: seeded(chatId, seq, `music:${cue.key}`),
    });
    if (pick) {
      const at = landingFor(cfg, chatMusic(chatId), pick, st.sceneNo);
      await play(chatId, cfg, pick, cue.key, { how: start ? "start" : "big", ending: start ? "replaced" : "cut", cue, messageId }, { land: at != null ? { at, scene: st.sceneNo } : null });
    }
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
    if (action === "off") closePlay(chatId, "off");
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
    markPlay(chatId, "wrongWords");
    return chatMusicView(chatId);
  }
  if (!cfg.token) throw badRequest("Connect YouTube Music first (Settings › Music)");
  const cue = cueFrom(currentFold(chatId).result.state, storyDials(mustChat(chatId)).genre);
  const cur = music.now?.videoId;
  if (action === "playPause") await command(cfg, { command: "playPause" });
  else if (action === "up" || action === "down") {
    if (!cur) throw badRequest("Nothing Mea chose is playing");
    setChatMusic(chatId, { votes: { ...(music.votes ?? {}), [cur]: (music.votes?.[cur] ?? 0) + (action === "up" ? 1 : -1) } });
    markPlay(chatId, action);
    // 👍 on a song picked by its words raises that passage for what's happening.
    const w = music.now?.words;
    if (action === "up" && w) {
      const yes = { ...(music.wordsYes ?? {}) };
      for (const s of w.situations) yes[s] = { ...(yes[s] ?? {}), [`${cur}#${w.passage}`]: (yes[s]?.[`${cur}#${w.passage}`] ?? 0) + 1 };
      setChatMusic(chatId, { wordsYes: yes });
    }
    if (action === "down") await changeSong(chatId, cfg, cue, cur, "down");
  } else await changeSong(chatId, cfg, cue, cur, action === "notForScene" ? "notFor" : "skip");
  return chatMusicView(chatId);
}

/** Skip, Not for this scene or 👎: the next song that fits, and the log says how far into this one you were. */
async function changeSong(chatId: string, cfg: MusicConfig, cue: Cue, cur: string | undefined, how: "skip" | "notFor" | "down") {
  const music = chatMusic(chatId);
  if (how === "notFor" && cur) setChatMusic(chatId, { notFor: { ...(music.notFor ?? {}), [cue.key]: [...(music.notFor?.[cue.key] ?? []), cur] } });
  const now = chatMusic(chatId);
  const pick = await chooseTrack(cfg, cue, now, { chatId, exclude: cur ? [cur] : [], words: await wordsContext(cfg, now, cue), themes: themesFor(cfg) });
  if (!pick) throw badRequest("Nothing else in your library fits");
  const heard = cur ? await playerState(cfg).then((s) => (s.videoId === cur ? s.elapsed : null)).catch(() => null) : null;
  await play(chatId, cfg, pick, cue.key, { how, ending: how === "skip" ? "skipped" : how, cue, heard });
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
  return { available: cfg.enabled && Boolean(cfg.token), on: Boolean(m.on), now: m.now ?? null, cue, vote: m.now ? (m.votes?.[m.now.videoId] ?? 0) : 0, moment: m.moment ?? null, scene: m.moment ? sceneLine(m.moment) : "" };
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
  let fresh = songs.filter((s) => !have.has(s.videoId)).map((s) => trackSchema.parse({ videoId: s.videoId, title: s.title.slice(0, 200) || s.videoId, artist: s.artist.slice(0, 120), moods: input.moods ?? [], ...(input.moods?.length ? { moodsByHand: true } : {}), instrumental: input.instrumental || /instrumental/i.test(s.title), explicit: s.explicit }));
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
  if (fresh.length) explicitSoon();
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
  const track = trackSchema.parse({ videoId, title: title || videoId, artist, moods: input.moods ?? [], ...(input.moods?.length ? { moodsByHand: true } : {}), instrumental: input.instrumental ?? false });
  // Re-read: the library may have changed while YouTube Music answered.
  const now = musicConfig();
  setSetting("music.config", { ...now, library: [...now.library.filter((t) => t.videoId !== videoId), track] } as never);
  markRemoved(videoId, false);
  lyricsSoon();
  explicitSoon();
  return musicView();
}

/**
 * One song's moods or instrumental flag. Edits go song by song: a whole library sent from the
 * page could be seconds old and drop songs a lookup added since.
 */
export function retagTrack(videoId: string, patch: { moods?: Mood[]; instrumental?: boolean }) {
  const cfg = musicConfig();
  if (!cfg.library.some((t) => t.videoId === videoId)) throw badRequest("That song isn't in the library");
  const hand = patch.moods ? { moodsByHand: true } : {};
  setSetting("music.config", { ...cfg, library: cfg.library.map((t) => (t.videoId === videoId ? { ...t, ...patch, ...hand } : t)) } as never);
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

// ---------- explicit versions ----------

/** Between songs, so YouTube Music isn't asked about a whole library at once. */
const EXPLICIT_GAP_MS = 2_000;
const EXPLICIT_DOWN_MS = 2 * 60_000;

/** Songs not looked into yet. Not instrumentals (no words to censor), nor versions you've blocked (they never play). */
function explicitDue(cfg: MusicConfig): Track[] {
  if (!cfg.enabled || !cfg.preferExplicit) return [];
  return cfg.library.filter((t) => t.explicit === undefined && !t.instrumental && !blockedVersion(t.title, cfg.taste.blockVersions as Version[]));
}

/** Looks through the library in the background (one job, one song at a time), when the switch is on. */
export function explicitSoon() {
  if (explicitDue(musicConfig()).length) enqueue("music.explicit", {}, { dedupeKey: "music.explicit", priority: -1, maxAttempts: 5 });
}

/** The explicit copy of this song in a search's results: same title, same first artist, same recording. */
export function explicitCopy(t: { videoId: string; title: string; artist: string }, rows: YtmSong[], skip: Set<string> = new Set()) {
  const key = songKey(t);
  return rows.find((r) => r.explicit && r.videoId !== t.videoId && !skip.has(r.videoId) && songKey(r) === key && sameCut(r.title, t.title)) ?? null;
}

/** Thumbs and "played lately" go with the song to its new id, in every chat. Not the chat's order: this isn't news. */
function moveChatVotes(from: string, to: string) {
  for (const c of all<{ id: string; settings: string }>("SELECT id, settings FROM chats WHERE settings LIKE ?", `%${from}%`)) {
    const s = parseJson<ChatSettings>(c.settings, {});
    const m = s.music as ChatMusic | undefined;
    if (!m) continue;
    const votes = m.votes && from in m.votes ? Object.fromEntries(Object.entries(m.votes).map(([k, v]) => [k === from ? to : k, v])) : m.votes;
    const recent = m.recent?.map((v) => (v === from ? to : v));
    run("UPDATE chats SET settings = ? WHERE id = ?", JSON.stringify({ ...s, music: { ...m, ...(votes ? { votes } : {}), ...(recent ? { recent } : {}) } }), c.id);
  }
}

/** Plays the explicit copy from now on: its tags, words and pins stay. The censored copy counts as removed, so a lookup won't add it back. */
function swapToExplicit(t: Track, copy: YtmSong) {
  const cfg = musicConfig();
  const had = cfg.library.some((x) => x.videoId === copy.videoId);
  const library = had
    ? cfg.library.filter((x) => x.videoId !== t.videoId).map((x) => (x.videoId === copy.videoId ? { ...x, explicit: true } : x))
    : cfg.library.map((x) => (x.videoId === t.videoId ? { ...x, videoId: copy.videoId, title: copy.title.slice(0, 200) || x.title, explicit: true } : x));
  const leitmotifs = cfg.leitmotifs.map((l) => (l.videoId === t.videoId ? { ...l, videoId: copy.videoId } : l));
  setSetting("music.config", { ...cfg, library, leitmotifs } as never);
  if (moveLyrics(t.videoId, copy.videoId)) movePassageVectors(t.videoId, copy.videoId);
  else forgetPassageVectors([t.videoId]);
  moveChatVotes(t.videoId, copy.videoId);
  markRemoved(t.videoId, true);
  lyricsSoon();
}

/**
 * The `music.explicit` job: one song looked up, then the job comes round again for the next one. A
 * censored copy is the song you'd added, so the explicit one takes its place in the library, and
 * the song itself never comes up twice. YouTube Music not answering waits two minutes.
 */
export async function explicitStep() {
  const t = explicitDue(musicConfig())[0];
  if (!t) return;
  let rows: YtmSong[];
  try {
    rows = await publicSongs(`${bareTitle(t.title) || t.title} ${firstArtist(t.artist)}`.trim());
  } catch (e) {
    if (e instanceof YtmError) throw new Deferred(`Explicit versions: ${e.message}`, EXPLICIT_DOWN_MS);
    throw e;
  }
  // Read fresh: the library may have changed while YouTube Music answered.
  const cfg = musicConfig();
  if (cfg.library.some((x) => x.videoId === t.videoId)) {
    const self = rows.find((r) => r.videoId === t.videoId);
    const copy = self?.explicit ? null : explicitCopy(t, rows, removedIds());
    if (copy) swapToExplicit(t, copy);
    else setSetting("music.config", { ...cfg, library: cfg.library.map((x) => (x.videoId === t.videoId ? { ...x, explicit: Boolean(self?.explicit) } : x)) } as never);
  }
  if (explicitDue(musicConfig()).length) throw new Deferred("Looking for the next song's explicit version", EXPLICIT_GAP_MS);
}

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
  // docs/34 2.5: each song's card in short, for the library's filter and line.
  const stored = allCards();
  const cards: Record<string, { bond: string; stance: string; heat: string; energy: number; line: string }> = {};
  for (const t of library) {
    const c = stored.get(songKey(t))?.card;
    if (c) cards[t.videoId] = { bond: c.bond, stance: c.stance, heat: c.heat, energy: c.energy, line: cardLine(c) };
  }
  const due = cardsDue(library, true).length;
  return {
    words,
    wordsCount: { have, timed: count("timed"), pending: count("pending"), of: library.filter((t) => !t.instrumental).length, read: have - library.filter((t) => unread.has(t.videoId) && !t.instrumental).length },
    cards,
    cardsCount: { have: Object.keys(cards).length, due, calls: Math.ceil(due / SHEET_BATCH), reading: due > 0 && cardsAllowed() },
  };
}

/** The next song to look up: one never looked for, then a miss from long enough ago. Not instrumentals, not words you pasted. */
function dueForWords(cfg: MusicConfig): Track | null {
  const idx = lyricsIndex();
  const songs = cfg.library.filter((t) => !t.instrumental);
  // A miss, or YouTube Music's plain words (LRCLIB may have timed ones since), once they're old enough.
  const stale = (t: Track) => {
    const l = idx.get(t.videoId);
    return Boolean(l && (l.source === "none" || (l.source === "ytmusic" && !l.timed)) && Date.now() - l.fetchedAt > MISS_TTL);
  };
  return songs.find((t) => !idx.has(t.videoId)) ?? songs.find(stale) ?? null;
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
/** Both lyrics sites failing for a song: the next look is this much later. */
const WORDS_DOWN_MS = 2 * 60_000;

/**
 * The `music.lyrics` job: one song's words, then the job comes round again for the next one. A site
 * not answering for a song (both of them, or LRCLIB with nothing on YouTube Music) waits two
 * minutes; turning the switch off ends it.
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
    if (e instanceof YtmError) throw new Deferred(`Lyrics: ${e.message}`, WORDS_DOWN_MS);
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
  const t = inLibrary(videoId);
  return { words: lyricsFor(videoId), sheet: sheetFor(videoId), card: cardView(t) };
}

/** Words you paste for a song (plain or LRC); empty text forgets them, and they're looked up again. */
export function setSongWords(videoId: string, text: string) {
  const t = inLibrary(videoId);
  pasteLyrics(videoId, text);
  if (!text.trim()) lyricsSoon();
  else sheetsSoon();
  return { words: lyricsFor(videoId), sheet: sheetFor(videoId), card: cardView(t), view: musicView() };
}

/** Find again: forgets what Mea has (pasted words too) and looks the song up now. */
export async function findSongWords(videoId: string) {
  const t = inLibrary(videoId);
  if (!musicConfig().lyricsOnline) throw badRequest("Turn on Find lyrics online first");
  const found = await findLyrics(t);
  if (found.instrumental) markInstrumental(videoId);
  else if (found.lines.length) sheetsSoon();
  return { words: lyricsFor(videoId), sheet: sheetFor(videoId), card: cardView(t), view: musicView() };
}

// ---------- reading the songs (docs/18, 2.1-2.2) ----------

/**
 * docs/34 2.1: songs read before song cards existed have a sheet and no card. Re-reading them costs
 * a helper call per few songs, so it only happens once you've said yes (Settings › Music). A song
 * read for its sheet gets its card in the same call, without asking.
 */
const cardsAllowed = () => getSetting("music.cardsAllowed") === true;

/** Songs whose words have a sheet but whose song has no card, one copy per song. `any`: whether or not you've said yes. */
function cardsDue(library: Track[], any = false): { videoId: string; lines: LyricLine[] }[] {
  if (!any && !cardsAllowed()) return [];
  const have = allCards();
  const songs = library.filter((t) => !t.instrumental && !have.has(songKey(t)));
  const unread = new Set(songsToRead(songs.map((t) => t.videoId)).map((s) => s.videoId));
  const lines = lyricsLines(songs.map((t) => t.videoId).filter((id) => !unread.has(id)));
  const seen = new Set<string>();
  const out: { videoId: string; lines: LyricLine[] }[] = [];
  for (const t of songs) {
    const l = lines.get(t.videoId);
    const k = songKey(t);
    if (!l?.some((x) => x.text) || seen.has(k)) continue;
    seen.add(k);
    out.push({ videoId: t.videoId, lines: l });
  }
  return out;
}

/** What the sheets job has to read: words with no sheet, then (once you've said yes) songs with no card. */
function toRead(cfg: MusicConfig) {
  const songs = cfg.library.filter((t) => !t.instrumental);
  const sheets = songsToRead(songs.map((t) => t.videoId));
  const ids = new Set(sheets.map((s) => s.videoId));
  return [...sheets, ...cardsDue(songs).filter((s) => !ids.has(s.videoId))];
}

/** Reads songs with words and no sheet (or no card) in the background, a few per helper call. */
export function sheetsSoon() {
  if (!toRead(musicConfig()).length) return;
  enqueue("music.sheets", {}, { dedupeKey: "music.sheets", priority: -1 });
}

/** Your yes to reading cards for the songs already read (Settings › Music): about one helper call per four songs, once. */
export function readCards() {
  setSetting("music.cardsAllowed", true);
  sheetsSoon();
  return musicView();
}

/**
 * A card read for one copy of a song: saved for the song, and its guessed moods become the moods of
 * every copy whose moods you didn't set yourself (the old ones are kept, to put back).
 */
function applyCard(videoId: string, card: SongCard) {
  const cfg = musicConfig();
  const t = cfg.library.find((x) => x.videoId === videoId);
  if (!t) return;
  const key = songKey(t);
  const guessable = cfg.library.filter((x) => songKey(x) === key && !x.moodsByHand);
  const moods = card.moods.filter((m): m is Mood => (MOODS as readonly string[]).includes(m));
  const changes = moods.length > 0 && guessable.some((x) => x.moods.join() !== moods.join());
  saveReadCard(key, card, changes ? (guessable.find((x) => x.moods.length)?.moods ?? null) : null);
  if (changes) setSetting("music.config", { ...cfg, library: cfg.library.map((x) => (songKey(x) === key && !x.moodsByHand ? { ...x, moods } : x)) } as never);
}

/**
 * The `music.sheets` job: one helper call's worth of songs, then round again for the next few. A
 * song whose words suggest a mood it isn't tagged with gains it (one at most, never replacing yours).
 * With embeddings on, the passages get vectors; an embedding failure never loses a sheet.
 */
export async function sheetsStep() {
  const cfg = musicConfig();
  const todo = toRead(cfg).slice(0, SHEET_BATCH);
  if (todo.length) {
    const byId = new Map(cfg.library.map((t) => [t.videoId, t]));
    const read = await readSongs(
      todo.map((s) => ({ ...s, title: byId.get(s.videoId)?.title ?? "", artist: byId.get(s.videoId)?.artist ?? "" })),
      MOODS,
    );
    for (const s of todo) {
      const r = read.get(s.videoId);
      if (r) saveSheet(s.videoId, r.sheet, linesHash(s.lines));
      if (r?.card) applyCard(s.videoId, r.card);
    }
    // A song the reply gave no card: the one mood its words carry joins its tags, as before cards.
    const fresh = musicConfig();
    const extra = new Map([...read].filter(([id, r]) => !r.card && r.mood && !fresh.library.find((t) => t.videoId === id)?.moods.includes(r.mood as Mood)).map(([id, r]) => [id, r.mood as Mood]));
    if (extra.size) setSetting("music.config", { ...fresh, library: fresh.library.map((t) => (extra.has(t.videoId) && t.moods.length < 9 ? { ...t, moods: [...t.moods, extra.get(t.videoId)!] } : t)) } as never);
  }
  try {
    await embedPassages(musicConfig().library.map((t) => ({ videoId: t.videoId, sheet: sheetFor(t.videoId) })).filter((x): x is { videoId: string; sheet: NonNullable<typeof x.sheet> } => Boolean(x.sheet)));
  } catch (e) {
    console.error("[mea] soundtrack: couldn't embed passages:", (e as Error).message);
  }
  try {
    await embedCards([...allCards().values()].map((c) => ({ key: c.key, text: cardText(c.card) })));
  } catch (e) {
    console.error("[mea] soundtrack: couldn't embed song cards:", (e as Error).message);
  }
  if (toRead(musicConfig()).length) throw new Deferred("Reading the next songs' lyrics", 1_000);
}

// ---------- song cards (docs/34, Part 2) ----------

/** A song's card as Settings shows it: which fields are still a guess, and the moods it replaced. */
function cardView(t: Track, stored: StoredCard | null = cardOf(t)) {
  if (!stored) return null;
  return { ...stored.card, edited: stored.edited, guessed: [...SOUND_FIELDS.filter((f) => !stored.edited.includes(f)), ...(t.moodsByHand ? [] : ["moods"])], oldMoods: stored.oldMoods };
}

/** Your edit to a song's card (every copy of the song shares it). */
export function editSongCard(videoId: string, patch: unknown) {
  const t = inLibrary(videoId);
  const ok = cardPatch.safeParse(patch);
  if (!ok.success) throw badRequest("Invalid card", z.treeifyError(ok.error));
  const stored = editCard(songKey(t), ok.data);
  return { card: cardView(t, stored), view: musicView() };
}

/** The moods a card's guess replaced, back on every copy of the song, as yours. */
export function restoreOldMoods(videoId: string) {
  const t = inLibrary(videoId);
  const key = songKey(t);
  const old = cardOf(t)?.oldMoods;
  if (!old) throw badRequest("There are no earlier moods to put back");
  const cfg = musicConfig();
  const moods = old.filter((m): m is Mood => (MOODS as readonly string[]).includes(m));
  setSetting("music.config", { ...cfg, library: cfg.library.map((x) => (songKey(x) === key ? { ...x, moods, moodsByHand: true } : x)) } as never);
  dropOldMoods(key);
  return { card: cardView(inLibrary(videoId)), view: musicView() };
}

/** Any song in the library has a sheet: only then is the moment worth a helper call. */
const anySheets = (cfg: MusicConfig) => cfg.library.some((t) => sheetFor(t.videoId));

// ---------- the scene brief (docs/18, 2.3; docs/34, Part 3) ----------

/** A brief read by the helper holds for this many replies in the same scene. */
const REREAD_AFTER = 3;

const seqOf = (messageId: string) => one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", messageId)?.seq ?? null;
/** Replies the story has had after `from`, up to and with `to`. */
const repliesBetween = (chatId: string, from: number, to: number) =>
  one<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND role = 'assistant' AND deleted_at IS NULL AND hidden = 0 AND seq > ? AND seq <= ?", chatId, from, to)?.n ?? 0;
/** The replies before this one (their shown swipe), oldest first. */
const repliesBefore = (chatId: string, seq: number, n: number) =>
  all<{ content: string }>(
    "SELECT s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.chat_id = ? AND m.role = 'assistant' AND m.deleted_at IS NULL AND m.hidden = 0 AND m.seq < ? ORDER BY m.seq DESC LIMIT ?",
    chatId,
    seq,
    n,
  )
    .map((r) => r.content)
    .reverse();

/**
 * The records' bond outranks the reply's, except "self": one person on the cast often means the
 * tracker missed someone (a child in the back seat), so then the reply says who the scene is about.
 * Never "self" with a child here.
 */
function bondOf(records: Bond | null, reply: Bond | null, child: boolean): Bond | null {
  const b = records === "self" ? (reply ?? "self") : (records ?? reply);
  return child && b === "self" ? "family" : b;
}

const joinSits = (a: Situation[], b: Situation[]) => [...a, ...b.filter((x) => !a.includes(x))].slice(0, 4);

/** The chip's line: "family · happy in it · no heat · energy 2 — dinner chores, then the pool". */
export function sceneLine(m: Moment) {
  const line = briefLine(m);
  const what = m.gist || m.situations.join(", ");
  return [line, what].filter(Boolean).join(" — ");
}

/**
 * The scene at a beat, read once and kept. The records come first, free: what's happening (a death,
 * a secret out) and who the people here are to each other (bond, a child). One helper call reads the
 * last three replies for the rest (gist, stance, heat, energy, zero to three situations, what would
 * grate); the reply outranks the records' hints (someone walking off, a sad mood). That reading holds
 * for the scene until three more replies have come, or the records say something new happened, so most
 * song changes cost no new call. A swipe of the same beat reuses the moment. Without any song read
 * for its words, only the records are looked at. Never throws.
 */
export async function momentAt(chatId: string, messageId: string, st: WorldState, cue: Cue, text: string, prev: Moment | null) {
  try {
    const key = `${messageId}|${cue.key}`;
    if (prev?.key === key) return prev;
    const changes = currentFold(chatId).result.changes[messageId] ?? [];
    const say = recordsSay(changes, st, prev);
    const rec = recordsBrief(st, cue.present);
    const seq = seqOf(messageId);
    let moment: Moment = { situations: [...say.firm, ...say.hints].slice(0, 4), gist: "", key, from: "records", at: Date.now(), bond: rec.bond, child: rec.child, heat: rec.child ? "none" : null, scene: st.sceneNo };
    const held = prev?.readSeq != null && prev.scene === st.sceneNo && seq != null && repliesBetween(chatId, prev.readSeq, seq) < REREAD_AFTER && say.firm.every((s) => prev.situations.includes(s));
    if (held) {
      const child = rec.child || Boolean(prev.child);
      moment = { ...prev, key, at: Date.now(), situations: joinSits(say.firm, prev.situations), bond: bondOf(rec.bond, prev.bond ?? null, child), heat: child ? "none" : (prev.heat ?? null) };
    } else if (text.trim() && anySheets(musicConfig())) {
      try {
        const replies = [...(seq == null ? [] : repliesBefore(chatId, seq, REREAD_AFTER - 1)), text];
        const r = await readBrief({ replies, moods: cue.moods, place: cue.place, present: cue.present, records: rec, recordsSay: say }, chatId);
        const child = rec.child || r.child;
        moment = { ...moment, situations: joinSits(say.firm, r.strong), slight: r.slight, gist: r.gist, from: say.firm.length ? "both" : "reply", bond: bondOf(rec.bond, r.bond, child), stance: r.stance, heat: child ? "none" : r.heat, energy: r.energy, avoid: r.avoid, child, ...(seq != null ? { readSeq: seq } : {}) };
      } catch (e) {
        console.error("[mea] soundtrack: couldn't read the scene:", (e as Error).message);
      }
    }
    setChatMusic(chatId, { moment });
    return moment;
  } catch {
    return prev;
  }
}

/** The moment at the latest reply, before a song is picked mid-scene: the scene moves on between songs. */
async function momentNow(chatId: string, st: WorldState, cue: Cue) {
  const last = one<{ id: string; content: string }>(
    "SELECT m.id, s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.chat_id = ? AND m.role = 'assistant' AND m.deleted_at IS NULL AND m.hidden = 0 ORDER BY m.seq DESC LIMIT 1",
    chatId,
  );
  if (last) await momentAt(chatId, last.id, st, cue, last.content, chatMusic(chatId).moment ?? null);
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
