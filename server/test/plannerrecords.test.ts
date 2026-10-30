import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, historyForPrompt, updateChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { advisorInput, newestChapters, steerFor } from "../src/steer/advisor";
import { buildNote } from "../src/trackers/note";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/19 Part 1: the planner reads the records, and FACTS IN PLAY says what the player's message touches. */
let chatId = "";
let swiped = "";
const SOCKS = `He takes the blue socks from the bag. "And here. Socks. For you. So it matches your eyes, see?"`;
const note = (focus?: string) => buildNote(currentFold(chatId).result.state, { userName: "Gabe", seq: 9, focus }).text;

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "accuracy.check", "tracker.update", "lessons.learn", "offpage.reword"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const id = addMessage(chatId, "assistant", "The kitchen is cold.", { name: "Buffy" });
  writeEvents(
    chatId,
    { messageId: id, swipeIdx: 0 },
    linesToOps([
      "clock: Day 1 23:00",
      "cast: Buffy@spot · Dawn@spot · Spike@spot · Joyce@left",
      "know Dawn: Gabe bought Dawn blue cat socks · knows · true — Buffy told her on the phone",
      "know Dawn: Gabriel bought Dawn socks · knows · true — Buffy told her",
      "know Dawn: Spike bought blood on Tuesdays · knows · true — she paid for it",
      "know Dawn: Willow bought candles · knows · true — saw the receipt",
      "know Dawn: Xander bought donuts · knows · true — ate one",
      "know Dawn: Giles bought a plane ticket · knows · true — he said goodbye",
      "know Joyce: Gabe bought Dawn socks · knows · true — Buffy told her",
      "item grey cat socks: Buffy → Gabe — Buffy picked them for Dawn",
      "secret #heaven: Buffy was in heaven | kept by Buffy · from Dawn",
    ]).ops,
    "model",
  );
  addMessage(chatId, "user", SOCKS);
  // The take being replaced: it says Spike learned about the socks, which the planner must not read.
  swiped = addMessage(chatId, "assistant", "Spike watches.", { name: "Buffy" });
  writeEvents(chatId, { messageId: swiped, swipeIdx: 0 }, linesToOps(["know Spike: Gabe bought Dawn blue cat socks · knows · true — overheard"]).ops, "model");
});
afterAll(() => pauseJobs(false));

describe("FACTS IN PLAY", () => {
  test("a gift she was told about leads the note, with how and when, said once; the thing itself comes too", () => {
    const text = note(SOCKS);
    expect(text).toContain("FACTS IN PLAY");
    expect(text).toMatch(/- Gabe bought Dawn blue cat socks: Dawn knows \(Buffy told her on the phone, #\d+\)/);
    expect(text.match(/^- .*bought Dawn.*socks/gm)).toHaveLength(1);
    expect(text).toMatch(/- grey cat socks: with Gabe/);
    expect(text.indexOf("FACTS IN PLAY")).toBeLessThan(text.indexOf("PRESENT"));
  });

  test("a fact recorded long ago says it's how things stood then", () => {
    const fresh = note(SOCKS);
    expect(fresh).not.toContain("how things stood then, which");
    const later = buildNote(currentFold(chatId).result.state, { userName: "Gabe", seq: 300, focus: SOCKS }).text;
    expect(later).toMatch(/- Gabe bought Dawn blue cat socks: Dawn knows \(Buffy told her on the phone, #\d+\).* · recorded \d+ messages ago: how things stood then/);
  });

  test("someone who isn't here, a common word alone, or no message: nothing", () => {
    expect(note(SOCKS)).not.toContain("Joyce knows");
    expect(note("He bought groceries.")).not.toContain("FACTS IN PLAY");
    expect(note()).not.toContain("FACTS IN PLAY");
  });
});

describe("the planner's input (docs/19 1.1, 1.3)", () => {
  test("the whole story state with KNOWLEDGE and FACTS IN PLAY, from the fold before the take being replaced", async () => {
    updateChat(chatId, { settings: { planning: "planner" } });
    const history = historyForPrompt(chatId, { excludeMessageId: swiped });
    const { user } = await advisorInput(chatId, history, undefined, { ...steerFor(chatId), planner: true }, undefined, swiped);
    expect(user).toContain("KNOWLEDGE");
    expect(user).toContain("FACTS IN PLAY");
    expect(user).toContain("Dawn knows (Buffy told her on the phone");
    expect(user).not.toContain("overheard");
  });

  test("the Story So Far's newest chapters, whole, or its newest paragraphs when it has none", () => {
    const chapters = ["### Chapter: One\nold " + "word ".repeat(400), "### Chapter: Two\nmiddle " + "word ".repeat(400), "### Chapter: Three\nnewest."].join("\n");
    const kept = newestChapters(chapters, 450);
    expect(kept).toStartWith("### Chapter: Two");
    expect(kept).toEndWith("newest.");
    expect(newestChapters(["first " + "word ".repeat(400), "last."].join("\n\n"), 100)).toBe("last.");
  });
});
