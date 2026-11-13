import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { run } from "../src/db/db";
import { setSetting } from "../src/lib/settings";
import { cardOf, saveReadCard, type SongCard } from "../src/music/cards";
import { musicConfig, type Track } from "../src/music/director";
import { addSuggestion, askSuggestions, backgroundSongs, declineSuggestion, gapList, INSTRUMENTALS, suggestionsView, suggestStep } from "../src/music/gaps";
import { lyricsFor, pasteLyrics } from "../src/music/lyrics";
import { openPlay, closePlay } from "../src/music/plays";
import { songKey } from "../src/music/versions";
import type { LyricSheet } from "../src/music/words";
import { saveSheet, linesHash, sheetFor } from "../src/music/words";
import type { YtmSong } from "../src/music/ytmusic";
import { pauseJobs } from "../src/services/jobs";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { createChat } from "../src/services/chats";
import { freshDb } from "./helpers";

const card = (c: Partial<SongCard>): SongCard => ({ about: "", bond: "anyone", stance: "happy in it", heat: "none", dark: [], main: [], passing: [], opening: [], energy: 2, pace: "mid", moods: [], ...c });
const t = (id: string, title: string, artist: string, extra: Partial<Track> = {}): Track => ({ videoId: id, title, artist, moods: ["calm"], instrumental: false, ...extra });

/** One logged scene reading, as the helper call is kept. */
let n = 0;
function reading(answer: Record<string, unknown>) {
  const request = JSON.stringify({ messages: [{ role: "system", content: "You choose music for a story. …" }, { role: "user", content: "Place: ?\nHere: Mira\nMood: tender\n\n--- The last reply (its end):\n…" }] });
  run("INSERT INTO generations (id, kind, request, response, status, started_at) VALUES (?, 'helper', ?, ?, 'ok', ?)", `g${++n}`, request, JSON.stringify({ gist: `scene ${n}`, ...answer }), n);
}
const family = { bond: "family", stance: "happy in it", heat: "none", energy: 2, situations: [{ s: "homecoming", strength: "strong" }] };

const library = [
  t("homesong001", "Home Again", "Harbour Lights"),
  t("lovesong001", "Love Song", "Harbour Lights"),
  t("sexsong0001", "Night Club", "Velvet"),
  t("devotion001", "Always", "Velvet"),
  t("pianopiece1", "Rain Study", "Keys", { instrumental: true }),
];

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  setSetting("music.config", { enabled: true, library } as never);
  saveReadCard(songKey(library[0]!), card({ bond: "family", main: ["homecoming"], about: "coming home" }));
  saveReadCard(songKey(library[1]!), card({ bond: "romantic", main: ["devotion"] }));
  saveReadCard(songKey(library[2]!), card({ bond: "romantic", stance: "wanting", heat: "sexual", main: ["desire"], energy: 4 }));
  // A song read before cards existed: its sheet says what it's about.
  const sheet: LyricSheet = { situations: ["devotion"], themes: [], voice: "to-you", passages: [] };
  pasteLyrics("devotion001", "always");
  saveSheet("devotion001", sheet, linesHash(lyricsFor("devotion001")!.lines));
  // Five family scenes, three from before briefs said who (devotion), one romantic (once is no pattern).
  for (let i = 0; i < 5; i++) reading(family);
  for (let i = 0; i < 3; i++) reading({ situations: ["devotion", "hope"] });
  reading({ bond: "romantic", stance: "wanting", heat: "flirting", energy: 4, situations: [] });
  // A family scene's song was skipped.
  const moment = { situations: ["homecoming" as const], gist: "", key: "k", from: "reply" as const, at: 0, bond: "family" as const, stance: "happy in it" as const, energy: 2 };
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "Hi." } });
  const chatId = createChat({ characterId: createCharacter(data) }).id;
  openPlay({ chatId, videoId: "lovesong001", title: "Love Song", artist: "Harbour Lights", how: "start", why: "fits", moment });
  closePlay(chatId, "skipped", 5);
});
afterAll(() => {
  pauseJobs(false);
  setSetting("music.config", null);
  setSetting("music.suggestions", null);
});

describe("the gap list (docs/34, 6.1)", () => {
  test("kinds of scene asked for, worst first, with the songs that suit them; older scenes by what was happening", () => {
    const gaps = gapList();
    expect(gaps.map((g) => g.line)).toEqual(["family · happy in it · quiet", "about devotion"]);
    expect(gaps[0]).toMatchObject({ scenes: 5, misses: 1, fit: 1, examples: ["Home Again"] });
    // The sheet-only song counts for devotion; the love song's card does too.
    expect(gaps[1]).toMatchObject({ scenes: 3, misses: 0, fit: 2 });
  });

  test("songs safe under anything, and the instrumentals (6.3)", () => {
    expect(backgroundSongs()).toEqual({ safe: [], instrumentals: 1 });
    saveReadCard(songKey(library[4]!), card({ about: "rain on a window" }));
    expect(backgroundSongs().safe.map((s) => s.title)).toEqual(["Rain Study"]);
  });
});

