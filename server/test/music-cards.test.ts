import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { run } from "../src/db/db";
import { setSetting } from "../src/lib/settings";
import { cleanCard, storedCard } from "../src/music/cards";
import { editSongCard, musicConfig, musicView, readCards, restoreOldMoods, retagTrack, sheetsStep, songWords } from "../src/music/director";
import { pasteLyrics } from "../src/music/lyrics";
import { songKey } from "../src/music/versions";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { Deferred, pauseJobs, registerJob } from "../src/services/jobs";
import { freshDb } from "./helpers";

const RUSH = "Your skin on mine in the dark\nTake me to bed, baby\n\nI want you, I want you\nTake me to bed, baby";
const GRAVE = "We laid him in the grave\nThe rain came down\n\nI mourn you still";
const MAMA = "Mama, I'm coming home\nThe porch light on for me\n\nMama, I'm coming home";

/** Runs the sheets job to the end, as the job queue would. */
async function readAll() {
  for (let i = 0; i < 20; i++) {
    try {
      await sheetsStep();
      return;
    } catch (e) {
      if (!(e instanceof Deferred)) throw e;
    }
  }
}
const lib = () => musicConfig().library;
const track = (id: string) => lib().find((t) => t.videoId === id)!;

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["music.sheets", "music.lyrics", "music.explicit"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
  setSetting("music.config", {
    library: [
      { videoId: "rush0000001", title: "Rush", artist: "Troye Sivan", moods: ["bright"], instrumental: false },
      // The explicit copy of the same song: one card for both.
      { videoId: "rush0000002", title: "Rush (Explicit)", artist: "Troye Sivan", moods: ["epic", "night"], instrumental: false },
      { videoId: "grave000001", title: "Grave Song", artist: "B", moods: ["tender"], instrumental: false },
      { videoId: "mama0000001", title: "Mama", artist: "C", moods: [], instrumental: false },
    ],
  } as never);
  // Moods you set yourself are never replaced by a guess.
  retagTrack("grave000001", { moods: ["calm", "tender"] });
});
afterAll(() => {
  pauseJobs(false);
  setSetting("music.config", null);
  setSetting("music.cardsAllowed", null);
});

describe("song cards (docs/34, Part 2)", () => {
  test("a card is made safe: known values only, levels kept in range, main not repeated in passing", () => {
    const c = cleanCard({ about: "  a  rush \n of love ", bond: "Romantic", stance: "smug", heat: "SEXUAL", dark: ["drugs", "taxes"], main: ["desire", "first love", "devotion"], passing: ["desire", "hope", "nope"], opening: ["desire"], energy: 9, pace: "sprint", moods: ["night", "loud"] }, ["night", "calm"]);
    expect(c).toEqual({ about: "a rush of love", bond: "romantic", stance: "wanting", heat: "sexual", dark: ["drugs"], main: ["desire", "first love"], passing: ["hope"], opening: ["desire"], energy: 5, pace: "mid", moods: ["night"] });
  });

  test("the sheet's helper call writes the card; every copy of the song shares it and takes its guessed moods", async () => {
    pasteLyrics("rush0000001", RUSH);
    pasteLyrics("rush0000002", RUSH);
    pasteLyrics("grave000001", GRAVE);
    await readAll();
    const rush = songWords("rush0000001").card!;
    expect(rush).toMatchObject({ bond: "romantic", heat: "sexual", stance: "wanting" });
    expect(songWords("rush0000002").card).toMatchObject({ bond: "romantic", heat: "sexual" });
    expect(songKey(track("rush0000001"))).toBe(songKey(track("rush0000002")));
    // Both copies now carry the same guessed moods (they had two different guesses), and say they're a guess.
    expect(track("rush0000001").moods).toEqual(["tender"]);
    expect(track("rush0000002").moods).toEqual(["tender"]);
    expect(rush.guessed).toEqual(["energy", "pace", "moods"]);
    expect(rush.oldMoods).toEqual(["bright"]);
    // The grave song mourns; its moods were yours and stay.
    expect(songWords("grave000001").card).toMatchObject({ stance: "mourning", dark: ["death"], energy: 1, guessed: ["energy", "pace"] });
    expect(track("grave000001").moods).toEqual(["calm", "tender"]);
    expect(musicView().cards.rush0000002).toMatchObject({ line: "romantic · wanting · sexual · energy 3" });
  });

  test("the moods a guess replaced can be put back, and are yours from then on", () => {
    const r = restoreOldMoods("rush0000002");
    expect(track("rush0000001").moods).toEqual(["bright"]);
    expect(track("rush0000002")).toMatchObject({ moods: ["bright"], moodsByHand: true });
    expect(r.card).toMatchObject({ oldMoods: null, guessed: ["energy", "pace"] });
    expect(() => restoreOldMoods("rush0000002")).toThrow();
  });

  test("songs read before cards wait for your yes; then they're read once, a few per call", async () => {
    pasteLyrics("mama0000001", MAMA);
    await readAll();
    // Pretend these were read before cards existed.
    run("DELETE FROM song_cards");
    await readAll();
    expect(songWords("rush0000001").card).toBeNull();
    // Three songs are due (the two Rush copies are one song), in one call of four.
    expect(musicView().cardsCount).toEqual({ have: 0, due: 3, calls: 1, reading: false });
    expect(readCards().cardsCount).toMatchObject({ due: 3, reading: true });
    await readAll();
    expect(musicView().cardsCount).toEqual({ have: 4, due: 0, calls: 0, reading: false });
    expect(songWords("mama0000001").card).toMatchObject({ bond: "family", stance: "wanting", main: ["homecoming"] });
  });

  test("your edit survives a re-read; a field you confirm stops being a guess", async () => {
    const r = editSongCard("rush0000001", { heat: "flirting", about: "Chasing a new lover", confirm: ["energy"] });
    expect(r.card).toMatchObject({ heat: "flirting", about: "Chasing a new lover", edited: ["about", "heat", "energy"], guessed: ["pace"] });
    // New words: the song is read again. Your fields stay, the rest is read fresh.
    pasteLyrics("rush0000001", `${RUSH}\nAnd we fight about it all night`);
    await readAll();
    expect(storedCard(songKey(track("rush0000001")))!.card).toMatchObject({ heat: "flirting", about: "Chasing a new lover", energy: 3, main: ["the fight"] });
    expect(() => editSongCard("rush0000001", { bond: "pets" })).toThrow();
    expect(() => editSongCard("rush0000001", { main: ["desire", "hope", "peace"] })).toThrow();
  });
});
