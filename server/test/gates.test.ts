import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkReply, dismissIssue, flagsFor } from "../src/accuracy/checker";
import { correctionLine, correctionsLane, correctMemory } from "../src/accuracy/corrections";
import { doneAhead, findOutdated } from "../src/accuracy/promptcheck";
import { undoneRule } from "../src/accuracy/undone";
import { normalizeCard } from "../src/cards/card";
import { one, parseJson, run } from "../src/db/db";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, historyForPrompt, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { advisorExtra, advisorInput, editPlan, planFor, planSchema, steerFor, turnKey } from "../src/steer/advisor";
import { ledgerThreads, pendingDone } from "../src/steer/plancheck";
import { loopId } from "../src/trackers/loops";
import { standing } from "../src/trackers/stands";
import { currentFold, foldAt, linesToOps, writeEvents } from "../src/trackers/store";
import type { Op } from "../src/trackers/types";
import { freshDb } from "./helpers";

/**
 * docs/22 Part 3. In Filed Under Stay the groceries were bought at #462. #599 still said "Then
 * groceries", and #629 "the grocery run", which the tracker filed as a plan. These are its words.
 */
const WORDINGS = ["The Thursday list: groceries, then tacos", "We'll buy you groceries tomorrow", "the grocery run for the house"];
const DONE = "The grocery portion of the Thursday list — completed";
const SAID = "Buffy's promise to say the whole word tonight, eyes open, no takebacks";

let charId = "";
const reply = (id: string, text: string) => addMessage(id, "assistant", text, { name: "Buffy" });
const lines = (id: string, messageId: string, ...ls: string[]) => writeEvents(id, { messageId, swipeIdx: 0 }, linesToOps(ls).ops, "model");
const state = (id: string) => currentFold(id).result.state;
const closed = (what: string, from: string[]): Op => ({ op: "loop", args: { action: "new", what, kind: "errand", from, done: true, how: what }, raw: `loop: ${what}` });
/** A chat where the groceries are done and the three words are said. */
function story() {
  const id = createChat({ characterId: charId }).id;
  const first = reply(id, "Friday, she says.");
  lines(id, first, "clock: Day 1 12:00", "cast: Buffy@spot · Gabe@spot");
  const done = reply(id, "Bought.");
  writeEvents(id, { messageId: done, swipeIdx: -1 }, [closed(DONE, WORDINGS), closed(SAID, [SAID, "say the whole word tonight"])], "user");
  return { id, done };
}

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "accuracy.check", "tracker.update", "lessons.learn", "offpage.reword", "loops.backfill"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 12000, max_tokens: 300 } });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
  charId = createCharacter(data);
});
afterAll(() => pauseJobs(false));

describe("what looks ahead at something done", () => {
  test("a reply's list says one word: the to-do around it is enough", () => {
    const ahead = doneAhead(state(story().id), { lists: true });
    expect(ahead("Then groceries.")?.what).toBe(DONE);
    expect(ahead("He needs cilantro — the grocery run is a two-person operation")?.what).toBe(DONE);
  });

  test("sharing a word isn't a to-do", () => {
    const ahead = doneAhead(state(story().id), { lists: true });
    expect(ahead("And the groceries wait in the fridge, patient, ready.")).toBeNull();
    expect(ahead("The groceries she bought still sat on the counter.")).toBeNull();
  });

  test("a line that knows it's past is left alone", () => {
    expect(doneAhead(state(story().id), { lists: true })("Then groceries again, since the fridge is empty.")).toBeNull();
  });

  test("something worded once has nothing to go by", () => {
    const { id, done } = story();
    writeEvents(id, { messageId: done, swipeIdx: -1 }, [closed("clothes outside the guest-room door", [])], "user");
    expect(doneAhead(state(id), { lists: true })("She needs clothes.")).toBeNull();
  });

  test("an open loop with the same word keeps it", () => {
    const { id, done } = story();
    lines(id, done, "loop: grocery delivery for Spike | errand");
    expect(doneAhead(state(id), { lists: true })("Then groceries.")).toBeNull();
  });

  test("a loop that repeats is never done", () => {
    const { id, done } = story();
    lines(id, done, "promise Buffy>Gabe: tacos every Friday | open");
    const l = loopId("tacos every Friday");
    lines(id, reply(id, "Tacos."), `loop ${l}: done — Tacos`);
    expect(doneAhead(state(id), { lists: true })("Then tacos every Friday, tonight.")).toBeNull();
  });
});

