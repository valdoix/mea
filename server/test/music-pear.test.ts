import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setSetting } from "../src/lib/settings";
import { addTrack, connectStart, type Cue, musicConfig, musicView, pickTrack, poolOf, refreshTaste, saveMusicConfig } from "../src/music/director";
import { command, playlistIdOf, YtmError } from "../src/music/ytmusic";
import { freshDb } from "./helpers";

const realFetch = globalThis.fetch;
const sent: { method: string; path: string; body: unknown; auth: string | null }[] = [];

/** One list row the way YouTube Music's page data has it. */
const row = (videoId: string, title: string, second: string, type = "MUSIC_VIDEO_TYPE_ATV") => ({
  musicResponsiveListItemRenderer: {
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title, navigationEndpoint: { watchEndpoint: { videoId, watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: type } } } } }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: second }] } } },
    ],
  },
});
const searchPage = {
  contents: {
    tabbedSearchResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  { musicCardShelfRenderer: { title: { runs: [{ text: "Hozier" }] }, contents: [row("hhhhhhhhhh1", "Northern Attitude", "Song • 4:28")] } },
                  { itemSectionRenderer: { contents: [row("hhhhhhhhhh2", "Blood Upon the Snow", "Song • Hozier & Bear McCreary")] } },
                  { itemSectionRenderer: { contents: [row("hhhhhhhhhh3", "Grown Folks Music", "Song • Hosier")] } },
                  { itemSectionRenderer: { contents: [row("hhhhhhhhhh4", "Too Sweet", "Video • Hozier • 265K views", "MUSIC_VIDEO_TYPE_OMV")] } },
                ],
              },
            },
          },
        },
      ],
    },
  },
};
const playlistPage = { contents: { twoColumnBrowseResultsRenderer: { secondaryContents: { sectionListRenderer: { contents: [{ musicPlaylistShelfRenderer: { contents: [row("llllllllll1", "Movement", "Hozier"), row("llllllllll2", "Almost (Audio)", "Hozier", "MUSIC_VIDEO_TYPE_OMV")] } }] } } } } };

beforeAll(() => {
  freshDb();
  // A stand-in for th-ch's YouTube Music with its API Server plugin on this PC.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    // A pasted playlist link is the one thing read from YouTube Music's website.
    if (url.hostname === "music.youtube.com" && url.pathname === "/youtubei/v1/browse") {
      const b = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(b.browseId === "VLPLmine1234567" ? playlistPage : {}), { status: 200 });
    }
    if (url.hostname !== "127.0.0.1" || url.port !== "26538") throw new Error(`unexpected network call: ${url}`);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
    sent.push({ method: init?.method ?? "GET", path: url.pathname, body, auth });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (url.pathname === "/doc") return json({ info: { title: "YouTube Music API Server" } });
    if (url.pathname === "/auth/mea-soundtrack") return json({ accessToken: "jwt-9" });
    if (auth !== "Bearer jwt-9") return new Response("Unauthorized", { status: 401 });
    if (url.pathname === "/api/v1/search") return json(body.query === "Hozier" ? searchPage : {});
    if (url.pathname === "/api/v1/song") return json({ title: "Pear Song", artist: "P", isPaused: false, videoId: "ppppppppppp" });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  saveMusicConfig({ port: 26538 });
});
afterAll(() => {
  globalThis.fetch = realFetch;
  setSetting("music.config", null);
  setSetting("music.taste", null);
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

  test("songs by your preferred artists play without being in the library", async () => {
    saveMusicConfig({ taste: { preferred: ["Hozier"], banned: [], instrumentalInDialogue: false } });
    await refreshTaste();
    const cfg = musicConfig();
    // Songs only, by that artist (a feature counts; a near-miss name and a music video don't).
    expect(poolOf(cfg).filter((t) => !cfg.library.some((l) => l.videoId === t.videoId)).map((t) => [t.title, t.artist])).toEqual([
      ["Northern Attitude", "Hozier"],
      ["Blood Upon the Snow", "Hozier & Bear McCreary"],
    ]);
    expect(musicView()).toMatchObject({ canSearch: true, tasteFound: { Hozier: 2 } });
    const cue: Cue = { moods: ["calm"], intensity: 0, hour: null, weather: "", place: "", genre: null, present: [], key: "k" };
    // With the library song set aside, a Hozier song plays.
    expect(pickTrack(cfg, cue, {}, { pool: poolOf(cfg), exclude: ["ppppppppppp"] })?.track.artist).toContain("Hozier");
    // Banned wins over preferred.
    expect(pickTrack({ ...cfg, taste: { ...cfg.taste, banned: ["bear mccreary"] } }, cue, {}, { pool: poolOf(cfg), exclude: ["ppppppppppp", "hhhhhhhhhh1"] })).toBeNull();
    // Taking the artist off the list forgets their songs.
    saveMusicConfig({ taste: { preferred: [], banned: [], instrumentalInDialogue: false } });
    await refreshTaste();
    expect(poolOf(musicConfig()).length).toBe(musicConfig().library.length);
  });

  test("a playlist link adds each of its songs", async () => {
    expect(playlistIdOf("https://music.youtube.com/playlist?list=PLmine1234567&si=x")).toBe("PLmine1234567");
    expect(playlistIdOf("not a link")).toBeNull();
    const r = (await addTrack({ link: "https://music.youtube.com/playlist?list=PLmine1234567", moods: ["tender"] })) as { added?: number };
    expect(r.added).toBe(2);
    expect(musicConfig().library.slice(-2)).toMatchObject([
      { videoId: "llllllllll1", title: "Movement", artist: "Hozier", moods: ["tender"] },
      { videoId: "llllllllll2", title: "Almost (Audio)", artist: "Hozier", moods: ["tender"] },
    ]);
    // A song's own link wins over the list it was played from.
    await addTrack({ link: "https://music.youtube.com/watch?v=sssssssssss&list=PLmine1234567" });
    expect(musicConfig().library.at(-1)?.videoId).toBe("sssssssssss");
    expect(await addTrack({ link: "https://music.youtube.com/playlist?list=PLempty123456" }).catch((e) => e.message)).toContain("empty");
  });
});
