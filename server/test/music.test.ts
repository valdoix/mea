import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { setSetting } from "../src/lib/settings";
import { addTrack, chatMusicView, connectFinish, connectStart, type Cue, cueFrom, type Mood, musicAction, musicAfterReply, musicTick, musicConfig, musicView, pickTrack, saveMusicConfig } from "../src/music/director";
import { videoIdOf } from "../src/music/ytmusic";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
const realFetch = globalThis.fetch;
const sent: { path: string; body: unknown; auth: string | null }[] = [];
let playing: { id: string; title: string; author: string; durationSeconds?: number } = { id: "aaaaaaaaaaa", title: "Now Playing Song", author: "Someone" };
let player = { trackState: 1, videoProgress: 0 };

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update"]) registerJob(kind, async () => {});
  // A stand-in for the YouTube Music Desktop App's Companion Server on this PC.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "127.0.0.1" || url.port !== "9863") throw new Error(`unexpected network call: ${url}`);
    const path = url.pathname.replace("/api/v1", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    sent.push({ path, body, auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (path === "/auth/requestcode") return json({ code: "4821" });
    if (path === "/auth/request") return body.code === "4821" ? json({ token: "tok-123" }) : new Response("", { status: 403 });
    if (path === "/state") return json({ player, video: playing });
    if (path === "/command") return new Response("", { status: 204 });
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "The lamp hums." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 1 22:00", "at: Port Ellis › Lighthouse", "cast: Mira@spot · Spike@spot", "mood Mira: wistful", "scene: The lamp room"]).ops, "model");
});
afterAll(() => {
  globalThis.fetch = realFetch;
  pauseJobs(false);
  setSetting("music.config", null);
});

const flush = () => new Promise((r) => setTimeout(r, 30));

describe("the soundtrack, on YouTube Music (J3)", () => {
  test("off by default; links and ids are read", () => {
    expect(musicView()).toMatchObject({ enabled: false, connected: false, port: 9863 });
    expect(videoIdOf("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x")).toBe("dQw4w9WgXcQ");
    expect(videoIdOf("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(videoIdOf("not a link")).toBeNull();
  });

  test("connecting: the app shows a code, you approve it, Mea keeps the token (never shown to the browser)", async () => {
    expect(await connectStart()).toEqual({ code: "4821" });
    const v = await connectFinish("4821");
    expect(v).toMatchObject({ enabled: true, connected: true });
    expect(JSON.stringify(v)).not.toContain("tok-123");
    expect(musicConfig().token).toBe("tok-123");
  });

  test("a cue from the story: mood, hour, who's here", () => {
    const cue = cueFrom(currentFold(chatId).result.state, "romance");
    expect(cue.moods).toContain("melancholy");
    expect(cue.moods).toContain("tender");
    expect(cue.present).toEqual(["Mira", "Spike"]);
    expect(cue.key).toMatch(/\|night$/);
  });

  test("the library: a pasted link, or what's playing now", async () => {
    await addTrack({ link: "https://music.youtube.com/watch?v=sadsadsad11", title: "Rain Song", artist: "A", moods: ["melancholy", "night"] });
    await addTrack({ link: "bbbbbbbbbbb", title: "Fight Song", artist: "B", moods: ["tense"] });
    await addTrack({ moods: ["tender"] });
    expect(musicView().library.map((t) => t.title)).toEqual(["Rain Song", "Fight Song", "Now Playing Song"]);
    saveMusicConfig({ leitmotifs: [{ who: "Mira & Spike", videoId: "aaaaaaaaaaa" }] });
  });

  test("the picker: a leitmotif for the people here wins; banned artists and 'not for this scene' never play", () => {
    const cfg = musicConfig();
    const cue = cueFrom(currentFold(chatId).result.state, null);
    expect(pickTrack(cfg, cue, {})).toMatchObject({ track: { title: "Now Playing Song" }, why: "Mira & Spike's theme" });
    expect(pickTrack(cfg, cue, { notFor: { [cue.key]: ["aaaaaaaaaaa"] } })?.track.title).toBe("Rain Song");
    expect(pickTrack({ ...cfg, taste: { ...cfg.taste, banned: ["Someone"] } }, cue, {})?.track.title).toBe("Rain Song");
  });

  test("the director changes the music on beats only", async () => {
    const id = addMessage(chatId, "assistant", "She trims the wick.", { name: "Mira" });
    musicAfterReply(chatId, id);
    await flush();
    expect(sent.filter((s) => s.path === "/command")).toEqual([]);
    await musicAction(chatId, "on");
    musicAfterReply(chatId, id);
    await flush();
    const cmds = sent.filter((s) => s.path === "/command");
    expect(cmds.at(-1)).toMatchObject({ body: { command: "changeVideo", data: { videoId: "aaaaaaaaaaa" } }, auth: "tok-123" });
    // The same beat: it holds.
    const again = addMessage(chatId, "assistant", "The lamp hums on.", { name: "Mira" });
    musicAfterReply(chatId, again);
    await flush();
    expect(sent.filter((s) => s.path === "/command").length).toBe(cmds.length);
    // A new scene: it changes.
    const next = addMessage(chatId, "assistant", "Morning on the harbour.", { name: "Mira" });
    writeEvents(chatId, { messageId: next, swipeIdx: 0 }, linesToOps(["scene: The harbour", "clock: Day 2 09:00", "cast: Spike@off", "mood Mira: furious"]).ops, "model");
    musicAfterReply(chatId, next);
    await flush();
    expect(sent.filter((s) => s.path === "/command").length).toBe(cmds.length + 1);
    expect(chatMusicView(chatId).now?.title).toBe("Fight Song");
    // The mood shifting within the scene: the song plays on (the next one follows the new mood).
    const calmer = addMessage(chatId, "assistant", "She laughs it off.", { name: "Mira" });
    writeEvents(chatId, { messageId: calmer, swipeIdx: 0 }, linesToOps(["mood Mira: happy"]).ops, "model");
    musicAfterReply(chatId, calmer);
    await flush();
    expect(sent.filter((s) => s.path === "/command").length).toBe(cmds.length + 1);
    expect(chatMusicView(chatId).now?.title).toBe("Fight Song");
  });

  test("the picker varies: the songs that fit take turns, none back while it's recent", () => {
    const library = Array.from({ length: 12 }, (_, i) => ({ videoId: `v${String(i).padStart(10, "0")}`, title: `T${i}`, artist: "X", moods: [i < 8 ? "tense" : "calm"] as Mood[], instrumental: false }));
    const cfg = { ...musicConfig(), leitmotifs: [], library };
    const cue: Cue = { moods: ["tense"], intensity: 0, hour: null, weather: "", place: "", genre: null, present: [], key: "k" };
    const played: string[] = [];
    for (let i = 0; i < 40; i++) played.unshift(pickTrack(cfg, cue, { recent: played.slice(0, 60) })!.track.videoId);
    // Every tense song, and no calm one.
    expect(new Set(played)).toEqual(new Set(library.slice(0, 8).map((t) => t.videoId)));
    // Of 8, the last 5 sit out: a song is at least 6 picks apart from itself.
    played.forEach((v, i) => expect(played.slice(i + 1, i + 6)).not.toContain(v));
  });

  test("your hand: thumbs, skip, not for this scene, play/pause", async () => {
    let v = await musicAction(chatId, "up");
    expect(v.vote).toBe(1);
    v = await musicAction(chatId, "notForScene");
    expect(v.now?.title).not.toBe("Fight Song");
    await musicAction(chatId, "playPause");
    expect(sent.at(-1)?.body).toEqual({ command: "playPause" });
  });

  test("one song after another: when Mea's song ends, the next one that fits plays", async () => {
    const now = chatMusicView(chatId).now!;
    // Still playing, well before the end: nothing happens.
    playing = { id: now.videoId, title: now.title, author: now.artist, durationSeconds: 200 };
    player = { trackState: 1, videoProgress: 100 };
    sent.length = 0;
    await musicTick();
    expect(sent.filter((x) => x.path === "/command")).toEqual([]);
    // Ended and stopped (the Companion Server has no queue to line it up in): the next song plays.
    player = { trackState: 0, videoProgress: 200 };
    await musicTick();
    const cmds = sent.filter((x) => x.path === "/command");
    expect(cmds.length).toBe(1);
    expect(cmds[0]?.body).toMatchObject({ command: "changeVideo" });
    const next = chatMusicView(chatId).now!;
    expect(next.videoId).not.toBe(now.videoId);
    expect((cmds[0]?.body as { data: { videoId: string } }).data.videoId).toBe(next.videoId);
    // Something you put on yourself is left alone.
    playing = { id: "zzzzzzzzzzz", title: "Mine", author: "Me", durationSeconds: 100 };
    player = { trackState: 0, videoProgress: 100 };
    sent.length = 0;
    await musicTick();
    expect(sent.filter((x) => x.path === "/command")).toEqual([]);
    await musicAction(chatId, "off");
  });
});