describe("the prompt lint", () => {
  const says = (id: string, text: string, where = "Story So Far") => findOutdated(state(id), [{ where, text }]).filter((f) => f.kind === "done");

  test("a line that repeats a wording of a done loop is caught, wherever it is", () => {
    const { id } = story();
    const [f] = says(id, "She's telling him tonight, say the whole word, eyes open, no takebacks.", "lore");
    expect(f).toMatchObject({ kind: "done", where: "lore", ref: loopId(SAID) });
    expect(correctionLine(f!)).toContain("that's over. Already happened:");
    expect(correctionLine(f!)).not.toContain("written before");
  });

  test("it goes in the corrections lane for the card, and under the block for memory", () => {
    const { id } = story();
    const text = "She'll say the whole word tonight, eyes open, no takebacks.";
    expect(correctionsLane(state(id), [{ where: "card", text }]).extra?.content).toContain("that's over");
    expect(correctMemory(state(id), text, "recalled memories").text).toContain("### Out of date");
  });

  test("a timeless line with a to-do's shape is left alone", () => {
    expect(says(story().id, "He meets it: a sandwich, then groceries, whatever someone needs.", "persona")).toEqual([]);
  });

  test("what already says it's closed isn't caught", () => {
    expect(says(story().id, `Closed here: ${SAID}, due tonight`)).toEqual([]);
  });

  test("a rewind past it takes the correction away", () => {
    const { id, done } = story();
    expect(findOutdated(foldAt(id, { excludeMessageId: done }).state, [{ where: "lore", text: "She'll say the whole word tonight, eyes open, no takebacks." }])).toEqual([]);
  });

  test("the planner's records are read through it", async () => {
    const { id } = story();
    run("INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, data, state, created_at, updated_at) VALUES ('s', ?, 'story', 1, 1, 1, 't', ?, '{}', 'ready', 1, 1)", id, "She'll say the whole word tonight, eyes open, no takebacks.");
    const { user } = await advisorInput(id, historyForPrompt(id), undefined, steerFor(id));
    expect(user).toContain("### Out of date in the records above");
    run("DELETE FROM summaries WHERE id = 's'");
  });
});

describe("a plan that waits for something done", () => {
  const STALE = "NOW — the kitchen.\nMOVE — then groceries.\nVOICE — short.";
  const planned = (id: string, pass = STALE) => {
    updateChat(id, { settings: { planning: "planner" } });
    const key = turnKey(historyForPrompt(id));
    run("INSERT INTO advisor_plans (id, chat_id, key, plan, created_at) VALUES (?, ?, ?, ?, 1)", `p${id}`, id, key, JSON.stringify(planSchema.parse({ pass })));
    return key;
  };
  const prepared = (id: string) => advisorExtra(id, historyForPrompt(id), { wait: true, state: state(id) });
  const calls = (id: string) => one<{ n: number }>("SELECT COUNT(*) AS n FROM generations WHERE chat_id = ? AND kind = 'planner:replan'", id)?.n ?? 0;

  test("the plan check sees the to-do too", () => {
    const { id } = story();
    expect(pendingDone(id, state(id), STALE)[0]).toMatchObject({ says: "pending", fact: DONE });
  });

  test("it gets one more try, and the new plan stands", async () => {
    const { id } = story();
    const key = planned(id);
    const extra = await prepared(id);
    expect(extra?.pass).toContain("the lamp room");
    expect(calls(id)).toBe(1);
    expect(planFor(id, key)).toMatchObject({ replanned: true });
    await prepared(id);
    expect(calls(id)).toBe(1);
  });

  test("a retry that still waits for it leaves the first plan, once", async () => {
    const { id } = story();
    reply(id, "MOCK_PLANNER_WAITS");
    planned(id);
    const extra = await prepared(id);
    expect(extra?.pass).toBe(STALE);
    expect(calls(id)).toBe(1);
    await prepared(id);
    expect(calls(id)).toBe(1);
  });

  test("a retry that fails leaves the first plan", async () => {
    const { id } = story();
    reply(id, "MOCK_PLANNER_FAIL");
    planned(id);
    expect((await prepared(id))?.pass).toBe(STALE);
  });

  test("no call when nothing's wrong, and none for a preview or your own edit", async () => {
    const clean = story();
    planned(clean.id, "NOW — the kitchen.\nMOVE — she answers.\nVOICE — short.");
    await prepared(clean.id);
    expect(calls(clean.id)).toBe(0);

    const preview = story();
    planned(preview.id);
    await advisorExtra(preview.id, historyForPrompt(preview.id), { wait: false, state: state(preview.id) });
    expect(calls(preview.id)).toBe(0);

    const edited = story();
    const key = planned(edited.id);
    run("DELETE FROM advisor_plans WHERE chat_id = ?", edited.id);
    editPlan(edited.id, "none", STALE, key);
    expect((await prepared(edited.id))?.pass).toBe(STALE);
    expect(calls(edited.id)).toBe(0);
  });
});

