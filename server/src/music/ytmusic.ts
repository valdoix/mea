/**
 * Soundtrack (Almanac plan J3), YouTube Music only: the YouTube Music Desktop App's Companion
 * Server on this PC (Mea runs on the same machine). Its REST API lives at
 * http://127.0.0.1:<port>/api/v1 (9863 by default): the app shows a code you approve once, and
 * Mea keeps the token it gets. Nothing else is contacted: no network access beyond localhost.
 */

export const APP_ID = "mea-soundtrack";
export const APP_NAME = "Mea";
export const APP_VERSION = "1.0.0";

export interface YtmState {
  playing: boolean;
  videoId: string | null;
  title: string | null;
  author: string | null;
}

export class YtmError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

const base = (port: number) => `http://127.0.0.1:${port}/api/v1`;

async function call<T>(port: number, path: string, init: { method?: string; token?: string | null; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base(port)}${path}`, {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(init.token ? { Authorization: init.token } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.method === "POST" && path.startsWith("/auth/request") && !path.endsWith("code") ? 35_000 : 5_000),
    });
  } catch {
    throw new YtmError("YouTube Music isn't answering. Is the desktop app open, with its Companion Server on?");
  }
  if (!res.ok) throw new YtmError(res.status === 401 || res.status === 403 ? "YouTube Music turned Mea away: connect again" : `YouTube Music said ${res.status}`, res.status);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** Step 1 of connecting: the app shows this code; you approve it there. */
export async function requestCode(port: number) {
  const r = await call<{ code?: string }>(port, "/auth/requestcode", { method: "POST", body: { appId: APP_ID, appName: APP_NAME, appVersion: APP_VERSION } });
  if (!r.code) throw new YtmError("YouTube Music didn't give a code");
  return r.code;
}

/** Step 2: once you approve in the app, the token (kept by Mea, never sent to the browser). */
export async function requestToken(port: number, code: string) {
  const r = await call<{ token?: string }>(port, "/auth/request", { method: "POST", body: { appId: APP_ID, code } });
  if (!r.token) throw new YtmError("YouTube Music didn't approve Mea");
  return r.token;
}

/** What's playing now. */
export async function playerState(port: number, token: string): Promise<YtmState> {
  const r = await call<{ player?: { trackState?: number }; video?: { id?: string; title?: string; author?: string } | null }>(port, "/state", { token });
  return { playing: r.player?.trackState === 1, videoId: r.video?.id ?? null, title: r.video?.title ?? null, author: r.video?.author ?? null };
}

export type YtmCommand = { command: "playPause" | "play" | "pause" | "next" | "previous" } | { command: "changeVideo"; data: { videoId: string; playlistId?: string | null } };

export async function command(port: number, token: string, c: YtmCommand) {
  await call(port, "/command", { method: "POST", token, body: c });
}

/** A video id from what you paste: an id, or a music.youtube.com / youtube.com / youtu.be link. */
export function videoIdOf(input: string): string | null {
  const t = input.trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  const m = t.match(/[?&]v=([\w-]{11})/) ?? t.match(/youtu\.be\/([\w-]{11})/) ?? t.match(/\/(?:embed|shorts)\/([\w-]{11})/);
  return m?.[1] ?? null;
}
