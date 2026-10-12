import { HttpError } from "../lib/http";

/**
 * Soundtrack (Almanac plan J3), YouTube Music only, through one of the two desktop apps on this PC
 * (Mea runs on the same machine). Nothing else is contacted, except YouTube Music's public page
 * data for a playlist link you paste (neither app can list a playlist).
 * - "ytmd": the YouTube Music Desktop App's Companion Server (http://127.0.0.1:9863/api/v1). It
 *   shows a code you approve once, and Mea keeps the token it gets.
 * - "pear": th-ch's YouTube Music app with its API Server plugin (26538 by default). One request
 *   pops an Allow dialog in the app, and the answer is the token.
 * Which one is listening is found when you connect, and kept with the token.
 */

export const APP_ID = "mea-soundtrack";
export const APP_NAME = "Mea";
export const APP_VERSION = "1.0.0";

export type YtmApp = "ytmd" | "pear";
export interface YtmConn {
  port: number;
  token?: string | null;
  app?: YtmApp | null;
}

export interface YtmState {
  playing: boolean;
  videoId: string | null;
  title: string | null;
  author: string | null;
  /** Seconds into the song, and its length (null when the app doesn't say). */
  elapsed: number | null;
  duration: number | null;
}

/** Shown to you as it is (502: the app on this PC, not Mea, said no). */
export class YtmError extends HttpError {
  constructor(
    message: string,
    public upstream = 0,
  ) {
    super(502, message);
  }
}

const NOT_ANSWERING = "YouTube Music isn't answering. Is the app open, with its Companion Server (or API Server plugin) on, at this port?";

