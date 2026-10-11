import { z } from "zod";
import { one, parseJson } from "../db/db";
import { badRequest } from "../lib/http";
import { getSetting, setSetting } from "../lib/settings";
import { type ChatSettings, mustChat, updateChat } from "../services/chats";
import { storyDials } from "../services/layers";
import { currentFold } from "../trackers/store";
import type { WorldState } from "../trackers/types";
import { command, detectApp, playerState, requestCode, requestPearToken, requestToken, videoIdOf, YtmError, type YtmApp } from "./ytmusic";

/**
 * The soundtrack (Almanac plan J3), on YouTube Music: a cue read from the story (mood, intensity,
 * hour, weather, place, genre), a picker over your library (tracks you've tagged, leitmotifs
 * pinned to people and bonds, your taste and thumbs), and a director that changes the music on
 * story beats only: a new scene, a change of mood or time of day, or a big moment. Otherwise it
 * holds. Off by default; it only ever talks to the YouTube Music app on this PC.
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
});
export type MusicConfig = z.infer<typeof musicConfigSchema> & { token?: string | null; app?: YtmApp | null };

export function musicConfig(): MusicConfig {
  const raw = getSetting("music.config") as Partial<MusicConfig> | null;
  return { ...musicConfigSchema.parse(raw ?? {}), token: raw?.token ?? null, app: raw?.app ?? null };
}
/** What the browser sees: everything but the token. */
export function musicView() {
  const { token, app: _app, ...rest } = musicConfig();
  return { ...rest, connected: Boolean(token) };
}
export function saveMusicConfig(patch: Partial<z.infer<typeof musicConfigSchema>>) {
  const cur = musicConfig();
  // Only what was sent changes (the schema's defaults would fill in the rest).
  const parsed = musicConfigSchema.partial().parse(patch) as Record<string, unknown>;
  const next = { ...cur, ...Object.fromEntries(Object.keys(patch).map((k) => [k, parsed[k]])) };
  setSetting("music.config", next as never);
  return musicView();
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
  now?: { videoId: string; title: string; artist: string; key: string; why: string; at: number } | null;
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

export function pickTrack(cfg: MusicConfig, cue: Cue, music: ChatMusic, opts: { dialogue?: boolean; exclude?: string[] } = {}): { track: Track; why: string } | null {
  const banned = cfg.taste.banned.map((a) => a.toLowerCase());
  const preferred = cfg.taste.preferred.map((a) => a.toLowerCase());
  const skip = new Set([...(music.notFor?.[cue.key] ?? []), ...(opts.exclude ?? [])]);
  const recent = music.recent ?? [];
  const motif = leitmotifFor(cfg, cue.present);
  let best: { track: Track; score: number; why: string } | null = null;
  for (const t of cfg.library) {
    if (skip.has(t.videoId) || banned.includes(t.artist.toLowerCase())) continue;
    if (opts.dialogue && cfg.taste.instrumentalInDialogue && !t.instrumental) continue;
    const overlap = t.moods.filter((m) => cue.moods.includes(m));
    let score = overlap.length * 2 + (t.moods[0] && t.moods[0] === cue.moods[0] ? 1 : 0);
    let why = overlap.length ? `fits: ${overlap.join(", ")}` : "nothing closer";
    if (motif?.videoId === t.videoId) {
      score += 6;
      why = `${motif.who}'s theme`;
    }
    score += (music.votes?.[t.videoId] ?? 0) + (preferred.includes(t.artist.toLowerCase()) ? 1 : 0) - (recent.includes(t.videoId) ? 3 : 0);
    if (!best || score > best.score) best = { track: t, score, why };
  }
  return best ? { track: best.track, why: best.why } : null;
}

/** A big moment in this reply's records: someone died, a secret came out, a promise kept or broken, romance moved. */
function bigMoment(messageId: string, chatId: string) {
  const changes = currentFold(chatId).result.changes[messageId] ?? [];
  return changes.some((c) => (c.kind === "secret" && /revealed/i.test(c.text)) || c.kind === "dead" || c.kind === "ladder" || ((c.kind === "promise" || c.kind === "owe") && /kept|broken|stood up/i.test(c.text)) || (c.kind === "scene" && c.newScene));
}

/** Mostly dialogue: instrumental-only taste applies. */
const dialogueHeavy = (text: string) => (text.match(/[“"][^”"]+[”"]/g) ?? []).join("").length > text.length * 0.4;

async function play(chatId: string, cfg: MusicConfig, pick: { track: Track; why: string }, key: string) {
  if (!cfg.token) return;
  await command(cfg, { command: "changeVideo", data: { videoId: pick.track.videoId } });
  const m = chatMusic(chatId);
  setChatMusic(chatId, { lastKey: key, recent: [pick.track.videoId, ...(m.recent ?? []).filter((v) => v !== pick.track.videoId)].slice(0, 6), now: { videoId: pick.track.videoId, title: pick.track.title, artist: pick.track.artist, key, why: pick.why, at: Date.now() } });
}

/**
 * The director (an onTrackerUpdate hook): music changes on beats only. Never throws; YouTube Music
 * not answering just means the music holds.
 */
export function musicAfterReply(chatId: string, messageId: string) {
  void (async () => {
    const cfg = musicConfig();
    if (!cfg.enabled || !cfg.token || !cfg.library.length) return;
    const music = chatMusic(chatId);
    if (!music.on) return;
    const st = currentFold(chatId).result.state;
    const cue = cueFrom(st, storyDials(mustChat(chatId)).genre);
    const beat = cue.key !== music.lastKey || bigMoment(messageId, chatId);
    if (!beat) return;
    const text = one<{ content: string }>("SELECT s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.id = ?", messageId)?.content ?? "";
    const pick = pickTrack(cfg, cue, music, { dialogue: dialogueHeavy(text), exclude: music.now ? [music.now.videoId] : [] });
    if (pick) await play(chatId, cfg, pick, cue.key);
  })().catch((e) => {
    if (!(e instanceof YtmError)) console.error("[mea] soundtrack:", (e as Error).message);
  });
}

// ---------- your hand ----------

export type MusicAction = "on" | "off" | "playPause" | "skip" | "up" | "down" | "notForScene";

export async function musicAction(chatId: string, action: MusicAction) {
  const cfg = musicConfig();
  const music = chatMusic(chatId);
  if (action === "on" || action === "off") {
    setChatMusic(chatId, { on: action === "on", ...(action === "on" ? { lastKey: "" } : {}) });
    return chatMusicView(chatId);
  }
  if (!cfg.token) throw badRequest("Connect YouTube Music first (Settings › Music)");
  const cue = cueFrom(currentFold(chatId).result.state, storyDials(mustChat(chatId)).genre);
  const cur = music.now?.videoId;
  if (action === "playPause") await command(cfg, { command: "playPause" });
  else if (action === "up" || action === "down") {
    if (!cur) throw badRequest("Nothing Mea chose is playing");
    setChatMusic(chatId, { votes: { ...(music.votes ?? {}), [cur]: (music.votes?.[cur] ?? 0) + (action === "up" ? 1 : -1) } });
    if (action === "down") return musicAction(chatId, "skip");
  } else {
    if (action === "notForScene" && cur) setChatMusic(chatId, { notFor: { ...(music.notFor ?? {}), [cue.key]: [...(music.notFor?.[cue.key] ?? []), cur] } });
    const pick = pickTrack(cfg, cue, chatMusic(chatId), { exclude: cur ? [cur] : [] });
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
  return { available: cfg.enabled && Boolean(cfg.token), on: Boolean(m.on), now: m.now ?? null, cue, vote: m.now ? (m.votes?.[m.now.videoId] ?? 0) : 0 };
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

/** Add a track: a pasted link or id, or whatever YouTube Music is playing now. */
export async function addTrack(input: { link?: string; moods?: Mood[]; instrumental?: boolean; title?: string; artist?: string }) {
  const cfg = musicConfig();
  let videoId = input.link ? videoIdOf(input.link) : null;
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
  const library = [...cfg.library.filter((t) => t.videoId !== videoId), track];
  setSetting("music.config", { ...cfg, library } as never);
  return musicView();
}
