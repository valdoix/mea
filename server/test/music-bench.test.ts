import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BenchScene, benchView, chooseScenes, type MarkedScene, rankScene, readMarked, sceneFromReading, scoreScene, setChecked, setMark, summarize, writeMarked } from "../src/music/bench";
import { type Mood, musicConfig, type Track } from "../src/music/director";
import { freshDb } from "./helpers";

beforeAll(() => freshDb());

/** A logged `story_moment` call, as the generations table keeps it. */
const reading = (id: string, opts: { mood?: string; gist?: string; situations?: string[]; system?: string } = {}) => ({
  id,
  chat_id: "c1",
  started_at: 1000,
  request: JSON.stringify({
    messages: [
      { role: "system", content: opts.system ?? "You choose music for a story. Say what is happening in this scene right now…" },
      { role: "user", content: `Place: Home › Kitchen\nHere: Buffy, Dawn\nMood: ${opts.mood ?? "tender, bright"}\n\nShe set the plates down.\n\nDawn laughed.` },
    ],
  }),
  response: JSON.stringify({ gist: opts.gist ?? "A family dinner", situations: opts.situations ?? ["peace", "homecoming", "not-a-situation"] }),
});

const song = (n: number, moods: Mood[]): Track => ({ videoId: `v${String(n).padStart(10, "0")}`, title: `Song ${n}`, artist: "X", moods, instrumental: false });

describe("the replay bench (docs/34, 1.3-1.4)", () => {
  test("a scene is read back from its logged call: the cue lines, the situations it named, the end of the reply", () => {
    const s = sceneFromReading(reading("g1"))!;
    expect(s).toMatchObject({ id: "g1", chatId: "c1", moods: ["tender", "bright"], present: ["Buffy", "Dawn"], place: "Home › Kitchen", situations: ["peace", "homecoming"], gist: "A family dinner", from: "reading" });
    expect(s.excerpt).toBe("She set the plates down.\n\nDawn laughed.");
    // Other soundtrack calls (a lyric sheet) are not scenes.
    expect(sceneFromReading(reading("g2", { system: "You read song lyrics for a story's soundtrack" }))).toBeNull();
    expect(sceneFromReading({ ...reading("g3"), response: "not json" })).toBeNull();
  });

  test("today's picker on a scene: every song in the roll with its chance; the marks score it", async () => {
    const library = [song(1, ["tender", "bright"]), song(2, ["tender"]), song(3, ["bright"]), song(4, ["dread"])];
    const cfg = { ...musicConfig(), library, leitmotifs: [], wordsDial: "off" as const };
    const scene = sceneFromReading(reading("g1"))!;
    const ranked = await rankScene(cfg, scene);
    expect(ranked[0]!.track.videoId).toBe(library[0]!.videoId);
    expect(ranked.map((r) => r.track.videoId)).not.toContain(library[3]!.videoId);
    expect(ranked.reduce((n, r) => n + r.chance, 0)).toBeCloseTo(1, 6);
    const marked: MarkedScene = { ...scene, songs: { [library[0]!.videoId]: { mark: "wrong", by: "claude" }, [library[1]!.videoId]: { mark: "fits", by: "claude" } } };
    const sc = scoreScene(marked, ranked);
    expect(sc.topWrong).toBe(true);
    expect(sc.wrongInTop3).toBe(true);
    expect(sc.wrong).toBeCloseTo(ranked[0]!.chance, 6);
    expect(sc.fits + sc.fine + sc.wrong + sc.unmarked).toBeCloseTo(1, 6);
    expect(summarize([sc, { ...sc, topWrong: false, wrongInTop3: false, wrong: 0, fits: 1, fine: 0, unmarked: 0 }])).toMatchObject({ scenes: 2, topWrong: 1, wrongInTop3: 1 });
  });

  test("scenes to mark: spread over the kinds of scene, newest first, never the same gist twice", () => {
    const at = (s: BenchScene, n: number) => ({ ...s, at: n });
    const scenes = [
      at(sceneFromReading(reading("a", { gist: "Dinner" }))!, 1),
      at(sceneFromReading(reading("b", { gist: "dinner!" }))!, 2),
      at(sceneFromReading(reading("c", { gist: "Breakfast" }))!, 3),
      at(sceneFromReading(reading("d", { gist: "A fight", mood: "tense", situations: ["the fight"] }))!, 4),
    ];
    const picked = chooseScenes(scenes, 3).map((s) => s.id);
    expect(picked).toHaveLength(3);
    expect(picked).toContain("d");
    // "Dinner" and "dinner!" are one scene: the newer one stays.
    expect(picked.filter((id) => id === "a" || id === "b")).toEqual(["b"]);
  });

  test("your marks on the Settings page are kept as yours", () => {
    const file = join(mkdtempSync(join(tmpdir(), "mea-bench-")), "evals", "music-bench.json");
    const scene = sceneFromReading(reading("g1"))!;
    writeMarked({ version: 1, made: 1, scenes: [{ ...scene, songs: { v0000000001: { mark: "fine", by: "claude", title: "Song 1", artist: "X" } } }] }, file);
    expect(setMark("g1", "v0000000001", "wrong", file)).not.toBeNull();
    expect(setMark("nope", "v0000000001", "wrong", file)).toBeNull();
    setChecked("g1", true, file);
    expect(readMarked(file)!.scenes[0]!.songs.v0000000001).toMatchObject({ mark: "wrong", by: "you", title: "Song 1" });
    expect(benchView(file)).toMatchObject({ counts: { scenes: 1, checked: 1, songs: 1, byYou: 1 }, scenes: [{ id: "g1", checked: true, songs: [{ videoId: "v0000000001", mark: "wrong", by: "you" }] }] });
    expect(benchView(join(tmpdir(), "no-such-dir", "x.json")).scenes).toEqual([]);
  });
});
