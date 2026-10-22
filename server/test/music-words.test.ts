import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { setSetting } from "../src/lib/settings";
import { pasteLyrics } from "../src/music/lyrics";
import { bigMoment, chatMusicView, cueFrom, momentAt, musicConfig, musicView, removeTracks, sheetsStep, songWords } from "../src/music/director";
import { cleanSheet, type LyricSheet, numbered, situationsFromRecords, wordsFit } from "../src/music/words";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { Deferred, pauseJobs, registerJob } from "../src/services/jobs";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import type { Change, WorldState } from "../src/trackers/types";
import { freshDb } from "./helpers";

let chatId = "";
const st = (mode = "") => ({ mode }) as unknown as WorldState;
const change = (kind: string, text: string, extra: Partial<Change> = {}): Change => ({ ...extra, kind, text, path: extra.path ?? kind }) as Change;

const LEAVING = "[00:10.00] I'll be gone before the morning\n[00:14.00] Don't wait up for me\n[00:18.00] \n[00:30.00] Always yours, forever\n[00:34.00] Always yours, forever\n[00:38.00] \n[00:50.00] I'll be gone before the morning\n[00:54.00] Don't wait up for me";
const GRAVE = "We laid him in the grave\nThe rain came down\n\nI mourn you still";

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "music.sheets", "music.lyrics"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "The lamp hums." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 1 22:00", "at: Port Ellis › Lighthouse", "cast: Mira@spot · Spike@spot", "scene: The lamp room"]).ops, "model");
  setSetting("music.config", {
    library: [
      { videoId: "leaving0001", title: "Gone by Morning", artist: "A", moods: ["tender"], instrumental: false },
      { videoId: "grave000001", title: "Grave Song", artist: "B", moods: [], instrumental: false },
      { videoId: "nowords0001", title: "No Words", artist: "C", moods: ["calm"], instrumental: false },
    ],
  } as never);
});
afterAll(() => {
  pauseJobs(false);
  setSetting("music.config", null);
});

describe("lyric sheets (docs/18, 2.1)", () => {
  test("a sheet is made safe: known situations, passages inside the song and in order, one peak", () => {
    const s = cleanSheet(
      {
        id: "x",
        situations: ["Leaving", "teleportation", "goodbye"],
        themes: [" Dawn ", ""],
        voice: "sideways",
        passages: [
          { from: 4, to: 99, kind: "chorus", gist: "the end", situations: ["longing"], peak: true },
          { from: 0, to: 5, kind: "verse", gist: "the start", situations: ["leaving"], peak: true },
          { from: 2, to: 1, kind: "verse", gist: "backwards", situations: [], peak: false },
        ],
      },
      8,
    );
    expect(s.situations).toEqual(["leaving", "goodbye"]);
    expect(s.themes).toEqual(["dawn"]);
    expect(s.voice).toBe("to-you");
    expect(s.passages.map((p) => [p.from, p.to, p.kind, p.peak])).toEqual([
      [0, 5, "verse", true],
      [6, 7, "chorus", false],
    ]);
  });

  test("timed lyrics: a long pause between lines shows the reader where a section starts", () => {
    expect(numbered([{ t: 1, text: "a" }, { t: 3, text: "b" }, { t: 12, text: "c" }, { t: 13, text: "" }, { t: 20, text: "d" }])).toBe(["0: a", "1: b", "—", "2: c", "3: —", "4: d"].join("\n"));
    expect(numbered([{ t: null, text: "a" }, { t: null, text: "b" }])).toBe("0: a\n1: b");
  });

  test("the job reads songs with words, adds a mood the words carry, and leaves songs without words alone", async () => {
    pasteLyrics("leaving0001", LEAVING);
    pasteLyrics("grave000001", GRAVE);
    expect(musicView().wordsCount).toMatchObject({ have: 2, read: 0 });
    await sheetsStep().catch((e) => {
      if (!(e instanceof Deferred)) throw e;
    });
    const leaving = songWords("leaving0001").sheet!;
    expect(leaving.situations).toContain("leaving");
    expect(leaving.voice).toBe("to-you");
    expect(leaving.passages.map((p) => p.kind)).toEqual(["chorus", "verse", "chorus"]);
    expect(leaving.passages[1]).toMatchObject({ from: 3, to: 4, situations: ["devotion"] });
    expect(songWords("grave000001").sheet?.situations).toEqual(["grief"]);
    expect(songWords("nowords0001").sheet).toBeNull();
    expect(musicConfig().library.find((t) => t.videoId === "grave000001")?.moods).toEqual(["melancholy"]);
    expect(musicView().wordsCount).toMatchObject({ have: 2, read: 2 });
    // Unchanged words aren't read again; changed ones are.
    await sheetsStep();
    pasteLyrics("grave000001", `${GRAVE}\nOne more line`);
    expect(songWords("grave000001").sheet).toBeNull();
    expect(musicView().wordsCount.read).toBe(1);
  });
});

