import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setSetting } from "../src/lib/settings";
import { findSongWords, lyricsStep, musicConfig, musicView, removeTracks, saveMusicConfig, setSongWords, songWords } from "../src/music/director";
import { bestLrclib, cleanTitle, leadArtist, lyricsFor, parseLyrics, readLyricsTab, readNext, sameArtist } from "../src/music/lyrics";
import { Deferred, pauseJobs } from "../src/services/jobs";
import { freshDb } from "./helpers";

const realFetch = globalThis.fetch;
const asked: string[] = [];
let lrclibDown = false;
let blips = 0;

const SYNCED = "[00:12.00] My lover's got humour\n[00:15.50] She's the giggle at a funeral\n[00:19.00] \n[00:21.00] Take me to church";
// A stand-in for LRCLIB and YouTube Music's page data.
beforeAll(() => {
  freshDb();
  pauseJobs(true);
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    asked.push(`${url.hostname}${url.pathname}`);
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (url.hostname === "lrclib.net") {
      if (lrclibDown) throw new Error("down");
      if (blips > 0 && blips--) return new Response("", { status: 503 });
      const track = url.searchParams.get("track_name") ?? url.searchParams.get("q") ?? "";
      if (/church/i.test(track)) return json([{ trackName: "Take Me to Church", artistName: "Hozier", duration: 300, syncedLyrics: "[00:01.00] wrong cut" }, { trackName: "Take Me to Church", artistName: "Hozier", duration: 242, syncedLyrics: SYNCED, plainLyrics: "x" }]);
      if (/interlude/i.test(track)) return json([{ trackName: "Interlude", artistName: "Ólafur Arnalds", duration: 211, instrumental: true }]);
      return json([]);
    }
    if (url.hostname === "music.youtube.com") {
      const body = JSON.parse(String(init?.body));
      if (url.pathname.endsWith("/next")) return json({ contents: { panel: [{ playlistPanelVideoRenderer: { videoId: body.videoId, lengthText: { runs: [{ text: /church|later/.test(body.videoId) ? "4:02" : "3:30" }] } } }], tabs: [{ tabRenderer: { endpoint: { browseEndpoint: { browseId: `MPLY${body.videoId}` } } } }] } });
      if (body.browseId === "MPLYplainsong01") return json({ contents: { sectionListRenderer: { contents: [{ musicDescriptionShelfRenderer: { description: { runs: [{ text: "First verse line\nSecond line\n\n\nChorus line" }] } } }] } } });
      return json({ contents: {} });
    }
    throw new Error(`unexpected network call: ${url}`);
  }) as typeof fetch;
  setSetting("music.config", {
    library: [
      { videoId: "church00001", title: "Hozier - Take Me To Church (Official Video)", artist: "Hozier", moods: ["melancholy"], instrumental: false },
      { videoId: "plainsong01", title: "Plain Song", artist: "Someone", moods: [], instrumental: false },
      { videoId: "interlude01", title: "Interlude", artist: "Ólafur Arnalds", moods: [], instrumental: false },
      { videoId: "nowhere0001", title: "Nowhere Song", artist: "Nobody", moods: [], instrumental: false },
    ],
  } as never);
});
afterAll(() => {
  globalThis.fetch = realFetch;
  pauseJobs(false);
  setSetting("music.config", null);
});

describe("reading words (docs/18, 1.2)", () => {
  test("LRC is timed, with repeats and tags; plain keeps one blank line between verses", () => {
    const lrc = parseLyrics("[ar: Hozier]\n[00:10.00][01:10.00] Chorus\n[00:05.5] Verse");
    expect(lrc.timed).toBe(true);
    expect(lrc.lines).toEqual([{ t: 5.5, text: "Verse" }, { t: 10, text: "Chorus" }, { t: 70, text: "Chorus" }]);
    const plain = parseLyrics("One\r\nTwo\n\n\n\nThree\n\n");
    expect(plain.timed).toBe(false);
    expect(plain.lines.map((l) => l.text)).toEqual(["One", "Two", "", "Three"]);
    // A few stamped lines among plain ones isn't timed.
    expect(parseLyrics("[00:01.00] one\ntwo").timed).toBe(false);
  });

  test("titles and artists as a lyrics site knows them", () => {
    expect(cleanTitle("Take Me To Church (Official Video)")).toBe("Take Me To Church");
    expect(cleanTitle("Song [Lyric Video] (feat. Someone)")).toBe("Song");
    expect(cleanTitle("Old Song - Remastered 2011")).toBe("Old Song");
    expect(cleanTitle("Song ft. Guest")).toBe("Song");
    expect(leadArtist("Hozier & Bear McCreary")).toBe("Hozier");
    expect(leadArtist("Hozier - Topic")).toBe("Hozier");
    expect(sameArtist("Hozier & Bear McCreary", "Hozier")).toBe(true);
    expect(sameArtist("Hozier", "Someone Else")).toBe(false);
  });

  test("LRCLIB's best match: the artist's, near the length, timed first", () => {
    const hits = [
      { artistName: "Hozier", duration: 260, syncedLyrics: "a" },
      { artistName: "Hozier", duration: 243, plainLyrics: "b" },
      { artistName: "Cover Band", duration: 242, syncedLyrics: "c" },
      { artistName: "Hozier", duration: 241, syncedLyrics: "d" },
    ];
    expect(bestLrclib(hits, "Hozier", 242)?.syncedLyrics).toBe("d");
    // More than 5 s off: dropped rather than risked.
    expect(bestLrclib([{ artistName: "Hozier", duration: 260, syncedLyrics: "a" }], "Hozier", 242)).toBeNull();
    expect(bestLrclib([{ artistName: "Hozier", duration: 260, syncedLyrics: "a" }], "Hozier", null)?.syncedLyrics).toBe("a");
  });

  test("YouTube Music's page: the song's length, its lyrics tab, the words on it", () => {
    expect(readNext({ a: [{ videoId: "x", lengthText: { runs: [{ text: "1:02:03" }] } }, { browseEndpoint: { browseId: "MPLYabc" } }] }, "x")).toEqual({ duration: 3723, lyricsId: "MPLYabc" });
    expect(readLyricsTab({ x: { musicDescriptionShelfRenderer: { description: { runs: [{ text: "la la" }] } } } })).toBe("la la");
  });
});

