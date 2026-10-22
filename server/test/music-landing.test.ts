import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { setSetting } from "../src/lib/settings";
import { chatMusicView, landingFor, landPollForTests, MOODS, musicAfterReply, musicConfig, nowSinging } from "../src/music/director";
import { type LyricLine, pasteLyrics } from "../src/music/lyrics";
import { landingPoint, linesHash, type LyricSheet, saveSheet } from "../src/music/words";
import { seekTo } from "../src/music/ytmusic";
import { createCharacter } from "../src/services/characters";
import { addMessage, type ChatSettings, createChat, updateChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** A song: intro verse 0:10-0:18, verse 0:40-0:48, chorus 0:52-1:00, outro to 1:30 of 3:00. */
const LRC = ["[00:10.00] intro one", "[00:14.00] intro two", "[00:40.00] verse one", "[00:44.00] verse two", "[00:52.00] I'll be gone before the morning", "[00:56.00] don't wait up", "[01:30.00] outro"].join("\n");
const SHEET: LyricSheet = {
  situations: ["leaving"],
  themes: [],
  voice: "to-you",
  passages: [
    { from: 0, to: 1, kind: "intro", gist: "opening", situations: [], peak: false },
    { from: 2, to: 3, kind: "verse", gist: "packing", situations: [], peak: false },
    { from: 4, to: 5, kind: "chorus", gist: "gone by morning", situations: ["leaving", "goodbye"], peak: true },
    { from: 6, to: 6, kind: "outro", gist: "the end", situations: [], peak: false },
  ],
};
const t = (...ts: number[]): LyricLine[] => ts.map((x, i) => ({ t: x, text: `line ${i}` }));

const realFetch = globalThis.fetch;
const sent: { path: string; body: unknown }[] = [];
let playing = { id: "ooooooooooo", durationSeconds: 180 };
let progress = 0;
let chatId = "";

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  landPollForTests(5);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "music.sheets", "music.lyrics"]) registerJob(kind, async () => {});
  // A Companion Server that plays what it's told to, from the top.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "127.0.0.1") throw new Error(`unexpected network call: ${url}`);
    const path = url.pathname.replace("/api/v1", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    sent.push({ path, body });
    if (path === "/state") return new Response(JSON.stringify({ player: { trackState: 1, videoProgress: progress }, video: playing }));
    if (path === "/command") {
      if (body.command === "changeVideo") (playing = { id: body.data.videoId, durationSeconds: 180 }), (progress = 0);
      if (body.command === "seekTo") progress = body.data;
      return new Response("", { status: 204 });
    }
    if (path === "/seek-to") return new Response("", { status: 204 });
    return new Response("", { status: 404 });
  }) as typeof fetch;
  setSetting("music.config", {
    enabled: true,
    token: "tok",
    app: "ytmd",
    wordsDial: "lean",
    library: [
      { videoId: "gonebymorn1", title: "Gone by Morning", artist: "A", moods: [...MOODS], instrumental: false },
      { videoId: "othersong01", title: "Other", artist: "B", moods: [], instrumental: false },
    ],
  } as never);
  pasteLyrics("gonebymorn1", LRC);
  saveSheet("gonebymorn1", SHEET, linesHash([...LRC.matchAll(/\] (.*)/g)].map((m, i) => ({ t: [10, 14, 40, 44, 52, 56, 90][i]!, text: m[1]! }))));
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "The lamp hums." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 1 22:00", "at: Port Ellis › Lighthouse", "cast: Mira@spot · Spike@spot", "scene: The lamp room"]).ops, "model");
});
afterAll(() => {
  globalThis.fetch = realFetch;
  pauseJobs(false);
  setSetting("music.config", null);
});

