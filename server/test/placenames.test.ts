import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all } from "../src/db/db";
import { insertAtom } from "../src/memory/atoms";
import { genericPlace, placeName, resolver, syncEntities } from "../src/memory/entities";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

describe("place names", () => {
  test("a room alone is generic; a named one isn't", () => {
    expect(genericPlace("kitchen")).toBe(true);
    expect(genericPlace("Kitchen (lemon magnet)")).toBe(true);
    expect(genericPlace("upstairs guest room")).toBe(true);
    expect(genericPlace("walk-in closet")).toBe(true);
    expect(genericPlace("Gabriel's bedroom")).toBe(false);
    expect(genericPlace("Zapatos Dorothea")).toBe(false);
  });

  test("a generic room takes the building it's in", () => {
    expect(placeName(["Summers Residence", "Stairs", "Kitchen"])).toEqual({ name: "Summers Residence kitchen", aliases: ["Summers kitchen"] });
    expect(placeName(["Sunnydale", "Winters House → Summers Residence", "front porch"]).name).toBe("Summers Residence front porch");
    expect(placeName(["Sunnydale", "strip mall", "Zapatos Dorothea"])).toEqual({ name: "Zapatos Dorothea", aliases: [] });
    expect(placeName(["Summers Residence", "Stairs → Summers Residence", "Kitchen (carried Buffy down)"]).name).toBe("Summers Residence kitchen");
    expect(placeName(["Summers Residence", "hallway → kitchen (named,"]).name).toBe("Summers Residence kitchen");
    expect(placeName(["kitchen"])).toEqual({ name: "kitchen", aliases: [] });
  });
});

describe("two houses, two kitchens", () => {
  let chatId = "";
  beforeAll(() => {
    freshDb();
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", description: "A slayer.", first_mes: "Hi." } });
    chatId = createChat({ characterId: createCharacter(data) }).id;
    const ids = Array.from({ length: 4 }, (_, i) => addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}`));
    writeEvents(chatId, { messageId: ids[1]!, swipeIdx: 0 }, linesToOps(["at: Sunnydale › Winters Residence › Kitchen"]).ops, "model");
    writeEvents(chatId, { messageId: ids[3]!, swipeIdx: 0 }, linesToOps(["at: Sunnydale › Summers Residence › Kitchen"]).ops, "model");
    insertAtom(chatId, null, { type: "event", content: "The toothbrush rolled onto the counter beside the BALLET! album.", entities: ["kitchen", "Buffy"], importance: 6 }, [{ id: ids[1]!, seq: 2 }]);
    syncEntities(chatId, true);
  });

  test("each kitchen is its own place", () => {
    const names = all<{ name: string }>("SELECT name FROM entities WHERE chat_id = ? AND kind = 'place'", chatId).map((r) => r.name);
    expect(names).toContain("Winters Residence kitchen");
    expect(names).toContain("Summers Residence kitchen");
    const res = resolver(chatId);
    expect(res.find("Summers kitchen")?.name).toBe("Summers Residence kitchen");
    expect(res.find("Summers Residence kitchen")?.id).not.toBe(res.find("Winters Residence kitchen")?.id);
    // The memory that only says "kitchen" belongs to neither house.
    expect(res.find("kitchen")?.id).not.toBe(res.find("Summers Residence kitchen")?.id);
  });
});
