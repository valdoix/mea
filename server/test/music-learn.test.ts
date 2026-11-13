import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { setSetting } from "../src/lib/settings";
import { saveReadCard, type SongCard } from "../src/music/cards";
import { answerSuggestion, type ChatMusic, chatMusicView, type Cue, musicAction, musicConfig, rankTracks, type Track } from "../src/music/director";
import { kindLine, sceneKind, suggestionFor } from "../src/music/learn";
import { playHistory } from "../src/music/plays";
import { songKey } from "../src/music/versions";
import type { Moment } from "../src/music/words";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, getChat, updateChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

const card = (c: Partial<SongCard>): SongCard => ({ about: "", bond: "anyone", stance: "happy in it", heat: "none", dark: [], main: [], passing: [], opening: [], energy: 2, pace: "mid", moods: [], ...c });

describe("what you teach, in short (docs/34, Part 5)", () => {
  test("a kind of scene is who it's about, where it stands and how loud", () => {
    expect(sceneKind({ bond: "family", stance: "happy in it", energy: 2 })).toBe("family|happy in it|quiet");
    expect(sceneKind({ bond: "romantic", stance: null, energy: 5 })).toBe("romantic|?|loud");
    expect(sceneKind({ bond: null, stance: null, energy: 3 })).toBeNull();
    expect(kindLine("romantic|?|loud")).toBe("romantic · loud");
  });
});

let chatId = "";
const realFetch = globalThis.fetch;
/** What the YouTube Music app says is playing, and how far in. */
let state = { id: "", progress: 0 };
const commands: unknown[] = [];