describe("the moment (2.3)", () => {
  test("the records say it for free", () => {
    expect(situationsFromRecords([change("death", "Old Tom died")], st())).toEqual(["grief"]);
    expect(situationsFromRecords([change("secret", "Revealed to Spike: the map is fake")], st())).toEqual(["confession"]);
    expect(situationsFromRecords([change("secret", "Revealed to Spike: the map is fake"), change("bond", "Spike → Mira · Trust -2", { path: "bonds.a.trust", tone: "down" })], st())).toEqual(["betrayal"]);
    expect(situationsFromRecords([change("romance", "Mira → Spike: Smitten (3/7)", { tone: "up" })], st())).toEqual(["first love"]);
    expect(situationsFromRecords([change("romance", "Mira → Spike: Devoted (6/7)", { tone: "up" })], st())).toEqual(["devotion"]);
    expect(situationsFromRecords([change("cast", "Spike left"), change("cast", "Tam arrived")], st())).toEqual(["leaving", "reunion"]);
    expect(situationsFromRecords([], st("conflict"))).toEqual(["the fight"]);
    expect(situationsFromRecords([], st("calm"), { situations: ["the fight"], gist: "", key: "", from: "records", at: 0 })).toEqual(["aftermath"]);
    expect(situationsFromRecords([change("promise", "Promise broken: be there")], st("travel"))).toEqual(["betrayal", "the road"]);
    // The scene moving on without someone isn't anyone leaving.
    expect(situationsFromRecords([change("cast", "Tam stayed behind (the café)")], st())).toEqual([]);
  });

  test("hints from the records (someone walking off, a sad mood) don't outvote the reply", async () => {
    const text = "She drops the blue shirt in his basket. Forever, she thinks, and lets him keep his hand at her waist.";
    const id = addMessage(chatId, "assistant", text, { name: "Mira" });
    writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(["cast: Mira@spot · Spike@left", "mood Mira: heartbroken"]).ops, "model");
    const state = currentFold(chatId).result.state;
    expect(situationsFromRecords(currentFold(chatId).result.changes[id] ?? [], state)).toEqual(["leaving", "grief"]);
    const m = await momentAt(chatId, id, state, cueFrom(state, null), text, null);
    expect(m).toMatchObject({ situations: ["devotion"], from: "reply" });
  });

  test("with fewer than two from the records, one helper call reads the reply; the same beat reuses it", async () => {
    const id = addMessage(chatId, "assistant", "She folds the letter. She'll be gone before the morning, and she won't say goodbye.", { name: "Mira" });
    const state = currentFold(chatId).result.state;
    const cue = cueFrom(state, null);
    const m = await momentAt(chatId, id, state, cue, "She folds the letter. She'll be gone before the morning, and she won't say goodbye.", null);
    expect(m).toMatchObject({ situations: ["leaving", "goodbye"], from: "reply" });
    expect(m!.gist).toBe("Someone is leaving");
    expect(chatMusicView(chatId).moment).toMatchObject({ situations: ["leaving", "goodbye"] });
    // A swipe of the same beat: no second reading.
    const again = await momentAt(chatId, id, state, cue, "something else entirely", m!);
    expect(again).toBe(m);
  });

  test("a death or a romance step is a big moment for the music", () => {
    const id = addMessage(chatId, "assistant", "Spike falls.", { name: "Mira" });
    writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(["dead Spike — fell"]).ops, "model");
    expect(bigMoment(id, chatId)).toBe(true);
    const id2 = addMessage(chatId, "assistant", "She smiles at Tam.", { name: "Mira" });
    writeEvents(chatId, { messageId: id2, swipeIdx: 0 }, linesToOps(["cast: Mira@spot · Tam@spot", "ladder Mira>Tam: 3 — she keeps finding reasons to stay"]).ops, "user");
    expect(bigMoment(id2, chatId)).toBe(true);
    const quiet = addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
    expect(bigMoment(quiet, chatId)).toBe(false);
  });
});

describe("how well a song fits (2.4)", () => {
  const sheet: LyricSheet = {
    situations: ["leaving", "longing"],
    themes: [],
    voice: "to-you",
    passages: [
      { from: 0, to: 1, kind: "verse", gist: "packing at night", situations: ["leaving"], peak: false },
      { from: 2, to: 3, kind: "chorus", gist: "gone by morning", situations: ["leaving", "goodbye"], peak: false },
      { from: 4, to: 5, kind: "bridge", gist: "hoping to return", situations: ["hope"], peak: true },
    ],
  };
  test("the passage that shares the most, the chorus a little ahead", () => {
    expect(wordsFit(sheet, { situations: ["leaving", "goodbye"] })).toEqual({ score: 3, passage: 1 });
    expect(wordsFit(sheet, { situations: ["hope"] })).toEqual({ score: 1.75, passage: 2 });
    expect(wordsFit(sheet, { situations: ["the fight"] })).toEqual({ score: 0, passage: null });
    expect(wordsFit(null, { situations: ["leaving"] })).toEqual({ score: 0, passage: null });
    expect(wordsFit(sheet, { situations: [] })).toEqual({ score: 0, passage: null });
  });
  test("who the song sings to, and meaning when there are vectors", () => {
    const two = wordsFit(sheet, { situations: ["leaving"] }, { present: 2 }).score;
    const one = wordsFit(sheet, { situations: ["leaving"] }, { present: 1 }).score;
    expect(two).toBeGreaterThan(one);
    const v = (x: number, y: number) => new Float32Array([x, y]);
    const near = wordsFit(sheet, { situations: ["hope"] }, { vectors: new Map([[2, v(1, 0)], [0, v(0, 1)]]), momentVec: v(1, 0) });
    expect(near.passage).toBe(2);
    expect(near.score).toBeGreaterThan(1.75);
  });
});

test("a removed song's sheet goes with its words", () => {
  removeTracks(["leaving0001"]);
  expect(() => songWords("leaving0001")).toThrow(/isn't in the library/);
});
