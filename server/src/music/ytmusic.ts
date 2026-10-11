import { HttpError } from "../lib/http";

/**
 * Soundtrack (Almanac plan J3), YouTube Music only, through one of the two desktop apps on this PC
 * (Mea runs on the same machine). Nothing else is contacted: no network access beyond localhost.
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
    const r = await call<{ isPaused?: boolean; videoId?: string; title?: string; artist?: string }>(conn, "/api/v1/song");
    return { playing: Boolean(r.videoId) && !r.isPaused, videoId: r.videoId ?? null, title: r.title ?? null, author: r.artist ?? null };
  }
  const r = await call<{ player?: { trackState?: number }; video?: { id?: string; title?: string; author?: string } | null }>(conn, "/api/v1/state");
  return { playing: r.player?.trackState === 1, videoId: r.video?.id ?? null, title: r.video?.title ?? null, author: r.video?.author ?? null };
}

export type YtmCommand = { command: "playPause" | "play" | "pause" | "next" | "previous" } | { command: "changeVideo"; data: { videoId: string; playlistId?: string | null } };

export async function command(conn: YtmConn, c: YtmCommand) {
  if (conn.app !== "pear") return void (await call(conn, "/api/v1/command", { method: "POST", body: c }));
  if (c.command === "changeVideo") {
    // No "play this" here: queue it right after the current song, then skip to it.
    await call(conn, "/api/v1/queue", { method: "POST", body: { videoId: c.data.videoId, insertPosition: "INSERT_AFTER_CURRENT_VIDEO" } });
    await call(conn, "/api/v1/next", { method: "POST" });
    return;
  }
  await call(conn, `/api/v1/${c.command === "playPause" ? "toggle-play" : c.command}`, { method: "POST" });
}

/** A video id from what you paste: an id, or a music.youtube.com / youtube.com / youtu.be link. */
export function videoIdOf(input: string): string | null {
  const t = input.trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  const m = t.match(/[?&]v=([\w-]{11})/) ?? t.match(/youtu\.be\/([\w-]{11})/) ?? t.match(/\/(?:embed|shorts)\/([\w-]{11})/);
  return m?.[1] ?? null;
}
