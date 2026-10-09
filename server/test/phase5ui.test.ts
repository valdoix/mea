import { beforeAll, describe, expect, test } from "bun:test";
import { nameRegistry } from "../src/accuracy/names";
import { normalizeCard } from "../src/cards/card";
import { createEntity } from "../src/memory/entities";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, listMessages } from "../src/services/chats";
import { addHighlight, moments } from "../src/services/notebook";
import { freshDb } from "./helpers";

/** Server pieces the Phase 5 screens lean on: reading forward, who's-who ids, highlights. */
let chatId = "";
const ids: string[] = [];

beforeAll(() => {
  freshDb();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "Welcome." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  for (let i = 0; i < 9; i++) ids.push(addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}`, { name: i % 2 ? "Mira" : "You" }));
});

describe("reading mode pages forward (UI-15)", () => {
  test("after= reads from a point in story order", () => {
    const all = listMessages(chatId, { limit: 200 }).messages.map((m) => m.seq);
    const first = listMessages(chatId, { after: 0, limit: 4 });
    expect(first.messages.map((m) => m.seq)).toEqual(all.slice(0, 4));
    expect(first.hasMore).toBe(true);
    const rest = listMessages(chatId, { after: first.messages.at(-1)!.seq, limit: 100 });
    expect(rest.messages.map((m) => m.seq)).toEqual(all.slice(4));
    expect(rest.hasMore).toBe(false);
  });
  test("without after= pages still come backwards from the end", () => {
    const page = listMessages(chatId, { limit: 3 });
    const all = listMessages(chatId, { limit: 200 }).messages.map((m) => m.seq);
    expect(page.messages.map((m) => m.seq)).toEqual(all.slice(-3));
  });
});

describe("who's-who (UI-11)", () => {
  test("names from memory carry their Codex page, even when the card named them first", () => {
    const mira = createEntity(chatId, { name: "Mira", kind: "person", description: "Keeper of the lighthouse." });
    const joss = createEntity(chatId, { name: "Joss", kind: "person" });
    const reg = nameRegistry(chatId);
    const m = reg.find((r) => r.name === "Mira")!;
    expect(m.source).toBe("card");
    expect(m.entityId).toBe(mira.id);
    expect(reg.find((r) => r.name === "Joss")?.entityId).toBe(joss.id);
  });
});

describe("highlights (QOL-02)", () => {
  test("the same passage highlighted twice is kept once", () => {
    const a = addHighlight(ids[1]!, "the lamp flickers");
    const b = addHighlight(ids[1]!, "  the lamp flickers ");
    expect(b.id).toBe(a.id);
    expect(moments({ chatId }).filter((x) => x.kind === "highlight")).toHaveLength(1);
  });
});
