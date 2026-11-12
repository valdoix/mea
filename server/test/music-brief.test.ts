import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { one, run } from "../src/db/db";
import { setSetting } from "../src/lib/settings";
import { cleanBrief, recordsBrief } from "../src/music/brief";
import { saveReadCard } from "../src/music/cards";
import { chatMusicView, cueFrom, type Mood, momentAt, musicConfig, rankTracks, type Track } from "../src/music/director";
import { songKey } from "../src/music/versions";
import { pasteLyrics } from "../src/music/lyrics";
import { saveSheet, linesHash } from "../src/music/words";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import type { WorldState } from "../src/trackers/types";
import { freshDb } from "./helpers";

let chatId = "";
/** Helper calls that read the scene, so far. */
const readings = () => one<{ n: number }>("SELECT COUNT(*) AS n FROM generations WHERE request LIKE '%You choose music for a story%'")!.n;

/** A reply with its records written, and the moment Mea reads at it. */
async function beat(text: string, lines: string[] = []) {
  const id = addMessage(chatId, "assistant", text, { name: "Mira" });
  if (lines.length) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
  const st = currentFold(chatId).result.state;
  return (await momentAt(chatId, id, st, cueFrom(st, null), text, chatMusicView(chatId).moment ?? null))!;
}

/** A hand-made state: just the cast, their bonds, the romance ladder and the groups. */
const state = (s: Partial<WorldState>) => ({ chars: {}, bonds: {}, ladders: {}, groups: {}, ...s }) as unknown as WorldState;
const char = (id: string, name: string, extra: object = {}) => ({ [id]: { id, name, aliases: [], traits: [], ...extra } }) as unknown as WorldState["chars"];

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "music.sheets", "music.lyrics"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "The car idles." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "The car idles.", { name: "Mira" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 1 15:00", "at: Port Ellis › The school gates", "cast: Mira@spot · Spike@spot", "scene: Pickup"]).ops, "model");
  // One song read for its words: only then does the scene get a helper call (docs/18).
  setSetting("music.config", { library: [{ videoId: "song0000001", title: "A Song", artist: "A", moods: ["tender"], instrumental: false }] } as never);
  pasteLyrics("song0000001", "Hold on to me");
  saveSheet("song0000001", { situations: ["devotion"], themes: [], voice: "to-you", passages: [{ from: 0, to: 0, kind: "chorus", gist: "holding on", situations: ["devotion"], peak: false }] }, linesHash([{ t: null, text: "Hold on to me" }]));
});
afterAll(() => {
  pauseJobs(false);
  setSetting("music.config", null);
});

describe("the scene brief: what the records say, free (docs/34, 3.1)", () => {
  const couple = { l: { from: "a", to: "b", tier: 6, seq: 1, scene: 1, history: [] } };
  test("two people on the romance ladder alone are romantic; with a sister along, family", () => {
    expect(recordsBrief(state({ chars: { ...char("a", "Buffy"), ...char("b", "Spike") }, ladders: couple as never }), ["Buffy", "Spike"])).toMatchObject({ bond: "romantic", child: false, ties: ["Buffy & Spike: romance, Together"] });
    const family = { g: { name: "the Summers", kind: "family", members: [{ name: "Buffy", since: 0 }, { name: "Dawn", role: "sister", since: 0 }], facts: [] } };
    const r = recordsBrief(state({ chars: { ...char("a", "Buffy"), ...char("b", "Spike"), ...char("c", "Dawn") }, ladders: couple as never, groups: family as never }), ["Buffy", "Spike", "Dawn"]);
    expect(r.bond).toBe("family");
    expect(r.ties).toContain("Buffy, Dawn (sister): family, the Summers");
  });

  test("a child, by how they're described; a kin word in a bond's label is family; one person is a scene about themself", () => {
    const kid = recordsBrief(state({ chars: { ...char("a", "Buffy"), ...char("b", "Gabriel", { look: "a seven-year-old with a gap-toothed grin" }) } }), ["Buffy", "Gabriel"]);
    expect(kid).toMatchObject({ bond: "family", child: true });
    // "Her daughter" is a role, not an age.
    const grown = { g: { name: "the Rosenbergs", kind: "family", members: [{ name: "Willow", role: "daughter", since: 0 }, { name: "Sheila", role: "mother", since: 0 }], facts: [] } };
    expect(recordsBrief(state({ groups: grown as never }), ["Willow", "Sheila"])).toMatchObject({ bond: "family", child: false });
    const sisters = { x: { from: "a", to: "b", axes: {}, label: "protective older sister", tags: [], history: [] } };
    expect(recordsBrief(state({ chars: { ...char("a", "Buffy"), ...char("b", "Dawn") }, bonds: sisters as never }), ["Buffy", "Dawn"]).bond).toBe("family");
    expect(recordsBrief(state({}), ["Buffy"]).bond).toBe("self");
    expect(recordsBrief(state({}), ["Buffy", "Xander"]).bond).toBeNull();
  });
});

