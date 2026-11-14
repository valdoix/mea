import { beforeAll, describe, expect, test } from "bun:test";
import { leakMatch, notStating, saysShort, shortSecret, weigher } from "../src/accuracy/leakmatch";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { freshDb } from "./helpers";

/** docs/35 Part 3: match the secret, not its vocabulary. */

const names = new Set(["buffy", "summers", "walter", "ruth", "joss", "mira"]);
const flat = () => 1;

describe("weighted, stemmed matching (3.1, 3.2)", () => {
  test("two words and most of the secret", () => {
    expect(leakMatch("Joss stole the harbor ledger from the customs office", "You stole that harbor ledger from customs.", { names, weight: flat }).leak).toBe(true);
    expect(leakMatch("Joss stole the harbor ledger from the customs office", "The harbor was quiet.", { names, weight: flat }).leak).toBe(false);
  });
  test("word forms meet: clawed and claws", () => {
    expect(leakMatch("Buffy clawed out of her grave", "She claws at the grave dirt.", { names, weight: flat }).hits.sort()).toEqual(["claw", "grave"]);
  });
  test("a word the story uses all the time weighs little", () => {
    // "alive" and "night" everywhere, "grave" and "clawed" rare: the common pair isn't the secret.
    const weight = (w: string) => (w === "alive" || w === "night" ? 0.05 : 1);
    const secret = "Buffy clawed out of her grave alive one night";
    expect(leakMatch(secret, "Alive, every night, she says.", { names, weight }).leak).toBe(false);
    expect(leakMatch(secret, "She clawed out of a grave, she says.", { names, weight }).leak).toBe(true);
  });
});

describe("saying it, not asking or denying it (3.3)", () => {
  test.each([
    ["“Is she alive?” Walter asks.", true],
    ["“She isn't alive,” Walter says.", true],
    ["Walter remembers when she was alive.", true],
    ["“She's alive,” Walter says.", false],
  ])("%s → not stating: %s", (s, want) => expect(notStating(s)).toBe(want));
});

describe("one-word secrets (3.4)", () => {
  test("Buffy is alive: her name with the word", () => {
    const s = shortSecret("Buffy is alive")!;
    expect(s).toEqual({ who: "Buffy", what: "alive" });
    expect(saysShort("“Buffy Summers is alive,” Walter says.", s, ["Buffy Summers", "Buffy"])).toBe(true);
    expect(saysShort("“Joyce was alive then,” Walter says.", s, ["Buffy Summers", "Buffy"])).toBe(false);
    expect(saysShort("“Buffy would hate this,” Walter says.", s, ["Buffy Summers", "Buffy"])).toBe(false);
  });
  test("a longer secret isn't one", () => expect(shortSecret("Joss stole the harbor ledger")).toBeNull());
});

describe("the story's own counts", () => {
  let chatId = "";
  beforeAll(() => {
    freshDb();
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Walter", description: "", first_mes: "Hello." } });
    chatId = createChat({ characterId: createCharacter(data) }).id;
    for (let i = 0; i < 30; i++) addMessage(chatId, i % 2 ? "assistant" : "user", i === 7 ? "The ledger sat in the customs office, alive with dust." : `Line ${i}: everyone is alive and the night is long.`, { name: i % 2 ? "Walter" : "You" });
  });
  test("a word in every reply weighs less than one in a single reply", () => {
    const w = weigher(chatId);
    expect(w("alive")).toBeLessThan(w("ledger"));
    expect(w("ledger")).toBeGreaterThan(0.5);
  });
  test("a short story weighs every word the same", () => expect(weigher(null)("anything")).toBe(1));
});
