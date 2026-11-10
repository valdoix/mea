import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { pauseJobs } from "../src/services/jobs";
import { currentFold, linesToOps, setStoryNames, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/32 Part 1, against the database: the story's messages, the card and the lore are what name people. */
let chatId = "";
const reply = (text: string, lines: string[]) => {
  const id = addMessage(chatId, "assistant", text, { name: "Buffy Summers" });
  writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
};
const cast = () => Object.values(currentFold(chatId).result.state.chars).map((c) => c.name);
const said = () => Object.values(currentFold(chatId).result.verdicts).flatMap((v) => (v.warn ? [v.warn] : v.ok ? [] : [v.reason ?? ""]));

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  setStoryNames(true);
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy Summers", description: "Buffy Summers, twenty, lives with her sister Dawn. Her mother Joyce died last year.", first_mes: "The lamp hums." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
});
afterAll(() => {
  setStoryNames(false);
  pauseJobs(false);
});

describe("named by the story, from the database (docs/32 Part 1)", () => {
  test("the messages name a walk-on; the ledger alone names nobody", () => {
    reply("A clerk waves them over. \"I'm Chloe, shout if you need a size.\"", ["cast: Buffy Summers@spot · Chloe@peri", "cast: Shannon@spot", "know Shannon: Buffy is trying on boots | watching · knows · true"]);
    expect(cast()).toContain("Chloe");
    expect(cast()).not.toContain("Shannon");
    expect(said().filter((s) => s.includes("the story never says Shannon: nobody was added")).length).toBe(2);
  });

  test("the card names people the messages haven't yet", () => {
    reply("She turns the photo face down.", ["cast: Dawn@off · Joyce@off"]);
    expect(cast()).toEqual(expect.arrayContaining(["Dawn", "Joyce"]));
  });

  test("a name the story reaches later is a person from then on", () => {
    reply("Nothing much happens.", ["cast: Marco@peri"]);
    expect(cast()).not.toContain("Marco");
    reply("Marco, the piercer, looks up from the counter.", ["cast: Marco@peri"]);
    expect(cast()).toContain("Marco");
  });
});
