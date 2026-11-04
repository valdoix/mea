import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all } from "../src/db/db";
import { insertAtom } from "../src/memory/atoms";
import { namedFacts } from "../src/memory/named";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { trackerPrompt } from "../src/trackers/service";
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

  test("it reaches the story state under FACTS IN PLAY", () => {
    const parts = trackerPrompt(chatId, { kind: "story", focus: "And that's Brongel for you." });
    expect(parts.note?.text).toContain("FACTS IN PLAY");
    expect(parts.note?.text).toContain("The banner read Brongel for President; Dawn saw it.: Buffy, Gabriel, Dawn know it (");
  });
});
