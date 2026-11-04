import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all, run } from "../src/db/db";
import { insertAtom } from "../src/memory/atoms";
import { heardBy, namedFacts, namesStats, whoWasThere } from "../src/memory/named";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { trackerPrompt } from "../src/trackers/service";
import type { WorldState } from "../src/trackers/types";
import { freshDb } from "./helpers";

/** docs/26 2.1: at #791 the tracker had no line on "Brongel", and the memories had who knew it all along. */
describe("what the memories hold about a name just used", () => {
  let chatId: string;
  const none = new Set<string>();

  beforeAll(() => {
    freshDb();
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", description: "A Slayer.", first_mes: "Hi." } });
    chatId = createChat({ characterId: createCharacter(data) }).id;
    for (let i = 0; i < 40; i++) addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}.`);
    const rows = all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? ORDER BY seq", chatId);
    const atom = (type: string, content: string, seq: number, knownBy: string[] = []) => insertAtom(chatId, null, { type, content, knownBy }, [rows.find((r) => r.seq === seq)!]);
    atom("fact", "His frat called him 'The Brongel'.", 4, ["Buffy", "Gabriel"]);
    atom("event", "Resolved: Brongel (the word girlfriend)", 6);
    atom("fact", "The banner read Brongel for President; Dawn saw it.", 8, ["Buffy", "Gabriel", "Dawn"]);
    atom("fact", "He was innocent of the whole thing.", 10, ["Buffy"]);
    atom("fact", "Only Spike saw the Cordelia photo.", 12, ["Spike"]);
    atom("fact", "Later on, Rosalind wrote.", 30, ["Buffy"]);
    for (let i = 0; i < 12; i++) atom("fact", `Harmony called, take ${i}.`, 14, ["Buffy"]);
  });

  test("the latest fact, everyone the facts have knowing it, and where", () => {
    expect(namedFacts(chatId, "And that's Brongel for you.", 20, none)).toEqual([{ term: "brongel", statement: "The banner read Brongel for President; Dawn saw it.", knownBy: ["Buffy", "Gabriel", "Dawn"], firstSeq: 4, lastSeq: 8 }]);
  });

  test("only a word written as a name, and only that very word", () => {
    expect(namedFacts(chatId, `And she said "Brongel" once.`, 20, none)).toEqual([]);
    expect(namedFacts(chatId, "He spoke of Innocence.", 20, none)).toEqual([]);
  });

  test("a regular, the cast's own names, and what hasn't happened yet get no line", () => {
    expect(namedFacts(chatId, "She says that Harmony called.", 20, none)).toEqual([]);
    expect(namedFacts(chatId, "And that's Brongel for you.", 20, new Set(["brongel"]))).toEqual([]);
    expect(namedFacts(chatId, "And that's Brongel for you.", 4, none)).toEqual([]);
    expect(namedFacts(chatId, "She says that Rosalind wrote.", 20, none)).toEqual([]);
  });

  test("it says who holds it, so a fact one person holds reads that way", () => {
    expect(namedFacts(chatId, "She found the Cordelia photo.", 20, none)[0]!.knownBy).toEqual(["Spike"]);
  });

  test("who was there, from the scene's log: a person can have been in the room, or not", () => {
    const st = { chars: { b: { id: "b", name: "Buffy" }, d: { id: "d", name: "Dawn" }, s: { id: "s", name: "Spike" }, u: { id: "u", name: "Gabriel", isUser: true } }, presence: [{ seq: 1, who: ["b", "u"] }, { seq: 6, who: ["b", "d", "u"] }, { seq: 15, who: ["b", "d", "s", "u"] }] } as unknown as WorldState;
    expect(whoWasThere(st, 3)).toEqual(["b", "u"]);
    expect(whoWasThere(st, 15)).toEqual(["b", "d", "s", "u"]);
    expect(whoWasThere(st, 0)).toEqual([]);
    run("UPDATE swipes SET content = 'They called him Sprocket once.' WHERE message_id = (SELECT id FROM messages WHERE chat_id = ? AND seq = 4)", chatId);
    run("UPDATE swipes SET content = 'The banner said Sprocket.' WHERE message_id = (SELECT id FROM messages WHERE chat_id = ? AND seq = 8)", chatId);
    expect([...heardBy(chatId, st, "sprocket", 20).entries()]).toEqual([["b", 4], ["d", 8]]);
    expect([...heardBy(chatId, st, "sprocket", 8).entries()]).toEqual([["b", 4]]);
  });

  test("whoever here wasn't there is named, so nobody writes them as knowing", () => {
    const st = {
      motifs: {},
      chars: { b: { id: "b", name: "Buffy", aliases: [], tier: "spot" }, d: { id: "d", name: "Dawn", aliases: [], tier: "spot" }, s: { id: "s", name: "Spike", aliases: [], tier: "spot" }, u: { id: "u", name: "Gabriel", aliases: [], tier: "spot", isUser: true } },
      presence: [{ seq: 1, who: ["b", "d", "u"] }],
    } as unknown as WorldState;
    const [fact] = namedFacts(chatId, "And that's Brongel for you.", 20, none, 2, st);
    expect(fact!.notHeard).toEqual(["Spike"]);
  });

  test("a running bit the story kept counts as a record, when no memory says it", () => {
    const st = { motifs: { x: { id: "x", text: "Bumblebee, his name for her", firstSeq: 3, lastSeq: 9, uses: 2 } }, chars: {}, presence: [] } as unknown as WorldState;
    expect(namedFacts(chatId, "He calls her Bumblebee again.", 20, none, 2, st)).toEqual([{ term: "bumblebee", statement: "Bumblebee, his name for her", knownBy: [], firstSeq: 9, lastSeq: 9 }]);
    expect(namedFacts(chatId, "He calls her Bumblebee again.", 3, none, 2, st)).toEqual([]);
  });

  test("it reaches the story state under FACTS IN PLAY", () => {
    const parts = trackerPrompt(chatId, { kind: "story", focus: "And that's Brongel for you." });
    expect(parts.note?.text).toContain("FACTS IN PLAY");
    expect(parts.note?.text).toContain("The banner read Brongel for President; Dawn saw it.: Buffy, Gabriel, Dawn know it (");
  });

  test("Story health: names used against what reached the prompt, from the stored request", () => {
    const rows = all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? ORDER BY seq", chatId);
    const row = (seq: number) => rows.find((r) => r.seq === seq)!;
    const brongel = all<{ id: string }>("SELECT id FROM memories WHERE chat_id = ? AND content LIKE '%frat called%'", chatId)[0]!.id;
    // A reply at an odd seq answers the player's message just before it (the greeting is #1, then the player at #2).
    const turn = (seq: number, words: string, generation: string, evicted: number, used?: string) => {
      run("UPDATE swipes SET content = ? WHERE message_id = ?", words, row(seq - 1).id);
      run("UPDATE swipes SET meta = ? WHERE message_id = ?", JSON.stringify({ generationId: generation }), row(seq).id);
      run("INSERT INTO generations (id, chat_id, kind, started_at, trace) VALUES (?, ?, 'new', 1, ?)", generation, chatId, JSON.stringify({ memory: { evictedThrough: evicted } }));
      if (used) run("INSERT INTO memory_usage (generation_id, chat_id, owner_type, owner_id, slot, created_at) VALUES (?, ?, 'memory', ?, 'relevant', 1)", generation, chatId, used);
      return { id: row(seq).id, seq, idx: 0 };
    };
    const stats = namesStats(chatId, [
      turn(23, "And that's Brongel for you.", "g1", 20, brongel),
      turn(25, "And that's Brongel again.", "g2", 20),
      turn(27, "Then that's Brongel, in the window.", "g3", 2),
      turn(29, "Then that's Harmony once more.", "g4", 20),
    ]);
    expect(stats).toEqual({ used: 2, reached: 1, missed: { messageId: row(25).id, seq: 25, term: "brongel" } });
  });
});