describe("the scene brief: the helper's reading (3.2-3.3)", () => {
  test("a reading is made safe: strong and slight apart, at most three, known values only; zero situations is an answer", () => {
    expect(cleanBrief({ gist: " Tea,  quietly ", bond: "Family", stance: "content", heat: "warm", energy: 9, situations: [], avoid: [" Breakup songs ", "breakup songs", ""], child: false })).toEqual({ gist: "Tea, quietly", bond: "family", stance: null, heat: "none", energy: 5, strong: [], slight: [], avoid: ["breakup songs"], child: false });
    const r = cleanBrief({ gist: "", situations: ["hope", { s: "peace", strength: "slight" }, { s: "homecoming", strength: "strong" }, { s: "nope", strength: "strong" }, { s: "alone", strength: "slight" }], avoid: [], child: false });
    expect(r).toMatchObject({ strong: ["hope", "homecoming"], slight: ["peace"] });
  });

  test("the school pickup: family, no heat, a child here; the chip says so in a line", async () => {
    const m = await beat("Gabriel climbs into the back and buckles his car seat while Mira asks about his day. The kid talks about lizards the whole way home.");
    expect(m).toMatchObject({ bond: "family", heat: "none", child: true, situations: ["homecoming"], from: "reply" });
    expect(m.avoid).toEqual(["anything sexual"]);
    // The tracker has only Mira and Spike here; the reply knows a child came along, and that wins over "self".
    expect(chatMusicView(chatId).scene).toBe("family · happy in it · no heat · energy 2 — Someone is homecoming");
  });

  test("one person on the cast with a kid in the reply: the scene is family, not about herself", async () => {
    writeEvents(chatId, { messageId: addMessage(chatId, "assistant", "Next morning.", { name: "Mira" }), swipeIdx: 0 }, linesToOps(["clock: Day 2 08:00", "cast: Mira@spot · Spike@off"]).ops, "model");
    const m = await beat("Mira drives the kid to school, the radio low.");
    expect(m).toMatchObject({ bond: "family", child: true, heat: "none" });
  });

  test("two people making tea: nothing happening is an answer, and the words don't apply", async () => {
    writeEvents(chatId, { messageId: addMessage(chatId, "assistant", "A new scene.", { name: "Mira" }), swipeIdx: 0 }, linesToOps(["scene: The kitchen", "at: Port Ellis › The flat › Kitchen"]).ops, "model");
    const m = await beat("Mira fills the kettle. Spike gets the mugs down. They don't say much.");
    expect(m.situations).toEqual([]);
    expect(m.gist).toBe("A quiet moment");
  });
});

describe("the scene brief is kept for the scene (3.4)", () => {
  test("the next two replies reuse it; the third reads again; so does a new scene, or a death", async () => {
    writeEvents(chatId, { messageId: addMessage(chatId, "assistant", "Later.", { name: "Mira" }), swipeIdx: 0 }, linesToOps(["clock: Day 3 09:00", "scene: The pier"]).ops, "model");
    const first = await beat("She says she'll be gone before the morning.");
    expect(first.situations).toEqual(["leaving"]);
    const n = readings();
    // The words change, but the brief holds: no new call.
    expect((await beat("They walk to the end of the pier and fight about it.")).situations).toEqual(["leaving"]);
    expect((await beat("The gulls are loud.")).situations).toEqual(["leaving"]);
    expect(readings()).toBe(n);
    // Three replies since it was read: read again.
    expect((await beat("They make up and go for a fight-free dinner. A fight averted.")).situations).toEqual(["the fight"]);
    expect(readings()).toBe(n + 1);
    // The records say someone died: something new is happening, so it's read again at once.
    const dead = await beat("Spike falls from the pier.", ["dead Spike — fell"]);
    expect(dead.situations[0]).toBe("grief");
    expect(readings()).toBe(n + 2);
  });
});

describe("a child in the scene (3.1)", () => {
  const t = (id: string, moods: Mood[]): Track => ({ videoId: id, title: id, artist: "X", moods, instrumental: false });
  test("a sexual song drops far down the list, not out; the switch turns the lean off", () => {
    const library = [t("sexy0000001", ["tender"]), t("plain000001", ["tender"])];
    saveReadCard(songKey(library[0]!), { about: "", bond: "romantic", stance: "wanting", heat: "sexual", dark: [], main: [], passing: [], opening: [], energy: 3, pace: "mid", moods: [] });
    const cue = { moods: ["tender" as Mood], intensity: 1, hour: 15, weather: "", place: "", genre: null, present: ["Mira", "Gabriel"], key: "9|tender|day" };
    const moment = { situations: [], gist: "", key: "m|9", from: "reply" as const, at: 0, child: true };
    const cfg = { ...musicConfig(), library, leitmotifs: [] };
    const scores = (on: boolean) => Object.fromEntries(rankTracks({ ...cfg, childLean: on }, cue, { moment }, {})!.scored.map((s) => [s.track.videoId, s.score]));
    const on = scores(true);
    expect(on.sexy0000001).toBeLessThan(on.plain000001! - 4);
    expect(rankTracks({ ...cfg, childLean: true }, cue, { moment }, {})!.roll.map((s) => s.track.videoId)).toEqual(["plain000001"]);
    const off = scores(false);
    expect(off.sexy0000001).toBe(off.plain000001);
    // No child, no lean.
    const noChild = rankTracks({ ...cfg, childLean: true }, cue, { moment: { ...moment, child: false } }, {})!.scored.map((s) => s.score);
    expect(noChild).toEqual([on.plain000001!, on.plain000001!]);
    run("DELETE FROM song_cards");
  });
});
