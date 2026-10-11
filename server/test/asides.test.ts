import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asideHints, asidesAfterReply, fileAside, ownFacts } from "../src/accuracy/asides";
import { normalizeCard } from "../src/cards/card";
import { parseJson } from "../src/db/db";
import { createCharacter } from "../src/services/characters";
import { addMessage, type ChatSettings, createChat, mustChat } from "../src/services/chats";
import { filingsFor, undoFiling } from "../src/services/filings";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
let replyId = "";
const state = () => currentFold(chatId).result.state;
const user = () => Object.values(state().chars).find((c) => c.isUser)!;

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "The lamp hums." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  replyId = addMessage(chatId, "assistant", "Mira laughs. Her birthday, 19 January, is a week away. It's nine in the evening.", { name: "Mira" });
  writeEvents(chatId, { messageId: replyId, swipeIdx: -1 }, linesToOps(["clock: Day 2 18:00", "cast: Mira@spot"]).ops, "model");
});
afterAll(() => pauseJobs(false));

describe("selection asides (F3)", () => {
  test("hints: a date for the calendar, a time for the clock", () => {
    expect(asideHints("her birthday, 19 January")).toMatchObject({ date: "19 January", kind: "birthday", title: "her birthday" });
    expect(asideHints("the 3rd of May")).toMatchObject({ date: "3 May" });
    expect(asideHints("the next morning at 7:30")).toMatchObject({ clock: "next morning 7:30" });
    expect(asideHints("a lamp")).toMatchObject({ date: null, clock: null });
  });

  test("Pin as truth: one tap from the text, with Undo", () => {
    const f = fileAside(chatId, { kind: "truth", text: "Magic always costs something.", messageId: replyId });
    expect(parseJson<ChatSettings>(mustChat(chatId).settings, {}).truths).toContain("Magic always costs something.");
    undoFiling(f.id);
    expect(parseJson<ChatSettings>(mustChat(chatId).settings, {}).truths ?? []).not.toContain("Magic always costs something.");
  });

  test("Add to calendar, Running bit, Plant this, This belongs to: ledger lines with a chip each", () => {
    fileAside(chatId, { kind: "calendar", text: "Her birthday, 19 January", messageId: replyId });
    expect(Object.values(state().calendar)).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Her birthday", kind: "birthday", when: "19 January" })]));
    fileAside(chatId, { kind: "motif", text: "the lamp that won't stay lit", messageId: replyId });
    expect(Object.values(state().motifs).map((m) => m.text)).toContain("the lamp that won't stay lit");
    const plant = fileAside(chatId, { kind: "plant", text: "a loose floorboard by the stairs", messageId: replyId });
    expect(Object.values(state().plants).map((p) => p.text)).toContain("a loose floorboard by the stairs");
    fileAside(chatId, { kind: "owner", text: "the brass key", owner: "Mira", messageId: replyId });
    expect(state().items["the-brass-key"]?.owner).toBe(Object.values(state().chars).find((c) => c.name === "Mira")!.id);
    expect(filingsFor(chatId).filter((f) => f.messageId === replyId).map((f) => f.kind)).toEqual(["calendar", "motif", "plant", "owner"]);
    undoFiling(plant.id);
    expect(Object.values(state().plants).map((p) => p.text)).not.toContain("a loose floorboard by the stairs");
  });

  test("Set the clock from the text", () => {
    fileAside(chatId, { kind: "clock", text: "It's nine in the evening", messageId: replyId, when: "21:00" });
    expect((state().time?.minutes ?? 0) % 1440).toBe(21 * 60);
  });

  test("what your own message states is read, each a chip you can turn down", () => {
    expect(ownFacts("I have a feeling about this. I still have my father's compass in my pocket.", "Ash").map((f) => f.label)).toEqual(["You have father's compass"]);
    const u = addMessage(chatId, "user", "I have a silver knife tucked in my boot. My birthday is the 3rd of May.");
    const r = addMessage(chatId, "assistant", "Mira nods.", { name: "Mira" });
    asidesAfterReply(chatId, r);
    const chips = filingsFor(chatId).filter((f) => f.messageId === u);
    expect(chips.map((f) => f.label)).toEqual(["You have silver knife", "Your birthday · 3 May"]);
    expect(chips.every((f) => f.data.guess)).toBe(true);
    expect(Object.values(state().items).find((i) => i.name === "silver knife")?.holder).toBe(user().id);
    undoFiling(chips[0]!.id, "notMeant");
    expect(Object.values(state().items).find((i) => i.name === "silver knife")?.holder).toBeUndefined();
    // Read again: the guess you turned down isn't made again.
    asidesAfterReply(chatId, r);
    expect(filingsFor(chatId).filter((f) => f.messageId === u).map((f) => f.label)).toEqual(["Your birthday · 3 May"]);
  });
});
