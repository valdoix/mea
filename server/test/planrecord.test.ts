import { beforeAll, describe, expect, test } from "bun:test";
import { canonFor } from "../src/accuracy/checker";
import { normalizeCard } from "../src/cards/card";
import { one } from "../src/db/db";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { registerJob } from "../src/services/jobs";
import { planText } from "../src/steer/advisor";
import { planRecords, planRecordText } from "../src/steer/plancheck";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/20 Part 4: the plan answers to the page. */

let chatId = "";
const seqOf = (id: string) => one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", id)!.seq;
function say(role: "user" | "assistant", text: string, lines: string[] = []) {
  const id = addMessage(chatId, role, text, { name: role === "assistant" ? "Buffy" : "Gabriel" });
  if (lines.length) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
  return id;
}
let asked = "";
let answered = "";
const names = { char: "Buffy", user: "Gabriel" };

beforeAll(() => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "tracker.beats", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Revello Drive." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  say("assistant", "The grocery store. They buy tacos and a toaster for dinner.", ["clock: 2001-10-11 11:30", "at: Sunnydale › Grocery Store", "cast: Buffy@spot · You@spot", "promise Buffy → You: make the tacos for dinner | open"]);
  asked = say("user", "At the curb by his car he asks, nervous: \"Have you ever had romantic feelings towards Spike?\"", ["clock: 2001-10-11 11:51", "at: Sunnydale › Summers Residence › Curb"]);
  answered = say("assistant", "\"No. Never. And Dawn is hearing about this jealousy question at dinner.\"", ["promise Buffy → You: throw him under the bus, tell Dawn about the jealousy question at dinner | open"]);
  say("assistant", "He fixes the kitchen faucet. Tacos. Dawn comes home.", ["clock: 2001-10-11 15:10", "at: Sunnydale › Summers Residence › Kitchen", "cast: Buffy@spot · You@spot · Dawn@spot"]);
});

const plan = planText({ pass: "", direction: "Buffy delivers the promised jealousy story at the table.", beats: ["Buffy reenacts the morning: Gabriel asking whether he should be jealous of Spike, the wounded tone", "Dawn cackles, eating her earlier plate"], threads: [], reminders: [], avoid: [] });

describe("the record under a plan that retells (docs/20 4.1)", () => {
  test("the promise to tell it brings the moment it happened: what was asked, and the answer", () => {
    const recs = planRecords(chatId, canonFor(chatId, 99), plan, 99);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.sources.map((s) => s.seq)).toEqual([seqOf(asked), seqOf(answered)]);
    const text = planRecordText(recs, names);
    expect(text).toStartWith("[THE RECORD");
    expect(text).toContain(`#${seqOf(asked)} (11:51, Summers Residence › Curb) Gabriel: At the curb by his car he asks`);
    expect(text).toContain("romantic feelings towards Spike");
  });

  test("a promise that shares only one word with the line isn't its source", () => {
    const recs = planRecords(chatId, canonFor(chatId, 99), plan, 99);
    expect(recs.flatMap((r) => r.sources.map((s) => s.seq))).not.toContain(1);
  });

  test("a plan that retells nothing, or only says 'earlier' of a plate, gets no record", () => {
    const plain = planText({ pass: "", direction: "Dawn eats her earlier plate and asks about school.", beats: ["Buffy laughs"], threads: [], reminders: [], avoid: [] });
    expect(planRecords(chatId, canonFor(chatId, 99), plain, 99)).toEqual([]);
  });
});

describe("the story outranks the plan (docs/20 4.2)", () => {
  test("the advisor's plan says so in its header", () => {
    expect(plan).toContain("Where it and the story so far disagree about what already happened (where, when, who, what was said), the story is right.");
  });
});
