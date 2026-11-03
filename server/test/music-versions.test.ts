import { beforeAll, describe, expect, test } from "bun:test";
import { setSetting } from "../src/lib/settings";
import { type Cue, musicConfig, offTheme, pickTrack, stillFits } from "../src/music/director";
import { blockedVersion, songKey, versionsOf } from "../src/music/versions";
import { clashes } from "../src/music/words";
import { freshDb } from "./helpers";

const cue: Cue = { moods: ["tender", "night"], intensity: 0, hour: 23, weather: "", place: "", genre: null, present: ["Mira", "Spike"], key: "4|tender|night" };
const track = (videoId: string, title: string, artist = "A", moods: string[] = ["tender"]) => ({ videoId, title, artist, moods, instrumental: false });

describe("song versions", () => {
  test("told from the title's version part only", () => {
    expect(versionsOf("Rollercoaster (Live at Red Rocks - Morrison - 05.20.24)")).toEqual(["live"]);
    expect(versionsOf("I Wanna Get Better (MTV Unplugged)")).toEqual(["live", "acoustic"]);
    expect(versionsOf("LDN (Warbox Original Cut Dub)")).toEqual(["remix"]);
    expect(versionsOf("Cold Heart (PNAU Remix)")).toEqual(["remix"]);
    expect(versionsOf("How (demo)")).toEqual(["demo"]);
    expect(versionsOf("Espresso - Sped Up")).toEqual(["sped up"]);
    expect(versionsOf("Live Forever")).toEqual([]);
    expect(versionsOf("Talk talk (feat. Troye Sivan)")).toEqual([]);
    expect(blockedVersion("Modern Girl (Live From Madison Square Garden, NYC)", ["live"])).toBe(true);
    expect(blockedVersion("Modern Girl", ["live"])).toBe(false);
    expect(blockedVersion("Modern Girl (Live)", [])).toBe(false);
  });

  test("copies of one song share a key; songs of the same name by others don't", () => {
    expect(songKey({ title: "Rollercoaster (MTV Unplugged)", artist: "Bleachers" })).toBe(songKey({ title: "Rollercoaster", artist: "Bleachers" }));
    expect(songKey({ title: "Talk talk (feat. Troye Sivan)", artist: "Charli xcx" })).toBe(songKey({ title: "Talk talk", artist: "Charli xcx" }));
    expect(songKey({ title: "Rollercoaster", artist: "Charli XCX" })).not.toBe(songKey({ title: "Rollercoaster", artist: "Bleachers" }));
  });
});

describe("picking", () => {
  beforeAll(() => freshDb());

  test("blocked versions never play, and a copy of the last song doesn't either", () => {
    setSetting("music.config", { library: [track("studio00001", "Modern Girl"), track("livever0001", "Modern Girl (Live From Mexico)"), track("other000001", "Whim")], taste: { blockVersions: ["live"] } } as never);
    const cfg = musicConfig();
    for (let i = 0; i < 20; i++) expect(pickTrack(cfg, cue, {}, { rand: () => i / 20 })!.track.videoId).not.toBe("livever0001");
    setSetting("music.config", { library: [track("studio00001", "Modern Girl"), track("livever0001", "Modern Girl (Live From Mexico)"), track("other000001", "Whim")] } as never);
    for (let i = 0; i < 20; i++) expect(pickTrack(musicConfig(), cue, { recent: ["studio00001"] }, { exclude: ["studio00001"], rand: () => i / 20 })!.track.videoId).toBe("other000001");
  });

  test("a song about grief or heartbreak doesn't play in a tender scene, though it's tagged tender", () => {
    setSetting("music.config", { library: [track("griefsong01", "Gone", "A", ["tender", "night", "melancholy"]), track("lovesong001", "Yours", "B", ["tender"])] } as never);
    const themes = new Map([
      ["griefsong01", ["grief", "longing"]],
      ["lovesong001", ["desire", "devotion"]],
    ] as const);
    const cfg = musicConfig();
    for (let i = 0; i < 20; i++) expect(pickTrack(cfg, cue, {}, { themes: themes as never, rand: () => i / 20 })!.track.videoId).toBe("lovesong001");
    expect(stillFits(cfg, cue, "griefsong01", null, themes as never)).toBe(false);
    // Unless grief is what's happening.
    expect(offTheme(cue, ["grief"], { situations: ["grief"] })).toBe(false);
    expect(offTheme(cue, ["grief"], null)).toBe(true);
    expect(offTheme({ moods: ["melancholy"] }, ["grief"], null)).toBe(false);
  });

  test("a grief song clashes with desire", () => {
    expect(clashes({ situations: ["grief"], themes: [], voice: "self", passages: [] }, { situations: ["desire"] })).toBe(true);
  });
});