describe("the landing point (docs/18, 4.2)", () => {
  const sheet = (n: number[][]): LyricSheet => ({ situations: [], themes: [], voice: "to-you", passages: n.map(([from, to]) => ({ from: from!, to: to!, kind: "verse", gist: "", situations: [], peak: false })) });
  test("a short section before the passage plays whole as the run-up", () => {
    expect(landingPoint(sheet([[0, 1], [2, 3]]), t(30, 34, 50, 54), 1, 200)).toBe(30);
  });
  test("a long section before: the last line starting at least 8 s ahead", () => {
    expect(landingPoint(sheet([[0, 2], [3, 4]]), t(20, 30, 41, 70, 74), 1, 200)).toBe(41);
    expect(landingPoint(sheet([[0, 2], [3, 4]]), t(20, 30, 65, 70, 74), 1, 200)).toBe(30);
  });
  test("too early, too near the end, or untimed: from the top", () => {
    expect(landingPoint(sheet([[0, 1], [2, 3]]), t(2, 6, 12, 16), 1, 200)).toBeNull();
    expect(landingPoint(sheet([[0, 1], [2, 3]]), t(30, 34, 150, 170), 1, 200)).toBeNull();
    expect(landingPoint(sheet([[0, 1], [2, 3]]), [{ t: null, text: "a" }, { t: null, text: "b" }, { t: null, text: "c" }, { t: null, text: "d" }], 1, 200)).toBeNull();
  });
});

describe("seeking", () => {
  test("th-ch's app has /seek-to; the Companion Server a seekTo command with the seconds", async () => {
    await seekTo({ port: 26538, token: "x", app: "pear" }, 41.26);
    await seekTo({ port: 9863, token: "x", app: "ytmd" }, 41.26);
    expect(sent.slice(-2)).toEqual([
      { path: "/seek-to", body: { seconds: 41.3 } },
      { path: "/command", body: { command: "seekTo", data: 41.3 } },
    ]);
  });
});

describe("when a song lands (4.2)", () => {
  const pick = { track: musicConfigTrack(), why: "fits", words: { passage: 2, situations: ["leaving" as const], score: 2 } };
  function musicConfigTrack() {
    return { videoId: "gonebymorn1", title: "Gone by Morning", artist: "A", moods: [], instrumental: false };
  }
  test("on with Lean in, off with A little unless set to always; never twice in a scene, nor for a weak fit or a theme", () => {
    const cfg = musicConfig();
    expect(landingFor(cfg, {}, pick, 3)).toBe(40);
    expect(landingFor({ ...cfg, wordsDial: "little" }, {}, pick, 3)).toBeNull();
    expect(landingFor({ ...cfg, wordsDial: "little", landLine: "on" }, {}, pick, 3)).toBe(40);
    expect(landingFor({ ...cfg, landLine: "off" }, {}, pick, 3)).toBeNull();
    expect(landingFor(cfg, { landedScene: 3 }, pick, 3)).toBeNull();
    expect(landingFor(cfg, {}, { ...pick, words: { ...pick.words, score: 1 } }, 3)).toBeNull();
    expect(landingFor(cfg, {}, { ...pick, why: "Mira & Spike's theme" }, 3)).toBeNull();
  });

  test("a beat where someone leaves: the leaving song starts just before its chorus, and the chip shows the line", async () => {
    updateChat(chatId, { settings: { music: { on: true } } as ChatSettings });
    const id = addMessage(chatId, "assistant", "Spike shoulders his bag and goes.", { name: "Mira" });
    writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(["cast: Spike@off"]).ops, "model");
    sent.length = 0;
    musicAfterReply(chatId, id);
    for (let i = 0; i < 50 && !sent.some((s) => (s.body as { command?: string })?.command === "seekTo"); i++) await Bun.sleep(10);
    const cmds = sent.filter((s) => s.path === "/command").map((s) => s.body);
    expect(cmds).toEqual([
      { command: "changeVideo", data: { videoId: "gonebymorn1" } },
      { command: "seekTo", data: 40 },
    ]);
    await Bun.sleep(20);
    expect(chatMusicView(chatId).now).toMatchObject({ videoId: "gonebymorn1", landed: 40, words: { passage: 2 } });
    // Before the chorus, nothing to show; in it, the line being sung and the next.
    expect(await nowSinging(chatId)).toBeNull();
    progress = 53;
    expect(await nowSinging(chatId)).toEqual({ current: "I'll be gone before the morning", next: "don't wait up", elapsed: 53 });
  });
});
