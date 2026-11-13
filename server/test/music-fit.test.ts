import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { one, run } from "../src/db/db";
import { saveReadCard, type SongCard } from "../src/music/cards";
import { type ChatMusic, chooseTrack, type Cue, type Mood, musicConfig, rankTracks, stillFits, type Track } from "../src/music/director";
import { type Brief, cardFit, cleanVerdict, gateOf, NOTHING_FITS } from "../src/music/fit";
import type { Moment } from "../src/music/words";
import { songKey } from "../src/music/versions";
import { createCharacter } from "../src/services/characters";
import { createChat, getChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { pauseJobs } from "../src/services/jobs";
import { freshDb } from "./helpers";

/** A card with sensible blanks: a calm, happy song about nothing in particular. */
const card = (c: Partial<SongCard>): SongCard => ({ about: "", bond: "anyone", stance: "happy in it", heat: "none", dark: [], main: [], passing: [], opening: [], energy: 2, pace: "mid", moods: [], ...c });
const brief = (b: Partial<Brief>): Brief => ({ situations: [], gist: "", ...b });

describe("the gates (docs/34, 4.1)", () => {
  // The six wrong picks from 0.2, as their cards and their scenes' briefs. Each is out.
  const cases: [string, SongCard, Brief][] = [
    ["a song about sex at a family darts game", card({ bond: "romantic", stance: "wanting", heat: "sexual", main: ["desire", "celebration"], energy: 4 }), brief({ bond: "family", stance: "happy in it", heat: "none", energy: 3, situations: ["celebration"] })],
    ["a love song as a sister picks up her kid", card({ bond: "romantic", main: ["devotion"] }), brief({ bond: "family", stance: "happy in it", heat: "none", energy: 2, child: true, situations: ["homecoming", "devotion"] })],
    ["a song about desire after dinner chores", card({ bond: "romantic", stance: "wanting", heat: "sexual", main: ["desire"], energy: 4 }), brief({ bond: "friends", stance: "happy in it", heat: "none", energy: 2, situations: ["celebration"] })],
    ["taking a friend's boyfriend under a proposal", card({ bond: "romantic", stance: "wanting", heat: "flirting", main: ["temptation", "betrayal"], energy: 3 }), brief({ bond: "romantic", stance: "happy in it", heat: "flirting", energy: 2, situations: ["devotion", "confession"] })],
    ["grief and heartbreak on a warm car ride", card({ bond: "self", stance: "losing", main: ["grief", "heartbreak"], energy: 3 }), brief({ bond: "friends", stance: "happy in it", heat: "none", energy: 3, situations: [] })],
    ["dread in a tender daytime scene", card({ bond: "romantic", stance: "afraid", main: ["fear"], energy: 3 }), brief({ bond: "romantic", stance: "happy in it", heat: "none", energy: 2, situations: ["devotion"] })],
  ];
  for (const [name, c, b] of cases) test(`out: ${name}`, () => expect(gateOf(c, b)).not.toBeNull());

  test("each gate, and what it lets through", () => {
    const happy = brief({ bond: "family", stance: "happy in it", heat: "none", energy: 2 });
    expect(gateOf(card({ heat: "flirting" }), happy)).toBe("too flirty for the scene");
    expect(gateOf(card({ bond: "family" }), brief({ bond: "romantic" }))).toBe("a family song in a romantic scene");
    expect(gateOf(card({ stance: "mourning" }), brief({ stance: "mourning", situations: ["grief"] }))).toBeNull();
    expect(gateOf(card({ stance: "happy in it" }), brief({ situations: ["grief"] }))).toBe("happy over grief");
    expect(gateOf(card({ dark: ["drugs"] }), happy)).toBe("drugs in a light scene");
    expect(gateOf(card({ energy: 5 }), happy)).toBe("too loud for the scene");
    expect(gateOf(card({ energy: 4 }), happy)).toBeNull();
    expect(gateOf(card({ main: ["heartbreak"], stance: "free" }), brief({ avoid: ["breakup songs"] }))).toBe("the scene says no breakup songs");
    expect(gateOf(card({ main: ["the road"] }), brief({ avoid: ["the road"] }))).toBe("the scene says no the road");
    // A heartbreak song is right when the scene is heartbreak.
    expect(gateOf(card({ main: ["heartbreak"], stance: "free" }), brief({ stance: "happy in it", situations: ["heartbreak"] }))).toBeNull();
    // With a child here the heat isn't a gate (the child lean sinks it instead), and what isn't known isn't gated.
    expect(gateOf(card({ heat: "sexual" }), brief({ heat: "none", child: true }))).toBeNull();
    expect(gateOf(card({ heat: "sexual", bond: "romantic", energy: 5 }), brief({}))).toBeNull();
    expect(gateOf(null, happy)).toBeNull();
  });
});

describe("the fit (4.2)", () => {
  test("what a song is mainly about counts most; a main subject the scene isn't costs; the opening counts from the top", () => {
    const scene = brief({ situations: ["devotion"], bond: "romantic", stance: "happy in it", energy: 2 });
    const love = cardFit(card({ bond: "romantic", main: ["devotion"] }), scene);
    const mixed = cardFit(card({ bond: "romantic", main: ["devotion", "betrayal"] }), scene);
    expect(love.shared).toEqual(["devotion"]);
    expect(mixed.score).toBeLessThan(love.score);
    const opens = card({ bond: "romantic", main: ["devotion"], opening: ["devotion"] });
    expect(cardFit(opens, scene, { fromTop: true }).score).toBe(cardFit(opens, scene).score + 0.5);
    // Bond, stance and energy agreeing.
    expect(cardFit(card({ bond: "family", stance: "free", energy: 4 }), scene).score).toBeLessThan(cardFit(card({ bond: "romantic", energy: 2 }), scene).score);
  });
});

// ---------- the picker with gates, and the judge ----------

let chatId = "";
const judged = () => one<{ n: number }>("SELECT COUNT(*) AS n FROM generations WHERE request LIKE '%You judge songs for a story%'")!.n;
const t = (id: string, moods: Mood[], title = id): Track => ({ videoId: id, title, artist: "X", moods, instrumental: false });
const cue: Cue = { moods: ["tender"], intensity: 0, hour: 15, weather: "", place: "", genre: null, present: ["Mira", "Gabriel"], key: "9|tender|day" };
/** The scene brief as momentAt leaves it: read by the helper (readSeq), for scene 9. */
const moment = (b: Partial<Moment>): Moment => ({ situations: [], gist: "Picking up the kid", key: "m1|9|tender|day", from: "reply", at: 0, readSeq: 1, scene: 9, ...b });
const family = moment({ bond: "family", stance: "happy in it", heat: "none", energy: 2, situations: ["homecoming"] });

const library = [t("lovesong001", ["tender"], "Love Song"), t("sexsong0001", ["tender"], "Night Club"), t("homesong001", ["tender"], "Home Again"), t("easysong001", ["tender"], "Easy Day"), t("brightsong1", ["bright"], "Bright One")];
const cards: Record<string, SongCard> = {
  lovesong001: card({ bond: "romantic", main: ["devotion"] }),
  sexsong0001: card({ bond: "romantic", stance: "wanting", heat: "sexual", main: ["desire"], energy: 4 }),
  homesong001: card({ bond: "family", main: ["homecoming"], about: "coming home to the people you love" }),
  easysong001: card({ bond: "anyone", main: ["peace"], about: "an easy afternoon" }),
  brightsong1: card({ bond: "family", main: ["homecoming"] }),
};
const cfg = () => ({ ...musicConfig(), library, leitmotifs: [] as { who: string; videoId: string }[] });
const ids = (xs: { track: { videoId: string } }[]) => xs.map((x) => x.track.videoId);

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "The car idles." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  for (const tr of library) saveReadCard(songKey(tr), cards[tr.videoId]!);
});
afterAll(() => {
  pauseJobs(false);
  run("DELETE FROM song_cards");
});