describe("a plan's threads", () => {
  test("an open loop's id reads as the loop, a title stays, and the rest goes", () => {
    const { id, done } = story();
    lines(id, done, "loop: Spike's answer about the crypt | question", "thread The move: new — Dawn's vote");
    const open = loopId("Spike's answer about the crypt");
    const closedId = loopId(DONE);
    expect(ledgerThreads(state(id), [open, `${open}: Spike`, "the move", closedId, "Something the plan made up"])).toEqual(["Spike's answer about the crypt", "Spike's answer about the crypt", "the move"]);
  });

  test("the planner sees ids, and the writer doesn't", async () => {
    const { id, done } = story();
    lines(id, done, "loop: Spike's answer about the crypt | question");
    const l = loopId("Spike's answer about the crypt");
    const { user } = await advisorInput(id, historyForPrompt(id), undefined, { ...steerFor(id), planner: true });
    expect(user).toContain(`Spike's answer about the crypt (${l})`);
    expect(standing(id, state(id)).stands).not.toContain(l);
  });
});

describe("a reply that reopens what's closed", () => {
  test("it's flagged with the message it closed at, and offers the fix", async () => {
    const { id } = story();
    const m = reply(id, "“Come on. Ice first. Then groceries. Then Dawn.”");
    const [flag] = (await checkReply(id, m, 0, { model: false })) ?? [];
    expect(flag).toMatchObject({ kind: "undone", by: "rules", claim: "Then groceries." });
    expect(flag!.conflict).toContain(`at #3: ${DONE}`);
    expect(flag!.citations[0]).toMatchObject({ id: loopId(DONE), seq: 3 });
    expect(flag!.fix).toContain("nobody waits for it");
  });

  test("what it filed about that waits for the flag, and the rest stands", async () => {
    const { id } = story();
    const m = reply(id, "“Then groceries.”");
    await checkReply(id, m, 0, { model: false });
    lines(id, m, "plan grocery run: Day 2 10:00", "plan Paint at the hardware store: Day 2 12:00", "promise Buffy>Gabe: another grocery run | open", "loop: grocery run with Dawn | errand");
    const titles = () => Object.values(state(id).calendar).map((e) => e.title);
    expect(titles()).toEqual(["Paint at the hardware store"]);
    expect(Object.values(state(id).obligations)).toEqual([]);
    expect(Object.values(currentFold(id).result.verdicts).filter((v) => v.reason?.startsWith("held:"))).toHaveLength(3);
    const f = flagsFor(id, { open: true })[0]!;
    dismissIssue(f.id, f.issues[0]!.id);
    expect(titles()).toContain("grocery run");
    expect(Object.values(state(id).obligations)).toHaveLength(1);
  });

  test("your own lines never wait", async () => {
    const { id } = story();
    const m = reply(id, "“Then groceries.”");
    await checkReply(id, m, 0, { model: false });
    writeEvents(id, { messageId: m, swipeIdx: -1 }, linesToOps(["plan grocery run: Day 2 10:00"]).ops, "user");
    expect(Object.values(state(id).calendar).map((e) => e.title)).toEqual(["grocery run"]);
  });

  test("dismissing it says the story meant to: no flag again", async () => {
    const { id } = story();
    const m = reply(id, "“Then groceries.”");
    await checkReply(id, m, 0, { model: false });
    const f = flagsFor(id, { open: true })[0]!;
    dismissIssue(f.id, f.issues[0]!.id);
    const next = reply(id, "“Then groceries, like every week.”");
    expect((await checkReply(id, next, 0, { model: false }))?.filter((i) => i.kind === "undone")).toEqual([]);
    expect(undoneRule(id, "Then groceries.", state(id))).toEqual([]);
  });

  test("the fold before the reply decides, so a reply that closes it isn't flagged", async () => {
    const { id, done } = story();
    lines(id, done, "loop: pick up the dry cleaning for Dawn | errand", "loop: pick up the dry cleaning, Dawn's dress | errand");
    const m = reply(id, "“Then dry cleaning.”");
    lines(id, m, `loop ${loopId("pick up the dry cleaning for Dawn")}: done — Then dry cleaning`);
    expect((await checkReply(id, m, 0, { model: false }))?.filter((i) => i.kind === "undone")).toEqual([]);
  });

  test("a stored flag names its loop, so nothing has to match it again", async () => {
    const { id } = story();
    const m = reply(id, "“Then groceries.”");
    await checkReply(id, m, 0, { model: false });
    const row = one<{ issues: string }>("SELECT issues FROM continuity_flags WHERE message_id = ?", m)!;
    expect(parseJson<{ citations: { id: string }[] }[]>(row.issues, [])[0]!.citations[0]!.id).toBe(loopId(DONE));
  });
});
