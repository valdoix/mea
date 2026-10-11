import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { actOnInbox, inboxItems } from "../src/accuracy/inbox";
import { createOffpage, listOffpage } from "../src/accuracy/offpage";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, getChat, softDeleteMessage } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { statusTiles } from "../src/services/status";
import { exposureAfterReply, exposureFor, nudgeExposure } from "../src/trackers/exposure";
import { buildNote } from "../src/trackers/note";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
const KEY = "ledger";

/** A reply, read by the "trackers" (the lines given), then the exposure rules. */
function reply(text: string, lines: string[] = []) {
  const id = addMessage(chatId, "assistant", text, { name: "Mira" });
  if (lines.length) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
  exposureAfterReply(chatId, id, 0);
  return id;
}
const clock = () => exposureFor(chatId).find((x) => x.key === KEY)!;

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "Welcome." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 2 21:00", "cast: Mira@spot · Joss@left", `secret #${KEY}: Mira hid the harbour ledger | kept by Mira · from Joss`]).ops, "model");
});
afterAll(() => pauseJobs(false));

describe("secret exposure clocks (B2)", () => {
  test("nobody in earshot: the clock stays put", () => {
    reply("Mira polishes the lens alone.");
    expect(clock().cur).toBe(0);
  });

  test("the keeper in earshot of the one it's kept from moves it, once a scene", () => {
    reply("Joss comes up the stairs, dripping.", ["cast: Joss@spot"]);
    expect(clock()).toMatchObject({ cur: 1 });
    expect(clock().near[0]).toMatchObject({ name: "Joss", why: ["in earshot of Mira"] });
    reply("They talk about the weather.");
    expect(clock().cur).toBe(1);
  });

  test("a clue pointing at it moves it, and the reason is kept", () => {
    reply("Joss notices ink on Mira's cuff.", ["clue ink on Mira's cuff → points to the harbour ledger | shaky"]);
    expect(clock().cur).toBe(2);
    expect(clock().history.at(-1)?.why).toContain("a clue points at it");
  });

  test("the narration slipping an off-page word moves it", () => {
    createOffpage(chatId, { ref: `tracker:${KEY}`, label: "Mira hid the harbour ledger.", neverSay: ["ledger"] });
    reply("The ledger is under the floorboards, she thinks.");
    expect(clock().cur).toBe(3);
  });

  test("swiping or deleting the reply takes its move back (events tied to the reply)", () => {
    const id = reply("Joss finds a torn page under the desk.", ["clue a torn ledger page → points to the harbour ledger"]);
    expect(clock().cur).toBe(4);
    softDeleteMessage(id);
    expect(clock().cur).toBe(3);
  });

  test("a reply read again doesn't count twice", () => {
    const id = reply("Joss holds up a scrap of paper.", ["clue a scrap of paper → points to the harbour ledger"]);
    expect(clock().cur).toBe(4);
    exposureAfterReply(chatId, id, 0);
    expect(clock().cur).toBe(4);
  });

  test("close to coming out: the note tells the model, and the Status tile lights", () => {
    const note = buildNote(currentFold(chatId).result.state, { userName: "You", seq: 99 });
    expect(note?.text ?? "").toContain("Close to coming out (4/6)");
    expect(statusTiles(chatId).find((t) => t.id === "exposure")).toMatchObject({ value: "4/6", n: 1 });
  });

  test("Raise the stakes: +1 and a cue for the next scene", () => {
    nudgeExposure(chatId, KEY, 1, "raise");
    expect(clock().cur).toBe(5);
    expect(getChat(chatId)!.settings.cue).toContain("puts this secret at risk");
  });

  test("a full clock asks: Let it come out (in a scene), or Hold one more scene", () => {
    nudgeExposure(chatId, KEY, 1);
    // The off-page secret here reveals "when I say", so the exposure card asks.
    const card = inboxItems({ chatId }).find((i) => i.key === `exposure:${chatId}:${KEY}`);
    expect(card).toMatchObject({ source: "secret", title: "A secret is about to come out" });
    actOnInbox(card!.key, "reject");
    expect(clock().cur).toBe(5);
    nudgeExposure(chatId, KEY, 1);
    actOnInbox(`exposure:${chatId}:${KEY}`, "accept");
    expect(getChat(chatId)!.settings.cue).toContain("comes out on the page");
    expect(listOffpage(chatId).find((o) => o.ref === `tracker:${KEY}`)?.status).toBe("revealed");
  });

  test("an off-page secret that waits for its clock comes due when it fills", () => {
    createOffpage(chatId, { ref: `tracker:${KEY}`, label: "The ledger again.", neverSay: ["ledger"], reveal: { when: "exposure" } });
    nudgeExposure(chatId, KEY, 6 - clock().cur);
    const o = listOffpage(chatId).find((x) => x.reveal.when === "exposure")!;
    expect(o.due).toBe(true);
    // Its own card asks (no second exposure card).
    expect(inboxItems({ chatId }).some((i) => i.key === `exposure:${chatId}:${KEY}`)).toBe(false);
    expect(inboxItems({ chatId }).some((i) => i.key === `offpage:${o.id}`)).toBe(true);
  });

  test("the model can't move the clock; only the engine and you", () => {
    const id = addMessage(chatId, "assistant", "x", { name: "Mira" });
    const before = clock().cur;
    writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps([`expose #${KEY}: -3 — the model tried`]).ops, "model");
    expect(clock().cur).toBe(before);
  });
});