describe("suggestions, only on your yes (6.2)", () => {
  const found: YtmSong[] = [
    { videoId: "newhome0001", title: "Kitchen Light", artist: "Harbour Lights" },
    { videoId: "newlove0001", title: "Your Mouth", artist: "Harbour Lights" },
    { videoId: "lovesong001", title: "Love Song", artist: "Harbour Lights" },
    { videoId: "otherart001", title: "Someone Else", artist: "Not Them" },
  ];
  const cards: Record<string, SongCard> = {
    newhome0001: card({ bond: "family", main: ["homecoming"], about: "the kitchen light left on", moods: ["tender", "calm"] }),
    newlove0001: card({ bond: "romantic", stance: "wanting", heat: "sexual", main: ["desire"], energy: 4 }),
  };
  const searched: string[] = [];
  const deps = {
    search: async (q: string) => (searched.push(q), found),
    lyrics: async (s: { videoId: string }) => (pasteLyrics(s.videoId, "a line\nanother"), lyricsFor(s.videoId)!),
    read: async (songs: { videoId: string }[]) => new Map(songs.map((s) => [s.videoId, { sheet: { situations: [], themes: [], voice: "to-you" as const, passages: [] }, mood: null, card: cards[s.videoId] ?? null }])),
  };

  test("only with Find lyrics online: the words are what's read", () => {
    expect(() => askSuggestions("family|happy in it|quiet")).toThrow(/Find lyrics online/);
  });

  test("a look searches by artist name only, reads songs you don't have, keeps the ones that fit", async () => {
    await suggestStep("family|happy in it|quiet", deps);
    // Only an artist's name goes out.
    expect(searched).toEqual(["Harbour Lights", "Keys"]);
    const got = suggestionsView().byKind["family|happy in it|quiet"]!;
    expect(got.songs.map((s) => s.title)).toEqual(["Kitchen Light"]);
    expect(got.looked).toBe(2);
    // The song that didn't fit: its words are forgotten.
    expect(lyricsFor("newlove0001")).toBeNull();
    expect(suggestionsView().busy).toBeNull();
  });

  test("No thanks: it never comes back; Add: it joins the library with its card, words and moods", async () => {
    declineSuggestion("family|happy in it|quiet", "newhome0001");
    expect(lyricsFor("newhome0001")).toBeNull();
    await suggestStep("family|happy in it|quiet", deps);
    expect(suggestionsView().byKind["family|happy in it|quiet"]?.songs ?? []).toEqual([]);
    // Turned down by its key: another copy of the same song doesn't come back either.
    found[0] = { ...found[0]!, videoId: "newhome0002" };
    await suggestStep("family|happy in it|quiet", deps);
    expect(suggestionsView().byKind["family|happy in it|quiet"]?.songs ?? []).toEqual([]);

    // A new song that fits, added.
    found.push({ videoId: "newhome0003", title: "Porch Song", artist: "Harbour Lights" });
    cards.newhome0003 = card({ bond: "family", main: ["homecoming"], about: "the porch at dusk", moods: ["calm", "nope"] });
    await suggestStep("family|happy in it|quiet", deps);
    expect(suggestionsView().byKind["family|happy in it|quiet"]!.songs.map((s) => s.title)).toEqual(["Porch Song"]);
    await addSuggestion("family|happy in it|quiet", "newhome0003");
    const added = musicConfig().library.find((x) => x.videoId === "newhome0003")!;
    expect(added).toMatchObject({ title: "Porch Song", moods: ["calm"], instrumental: false });
    expect(cardOf(added)?.card.about).toBe("the porch at dusk");
    expect(sheetFor("newhome0003")).not.toBeNull();
    expect(suggestionsView().byKind["family|happy in it|quiet"]).toBeUndefined();
    expect(() => declineSuggestion("family|happy in it|quiet", "newhome0003")).toThrow(/gone/);
  });

  test("a starter set of instrumentals: plain searches, nothing read", async () => {
    const asked: string[] = [];
    let i = 0;
    const search = async (q: string) => (asked.push(q), [{ videoId: `instr${String(++i).padStart(6, "0")}`, title: `Piece ${i}`, artist: "Quiet Hands" }]);
    await suggestStep(INSTRUMENTALS, { ...deps, search, read: async () => new Map() });
    expect(asked.every((q) => /instrumental$/.test(q))).toBe(true);
    const got = suggestionsView().byKind[INSTRUMENTALS]!.songs;
    expect(got.length).toBe(4);
    await addSuggestion(INSTRUMENTALS, got[0]!.videoId);
    expect(musicConfig().library.find((x) => x.videoId === got[0]!.videoId)).toMatchObject({ instrumental: true, moods: ["calm", "tender"] });
  });
});
