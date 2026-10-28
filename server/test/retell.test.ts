import { beforeAll, describe, expect, test } from "bun:test";
import { canonFor, checkReply, dismissIssue } from "../src/accuracy/checker";
import { sceneSystem, verifySystem } from "../src/memory/prompts";
import { gatherLanes } from "../src/prompt/lanes";
import { findRetellings, retellSources, toldWrong, whenConflict } from "../src/accuracy/retell";
import "../src/accuracy/moreslips";
import { storyHealth } from "../src/accuracy/health";
import { normalizeCard } from "../src/cards/card";
import { one } from "../src/db/db";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/20 Part 3: a story retold against the passage it tells. */

let chatId = "";
const seqOf = (id: string) => one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", id)!.seq;
function say(role: "user" | "assistant", text: string, lines: string[] = []) {
  const id = addMessage(chatId, role, text, { name: role === "assistant" ? "Buffy" : "Gabriel" });
  if (lines.length) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
  return id;
}
let asked = "";
let faucet = "";

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "accuracy.check", "quota.refresh", "cache.probe", "tracker.update", "tracker.init", "tracker.beats"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 4000, max_tokens: 400 } });
  setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false, journals: false, chronicle: false, consolidate: false });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", description: "A Slayer.", first_mes: "Revello Drive." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  say("assistant", "The diner is warm. Breakfast is pancakes and coffee.", ["clock: 2001-10-11 08:30", "at: Sunnydale › the diner", "cast: Buffy@spot · You@spot"]);
  asked = say("user", "In the car he asks, nervous: \"Have you ever had romantic feelings towards Spike?\"", ["clock: 2001-10-11 11:51", "at: Sunnydale › Revello Drive › Gabriel's car"]);
  say("assistant", "\"No. Never. And Dawn is hearing about this jealousy question at dinner,\" Buffy says, and gets out of the car.", ["promise Buffy → You: tell Dawn about the jealousy question at dinner | open [due tonight]"]);
  faucet = say("assistant", "He fixes the kitchen faucet, sleeves rolled up, the wrench turning, biceps everywhere.", ["clock: 2001-10-11 12:17", "at: Sunnydale › Revello Drive › kitchen"]);
  say("assistant", "Dawn comes home. Tacos.", ["clock: 2001-10-11 15:10", "cast: Buffy@spot · You@spot · Dawn@spot"]);
});

describe("finding retellings (docs/20 3.1)", () => {
  test("a line that points back starts one; it runs on over the sentences after it, narration and all", () => {
    const r = findRetellings("She grins. “Okay. So. This morning. Kitchen. He's fixing the faucet. And this one—“ Buffy jerks her thumb at him. “—says, and I quote, should I be jealous of Spike?”");
    expect(r).toHaveLength(1);
    expect(r[0]!.when).toBe("this morning");
    expect(r[0]!.text).toContain("jealous of Spike");
  });

  test("ordinary narration isn't a retelling", () => {
    expect(findRetellings("She leans back in the chair. He looks back at the door before the clock strikes. The kitchen is warm and the tacos are good and nobody says a word.")).toEqual([]);
  });

  test("a time word against when the source happened", () => {
    const day = 1440 * 730000;
    expect(whenConflict("this morning", day + 12 * 60 + 17, day + 15 * 60)).toBe("it happened today at 12:17, in the afternoon, not this morning");
    expect(whenConflict("this morning", day + 9 * 60, day + 15 * 60)).toBeNull();
    expect(whenConflict("last night", day - 2 * 60, day + 9 * 60)).toBeNull();
    expect(whenConflict("yesterday", day + 9 * 60, day + 15 * 60)).toBe("it happened today at 09:00, not yesterday");
    expect(whenConflict(null, day, day + 60)).toBeNull();
  });
});

describe("the source (docs/20 3.2)", () => {
  test("the promise a retelling keeps brings its moment, with the time and place it happened", () => {
    const [r] = findRetellings("“Okay. So. This morning, in the kitchen, he was fixing the faucet and asked me, and I quote, should I be jealous? The jealousy question. That one.”");
    const sources = retellSources(chatId, canonFor(chatId, 99), 99, r!);
    const q = sources.find((s) => s.seq === seqOf(asked));
    expect(q).toBeDefined();
    expect(q!.place).toBe("Revello Drive › Gabriel's car");
    expect(q!.minutes! % 1440).toBe(11 * 60 + 51);
    expect(sources.some((s) => s.seq === seqOf(faucet))).toBe(true);
  });
});

