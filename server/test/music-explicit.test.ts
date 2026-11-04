import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { run } from "../src/db/db";
import { getSetting, setSetting } from "../src/lib/settings";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { createChat, mustChat, updateChat } from "../src/services/chats";
import { Deferred } from "../src/services/jobs";
import { explicitCopy, explicitStep, musicConfig, musicView, removeTrack, type Track } from "../src/music/director";
import { lyricsFor, saveLyrics } from "../src/music/lyrics";
import { sameCut } from "../src/music/versions";
import { publicSongs, songRows } from "../src/music/ytmusic";
import { freshDb } from "./helpers";

const realFetch = globalThis.fetch;
const EXPLICIT = [{ musicInlineBadgeRenderer: { icon: { iconType: "MUSIC_EXPLICIT_BADGE" }, accessibilityData: { accessibilityData: { label: "Explicit" } } } }];

/** One list row the way YouTube Music's songs-only search has it. */
const row = (videoId: string, title: string, second: string, explicit = false) => ({
  musicResponsiveListItemRenderer: {
    ...(explicit ? { badges: EXPLICIT } : {}),
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title, navigationEndpoint: { watchEndpoint: { videoId, watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: "MUSIC_VIDEO_TYPE_ATV" } } } } }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: second }] } } },
    ],
  },
});
const page = (...rows: unknown[]) => ({ contents: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents: rows } }] } } });

let answer: () => Response = () => new Response("{}");
const asked: string[] = [];
const track = (videoId: string, title: string, artist = "Kendrick Lamar", extra: Partial<Track> = {}): Track => ({ videoId, title, artist, moods: ["tense"], instrumental: false, ...extra });
const setLibrary = (library: Track[], extra: Record<string, unknown> = {}) => setSetting("music.config", { enabled: true, library, ...extra } as never);
const respond = (o: unknown) => (answer = () => new Response(JSON.stringify(o)));

beforeAll(() => {
  freshDb();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "music.youtube.com" || url.pathname !== "/youtubei/v1/search") throw new Error(`unexpected network call: ${url}`);
    asked.push(JSON.parse(String(init?.body)).query);
    return answer();
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  asked.length = 0;
  setSetting("music.removed", null);
});

describe("reading YouTube Music's rows", () => {
  test("the Explicit badge is read, and the artist is right on a songs-only search", () => {
    const rows = songRows(page(row("H4RELGc9su8", "HUMBLE.", "Kendrick Lamar • DAMN. • 2:57", true), row("ov4WobPqoSA", "HUMBLE.", "Kendrick Lamar • DAMN. • 2:57")));
    expect(rows).toEqual([
      { videoId: "H4RELGc9su8", title: "HUMBLE.", artist: "Kendrick Lamar", explicit: true },
      { videoId: "ov4WobPqoSA", title: "HUMBLE.", artist: "Kendrick Lamar" },
    ]);
  });

  test("a page without contents is YouTube turning Mea away, not a song with no results", async () => {
    respond({});
    expect(await publicSongs("x").catch((e) => e.message)).toContain("no search page");
    respond(page());
    expect(await publicSongs("x")).toEqual([]);
  });
});

describe("what counts as the same recording", () => {
  test("only how clean it is may differ", () => {
    expect(sameCut("Song (Clean)", "Song")).toBe(true);
    expect(sameCut("Song - Radio Edit", "Song (Explicit)")).toBe(true);
    expect(sameCut("Song (feat. Someone)", "Song")).toBe(true);
    expect(sameCut("Song (Live)", "Song")).toBe(false);
    expect(sameCut("Song (Extended Mix)", "Song")).toBe(false);
    expect(sameCut("Song - Tribute to Someone", "Song")).toBe(false);
  });

  test("a tribute, a cover or a live take isn't the song's explicit version, though it's marked explicit", () => {
    const clean = track("ov4WobPqoSA", "HUMBLE.");
    expect(explicitCopy(clean, [{ videoId: "tribute0001", title: "HUMBLE. - Tribute to Kendrick Lamar", artist: "2017 Billboard Masters", explicit: true }])).toBeNull();
    expect(explicitCopy(clean, [{ videoId: "cover000001", title: "HUMBLE.", artist: "Someone Else", explicit: true }])).toBeNull();
    expect(explicitCopy(clean, [{ videoId: "livetake001", title: "HUMBLE. (Live)", artist: "Kendrick Lamar", explicit: true }])).toBeNull();
    expect(explicitCopy(clean, [{ videoId: "unmarked001", title: "HUMBLE.", artist: "Kendrick Lamar" }])).toBeNull();
    expect(explicitCopy(clean, [{ videoId: "H4RELGc9su8", title: "HUMBLE.", artist: "Kendrick Lamar & Friend", explicit: true }])?.videoId).toBe("H4RELGc9su8");
  });
});