describe("picking past the gates (4.1, 4.2, 4.4)", () => {
  test("songs that grate are out; a song without the lead mood never stands in for one with it", () => {
    const r = rankTracks(cfg(), cue, { moment: family }, {})!;
    expect(r.scored.find((s) => s.track.videoId === "sexsong0001")?.gate).toBe("too sexual for the scene");
    expect(r.scored.find((s) => s.track.videoId === "lovesong001")?.gate).toBe("a love song in a family scene");
    // The bright song is about homecoming too, but the scene's lead mood is tender.
    expect(ids(r.roll)).toEqual(["homesong001"]);
    expect(r.roll[0]!.why).toBe("fits: tender, homecoming");
  });

  test("a leitmotif passes every gate", () => {
    const r = rankTracks({ ...cfg(), leitmotifs: [{ who: "Mira", videoId: "lovesong001" }] }, cue, { moment: family }, {})!;
    expect(r.theme?.track.videoId).toBe("lovesong001");
  });

  test("when nothing passes, a song safe under anything plays, and the chip doesn't claim a fit", () => {
    // Everything is ruled out: the love song by the bond, the club song by its heat, the easy one by what the scene says would grate.
    const few = library.filter((x) => ["lovesong001", "sexsong0001", "easysong001"].includes(x.videoId));
    const r = rankTracks({ ...cfg(), library: few }, cue, { moment: { ...family, avoid: ["peace"] } }, {})!;
    expect(r.nothing).toBe(true);
    expect(ids(r.roll)).toEqual(["easysong001"]);
    expect(r.roll[0]!.why).toBe(NOTHING_FITS);
  });

  test("a big moment cuts a song that now grates (4.6)", () => {
    expect(stillFits(cfg(), cue, "lovesong001", null, null, family)).toBe(false);
    expect(stillFits(cfg(), cue, "homesong001", null, null, family)).toBe(true);
  });
});

