import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { buildNote } from "../src/trackers/note";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** KNOWLEDGE names what the people here already learned about what the player's message brings up. */
let chatId = "";
const note = (focus?: string) => buildNote(currentFold(chatId).result.state, { userName: "Gabe", seq: 9, focus }).text;

beforeAll(() => {
  freshDb();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const id = addMessage(chatId, "assistant", "The kitchen is cold.", { name: "Buffy" });
  writeEvents(
    chatId,
    { messageId: id, swipeIdx: 0 },
    linesToOps([
      "clock: Day 1 23:00",
      "cast: Buffy@spot · Dawn@spot · Joyce@left",
      "know Dawn: Gabe bought Dawn blue cat socks · knows · true — Buffy told her on the phone",
      "know Dawn: Gabriel bought Dawn socks · knows · true — Buffy told her",
      "know Dawn: Spike bought blood on Tuesdays · knows · true — she paid for it",
      "know Dawn: Willow bought candles · knows · true — saw the receipt",
      "know Dawn: Xander bought donuts · knows · true — ate one",
      "know Dawn: Giles bought a plane ticket · knows · true — he said goodbye",
      "know Joyce: Gabe bought Dawn socks · knows · true — Buffy told her",
    ]).ops,
    "model",
  );
});

describe("already knows (KNOWLEDGE)", () => {
  test("a gift she was told about isn't news: the line leads, said once", () => {
    const text = note(`He takes the blue socks from the bag. "And here. Socks. For you. So it matches your eyes, see?"`);
    expect(text).toContain("- Dawn already knows: Gabe bought Dawn blue cat socks (Buffy told her on the phone)");
    expect(text.match(/already knows: .*socks/g)).toHaveLength(1);
    expect(text.indexOf("already knows")).toBeLessThan(text.indexOf("KNOWLEDGE") + 60);
  });

  test("someone who isn't here, a common word alone, or no message: nothing", () => {
    expect(note("Socks for you.")).not.toContain("Joyce already knows");
    expect(note("He bought groceries.")).not.toContain("already knows");
    expect(note()).not.toContain("already knows");
  });
});