describe("the flag (docs/20 3.3)", () => {
  test("a story told wrong is flagged against the passage it tells, citing its time and place", async () => {
    const reply = say("assistant", "Buffy grins. “Okay. So. This morning. Kitchen. He was fixing the faucet, biceps everywhere, and he asked me, and I quote, should I be jealous of Spike? MOCK_RETELL The jealousy question.”");
    const issues = (await checkReply(chatId, reply, 0, { model: true }))!.filter((i) => i.kind === "retell");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.citations[0]!.type).toBe("message");
    expect(issues[0]!.citations[0]!.label).toMatch(/^#\d+ \(\d\d:\d\d, /);
  });

  test("without the helper, the rules still catch a time the source can't fit", async () => {
    const reply = say("assistant", "Buffy says: “This morning he fixed the kitchen faucet, sleeves rolled up, the wrench turning, biceps everywhere. It was a whole thing.”");
    const issues = (await checkReply(chatId, reply, 0, { model: false }))!.filter((i) => i.kind === "retell");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.by).toBe("rules");
    expect(issues[0]!.conflict).toContain("not this morning");
    expect(issues[0]!.citations[0]!.seq).toBe(seqOf(faucet));
  });

  test("a story told right isn't flagged", async () => {
    const reply = say("assistant", "Buffy says: “This morning at the diner we had pancakes and coffee, and it was the best breakfast of my whole life, honestly.”");
    expect((await checkReply(chatId, reply, 0, { model: true }))!.some((i) => i.kind === "retell")).toBe(false);
  });
});

describe("a story told wrong stays corrected (docs/20 5.2)", () => {
  test("the next replies hear what really happened; LAST SLIPS doesn't say it twice", async () => {
    const reply = say("assistant", "Buffy grins. “Okay. So. This morning. Kitchen. He was fixing the faucet and he asked me, and I quote, should I be jealous of Spike? MOCK_RETELL The jealousy question.”");
    await checkReply(chatId, reply, 0, { model: true });
    say("assistant", "Dawn laughs.");
    const lines = toldWrong(chatId);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toStartWith(`- Told wrong at #${seqOf(reply)}: «`);
    expect(lines[0]).toContain("What happened:");
    const lanes = gatherLanes({ chatId, kind: "story", state: null, history: [], characterId: "" });
    expect(lanes.find((l) => l.lane === "retold")?.content).toContain("TOLD WRONG");
    expect(lanes.find((l) => l.lane === "slips")?.content ?? "").not.toContain("Tell it as it happened");
  });

  test("a retelling you dismissed was meant: it stays as written", async () => {
    const reply = say("assistant", "Buffy, lying through her teeth: “This morning in the kitchen he asked me, and I quote, should I be jealous of Spike? MOCK_RETELL Total lie, Dawnie.”");
    const issues = (await checkReply(chatId, reply, 0, { model: true }))!;
    const flag = one<{ id: string }>("SELECT id FROM continuity_flags WHERE message_id = ?", reply)!;
    for (const i of issues.filter((x) => x.kind === "retell")) dismissIssue(flag.id, i.id);
    expect(toldWrong(chatId).some((l) => l.includes(`#${seqOf(reply)}:`))).toBe(false);
  });
});

describe("talk isn't record (docs/20 5.1)", () => {
  test("the scene archivist records a retelling as said, and its check catches one recorded as the event", () => {
    expect(sceneSystem({ char: "Buffy", user: "Gabriel" })).toContain("record it as what they said, with who said it");
    expect(verifySystem()).toContain("someone's account of an earlier event recorded as the event itself");
  });
});

describe("retelling accuracy in Story health (docs/20 6.2)", () => {
  test("found, checked against the page, told wrong, dismissed", () => {
    const h = storyHealth(chatId);
    expect(h.retold).toBeDefined();
    const r = h.retold!;
    expect(r.found).toBeGreaterThanOrEqual(r.matched);
    expect(r.matched).toBeGreaterThan(0);
    expect(r.flagged).toBeGreaterThan(0);
    expect(r.dismissed).toBeGreaterThan(0);
    expect(r.last?.seq).toBeGreaterThan(0);
  });
});
