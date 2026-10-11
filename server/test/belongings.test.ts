import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { belongingsOf } from "../src/trackers/belongings";
import { parseLine } from "../src/trackers/dsl";
import { buildNote } from "../src/trackers/note";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";

/** A reply, read by the "trackers" (the lines given). */
function reply(lines: string[]) {
  const id = addMessage(chatId, "assistant", "…", { name: "Mira" });
  writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
  return id;
}
const state = () => currentFold(chatId).result.state;
const char = (name: string) => Object.values(state().chars).find((c) => c.name === name)!;
const note = () => buildNote(state(), { userName: "You", seq: 12 })?.text ?? "";

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "Welcome." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 2 21:00", "at: Port Ellis › Lighthouse › Lamp room", "cast: Mira@spot · Joss@spot"]).ops, "model");
});
afterAll(() => pauseJobs(false));

describe("belongings and rooms (E2)", () => {
  test("the ledger lines parse", () => {
    expect(parseLine("room Mira: Port Ellis › Lighthouse › Lamp room | room")).toMatchObject({ op: "room", subject: "Mira", args: { path: ["Port Ellis", "Lighthouse", "Lamp room"], kind: "room" } });
    expect(parseLine("keeps Mira: the ledger @ Lamp room — she hid it")).toMatchObject({ op: "keeps", subject: "Mira", args: { item: "the ledger", place: "Lamp room" }, cause: "she hid it" });
    expect(parseLine("item locket: Joss → Mira (gift from Joss) — her birthday")?.args).toMatchObject({ from: "Joss", to: "Mira", gift: "Joss" });
    expect(parseLine("item locket: Joss → Mira (gift from Joss) — her birthday")?.args.where).toBeUndefined();
  });

  test("a place gets an owner and a kind (named by its last part), and things are kept there", () => {
    reply(["room Mira: Lamp room | room — she sleeps up here", "keeps Mira: the ledger @ Lamp room — she hid it", "keeps Mira: a brass telescope @ Lamp room — her father's"]);
    const lamp = Object.values(state().places).find((p) => p.name === "Lamp room")!;
    expect(lamp).toMatchObject({ owner: char("Mira").id, kind: "room", path: ["Port Ellis", "Lighthouse", "Lamp room"] });
    expect(note()).toContain("ROOM: Mira's room · Mira keeps here: the ledger, a brass telescope");
  });

  test("coming back, the note says what changed since you were last in it", () => {
    reply(["at: Port Ellis › Harbour", "item a brass telescope: → Joss — he borrowed it", "keeps Mira: a pressed flower @ Lamp room — left on the sill"]);
    expect(note()).not.toContain("ROOM:");
    reply(["at: Port Ellis › Lighthouse › Lamp room"]);
    expect(note()).toContain("since last time: new: a pressed flower, gone: a brass telescope");
  });

  test("an object's history keeps who held it, where and when", () => {
    const tel = state().items["a-brass-telescope"]!;
    expect(tel.custody.at(-1)).toMatchObject({ to: char("Joss").id, at: "Port Ellis › Harbour" });
    expect(typeof tel.custody.at(-1)?.time).toBe("number");
    const b = belongingsOf(state(), char("Mira"));
    expect(b.rooms[0]).toMatchObject({ name: "Lamp room", kind: "room" });
    expect(b.items.find((i) => i.name === "a brass telescope")).toMatchObject({ mine: true, holder: "Joss", held: false });
  });

  test("a gift moves a bond, and losing it is noticed when the giver is there", () => {
    reply(["item a silver locket: Joss → Mira (gift from Joss) — for her birthday"]);
    const bond = state().bonds[`${char("Mira").id}>${char("Joss").id}`];
    expect(bond?.axes.affection).toBe(1);
    expect(state().items["a-silver-locket"]).toMatchObject({ gift: "Joss", owner: char("Mira").id });
    reply(["item a silver locket: → lost — it slipped into the sea"]);
    expect(note()).toContain("NOTICED: Joss gave Mira a silver locket; it's gone now");
    // Found again: no longer noticed.
    reply(["item a silver locket: +Mira — she found it in the rocks"]);
    expect(note()).not.toContain("NOTICED:");
    // Handing it back and forth isn't a second gift.
    expect(state().bonds[`${char("Mira").id}>${char("Joss").id}`]?.axes.affection).toBe(1);
  });
});
