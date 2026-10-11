import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setSetting } from "../src/lib/settings";
import { addTrack, connectStart, musicConfig, saveMusicConfig } from "../src/music/director";
import { command, YtmError } from "../src/music/ytmusic";
import { freshDb } from "./helpers";

const realFetch = globalThis.fetch;
const sent: { method: string; path: string; body: unknown; auth: string | null }[] = [];

beforeAll(() => {
  freshDb();
  // A stand-in for th-ch's YouTube Music with its API Server plugin on this PC.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "127.0.0.1" || url.port !== "26538") throw new Error(`unexpected network call: ${url}`);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
    sent.push({ method: init?.method ?? "GET", path: url.pathname, body, auth });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (url.pathname === "/doc") return json({ info: { title: "YouTube Music API Server" } });
    if (url.pathname === "/auth/mea-soundtrack") return json({ accessToken: "jwt-9" });
    if (auth !== "Bearer jwt-9") return new Response("Unauthorized", { status: 401 });
    if (url.pathname === "/api/v1/song") return json({ title: "Pear Song", artist: "P", isPaused: false, videoId: "ppppppppppp" });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  saveMusicConfig({ port: 26538 });
});
afterAll(() => {
  globalThis.fetch = realFetch;
  setSetting("music.config", null);
});

describe("the soundtrack on th-ch's YouTube Music (API Server)", () => {
  test("connecting is one step: the app asks you to allow Mea, and Mea keeps the token", async () => {
    const r = await connectStart();
    expect(r.code).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain("jwt-9");
    expect(musicConfig()).toMatchObject({ token: "jwt-9", app: "pear", enabled: true });
  });

  test("what's playing, and playing a chosen song: queued after this one, then skipped to", async () => {
    await addTrack({ moods: ["calm"] });
    expect(musicConfig().library[0]).toMatchObject({ videoId: "ppppppppppp", title: "Pear Song", artist: "P" });
    sent.length = 0;
    await command(musicConfig(), { command: "changeVideo", data: { videoId: "qqqqqqqqqqq" } });
    await command(musicConfig(), { command: "playPause" });
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual(["POST /api/v1/queue", "POST /api/v1/next", "POST /api/v1/toggle-play"]);
    expect(sent[0]?.body).toEqual({ videoId: "qqqqqqqqqqq", insertPosition: "INSERT_AFTER_CURRENT_VIDEO" });
  });

  test("the app's own errors reach you as they are, not as a server fault", async () => {
    const e = await command({ port: 26538, token: "stale", app: "pear" }, { command: "next" }).catch((x) => x);
    expect(e).toBeInstanceOf(YtmError);
    expect(e.status).toBe(502);
    expect(e.message).toContain("connect again");
  });
});
