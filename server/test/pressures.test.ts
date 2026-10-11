import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { gatherLanes } from "../src/prompt/lanes";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, getChat, softDeleteMessage } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { drawPressure, pressureAction, pressuresAfterReply, pressuresView } from "../src/trackers/pressures";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";

/** A reply, read by the "trackers" (the lines given), then the pressure rules. */
function reply(text: string, lines: string[] = []) {
  const id = addMessage(chatId, "assistant", text, { name: "Mira" });
  if (lines.length) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
  pressuresAfterReply(chatId, id, 0);
  return id;
}
const state = () => currentFold(chatId).result.state;
const mira = () => Object.values(state().chars).find((c) => c.name === "Mira")!;
const joss = () => Object.values(state().chars).find((c) => c.name === "Joss")!;

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "A widow who keeps the lighthouse.", first_mes: "Welcome." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 2 21:00", "scene: The lamp room", "cast: Mira@spot"]).ops, "model");
});
afterAll(() => pauseJobs(false));

describe("hidden pressures (E1)", () => {
  test("the main character draws one, grounded in what the card says, the same on every read", () => {
    reply("Mira trims the wick.");
    expect(mira().pressure).toMatchObject({ text: "still hasn't let themselves grieve", by: "grounded", stage: "hidden" });
    const id = reply("She looks out at the water.");
    pressuresAfterReply(chatId, id, 0);
    expect(mira().pressure?.history.length).toBe(1);
  });

  test("a passing stranger doesn't draw one; someone who stays does, from the deck", () => {
    reply("Joss comes up the stairs.", ["cast: Joss@spot"]);
    expect(joss().pressure).toBeUndefined();
    for (let i = 0; i < 6; i++) reply(`Joss and Mira talk (${i}).`, ["cast: Joss@spot"]);
    expect(joss().pressure).toMatchObject({ by: "deck", stage: "hidden" });
    // Seeded: drawing again for the same draw gives the same card.
    expect(drawPressure(chatId, state(), joss(), 1).text).toBe(drawPressure(chatId, state(), joss(), 1).text);
  });

  test("the model can't write one", () => {
    const id = addMessage(chatId, "assistant", "…", { name: "Mira" });
    writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(["pressure Mira: is secretly a queen | stage: cracking"]).ops, "model");
    expect(mira().pressure?.text).toBe("still hasn't let themselves grieve");
  });

  test("it grows over scenes, not replies, and a swipe or delete takes the step back", () => {
    reply("Night deepens.");
    expect(mira().pressure?.stage).toBe("hidden");
    reply("Morning.", ["scene: The harbour"]);
    const id = reply("Noon.", ["scene: The market"]);
    expect(mira().pressure?.stage).toBe("growing");
    softDeleteMessage(id);
    expect(mira().pressure?.stage).toBe("hidden");
  });

  test("the [PRESSURES] lane names present people's pressures as behaviour, never to announce", () => {
    const lanes = gatherLanes({ chatId, kind: "story", state: state(), history: [], characterId: getChat(chatId)!.characterId! });
    const p = lanes.find((l) => l.lane === "pressures");
    expect(p?.content).toContain("Mira still hasn't let themselves grieve");
    expect(p?.content).toContain("never announce it");
    expect(gatherLanes({ chatId, kind: "impersonate", state: state(), history: [], characterId: "" }).some((l) => l.lane === "pressures")).toBe(false);
  });

  test("your hand: write my own locks it against the engine; redraw rolls again", () => {
    pressureAction(chatId, mira().id, "write", "is planning to leave on the next boat");
    expect(mira().pressure).toMatchObject({ text: "is planning to leave on the next boat", by: "you", locked: true });
    reply("Another scene.", ["scene: The pier"]);
    reply("And another.", ["scene: The cliff"]);
    reply("Wind.");
    expect(mira().pressure?.stage).toBe("hidden");
    const before = joss().pressure!.text;
    const expected = drawPressure(chatId, state(), joss(), 2, before).text;
    pressureAction(chatId, joss().id, "redraw");
    expect(joss().pressure).toMatchObject({ draws: 2, text: expected });
    expect(expected).not.toBe(before);
  });

  test("bring it to a head sets the next reply's cue; resolve moves a bond", () => {
    pressureAction(chatId, mira().id, "head");
    expect(mira().pressure?.stage).toBe("head");
    expect(JSON.stringify(getChat(chatId)!.settings)).toContain("tests Mira's hidden pressure");
    pressureAction(chatId, mira().id, "resolve");
    expect(mira().pressure?.stage).toBe("resolved");
    const user = Object.values(state().chars).find((c) => c.isUser)!;
    const bond = Object.values(state().bonds).find((b) => b.from === mira().id && b.to === user.id);
    expect(bond?.axes.trust).toBe(1);
  });

  test("the dramatic irony view lists pressures and what you know that they don't", () => {
    const id = addMessage(chatId, "assistant", "…", { name: "Mira" });
    writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(["secret #boat: Mira booked passage | kept by Mira & You · from Joss"]).ops, "model");
    const v = pressuresView(chatId);
    expect(v.find((x) => x.name === "Mira")?.pressure?.stage).toBe("resolved");
    expect(v.find((x) => x.name === "Joss")?.youKnow).toContain("Mira booked passage");
  });
});