describe("the judge (4.3-4.5)", () => {
  test("a verdict is made safe: songs it was shown, each once; none is an answer", () => {
    const songs = [{ videoId: "a", title: "A", artist: "", card: null }, { videoId: "b", title: "B", artist: "", card: null }];
    expect(cleanVerdict({ none: false, ranking: [2, 2, 9, 1], reason: "  Warm   and easy. " }, songs)).toEqual({ order: ["b", "a"], reason: "Warm and easy.", none: false });
    expect(cleanVerdict({ none: false, ranking: [], reason: "" }, songs).none).toBe(true);
  });

  test("no helper: the fit score picks, and a song still plays", async () => {
    const pick = await chooseTrack(cfg(), cue, { moment: family }, { chatId, rand: () => 0 });
    expect(pick?.track.videoId).toBe("homesong001");
    expect(pick?.parts?.judge).toBeUndefined();
  });

  test("the helper ranks the best few; the first plays with its line of reason, kept with the reply", async () => {
    const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
    await syncModels(conn);
    createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
    const n = judged();
    const music: ChatMusic = { moment: family };
    const pick = await chooseTrack(cfg(), cue, music, { chatId, judgeKey: "m1|9|tender|day", rand: () => 0 });
    expect(pick).toMatchObject({ why: "Home Again suits the scene.", parts: { judge: 1 } });
    expect(judged()).toBe(n + 1);
    // Never the words: the judge sees the card.
    const req = one<{ request: string }>("SELECT request FROM generations WHERE request LIKE '%You judge songs for a story%' ORDER BY rowid DESC LIMIT 1")!.request;
    expect(req).toContain("coming home to the people you love");
    expect(req).not.toContain("Night Club");
    // The same reply again (a swipe): the verdict is kept, no new call.
    const kept = (getChat(chatId)!.settings as { music: ChatMusic }).music;
    expect(kept.judged?.key).toBe("m1|9|tender|day");
    expect((await chooseTrack(cfg(), cue, { ...music, judged: kept.judged }, { chatId, judgeKey: "m1|9|tender|day", rand: () => 0 }))?.track.videoId).toBe("homesong001");
    expect(judged()).toBe(n + 1);
  });

  test("none fit: a song for the mood from the safe ones, and the chip says so", async () => {
    const pick = await chooseTrack(cfg(), cue, { moment: { ...family, gist: "MOCK_NOTHING_FITS" } }, { chatId, rand: () => 0 });
    expect(pick).toMatchObject({ track: { videoId: "easysong001" }, why: NOTHING_FITS, parts: { judge: 0 } });
  });

  test("a brief from the records alone (no helper reading) isn't judged", async () => {
    const n = judged();
    await chooseTrack(cfg(), cue, { moment: { ...family, readSeq: undefined } }, { chatId, rand: () => 0 });
    expect(judged()).toBe(n);
  });
});

describe("the bench reads the brief (so the gates count on the marked set)", () => {
  test("a reading's bond, stance, heat, energy and avoid reach the picker's moment", async () => {
    const { sceneFromReading, sceneInputs } = await import("../src/music/bench");
    const request = JSON.stringify({ messages: [{ role: "system", content: "You choose music for a story. …" }, { role: "user", content: "Place: ?\nHere: Mira\nMood: tender\n\n--- The last reply (its end):\nThe kid runs over." }] });
    const response = JSON.stringify({ gist: "A pickup", bond: "family", stance: "happy in it", heat: "sexual", energy: 2, situations: [{ s: "homecoming", strength: "strong" }], avoid: ["love songs"], child: true });
    const s = sceneFromReading({ id: "r1", chat_id: null, started_at: 1, request, response })!;
    expect(s.brief).toMatchObject({ bond: "family", stance: "happy in it", heat: "none", energy: 2, avoid: ["love songs"], child: true });
    expect(sceneInputs(s).music.moment).toMatchObject({ bond: "family", situations: ["homecoming"] });
  });
});
