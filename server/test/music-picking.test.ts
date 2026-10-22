import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { setSetting } from "../src/lib/settings";
import { type Cue, chatMusicView, musicAction, musicConfig, musicView, pickTrack, saveMusicConfig, stillFits, type WordsCtx, wordsContext, wordsScore } from "../src/music/director";
import type { LyricLine } from "../src/music/lyrics";
import type { LyricSheet, Moment } from "../src/music/words";
import { seeded } from "../src/sim/dice";
import { createCharacter } from "../src/services/characters";
import { type ChatSettings, createChat, updateChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { freshDb } from "./helpers";

const cue: Cue = { moods: ["tender", "night"], intensity: 0, hour: 23, weather: "", place: "Lighthouse", genre: null, present: ["Mira", "Spike"], key: "4|tender|night" };
const moment = (situations: Moment["situations"], key = "m1|4|tender|night"): Moment => ({ situations, gist: "", key, from: "records", at: 0 });

const sheet = (situations: LyricSheet["situations"], extra: Partial<LyricSheet> = {}): LyricSheet => ({
  situations,
  themes: [],
  voice: "to-you",
  passages: [
    { from: 0, to: 1, kind: "verse", gist: "a verse", situations: [], peak: false },
    { from: 2, to: 3, kind: "chorus", gist: "the chorus", situations, peak: true },
  ],
  ...extra,
});
const lines = (chorus: string): LyricLine[] => [
  { t: 1, text: "first" },
  { t: 3, text: "second" },
  { t: 20, text: chorus },
  { t: 24, text: "and on" },
];

const LIB = [
  { videoId: "gonebymorn1", title: "Gone by Morning", artist: "A", moods: ["tender"], instrumental: false },
  { videoId: "alwaysyours", title: "Always Yours", artist: "B", moods: ["tender"], instrumental: false },
  { videoId: "partytime01", title: "Party Time", artist: "C", moods: ["tender"], instrumental: false },
  { videoId: "warcry00001", title: "War Cry", artist: "D", moods: ["tense"], instrumental: false },
];
const SHEETS = new Map<string, LyricSheet>([
  ["gonebymorn1", sheet(["leaving", "goodbye"])],
  ["alwaysyours", sheet(["devotion"])],
  ["partytime01", sheet(["celebration"])],
  ["warcry00001", sheet(["leaving", "goodbye", "the fight"])],
]);
const LINES = new Map([
  ["gonebymorn1", lines("I'll be gone before the morning comes and you won't hear the door")],
  ["alwaysyours", lines("Always yours")],
  ["partytime01", lines("Raise a glass")],
  ["warcry00001", lines("Swords up")],
]);
const ctx = (m: Moment, extra: Partial<WordsCtx> = {}): WordsCtx => ({ moment: m, weight: 0.5, lean: false, sheets: SHEETS, lines: LINES, vectors: new Map(), momentVec: null, present: 2, no: {}, yes: {}, ...extra });

let chatId = "";
beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update"]) registerJob(kind, async () => {});
  setSetting("music.config", { library: LIB } as never);
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "The lamp hums." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
});
afterAll(() => {
  pauseJobs(false);
  setSetting("music.config", null);
});

/** How often each song comes up over many seeds. */
function tally(words: WordsCtx | null) {
  const cfg = musicConfig();
  const n = new Map<string, number>();
  for (let i = 0; i < 200; i++) {
    const id = pickTrack(cfg, cue, {}, { words, rand: seeded("tally", i) })!.track.videoId;
    n.set(id, (n.get(id) ?? 0) + 1);
  }
  return n;
}

