import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { buildNote, carried, cleanBit } from "../src/trackers/note";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";

function reply(lines: string[]) {
  const id = addMessage(chatId, "assistant", "…", { name: "Buffy" });
  writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
  return id;
}
const state = () => currentFold(chatId).result.state;
const note = () => buildNote(state(), { userName: "Gabriel", seq: 99 })?.text ?? "";
const buffyLine = () => note().split("\n").find((l) => l.startsWith("- Buffy")) ?? "";

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  reply(["clock: Day 1 09:00", "at: Sunnydale › Hills house › Car", "scene: the hillside turnout", "cast: Buffy@spot"]);
});
afterAll(() => pauseJobs(false));

describe("state that expires (docs/33 Part 5)", () => {
  test("clothes and body state hold within their scene", () => {
    reply(["look Buffy: jeans unbuttoned, boots in the footwell", "body Buffy: arousal 5", "item cream soup: +Buffy", "item spare toothbrush: +Buffy (sofa arm)", "item white low-tops: +Buffy (on her feet)"]);
    const line = buffyLine();
    expect(line).toContain("wearing: jeans unbuttoned");
    expect(line).toContain("cream soup");
    expect(line).toContain("white low-tops");
  });
  test("a later scene doesn't inherit them", () => {
    reply(["item black boots: +Buffy (worn, one boot)"]);
    reply(["clock: +2h", "at: Sunnydale › Hills house › Living room", "scene: darts with Walter", "cast: Buffy@spot · Walter@spot", "item green slippers: +Buffy (on her feet)", "item marker: +Buffy"]);
    const line = buffyLine();
    expect(line).not.toContain("jeans unbuttoned");
    expect(line).not.toContain("arousal");
    expect(line).not.toContain("cream soup");
    expect(line).not.toContain("toothbrush");
    // One pair of shoes on her feet: the latest.
    expect(line).toContain("green slippers");
    expect(line).not.toContain("white low-tops");
    expect(line).not.toContain("black boots");
    expect(line).toContain("marker");
  });
  test("restating them brings them back", () => {
    reply(["look Buffy: boots on, jacket zipped", "body Buffy: hunger 3"]);
    expect(buffyLine()).toContain("wearing: boots on, jacket zipped");
  });
  test("at most eight things, the latest first", () => {
    reply(Array.from({ length: 11 }, (_, i) => `item stone ${i + 1}: +Buffy`));
    const buffy = Object.values(state().chars).find((c) => c.name === "Buffy")!;
    expect(carried(state(), buffy.id)).toHaveLength(8);
  });
  test("a broken line is cleaned before a prompt reads it", () => {
    expect(cleanBit("both earlobes (pierced wound")).toBe("both earlobes pierced wound");
    expect(cleanBit("left ankle (sprained)")).toBe("left ankle (sprained)");
    expect(cleanBit("arousal 4 · body Buffy Summers: arousal 5, asleep")).toBe("");
    expect(cleanBit("asleep")).toBe("asleep");
  });
});
