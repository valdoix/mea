import { beforeEach, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { parseLine } from "../src/trackers/dsl";
import { currentFold, saveCastFaction, writeEvents } from "../src/trackers/store";
import { fixSweep, leaveSweep, reachSweep, undoSweep } from "../src/trackers/sweep";
import { freshDb } from "./helpers";

/** docs/31 Part 4: older lines checked the way new ones are, fixed only when you say so. */

let chatId = "";
let lunch = "";
let bad = "";
beforeEach(() => {
  freshDb();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy Summers", description: "The Slayer.", first_mes: "Hey." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  saveCastFaction(chatId, null, { name: "Scoobies", members: [{ name: "Willow" }, { name: "Xander" }] });
  addMessage(chatId, "user", "I plate the tacos.", { name: "Gabriel Winters" });
  lunch = addMessage(chatId, "assistant", "Walter set down his taco. \"You two are Tom Paris and B'elanna Torres.\" Spike groaned.", { name: "Buffy Summers" });
  const ids = writeEvents(
    chatId,
    { messageId: lunch, swipeIdx: 0 },
    [
      "cast: Buffy Summers@spot · Walter@spot · Spike@spot",
      "know @Scoobies: Walter compares Gabriel and Buffy to Tom Paris | he said it at the table · knows",
      "know Walter, Spike, Anya: Spike watches Passions | at lunch · knows",
      "know Walter, Spike: Buffy rules film Fridays | at lunch · knows",
    ].map((l) => parseLine(l)!),
    "model",
  );
  bad = ids[1]!;
});
const holders = (text: string) => {
  const f = Object.values(currentFold(chatId).result.state.facts).find((x) => x.statement.includes(text));
  return Object.keys(f?.stances ?? {}).sort();
};

describe("the sweep", () => {
  test("finds the group line and the named absentee, not the clean line", () => {
    const found = reachSweep(chatId);
    expect(found.map((x) => [x.away, x.unsure])).toEqual([
      [["Willow", "Xander"], []],
      [[], ["Anya"]],
    ]);
    expect(found[0]!.eventId).toBe(bad);
  });

  test("fix all: the members are off the line; undo puts it back as written", () => {
    expect(holders("Tom Paris")).toEqual(["willow", "xander"]);
    expect(fixSweep(chatId)).toBe(2);
    expect(holders("Tom Paris")).toEqual([]);
    expect(currentFold(chatId).result.changes[lunch]!.find((c) => c.subject === "Anya")!.flag).toBe("not in the scene?");
    expect(reachSweep(chatId)).toEqual([]);
    expect(undoSweep(chatId, [bad])).toBe(1);
    expect(holders("Tom Paris")).toEqual(["willow", "xander"]);
    expect(reachSweep(chatId).map((x) => x.eventId)).toContain(bad);
  });

  test("leave it: the line stays as written and stops being listed", () => {
    expect(leaveSweep(chatId, [bad])).toBe(1);
    expect(holders("Tom Paris")).toEqual(["willow", "xander"]);
    expect(reachSweep(chatId).map((x) => x.eventId)).not.toContain(bad);
  });
});