describe("the library's words", () => {
  test("off by default: nothing is looked up", async () => {
    expect(musicConfig().lyricsOnline).toBe(false);
    await lyricsStep();
    expect(asked).toEqual([]);
    expect(musicView().words).toMatchObject({ church00001: "pending" });
    await expect(findSongWords("church00001")).rejects.toThrow(/Find lyrics online/);
  });

  test("with the switch on, the job goes song by song: timed, plain, instrumental, a miss", async () => {
    saveMusicConfig({ lyricsOnline: true });
    const steps = async () => {
      for (let i = 0; i < 10; i++) {
        try {
          await lyricsStep();
          return;
        } catch (e) {
          if (!(e instanceof Deferred)) throw e;
        }
      }
    };
    await steps();
    const church = lyricsFor("church00001")!;
    expect(church).toMatchObject({ source: "lrclib", timed: true, duration: 242 });
    expect(church.lines[0]).toEqual({ t: 12, text: "My lover's got humour" });
    expect(lyricsFor("plainsong01")).toMatchObject({ source: "ytmusic", timed: false });
    expect(lyricsFor("plainsong01")!.lines.map((l) => l.text)).toEqual(["First verse line", "Second line", "", "Chorus line"]);
    expect(lyricsFor("nowhere0001")).toMatchObject({ source: "none" });
    expect(musicConfig().library.find((t) => t.videoId === "interlude01")?.instrumental).toBe(true);
    const v = musicView();
    expect(v.words).toEqual({ church00001: "timed", plainsong01: "plain", interlude01: "instrumental", nowhere0001: "none" });
    expect(v.wordsCount).toEqual({ have: 2, timed: 1, pending: 0, of: 3, read: 0 });
    // Only the title, artist and length went out.
    expect(new Set(asked.map((a) => a.split("/")[0]))).toEqual(new Set(["lrclib.net", "music.youtube.com"]));
    // Done: nothing more to look up.
    asked.length = 0;
    await lyricsStep();
    expect(asked).toEqual([]);
  });

  test("a site not answering waits, and the miss isn't remembered", async () => {
    setSetting("music.config", { ...musicConfig(), library: [...musicConfig().library, { videoId: "later000001", title: "Church Later", artist: "Hozier", moods: [], instrumental: false }] } as never);
    lrclibDown = true;
    await expect(lyricsStep()).rejects.toBeInstanceOf(Deferred);
    expect(lyricsFor("later000001")).toBeNull();
    lrclibDown = false;
  });

  test("one 503 from LRCLIB is tried again at once", async () => {
    blips = 1;
    await lyricsStep().catch((e) => {
      if (!(e instanceof Deferred) || /Lyrics:/.test(e.message)) throw e;
    });
    expect(lyricsFor("later000001")).toMatchObject({ source: "lrclib", timed: true });
  });

  test("pasted words win and stay; Find again replaces them; removing a song forgets its words", async () => {
    const r = setSongWords("nowhere0001", "[00:01.00] mine\n[00:04.00] all mine");
    expect(r.words).toMatchObject({ source: "pasted", timed: true });
    expect(r.view.words.nowhere0001).toBe("timed");
    expect(songWords("nowhere0001").words?.lines).toHaveLength(2);
    setSongWords("plainsong01", "");
    expect(lyricsFor("plainsong01")).toBeNull();
    const again = await findSongWords("plainsong01");
    expect(again.words).toMatchObject({ source: "ytmusic" });
    removeTracks(["church00001"]);
    expect(lyricsFor("church00001")).toBeNull();
    expect(() => songWords("church00001")).toThrow(/isn't in the library/);
  });
});
