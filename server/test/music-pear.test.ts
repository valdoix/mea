import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { setSetting } from "../src/lib/settings";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { addTrack, chatMusicView, connectStart, type Cue, musicAction, musicConfig, musicTick, musicView, pickTrack, refreshTaste, removeTrack, removeTracks, retagTrack, saveMusicConfig } from "../src/music/director";
import { command, playlistIdOf, YtmError } from "../src/music/ytmusic";
import { freshDb } from "./helpers";

const realFetch = globalThis.fetch;
const sent: { method: string; path: string; body: unknown; auth: string | null }[] = [];

/** The app's queue. Like the real one, a song asked for lands only a moment later (after a couple of looks). */
let queue: { videoId: string; selected: boolean }[] = [{ videoId: "ppppppppppp", selected: true }, { videoId: "oldqueued11", selected: false }];
let landing: { videoId: string; looks: number } | null = null;
/** What the app says is playing. */
let song: Record<string, unknown> = { title: "Pear Song", artist: "P", isPaused: false, videoId: "ppppppppppp" };
let queueLands = true;

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
    if (url.pathname === "/api/v1/queue" && init?.method === "POST") {
      if (queueLands) landing = { videoId: body.videoId, looks: 2 };
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/api/v1/queue" && (init?.method ?? "GET") === "GET") {
      if (landing && --landing.looks <= 0) {
        queue.splice(queue.findIndex((q) => q.selected) + 1, 0, { videoId: landing.videoId, selected: false });
        landing = null;
      }
      // Real rows come both bare and wrapped.
      return json({ items: queue.map((q, i) => (i % 2 ? { playlistPanelVideoRenderer: q } : { playlistPanelVideoWrapperRenderer: { primaryRenderer: { playlistPanelVideoRenderer: q } } })) });
    }
    if (url.pathname === "/api/v1/queue" && init?.method === "PATCH") {
      queue = queue.map((q, i) => ({ ...q, selected: i === body.index }));
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/api/v1/search") return json(body.query === "Hozier" ? searchPage : {});
    if (url.pathname === "/api/v1/song") return json(song);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  saveMusicConfig({ port: 26538 });
});
afterAll(() => {
  globalThis.fetch = realFetch;
  setSetting("music.config", null);
  setSetting("music.taste", null);
  setSetting("music.removed", null);
});