describe("the library look", () => {
  test("the explicit copy takes the song's place, and its tags, words, pins and thumbs go with it", async () => {
    const chatId = createChat({ characterId: createCharacter(normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "Hi." } }).data) }).id;
    updateChat(chatId, { settings: { music: { votes: { ov4WobPqoSA: 2 }, recent: ["other000001", "ov4WobPqoSA"] } } as never });
    setLibrary([track("ov4WobPqoSA", "HUMBLE. (Clean)")], { leitmotifs: [{ who: "Mira", videoId: "ov4WobPqoSA" }] });
    saveLyrics({ videoId: "ov4WobPqoSA", source: "lrclib", timed: true, lines: [{ t: 1, text: "sit down" }], duration: 177 });
    respond(page(row("ov4WobPqoSA", "HUMBLE. (Clean)", "Kendrick Lamar • DAMN. • 2:57"), row("H4RELGc9su8", "HUMBLE.", "Kendrick Lamar • DAMN. • 2:57", true)));
    await explicitStep();
    expect(asked).toEqual(["HUMBLE. Kendrick Lamar"]);
    const cfg = musicConfig();
    expect(cfg.library).toEqual([track("H4RELGc9su8", "HUMBLE.", "Kendrick Lamar", { explicit: true })]);
    expect(cfg.leitmotifs).toEqual([{ who: "Mira", videoId: "H4RELGc9su8" }]);
    expect(lyricsFor("H4RELGc9su8")?.lines).toEqual([{ t: 1, text: "sit down" }]);
    expect(lyricsFor("ov4WobPqoSA")).toBeNull();
    const music = (JSON.parse(mustChat(chatId).settings) as { music: { votes: unknown; recent: unknown } }).music;
    expect(music.votes).toEqual({ H4RELGc9su8: 2 });
    expect(music.recent).toEqual(["other000001", "H4RELGc9su8"]);
    // A lookup for the artist won't bring the censored copy back.
    expect(getSetting("music.removed")).toEqual(["ov4WobPqoSA"]);
    // Looked at once only.
    asked.length = 0;
    await explicitStep();
    expect(asked).toEqual([]);
  });

  test("YouTube Music's own words for the censored copy aren't kept (they may be bleeped)", async () => {
    setLibrary([track("cleancopy01", "Song", "A")]);
    saveLyrics({ videoId: "cleancopy01", source: "ytmusic", timed: false, lines: [{ t: null, text: "[__]" }], duration: null });
    respond(page(row("explicit001", "Song", "A • B • 3:00", true)));
    await explicitStep();
    expect(lyricsFor("explicit001")).toBeNull();
    expect(lyricsFor("cleancopy01")).toBeNull();
  });

  test("both copies in the library: the censored one goes, and the other stays as it was", async () => {
    setLibrary([track("cleancopy01", "Song", "A"), track("explicit001", "Song", "A", { moods: ["calm"] })]);
    respond(page(row("cleancopy01", "Song", "A • B • 3:00"), row("explicit001", "Song", "A • B • 3:00", true)));
    await explicitStep().catch(() => {});
    expect(musicConfig().library).toEqual([track("explicit001", "Song", "A", { moods: ["calm"], explicit: true })]);
  });

  test("a song that's explicit already, or has no such version, is left alone and not asked about again", async () => {
    setLibrary([track("already0001", "Song", "A"), track("nothing0001", "Other", "A")]);
    respond(page(row("already0001", "Song", "A • B • 3:00", true)));
    const e = await explicitStep().catch((x) => x);
    expect(e).toBeInstanceOf(Deferred);
    expect(musicConfig().library[0]).toMatchObject({ videoId: "already0001", explicit: true });
    respond(page(row("nothing0001", "Other", "A • B • 3:00")));
    await explicitStep();
    expect(musicConfig().library[1]).toMatchObject({ videoId: "nothing0001", explicit: false });
    expect(musicView().explicitPending).toBe(0);
  });

  test("an explicit copy you removed yourself stays removed", async () => {
    setLibrary([track("explicit001", "Song", "A"), track("cleancopy01", "Song", "A")]);
    removeTrack("explicit001");
    respond(page(row("explicit001", "Song", "A • B • 3:00", true)));
    await explicitStep();
    expect(musicConfig().library).toEqual([track("cleancopy01", "Song", "A", { explicit: false })]);
  });

  test("YouTube Music not answering keeps the song for later", async () => {
    setLibrary([track("cleancopy01", "Song", "A")]);
    answer = () => new Response("nope", { status: 500 });
    const e = await explicitStep().catch((x) => x);
    expect(e).toBeInstanceOf(Deferred);
    expect(e.message).toContain("500");
    expect(musicConfig().library[0]?.explicit).toBeUndefined();
  });

  test("nothing is asked with the switch off, of instrumentals, or of versions you've blocked", async () => {
    setLibrary([track("cleancopy01", "Song", "A")], { preferExplicit: false });
    await explicitStep();
    setLibrary([track("instrument1", "Song", "A", { instrumental: true }), track("livetake001", "Song (Live)", "A")], { taste: { blockVersions: ["live"] } });
    await explicitStep();
    setLibrary([track("cleancopy01", "Song", "A")], { enabled: false });
    await explicitStep();
    expect(asked).toEqual([]);
    run("DELETE FROM jobs WHERE kind = 'music.explicit'");
  });
});
