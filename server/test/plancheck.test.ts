import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { dismissIssue, flagsFor } from "../src/accuracy/checker";
import { newId, now, run } from "../src/db/db";
import { setSetting, defaultMemoryConfig } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, historyForPrompt, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { previewPrompt } from "../src/services/generation";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { editPlan, turnKey } from "../src/steer/advisor";
import { checkPlan, planCorrection } from "../src/steer/plancheck";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/19 Part 2: the plan's "who knows" is checked against the records, and a flagged leak holds what it let out. */
let chatId = "";
const SOCKS = `He takes the blue socks from the bag. "And here. Socks. For you. So it matches your eyes, see?"`;
const PLAN = (know: string) => `NOW — the kitchen, 23:24.\nSEAL — DID: offers the socks.\nKNOW — ${know}\nMOVE — Dawn takes the socks.\nVOICE — medium.`;
const state = () => currentFold(chatId).result.state;

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "accuracy.check", "quota.refresh", "cache.probe", "tracker.update", "lessons.learn", "offpage.reword"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 12000, max_tokens: 300 } });
  setSetting("memory.config", { ...defaultMemoryConfig, checkerModel: false });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const id = addMessage(chatId, "assistant", "The kitchen is cold.", { name: "Buffy" });
  writeEvents(
    chatId,
    { messageId: id, swipeIdx: 0 },
    linesToOps([
      "clock: Day 1 23:00",
      "cast: Buffy@spot · Dawn@spot · Spike@spot",
      "know Dawn: Gabe bought Dawn blue cat socks · knows · true — Buffy told her on the phone",
      "know Spike: Gabriel can read bone structure to tell an era of origin · believes · true — Gabriel said so",
      "know Dawn: Willow bought candles · knows · true — saw the receipt",
      "know Dawn: Xander bought donuts · knows · true — ate one",
      "secret #heaven: Buffy was in heaven, not hell | kept by Buffy · from Dawn",
    ]).ops,
    "model",
  );
  addMessage(chatId, "user", SOCKS);
});
afterAll(() => pauseJobs(false));

describe("checkPlan (2.1)", () => {
  test("#323: she was told about the socks on the call, and the plan says she doesn't know", () => {
    const f = checkPlan(state(), PLAN("Dawn doesn't know Buffy picked the socks or told Gabriel her eye color. Buffy knows she told him."), SOCKS);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ who: "Dawn", says: "unaware", fact: "Gabe bought Dawn blue cat socks", status: "knows", route: "Buffy told her on the phone", strong: false });
    expect(planCorrection(f)).toContain("Write Dawn as knowing that much; anything beyond it is the plan's call.");
  });

  test("a word in common isn't enough when the beat is about something else", () => {
    expect(checkPlan(state(), PLAN("Spike doesn't know the socks' origin."), SOCKS)).toEqual([]);
  });

  test("a plan that says she knows a secret kept from her: she can't act on it", () => {
    const f = checkPlan(state(), PLAN("Dawn knows Buffy was in heaven, not hell."), SOCKS);
    expect(f[0]).toMatchObject({ who: "Dawn", says: "knows", status: "unaware", strong: true });
    expect(planCorrection(f)).toContain("Dawn can't act on it in this reply.");
  });

  test("each claim stops at the next one: knowing she's alive isn't knowing about heaven", () => {
    expect(checkPlan(state(), PLAN("Dawn knows Buffy is alive · Dawn does NOT know Buffy was in heaven."), SOCKS)).toEqual([]);
    expect(checkPlan(state(), PLAN("Dawn knows the socks are blue, doesn't know about heaven."), SOCKS)).toEqual([]);
  });

  test("a plan that agrees with the records, or has no KNOW step about anyone: nothing", () => {
    expect(checkPlan(state(), PLAN("Dawn knows Gabe bought her the socks. Nobody knows Buffy was in heaven."), SOCKS)).toEqual([]);
    expect(checkPlan(state(), "NOW — the kitchen.\nMOVE — she takes them.", SOCKS)).toEqual([]);
  });
});

describe("the writer gets the correction (2.2)", () => {
  test("a separate planner's plan that contradicts the records carries a [PLAN CORRECTION] for the writer", async () => {
    updateChat(chatId, { settings: { planning: "planner" } });
    const history = historyForPrompt(chatId);
    expect(editPlan(chatId, "none", PLAN("Dawn doesn't know Buffy picked the socks."), turnKey(history))).toBe(true);
    const p = await previewPrompt(chatId);
    const adv = p.trace.blocks.find((b) => b.id === "extra:advisor");
    expect(adv?.text).toContain("<director-plan>");
    expect(adv?.text).toContain("[PLAN CORRECTION");
    expect(adv?.text).toContain("Dawn knows: Gabe bought Dawn blue cat socks (Buffy told her on the phone");
  });
});

describe("a flagged leak holds what it let out (2.3)", () => {
  test("the reply's own ledger can't teach her the secret until the flag is dismissed", () => {
    const id = addMessage(chatId, "assistant", "“You were in heaven,” Dawn says.", { name: "Buffy" });
    writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(["know Dawn: Buffy was in heaven, not hell · knows · true — guessed it"]).ops, "model");
    const fid = newId();
    run(
      "INSERT INTO continuity_flags (id, chat_id, message_id, swipe_idx, issues, status, created_at, updated_at) VALUES (?, ?, ?, 0, ?, 'open', ?, ?)",
      fid,
      chatId,
      id,
      JSON.stringify([{ id: "1", kind: "leak", severity: "major", claim: "“You were in heaven,” Dawn says.", conflict: "", citations: [], fix: "Dawn doesn't know: Buffy was in heaven, not hell", by: "rules" }]),
      now(),
      now(),
    );
    // A flag written straight to the table: the next change through the checker folds again.
    expect(flagsFor(chatId, { open: true })).toHaveLength(1);
    dismissIssue(fid, "2");
    const dawn = Object.values(state().chars).find((c) => c.name === "Dawn")!.id;
    expect(state().facts.heaven!.stances[dawn]?.status).toBe("unaware");
    expect(Object.values(currentFold(chatId).result.verdicts).some((v) => v.reason?.startsWith("held:"))).toBe(true);
    dismissIssue(fid, "1");
    expect(state().facts.heaven!.stances[dawn]?.status).toBe("knows");
  });
});
