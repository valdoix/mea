import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { one } from "../src/db/db";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, historyForPrompt } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { advisorInput, steerFor } from "../src/steer/advisor";
import { momentsOf } from "../src/trackers/moments";
import { trackerPrompt } from "../src/trackers/service";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/20 Part 2: records carry their moment. */

let chatId = "";
const seqOf = (id: string) => one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", id)!.seq;
function say(role: "user" | "assistant", text: string, lines: string[] = []) {
  const id = addMessage(chatId, role, text, { name: role === "assistant" ? "Buffy" : "Gabriel" });
  if (lines.length) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
  return id;
}
let yesterday = "";
let car = "";

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "tracker.beats", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Revello Drive." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  say("assistant", "Revello Drive.", ["clock: 2001-10-10 20:33", "at: Sunnydale › Winters House › Gabriel's bedroom", "cast: Buffy@spot · You@spot"]);
  yesterday = say("assistant", "She tells him about the socks.", ["know Buffy: Dawn likes grey cat socks · knows · true — Dawn told her in the sock aisle", "know Buffy: Spike bought blood on Tuesdays · knows · true — she paid for it", "know Buffy: Willow bought candles · knows · true — saw the receipt", "know Buffy: Xander bought donuts · knows · true — ate one", "thread The socks: new — Gabriel will buy them"]);
  car = say("assistant", "“And Dawn hears about this at dinner.”", ["clock: 2001-10-11 11:57", "at: Sunnydale › Summers Residence › Front Yard", "cast: Buffy@spot · You@spot", "promise Buffy → You: tell Dawn about the jealousy question at dinner | open [due 2001-10-11 15:05]"]);
  say("assistant", "Tacos.", ["clock: 2001-10-11 15:00", "at: Sunnydale › Summers Residence › Kitchen"]);
  say("user", "Gabriel pouts about the jealousy question and the grey cat socks.");
});
afterAll(() => pauseJobs(false));

describe("a record's moment (docs/20 Part 2)", () => {
  test("a message number reads as its time and place, relative to the story's day", () => {
    const at = momentsOf(chatId);
    expect(at(seqOf(car))).toBe(`#${seqOf(car)}, 11:57 at Summers Residence › Front Yard`);
    expect(at(seqOf(yesterday))).toBe(`#${seqOf(yesterday)}, yesterday 20:33 at Winters House › Gabriel's bedroom`);
  });

  test("STAKES says where and when a promise was made", () => {
    const text = trackerPrompt(chatId, { kind: "story" }).note!.text;
    expect(text).toContain(`tell Dawn about the jealousy question at dinner (made #${seqOf(car)}, 11:57 at Summers Residence › Front Yard)`);
  });

  test("FACTS IN PLAY says where and when someone learned it", () => {
    const text = trackerPrompt(chatId, { kind: "story", focus: "the grey cat socks" }).note!.text;
    expect(text).toContain(`#${seqOf(yesterday)}, yesterday 20:33 at Winters House › Gabriel's bedroom`);
  });

  test("the advisor's open threads say where and when each last moved", async () => {
    const { user } = await advisorInput(chatId, historyForPrompt(chatId), undefined, steerFor(chatId));
    expect(user).toMatch(/OPEN THREADS:\n- The socks: [^\n]*\(#\d+, yesterday 20:33 at Winters House › Gabriel's bedroom\)/);
  });
});
