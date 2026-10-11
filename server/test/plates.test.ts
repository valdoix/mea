import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, getMessageRow, updateChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { scenePlates } from "../src/trackers/plates";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
const seqs: number[] = [];

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "The lamp hums." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  writeEvents(chatId, { messageId: null, swipeIdx: 0 }, linesToOps(["clock: Day 1 20:00", "at: Port Ellis › Lighthouse › Lamp room", "wx: wind off the sea"]).ops, "init");
  const say = (lines: string[]) => {
    const id = addMessage(chatId, "assistant", "…", { name: "Mira" });
    if (lines.length) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
    seqs.push(getMessageRow(id)!.seq);
  };
  say([]);
  say(["wx: rain", "clock: +30m"]);
  say(["at: Port Ellis › The Anchor", "clock: Day 2 08:00"]);
});

describe("scene plates (J1)", () => {
  test("where the story stood, from the start and at each change", () => {
    const p = scenePlates(chatId);
    expect(p.states[0]).toMatchObject({ seq: 0, place: ["Port Ellis", "Lighthouse", "Lamp room"], weather: "wind off the sea", hour: 20 });
    expect(p.states[1]).toMatchObject({ seq: seqs[1], weather: "rain", hour: 20.5 });
    expect(p.states.at(-1)).toMatchObject({ seq: seqs[2], place: ["Port Ellis", "The Anchor"], hour: 8 });
    expect(p.states.length).toBe(3);
  });

  test("“This place is…” corrections ride along", () => {
    updateChat(chatId, { settings: { placeKinds: { "The Anchor": "tavern" } } });
    expect(scenePlates(chatId).kinds).toEqual({ "The Anchor": "tavern" });
  });
});