async function call<T>(conn: YtmConn, path: string, init: { method?: string; body?: unknown; timeout?: number } = {}): Promise<T> {
  const app = conn.app ?? "ytmd";
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${conn.port}${path}`, {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(conn.token ? { Authorization: app === "pear" ? `Bearer ${conn.token}` : conn.token } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeout ?? 5_000),
    });
  } catch {
    throw new YtmError(NOT_ANSWERING);
  }
  if (!res.ok) throw new YtmError(res.status === 401 || res.status === 403 ? "YouTube Music turned Mea away: connect again" : `YouTube Music said ${res.status}`, res.status);
  const text = await res.text();
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    return {} as T;
  }
}

/** Which app is on this port: th-ch's API Server describes itself at /doc; the Companion Server doesn't. */
export async function detectApp(port: number): Promise<YtmApp> {
  try {
    const r = await call<{ info?: { title?: string } }>({ port }, "/doc");
    if (/YouTube Music API Server/i.test(r.info?.title ?? "")) return "pear";
  } catch (e) {
    if (e instanceof YtmError && !e.upstream) throw e;
  }
  return "ytmd";
}

/** Companion Server, step 1: the app shows this code; you approve it there. */
export async function requestCode(port: number) {
  const r = await call<{ code?: string }>({ port }, "/api/v1/auth/requestcode", { method: "POST", body: { appId: APP_ID, appName: APP_NAME, appVersion: APP_VERSION } });
  if (!r.code) throw new YtmError("YouTube Music didn't give a code");
  return r.code;
}

/** Companion Server, step 2: once you approve in the app, the token (kept by Mea, never sent to the browser). */
export async function requestToken(port: number, code: string) {
  const r = await call<{ token?: string }>({ port }, "/api/v1/auth/request", { method: "POST", body: { appId: APP_ID, code }, timeout: 35_000 });
  if (!r.token) throw new YtmError("YouTube Music didn't approve Mea");
  return r.token;
}

/** API Server: one request; the app asks you to allow Mea, and answers with the token. */
export async function requestPearToken(port: number) {
  const r = await call<{ accessToken?: string }>({ port }, `/auth/${APP_ID}`, { method: "POST", timeout: 90_000 });
  if (!r.accessToken) throw new YtmError("YouTube Music didn't approve Mea");
  return r.accessToken;
}

/** What's playing now. */
export async function playerState(conn: YtmConn): Promise<YtmState> {
  if (conn.app === "pear") {
    const r = await call<{ isPaused?: boolean; videoId?: string; title?: string; artist?: string; elapsedSeconds?: number; songDuration?: number }>(conn, "/api/v1/song");
    return { playing: Boolean(r.videoId) && !r.isPaused, videoId: r.videoId ?? null, title: r.title ?? null, author: r.artist ?? null, elapsed: r.elapsedSeconds ?? null, duration: r.songDuration ?? null };
  }
  const r = await call<{ player?: { trackState?: number; videoProgress?: number }; video?: { id?: string; title?: string; author?: string; durationSeconds?: number } | null }>(conn, "/api/v1/state");
  return { playing: r.player?.trackState === 1, videoId: r.video?.id ?? null, title: r.video?.title ?? null, author: r.video?.author ?? null, elapsed: r.player?.videoProgress ?? null, duration: r.video?.durationSeconds ?? null };
}

/**
 * Lines a song up to play when this one ends, with no gap (th-ch's app only; the Companion Server
 * has no queue to add to, so there the next song starts when this one has ended). True if queued.
 */
export async function queueNext(conn: YtmConn, videoId: string): Promise<boolean> {
  if (conn.app !== "pear") return false;
  await call(conn, "/api/v1/queue", { method: "POST", body: { videoId, insertPosition: "INSERT_AFTER_CURRENT_VIDEO" } });
  return true;
}

export type YtmCommand = { command: "playPause" | "play" | "pause" | "next" | "previous" } | { command: "changeVideo"; data: { videoId: string; playlistId?: string | null } };

type QueueRow = { videoId?: string; selected?: boolean };
type QueueItem = { playlistPanelVideoRenderer?: QueueRow; playlistPanelVideoWrapperRenderer?: { primaryRenderer?: { playlistPanelVideoRenderer?: QueueRow } } };

/** th-ch's queue: each song's id, and which one is playing. */
async function pearQueue(conn: YtmConn): Promise<QueueRow[]> {
  const r = await call<{ items?: QueueItem[] }>(conn, "/api/v1/queue");
  return (r.items ?? []).map((it) => it.playlistPanelVideoRenderer ?? it.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer ?? {});
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * th-ch's app has no "play this": the song is queued right after the current one, then played by
 * its place in the queue. The queue fills in a moment after the request returns, so pressing
 * "next" at once played whatever was there before (the last song Mea queued): the music ran one
 * behind. So: wait until the song shows up after the current one, then jump to it.
 */
async function pearPlay(conn: YtmConn, videoId: string, waitMs = 4_000) {
  await call(conn, "/api/v1/queue", { method: "POST", body: { videoId, insertPosition: "INSERT_AFTER_CURRENT_VIDEO" } });
  const until = Date.now() + waitMs;
  for (;;) {
    const rows = await pearQueue(conn);
    const cur = rows.findIndex((r) => r.selected);
    const at = rows.findIndex((r, i) => i > cur && r.videoId === videoId);
    if (at >= 0) return void (await call(conn, "/api/v1/queue", { method: "PATCH", body: { index: at } }));
    if (Date.now() >= until) break;
    await pause(150);
  }
  // Never showed up (an older app?): skip ahead, as before.
  await call(conn, "/api/v1/next", { method: "POST" });
}

export async function command(conn: YtmConn, c: YtmCommand) {
  if (conn.app !== "pear") return void (await call(conn, "/api/v1/command", { method: "POST", body: c }));
  if (c.command === "changeVideo") return pearPlay(conn, c.data.videoId);
  await call(conn, `/api/v1/${c.command === "playPause" ? "toggle-play" : c.command}`, { method: "POST" });
}

export interface YtmSong {
  videoId: string;
  title: string;
  /** Everyone credited, as YouTube Music lists them ("Hozier & Bear McCreary"). */
  artist: string;
}

type Runs = { runs?: { text?: string; navigationEndpoint?: { watchEndpoint?: { videoId?: string; watchEndpointMusicSupportedConfigs?: { watchEndpointMusicConfig?: { musicVideoType?: string } } } } }[] };
const runsText = (t: unknown) => ((t as Runs | undefined)?.runs ?? []).map((x) => x.text ?? "").join("");

/**
 * The songs in YouTube Music's own page data (a search, a playlist): every list row with a song in
 * it, wherever it sits. `videos` keeps every video too (a playlist's own picks); otherwise only songs.
 */
export function songRows(data: unknown, videos = false): YtmSong[] {
  const out = new Map<string, YtmSong>();
  const walk = (node: unknown, card: string) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, card));
    const o = node as Record<string, unknown>;
    // A search's top-result card names the artist once, above its songs.
    if (o.musicCardShelfRenderer) card = runsText((o.musicCardShelfRenderer as { title?: unknown }).title);
    const row = o.musicResponsiveListItemRenderer as { flexColumns?: { musicResponsiveListItemFlexColumnRenderer?: { text?: Runs } }[] } | undefined;
    if (row) {
      const cols = (row.flexColumns ?? []).map((c) => c.musicResponsiveListItemFlexColumnRenderer?.text);
      const watch = cols[0]?.runs?.[0]?.navigationEndpoint?.watchEndpoint;
      const type = watch?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
      if (watch?.videoId && (videos || type === "MUSIC_VIDEO_TYPE_ATV")) {
        // Search: "Song • Artist • Album • 3:21", or "Song • 3:21" on the card. Playlist: just "Artist".
        const second = runsText(cols[1]);
        const parts = second.split(" • ");
        const artist = parts.length === 1 ? second || card : parts.length > 2 || !/^[\d:]+$/.test(parts[1]!) ? parts[1]! : card;
        if (!out.has(watch.videoId)) out.set(watch.videoId, { videoId: watch.videoId, title: runsText(cols[0]), artist });
      }
      return;
    }
    for (const v of Object.values(o)) walk(v, card);
  };
  walk(data, "");
  return [...out.values()];
}

/** Songs for a search (th-ch's API Server only; the Companion Server can't search). */
export async function searchSongs(conn: YtmConn, query: string): Promise<YtmSong[]> {
  if (conn.app !== "pear") return [];
  return songRows(await call<unknown>(conn, "/api/v1/search", { method: "POST", body: { query }, timeout: 10_000 }));
}

/** A playlist id from what you paste: a link with ?list=, or the id itself. */
export function playlistIdOf(input: string): string | null {
  const t = input.trim();
  const m = t.match(/[?&]list=([\w-]{10,})/);
  if (m) return m[1]!;
  return /^(?:VL)?(?:PL|OLAK5uy_|RDCLAK)[\w-]{10,}$/.test(t) ? t.replace(/^VL/, "") : null;
}

const WEB_REMIX = { clientName: "WEB_REMIX", clientVersion: "1.20241023.01.00", hl: "en" };

/**
 * A playlist's songs. Neither app can list one, so this is the one request that leaves this PC:
 * YouTube Music's public page data for that playlist, only when you paste its link. Public and
 * unlisted playlists only (a private one needs your sign-in).
 */
export async function playlistSongs(listId: string, max = 300): Promise<YtmSong[]> {
  const songs = new Map<string, YtmSong>();
  let body: Record<string, unknown> = { browseId: `VL${listId}` };
  for (let page = 0; page < 6 && songs.size < max; page++) {
    let res: Response;
    try {
      res = await fetch("https://music.youtube.com/youtubei/v1/browse?prettyPrint=false", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://music.youtube.com" },
        body: JSON.stringify({ ...body, context: { client: WEB_REMIX } }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new YtmError("YouTube Music's website isn't answering");
    }
    if (!res.ok) throw new YtmError(`YouTube Music said ${res.status} for that playlist`, res.status);
    const data = (await res.json()) as unknown;
    for (const s of songRows(data, true)) if (!songs.has(s.videoId)) songs.set(s.videoId, s);
    const next = JSON.stringify(data).match(/"(?:continuationCommand|nextContinuationData)":\{[^}]*?"(?:token|continuation)":"([^"]+)"/)?.[1];
    if (!next) break;
    body = { continuation: next };
  }
  return [...songs.values()].slice(0, max);
}

/** A video id from what you paste: an id, or a music.youtube.com / youtube.com / youtu.be link. */
export function videoIdOf(input: string): string | null {
  const t = input.trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  const m = t.match(/[?&]v=([\w-]{11})/) ?? t.match(/youtu\.be\/([\w-]{11})/) ?? t.match(/\/(?:embed|shorts)\/([\w-]{11})/);
  return m?.[1] ?? null;
}