describe("picking by the words (docs/18, 3.1)", () => {
  test("someone leaving: the leaving song plays most of the time, not a same-mood love song", () => {
    const without = tally(null);
    const withWords = tally(ctx(moment(["leaving"])));
    expect(withWords.get("gonebymorn1")!).toBeGreaterThan(without.get("gonebymorn1") ?? 0);
    expect(withWords.get("gonebymorn1")!).toBeGreaterThan(120);
  });

  test("the right words never drag in a song in the wrong mood", () => {
    expect(tally(ctx(moment(["leaving", "goodbye", "the fight"]), { weight: 1 })).get("warcry00001") ?? 0).toBe(0);
  });

  test("the chip says why, quoting the line that fits", () => {
    const cfg = musicConfig();
    const pick = pickTrack({ ...cfg, library: cfg.library.filter((t) => t.videoId === "gonebymorn1" || t.videoId === "alwaysyours") }, cue, {}, { words: ctx(moment(["leaving"])), rand: () => 0 })!;
    expect(pick.track.videoId).toBe("gonebymorn1");
    expect(pick.why).toBe('fits: tender, leaving — "I\'ll be gone before the morning comes and you won\'t hear th…"');
    expect(pick.words).toEqual({ passage: 1, situations: ["leaving"], score: expect.any(Number) });
  });

  test("the same seed picks the same song (a swipe keeps it)", () => {
    const cfg = musicConfig();
    const a = pickTrack(cfg, cue, {}, { words: ctx(moment(["devotion"])), rand: seeded(chatId, 7, "music:x") });
    const b = pickTrack(cfg, cue, {}, { words: ctx(moment(["devotion"])), rand: seeded(chatId, 7, "music:x") });
    expect(a?.track.videoId).toBe(b!.track.videoId);
  });

  test("Wrong words takes a passage out for that situation; 👍 raises it", () => {
    const leaving = moment(["leaving"]);
    expect(wordsScore(ctx(leaving), "gonebymorn1")).not.toBeNull();
    // The chorus no longer counts; only the song as a whole still says it's about leaving, so it counts far less.
    const wrong = wordsScore(ctx(leaving, { no: { leaving: ["gonebymorn1#1"] } }), "gonebymorn1")!;
    expect(wrong.words.passage).toBe(0);
    expect(wrong.score).toBeLessThan(wordsScore(ctx(leaving), "gonebymorn1")!.score / 2);
    // Only for that situation.
    expect(wordsScore(ctx(moment(["goodbye"]), { no: { leaving: ["gonebymorn1#1"] } }), "gonebymorn1")).not.toBeNull();
    const plain = wordsScore(ctx(leaving), "gonebymorn1")!.score;
    expect(wordsScore(ctx(leaving, { yes: { leaving: { "gonebymorn1#1": 1 } } }), "gonebymorn1")!.score).toBe(plain + 1);
    // Lean in: the words count fully, and the peak a little more.
    expect(wordsScore(ctx(leaving, { weight: 1, lean: true }), "gonebymorn1")!.score).toBe(plain * 2 + 0.5);
  });

  test("still fits: words that fit hold a song; words that clash cut it", () => {
    const cfg = musicConfig();
    expect(stillFits(cfg, { ...cue, moods: ["melancholy"] }, "gonebymorn1", ctx(moment(["leaving"])))).toBe(true);
    expect(stillFits(cfg, { ...cue, moods: ["melancholy"] }, "gonebymorn1", null)).toBe(false);
    expect(stillFits(cfg, cue, "partytime01", null)).toBe(true);
    expect(stillFits(cfg, cue, "partytime01", ctx(moment(["grief"])))).toBe(false);
  });
});

describe("when the words count (3.2)", () => {
  test("the dial is a setting of its own, beside each song's words", () => {
    expect(musicView()).toMatchObject({ wordsDial: "little", words: { gonebymorn1: "pending" } });
    expect(saveMusicConfig({ wordsDial: "lean" })).toMatchObject({ wordsDial: "lean" });
    saveMusicConfig({ wordsDial: "little" });
  });

  const music = (m: Moment | null) => ({ moment: m });
  test("off, a quiet scene, or a moment from another scene: mood only", async () => {
    const cfg = musicConfig();
    expect(await wordsContext({ ...cfg, wordsDial: "off" }, music(moment(["leaving"])), cue)).toBeNull();
    expect(await wordsContext(cfg, music(moment([])), cue)).toBeNull();
    expect(await wordsContext(cfg, music(moment(["leaving"], "m1|3|calm|day")), cue)).toBeNull();
    // No song read for its words yet.
    expect(await wordsContext(cfg, music(moment(["leaving"])), cue)).toBeNull();
  });
});

describe("your hand (3.3)", () => {
  test("Wrong words keeps the song and remembers the passage for this story", async () => {
    const now = { videoId: "gonebymorn1", title: "Gone by Morning", artist: "A", key: cue.key, why: "fits", at: 0, words: { passage: 1, situations: ["leaving", "goodbye"], score: 2 } };
    updateChat(chatId, { settings: { music: { on: true, now } } as ChatSettings });
    const v = await musicAction(chatId, "wrongWords");
    expect(v.now).toMatchObject({ videoId: "gonebymorn1" });
    expect(v.now?.words).toBeUndefined();
    expect(chatMusicView(chatId).now?.videoId).toBe("gonebymorn1");
    await expect(musicAction(chatId, "wrongWords")).rejects.toThrow(/wasn't picked for its words/);
  });
});