const library: Track[] = ["songaaaaaaa", "songbbbbbbb", "songccccccc", "songddddddd"].map((id, i) => ({ videoId: id, title: `Song ${"ABCD"[i]}`, artist: "X", moods: ["calm", "tender", "melancholy", "bright", "night", "tense", "dread", "epic", "mystery"], instrumental: false }));
const A = library[0]!;
let cue: Cue;
/** The scene brief, read by the helper, for this scene. */
const brief = (b: Partial<Moment>): Moment => ({ situations: [], gist: "", key: `m|${cue.key}`, from: "reply", at: 0, readSeq: 1, ...b });
const family = () => brief({ bond: "family", stance: "happy in it", heat: "none", energy: 2 });
const lovers = () => brief({ bond: "romantic", stance: "wanting", heat: "flirting", energy: 4 });
const music = () => (getChat(chatId)!.settings as { music: ChatMusic }).music;
const setMusic = (patch: Partial<ChatMusic>) => updateChat(chatId, { settings: { music: { ...music(), ...patch } } as never });
/** A playing, `seconds` in, in this scene. */
const playing = (seconds: number, moment: Moment) => {
  setMusic({ now: { videoId: A.videoId, title: A.title, artist: A.artist, key: cue.key, why: "", at: 0 }, moment });
  state = { id: A.videoId, progress: seconds };
};
const scoredIds = (m: Partial<ChatMusic>, c: Cue = cue) => rankTracks(musicConfig(), c, m as ChatMusic, {})!.scored.map((s) => s.track.videoId);
const votesOf = (m: Partial<ChatMusic>) => rankTracks(musicConfig(), cue, m as ChatMusic, {})!.scored.find((s) => s.track.videoId === A.videoId)!.parts.votes;

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update"]) registerJob(kind, async () => {});
  // A stand-in for the YouTube Music app: says what's playing and takes commands.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "127.0.0.1") throw new Error(`unexpected network call: ${url}`);
    const path = url.pathname.replace("/api/v1", "");
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (path === "/state") return json({ player: { trackState: 1, videoProgress: state.progress }, video: { id: state.id, title: "", author: "", durationSeconds: 200 } });
    if (path === "/command") {
      const b = JSON.parse(String(init?.body));
      commands.push(b);
      if (b.command === "changeVideo") state = { id: b.data.videoId, progress: 0 };
      return new Response("", { status: 204 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "The car idles." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "The car idles.", { name: "Mira" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 1 15:00", "at: Port Ellis › The school gates", "cast: Mira@spot", "scene: Pickup"]).ops, "model");
  setSetting("music.config", { enabled: true, token: "tok", library } as never);
  setMusic({ on: true });
  cue = chatMusicView(chatId).cue!;
});
beforeEach(() => {
  setSetting("music.learned", null);
  setMusic({ kindNo: {}, kindYes: {}, downs: {}, notFor: {}, votes: {}, recent: [] });
});
afterAll(async () => {
  await musicAction(chatId, "off");
  globalThis.fetch = realFetch;
  pauseJobs(false);
  setSetting("music.config", null);
  setSetting("music.learned", null);
});

describe("skips count (5.1)", () => {
  test("three early skips in family scenes and the song sits them out; it still plays in others", async () => {
    for (let i = 0; i < 3; i++) {
      playing(10, family());
      await musicAction(chatId, "skip");
    }
    expect(music().kindNo).toEqual({ "family|happy in it|quiet": { [songKey(A)]: 3 } });
    expect(scoredIds({ moment: family() })).not.toContain(A.videoId);
    expect(scoredIds({ moment: lovers() })).toContain(A.videoId);
  });

  test("one early skip is a soft no here, weaker in another story; a late skip teaches nothing", async () => {
    playing(10, family());
    await musicAction(chatId, "skip");
    expect(votesOf({ moment: family(), kindNo: music().kindNo })).toBe(-1);
    // Another story (no count of its own): the skip still counts, weakly.
    expect(votesOf({ moment: family() })).toBe(-0.3);
    expect(votesOf({ moment: lovers() })).toBe(0);
    setSetting("music.learned", null);
    setMusic({ kindNo: {} });
    playing(90, family());
    await musicAction(chatId, "skip");
    expect(music().kindNo).toEqual({});
  });
});

describe("thumbs on the new scale (5.3)", () => {
  test("👍 raises the song for this kind of scene, not everywhere", async () => {
    playing(60, family());
    const v = await musicAction(chatId, "up");
    expect(v).toMatchObject({ vote: 1, kind: "family · happy in it · quiet" });
    expect(votesOf({ moment: family(), kindYes: music().kindYes })).toBe(1.5);
    expect(votesOf({ moment: lovers(), kindYes: music().kindYes })).toBe(0);
  });

  test("👎 once costs a little; twice and it never plays in this story again", async () => {
    playing(60, family());
    await musicAction(chatId, "down");
    expect(votesOf({ moment: lovers(), downs: music().downs })).toBe(-1);
    playing(60, family());
    await musicAction(chatId, "down");
    expect(scoredIds({ moment: lovers(), downs: music().downs })).not.toContain(A.videoId);
    // From before Part 5, two 👎 were a vote of -2: the same.
    expect(scoredIds({ moment: lovers(), votes: { [A.videoId]: -2 } })).not.toContain(A.videoId);
  });
});

describe("Not for this scene asks why (5.2)", () => {
  test("it holds for the whole scene, whatever the mood does, and the log keeps the answer", async () => {
    playing(60, family());
    await musicAction(chatId, "notForScene", "sound");
    const darker = { ...cue, moods: ["dread" as const], key: `${cue.key.split("|")[0]}|dread|night` };
    expect(scoredIds({ notFor: music().notFor }, darker)).not.toContain(A.videoId);
    const nextScene = { ...cue, key: `99|${cue.key.split("|").slice(1).join("|")}` };
    expect(scoredIds({ notFor: music().notFor }, nextScene)).toContain(A.videoId);
    // (The test puts the song on by hand, so the answer lands on the play last logged, which ended "not for the scene".)
    expect(playHistory(chatId, 50).find((p) => p.marks.includes("wrongSound"))?.ending).toBe("notFor");
  });

  test("two of the same answer suggest a change to the card; you take it or keep the card as it is", async () => {
    saveReadCard(songKey(A), card({ energy: 3 }));
    // Wrong sound twice in quiet scenes, and the card guessed above them: louder than it thinks.
    playing(60, family());
    await musicAction(chatId, "notForScene", "sound");
    playing(60, family());
    await musicAction(chatId, "notForScene", "sound");
    const r = answerSuggestion(A.videoId, true);
    expect(r.card).toMatchObject({ energy: 4, suggest: null });
    expect(r.card?.edited).toContain("energy");
    // Too much twice: hotter than it thinks. Turned down, it's spent.
    playing(60, family());
    await musicAction(chatId, "notForScene", "much");
    playing(60, family());
    await musicAction(chatId, "notForScene", "much");
    expect((r.view as { cards: Record<string, { suggest?: string }> }).cards[A.videoId]?.suggest).toBeUndefined();
    const kept = answerSuggestion(A.videoId, false);
    expect(kept.card).toMatchObject({ heat: "none", suggest: null });
    expect(() => answerSuggestion(A.videoId, false)).toThrow(/no suggested change/);
  });

  test("the suggestions, worked out", () => {
    setSetting("music.learned", { skips: {}, why: { k: { sound: 2, much: 0, words: 0, now: 0, energies: [4, 5] } } });
    // Played in loud scenes and it sounded wrong: quieter than the card's guess.
    expect(suggestionFor("k", card({ energy: 3 }))).toMatchObject({ field: "energy", value: 2 });
    // A sound you confirmed isn't second-guessed.
    expect(suggestionFor("k", card({ energy: 3 }), ["energy"])).toBeNull();
    setSetting("music.learned", { skips: {}, why: { k: { sound: 0, much: 2, words: 0, now: 0, energies: [] } } });
    expect(suggestionFor("k", card({ heat: "flirting" }))).toMatchObject({ field: "heat", value: "sexual" });
    expect(suggestionFor("k", card({ heat: "sexual", energy: 2 }))).toMatchObject({ field: "energy", value: 3 });
  });
});

describe("the chip shows what came close (5.4)", () => {
  test("the song playing carries its reason and the runners-up", async () => {
    playing(60, lovers());
    const v = await musicAction(chatId, "skip");
    expect(v.now?.why).toBeTruthy();
    expect(v.now?.runners?.length).toBeGreaterThan(0);
    expect(v.now?.runners?.map((r) => r.title)).not.toContain(v.now?.title);
  });
});