describe("the soundtrack on th-ch's YouTube Music (API Server)", () => {
  test("connecting is one step: the app asks you to allow Mea, and Mea keeps the token", async () => {
    const r = await connectStart();
    expect(r.code).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain("jwt-9");
    expect(musicConfig()).toMatchObject({ token: "jwt-9", app: "pear", enabled: true });
  });

  test("what's playing, and playing a chosen song: queued after this one, then played once it's there", async () => {
    await addTrack({ moods: ["calm"] });
    expect(musicConfig().library[0]).toMatchObject({ videoId: "ppppppppppp", title: "Pear Song", artist: "P" });
    sent.length = 0;
    await command(musicConfig(), { command: "changeVideo", data: { videoId: "qqqqqqqqqqq" } });
    await command(musicConfig(), { command: "playPause" });
    // Not "next" straight away: that would play what was queued before (the music ran one song behind).
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual(["POST /api/v1/queue", "GET /api/v1/queue", "GET /api/v1/queue", "PATCH /api/v1/queue", "POST /api/v1/toggle-play"]);
    expect(sent[0]?.body).toEqual({ videoId: "qqqqqqqqqqq", insertPosition: "INSERT_AFTER_CURRENT_VIDEO" });
    expect(queue.find((q) => q.selected)?.videoId).toBe("qqqqqqqqqqq");
    // The same song already further down the queue: it's the copy just after this one that plays.
    sent.length = 0;
    await command(musicConfig(), { command: "changeVideo", data: { videoId: "oldqueued11" } });
    expect(queue.findIndex((q) => q.selected)).toBe(2);
    expect(queue[2]?.videoId).toBe("oldqueued11");
    // A song that never shows up: skip ahead, as before.
    queueLands = false;
    sent.length = 0;
    await command(musicConfig(), { command: "changeVideo", data: { videoId: "neverlands1" } });
    expect(sent.at(-1)).toMatchObject({ method: "POST", path: "/api/v1/next" });
    queueLands = true;
  });

  test("the app's own errors reach you as they are, not as a server fault", async () => {
    const e = await command({ port: 26538, token: "stale", app: "pear" }, { command: "next" }).catch((x) => x);
    expect(e).toBeInstanceOf(YtmError);
    expect(e.status).toBe(502);
    expect(e.message).toContain("connect again");
  });

  test("songs by your preferred artists join the library by themselves", async () => {
    // A look with nothing to do finishes at once, and doesn't stop the next one from running.
    await refreshTaste();
    saveMusicConfig({ taste: { preferred: ["Hozier"], banned: [], instrumentalInDialogue: false } });
    await refreshTaste();
    // Songs only, by that artist (a feature counts; a near-miss name and a music video don't).
    expect(musicConfig().library.filter((t) => t.artist.includes("Hozier")).map((t) => [t.title, t.artist])).toEqual([
      ["Northern Attitude", "Hozier"],
      ["Blood Upon the Snow", "Hozier & Bear McCreary"],
    ]);
    expect(musicView()).toMatchObject({ canSearch: true, tasteFound: { Hozier: 2 } });
    const cfg = musicConfig();
    const cue: Cue = { moods: ["calm"], intensity: 0, hour: null, weather: "", place: "", genre: null, present: [], key: "k" };
    expect(pickTrack(cfg, cue, {}, { exclude: ["ppppppppppp"] })?.track.artist).toContain("Hozier");
    // Banned wins over preferred.
    expect(pickTrack({ ...cfg, taste: { ...cfg.taste, banned: ["bear mccreary"] } }, cue, {}, { exclude: ["ppppppppppp", "hhhhhhhhhh1"] })).toBeNull();
    // One song at a time: retag it, or remove it.
    expect(retagTrack("hhhhhhhhhh2", { moods: ["epic"] }).library.find((t) => t.videoId === "hhhhhhhhhh2")?.moods).toEqual(["epic"]);
    removeTrack("hhhhhhhhhh1");
    // Songs lost another way (an older page saving a stale library) come back on the next look; one you removed doesn't.
    saveMusicConfig({ library: musicConfig().library.filter((t) => t.videoId !== "hhhhhhhhhh2") });
    setSetting("music.taste", { hozier: { at: Date.now(), ids: ["hhhhhhhhhh1", "hhhhhhhhhh2"] } });
    await refreshTaste();
    const ids = musicConfig().library.map((t) => t.videoId);
    expect(ids).toContain("hhhhhhhhhh2");
    expect(ids).not.toContain("hhhhhhhhhh1");
    // Adding it by hand makes it yours again.
    await addTrack({ link: "hhhhhhhhhh1" });
    removeTrack("hhhhhhhhhh1");
    await addTrack({ link: "hhhhhhhhhh1" });
    setSetting("music.taste", { hozier: { at: 0 } });
    await refreshTaste();
    expect(musicConfig().library.filter((t) => t.videoId === "hhhhhhhhhh1").length).toBe(1);
    // Several at once: both leave, and neither comes back.
    removeTracks(["hhhhhhhhhh1", "hhhhhhhhhh2"]);
    setSetting("music.taste", { hozier: { at: 0 } });
    await refreshTaste();
    expect(musicConfig().library.map((t) => t.videoId).filter((id) => id.startsWith("hhh"))).toEqual([]);
    await addTrack({ link: "hhhhhhhhhh2" });
    // Taking the artist off the list keeps their songs; it only stops looking for more.
    saveMusicConfig({ taste: { preferred: [], banned: [], instrumentalInDialogue: false } });
    await refreshTaste();
    expect(musicConfig().library.map((t) => t.videoId)).toContain("hhhhhhhhhh2");
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

  test("saving one setting from the page leaves the rest alone (the switch, the library, leitmotifs)", async () => {
    const app = createApp();
    const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
    const put = (b: unknown) => app.fetch(new Request("http://localhost/api/music", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }), local);
    saveMusicConfig({ enabled: true, leitmotifs: [{ who: "Mira", videoId: "llllllllll1" }] });
    const before = musicConfig();
    expect(before.library.length).toBeGreaterThan(0);
    const res = await put({ taste: { preferred: [], banned: ["Nobody"], instrumentalInDialogue: false } });
    expect(res.status).toBe(200);
    const after = musicConfig();
    expect(after).toMatchObject({ enabled: true, port: before.port, taste: { banned: ["Nobody"] } });
    expect(after.library).toEqual(before.library);
    expect(after.leitmotifs).toEqual(before.leitmotifs);
    expect((await put({ port: "nope" })).status).toBe(400);
  });

  test("one song after another: the next one is lined up before this one ends, so there's no gap", async () => {
    pauseJobs(true);
    for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update"]) registerJob(kind, async () => {});
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "The lamp hums." } });
    const chatId = createChat({ characterId: createCharacter(data) }).id;
    const first = addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
    writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 1 22:00", "cast: Mira@spot", "mood Mira: wistful", "scene: The lamp room"]).ops, "model");
    saveMusicConfig({ enabled: true });
    await musicAction(chatId, "on");
    await musicAction(chatId, "skip");
    const now = chatMusicView(chatId).now!;
    // Near the end: the next song is queued after this one, not played over it.
    song = { title: now.title, artist: now.artist, isPaused: false, videoId: now.videoId, elapsedSeconds: 190, songDuration: 200 };
    sent.length = 0;
    await musicTick();
    expect(sent.map((x) => `${x.method} ${x.path}`)).toEqual(["GET /api/v1/song", "POST /api/v1/queue"]);
    const lined = (sent[1]?.body as { videoId: string }).videoId;
    expect(lined).not.toBe(now.videoId);
    expect(chatMusicView(chatId).now?.videoId).toBe(now.videoId);
    // Lined up once only.
    sent.length = 0;
    await musicTick();
    expect(sent.map((x) => x.path)).toEqual(["/api/v1/song"]);
    // The app moved on to it by itself: the header says so.
    song = { title: "Next", artist: "", isPaused: false, videoId: lined, elapsedSeconds: 1, songDuration: 180 };
    await musicTick();
    expect(chatMusicView(chatId).now?.videoId).toBe(lined);
    await musicAction(chatId, "off");
    pauseJobs(false);
  });
});
