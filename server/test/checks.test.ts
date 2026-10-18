import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkReply } from "../src/accuracy/checker";
import { clockBackRule, issueToLesson, planningRule, statedTimes } from "../src/accuracy/moreslips";
import { normalizeCard } from "../src/cards/card";
import { one } from "../src/db/db";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { prepare } from "../src/services/generation";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { activeLessons } from "../src/steer/lessons";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 300 } });
  setSetting("memory.config", { ...defaultMemoryConfig, checkerModel: false });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "Welcome." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 2 21:30", "at: Port Ellis › Lighthouse", "cast: Mira@spot · Joss@left(→ the harbour)"]).ops, "model");
  addMessage(chatId, "user", "Who's there?", { name: "You" });
});
afterAll(() => pauseJobs(false));

const kinds = async (text: string) => {
  const id = addMessage(chatId, "assistant", text, { name: "Mira" });
  return { id, issues: (await checkReply(chatId, id, 0)) ?? [] };
};

describe("more reply checks (D1)", () => {
  test("someone speaking who isn't in the scene", async () => {
    const { issues } = await kinds('"You came back," Joss says, shaking rain from his coat. Mira nods.');
    const i = issues.find((x) => x.kind === "nothere");
    expect(i?.conflict).toContain("Joss isn't in this scene");
    // On the phone is fine.
    const phone = await kinds('Mira picks up the phone. "Not tonight," Joss says on the line.');
    expect(phone.issues.some((x) => x.kind === "nothere")).toBe(false);
  });

  test("the clock going back, unless it's a memory", () => {
    expect(statedTimes("It was three o'clock.")).toEqual([[180, 900]]);
    expect(statedTimes("At 9:15 pm she left.")).toEqual([[21 * 60 + 15]]);
    const now = 21 * 60 + 30;
    expect(clockBackRule("The clock strikes four o'clock as she pours the tea.", now)[0]?.conflict).toContain("earlier the same day");
    expect(clockBackRule("She remembers the bell at four o'clock that morning.", now)).toHaveLength(0);
    expect(clockBackRule("At ten o'clock the fog rolls in.", now)).toHaveLength(0); // 22:00 is later
    expect(clockBackRule("Hours later, at four o'clock, she wakes.", now)).toHaveLength(0);
  });

  test("planning left in the prose", () => {
    expect(planningRule("NOW — night, lamp room\nSEAL — Ash asked\nThe lamp hums.")[0]).toMatchObject({ kind: "planning", severity: "major" });
    expect(planningRule("<think>plan</think>\nThe lamp hums.")).toHaveLength(1);
    expect(planningRule("The lamp hums. Now she knows.")).toHaveLength(0);
  });

  test("each check has its switch in the registry, and a switched-off one stays quiet", async () => {
    const { updateChat } = await import("../src/services/chats");
    updateChat(chatId, { settings: { guards: { slips: { nothere: false } } } });
    const { issues } = await kinds('"Again," Joss says.');
    expect(issues.some((x) => x.kind === "nothere")).toBe(false);
    updateChat(chatId, { settings: { guards: { slips: {} } } });
  });

  test("the last reply's open findings go into the next prompt, so the slip isn't repeated", async () => {
    await kinds('"Hello," Joss says from the doorway.');
    const p = await prepare(chatId, "story");
    const lane = p.assembled.trace.blocks.find((b) => b.lane === "slips");
    expect(lane?.text).toContain("Joss isn't here and can't speak or act in this scene");
  });

  test("Make it a lesson: the finding becomes a kept lesson, checked like one", async () => {
    const { id, issues } = await kinds('"Once more," Joss says.');
    const flag = one<{ id: string }>("SELECT id FROM continuity_flags WHERE message_id = ?", id)!;
    const l = issueToLesson(flag.id, issues.find((x) => x.kind === "nothere")!.id);
    expect(l).toMatchObject({ status: "kept", data: { slip: { kind: "nothere", subject: "Joss" } } });
    expect(activeLessons(chatId).some((x) => x.id === l.id)).toBe(true);
    const again = await kinds('"And again," Joss says.');
    expect(again.issues.some((x) => x.kind === "lesson")).toBe(true);
  });
});
