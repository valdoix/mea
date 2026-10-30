import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { factSheet } from "../src/accuracy/checker";
import { normalizeCard } from "../src/cards/card";
import { newId, now, run } from "../src/db/db";
import { countTokens } from "../src/lib/tokens";
import { telescope } from "../src/memory/context";
import { lensOf, summaryText } from "../src/memory/openlist";
import { setMemState } from "../src/memory/store";
import { buildBrief } from "../src/meus/brief";
import { gatherLanes } from "../src/prompt/lanes";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, historyForPrompt, updateChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { advisorInput, steerFor } from "../src/steer/advisor";
import { doneLoops, loopId } from "../src/trackers/loops";
import { stateForModel, updatePrompt } from "../src/trackers/prompts";
import { alreadyHappened, standing } from "../src/trackers/stands";
import { currentFold, foldAt, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/**
 * docs/22 Part 2: only the ledger says what's open. In Filed Under Stay the first "I love you" was at
 * #541, no list in a prompt had it, and the plan for #629 still waited for it.
 */
let charId = "";
const reply = (id: string, text: string) => addMessage(id, "assistant", text, { name: "Buffy" });
const lines = (id: string, messageId: string, ...ls: string[]) => writeEvents(id, { messageId, swipeIdx: 0 }, linesToOps(ls).ops, "model", { replace: ["model"] });
const state = (id: string) => currentFold(id).result.state;
const chat = () => createChat({ characterId: charId }).id;
const scene = (id: string, start: number, end: number, importance: number, moments: { tag: string; text: string; seq: number }[]) =>
  run("INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, data, state, created_at, updated_at) VALUES (?, ?, 'scene', ?, ?, 1, 't', 'Text.', ?, 'ready', ?, ?)", newId(), id, start, end, JSON.stringify({ importance, moments }), now(), now());
/** A chat with a clock and two people. The greeting is #1, so its first message here is #2. */
function story(...more: string[]) {
  const id = chat();
  const first = reply(id, "Friday, she says.");
  lines(id, first, "clock: Day 1 12:00", "cast: Buffy@spot · Gabe@spot", ...more);
  return { id, first };
}

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "accuracy.check", "tracker.update", "lessons.learn", "offpage.reword", "loops.backfill"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
  charId = createCharacter(data);
});
afterAll(() => pauseJobs(false));

describe("where things stand", () => {
  test("it says what's open and what's done, and each is built from the ledger", () => {
    const { id } = story("promise Buffy>Gabe: say the word tonight | open", "promise Buffy>Gabe: buy the groceries | open");
    const m = reply(id, "We bought them.");
    lines(id, m, "promise Buffy>Gabe: buy the groceries | kept");
    const { stands } = standing(id, state(id));
    const [open, done] = [stands.match(/^Open: .*$/m)![0], stands.match(/^Done lately: .*$/m)![0]];
    expect(open).toContain("Buffy: say the word tonight");
    expect(open).not.toContain("groceries");
    expect(done).toBe("Done lately: buy the groceries (#3)");
  });

  test("a stored 'tonight' says which night, and a time reads from now", () => {
    const { id } = story("loop: pick Dawn up tonight | errand", "loop: the bank call | errand [due after the funeral]", "plan Dinner: Day 1 13:00", "plan The mall: Day 3 10:00");
    const later = reply(id, "A day on.");
    lines(id, later, "clock: Day 2 12:00", "plan Lunch: Day 2 12:40");
    const { stands } = standing(id, state(id));
    expect(stands).toContain("pick Dawn up tonight (Day 1)");
    expect(stands).toContain("the bank call (due after the funeral)");
    expect(stands).toContain("Lunch (in 40 min)");
    expect(stands).toContain("Dinner (was due Day 1 13:00)");
    expect(stands).toMatch(/The mall \(due Day 3 10:00\)/);
  });

  test("what's due comes first, then what's being talked about, and the quiet ones fold into a count", () => {
    const quiet = Array.from({ length: 40 }, (_, i) => `loop: ${Array.from({ length: 8 }, (_, k) => `thing${i}x${k}`).join(" ")} | errand`);
    const { id } = story(...quiet, "loop: a talk with Spike about the crypt lease | question", "plan Soon thing: Day 1 18:00");
    const { stands } = standing(id, state(id), "He brought up the crypt lease again.");
    const open = stands.match(/^Open: (.*)$/m)![1]!.split(" · ");
    expect(open[0]).toContain("Soon thing");
    expect(open[1]).toContain("crypt lease");
    expect(open.at(-1)).toMatch(/^and \d+ quieter$/);
    expect(countTokens(stands)).toBeLessThanOrEqual(330);
  });

  test("the same thing worded twice shows once", () => {
    const WORDS = ["Paint for Dawn's room, hardware store", "Paint for Dawn's room, hardware store, on Friday"];
    const { id } = story();
    for (const what of WORDS) {
      lines(id, reply(id, "Soon."), `loop: ${what} | errand`);
      lines(id, reply(id, "Done."), `loop ${loopId(what)}: done — Done`);
    }
    expect(doneLoops(state(id))).toHaveLength(2);
    expect(standing(id, state(id)).stands.match(/^Done lately: (.*)$/m)![1]!.match(/paint/gi)).toHaveLength(1);
  });

  test("something that repeats stays open when it's done again", () => {
    const { id } = story("promise Buffy>Gabe: tacos every Friday | open");
    const m = reply(id, "Tacos.");
    lines(id, m, `loop ${Object.keys(state(id).loops)[0]}: done — Tacos`);
    const { stands } = standing(id, state(id));
    expect(stands).toContain("Open: Buffy: tacos every Friday");
    expect(stands).not.toContain("Done lately");
  });

  test("it follows a swipe: a take that's gone takes its closure with it", () => {
    const { id } = story("promise Buffy>Gabe: say the word tonight | open");
    const m = reply(id, "I love you.");
    lines(id, m, `loop ${Object.keys(state(id).loops)[0]}: done — I love you`);
    expect(standing(id, state(id)).stands).toContain("Done lately");
    const before = foldAt(id, { excludeMessageId: m }).state;
    expect(standing(id, before).stands).not.toContain("Done lately");
    expect(standing(id, before).stands).toContain("Open: Buffy: say the word tonight");
  });

  test("with the trackers off there's nothing to say", () => {
    const { id } = story("promise Buffy>Gabe: say the word tonight | open");
    updateChat(id, { settings: { trackers: { mode: "off" } } });
    expect(standing(id, state(id))).toEqual({ stands: "", happened: "" });
  });
});

describe("the prompts", () => {
  test("the writer gets both as lanes, outside the cached prefix", () => {
    const { id } = story("promise Buffy>Gabe: say the word tonight | open", "milestone first kiss — Buffy & Gabe");
    const lanes = gatherLanes({ chatId: id, kind: "story", state: state(id), history: historyForPrompt(id), characterId: charId });
    const stands = lanes.find((l) => l.lane === "stands")!;
    expect(stands.content).toStartWith("[WHERE THINGS STAND]\n");
    expect(stands.prefix).toBeUndefined();
    expect(lanes.find((l) => l.lane === "happened")!.content).toContain("first kiss (#2)");
  });

  test("the planner reads them once, in their own place", async () => {
    const { id } = story("promise Buffy>Gabe: say the word tonight | open", "milestone first kiss — Buffy & Gabe");
    const { user } = await advisorInput(id, historyForPrompt(id), undefined, { ...steerFor(id), planner: true });
    expect(user.match(/WHERE THINGS STAND/g)).toHaveLength(1);
    expect(user.match(/ALREADY HAPPENED/g)).toHaveLength(1);
  });

  test("Meus's brief and the checker's facts have what's done", () => {
    const { id } = story("promise Buffy>Gabe: buy the groceries | open", "milestone first kiss — Buffy & Gabe");
    const m = reply(id, "We bought them.");
    lines(id, m, "promise Buffy>Gabe: buy the groceries | kept");
    expect(buildBrief(id).text).toContain("WHERE THINGS STAND");
    const sheet = factSheet(id, "Then groceries.", state(id), 4);
    expect(sheet.lines).toContain("[D1] Already happened: first kiss (#2)");
    expect(sheet.lines).toContain("[D2] Done: buy the groceries (#3)");
    expect(sheet.cites.get("D1")?.seq).toBe(2);
  });
});

describe("a summary stops saying what's open", () => {
  const record = { content: "They grew close.\nStill open: the move to the house; Spike's answer", level: "story" as const, start_seq: 1, end_seq: 5 };
  const reads = (id: string) => summaryText(record, lensOf(id, state(id)));

  test("once the backfill is approved", () => {
    const { id } = story();
    setMemState(id, { loopBackfill: { state: "done", at: 1, closed: [], open: [] } });
    expect(reads(id)).toBe("They grew close.");
    expect(summaryText({ ...record, content: "Left open: only this" }, lensOf(id, state(id)))).toBe("");
  });

  test("not before, and not if you said no: then the old rules hold", () => {
    const { id } = story();
    expect(reads(id)).toContain("Still open as of #5: the move to the house");
    setMemState(id, { loopBackfill: { state: "review", at: 1, closed: [], open: [] } });
    expect(reads(id)).toContain("Still open as of #5");
    setMemState(id, { loopBackfill: { state: "declined", at: 1, closed: [], open: [] } });
    expect(reads(id)).toContain("Still open as of #5");
  });

  test("not with the trackers off: nothing else would say", () => {
    const { id } = story();
    setMemState(id, { loopBackfill: { state: "done", at: 1, closed: [], open: [] } });
    updateChat(id, { settings: { trackers: { mode: "off" } } });
    expect(reads(id)).toContain("Still open as of #5");
  });

  test("what closed in a scene stays: that's history", () => {
    const { id } = story();
    setMemState(id, { loopBackfill: { state: "done", at: 1, closed: [], open: [] } });
    run("INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, data, state, created_at, updated_at) VALUES (?, ?, 'scene', 1, 1, 1, 't', ?, ?, 'ready', ?, ?)", newId(), id, "She said it.\nLeft open: the bank", JSON.stringify({ threadsClosed: ["The three words, said"] }), now(), now());
    const text = telescope(id, 1, 100_000, [], lensOf(id, state(id))).text;
    expect(text).toContain("She said it.\nClosed here: The three words, said");
    expect(text).not.toContain("the bank");
  });
});

describe("already happened", () => {
  test("the first 'I love you' is there from a scene's moment, whatever the tracker missed", () => {
    const { id } = story("milestone Buffy realizes she is in love with Gabriel — Buffy");
    scene(id, 2, 9, 10, [{ tag: "confession", text: "Buffy said 'I love you' — 'Load-bearing. Non-negotiable.'", seq: 9 }]);
    expect(alreadyHappened(id, state(id)).map((h) => h.text)).toEqual(["Buffy realizes she is in love with Gabriel", "Buffy said 'I love you'"]);
  });

  test("a scene's small moments stay out, and so does a turning point short of the top", () => {
    const { id } = story();
    scene(id, 1, 1, 9, [{ tag: "turning point", text: "She laughed.", seq: 1 }, { tag: "promise", text: "He promised.", seq: 1 }]);
    scene(id, 2, 2, 7, [{ tag: "confession", text: "A small confession.", seq: 2 }]);
    scene(id, 3, 3, 10, [{ tag: "turning_point", text: "She chose him.", seq: 3 }]);
    expect(alreadyHappened(id, state(id)).map((h) => h.text)).toEqual(["She chose him."]);
  });

  test("the ladder gives one line for two people, at the rung they reached", () => {
    const { id, first } = story();
    writeEvents(id, { messageId: first, swipeIdx: -1 }, linesToOps(["ladder Buffy>Gabe: 6 — together", "ladder Gabe>Buffy: 5 — said so", "ladder Buffy>Spike: 2 — noticed"]).ops, "user");
    expect(alreadyHappened(id, state(id)).map((h) => h.text)).toEqual(["Buffy and Gabe: Together"]);
  });

  test("a vital promise kept is there, and an ordinary one isn't", () => {
    const { id } = story("promise Buffy>Gabe: tell Dawn about the two of them | vital", "promise Buffy>Gabe: pick up the milk");
    lines(id, reply(id, "Done, both."), "promise Buffy>Gabe: tell Dawn about the two of them | kept", "promise Buffy>Gabe: pick up the milk | kept");
    expect(alreadyHappened(id, state(id)).map((h) => h.text)).toEqual(["Kept: tell Dawn about the two of them"]);
  });

  test("a thing told twice keeps its first telling", () => {
    const { id } = story("milestone first time making love — Buffy & Gabe");
    scene(id, 1, 1, 10, [{ tag: "confession", text: "First time making love.", seq: 9 }]);
    expect(alreadyHappened(id, state(id))).toEqual([{ text: "first time making love", seq: 2 }]);
  });

  test("a cut never lands inside a quote", () => {
    const { id } = story();
    scene(id, 1, 1, 10, [{ tag: "confession", text: "Buffy said, 'I love you — I do'", seq: 1 }]);
    expect(alreadyHappened(id, state(id))[0]!.text).toBe("Buffy said, 'I love you — I do'");
  });

  test("capped, and what says it's a first outlasts the rest", () => {
    const fill = Array.from({ length: 40 }, (_, i) => `milestone ${["ivory", "cobalt", "amber", "scarlet", "olive", "indigo", "teal", "umber"][i % 8]} lantern number ${i} lit — Buffy`);
    const { id } = story(...fill);
    const end = reply(id, "She says it.");
    lines(id, end, "milestone the first time she said it out loud — Buffy");
    const list = alreadyHappened(id, state(id));
    expect(list.length).toBeLessThanOrEqual(20);
    expect(list.map((h) => h.text)).toContain("the first time she said it out loud");
    expect(countTokens(list.map((h) => `${h.text} (#${h.seq})`).join(" · "))).toBeLessThanOrEqual(260);
  });

  test("the tracker is asked for firsts, and can see the ones it has", () => {
    const { id } = story("milestone first kiss — Buffy & Gabe");
    const prompt = updatePrompt({ state: "", messages: "", userName: "Gabe", charName: "Buffy", sealed: true, romance: "slow" });
    expect(prompt.system).toContain('the first "I love you"');
    expect(stateForModel(state(id), { userName: "Gabe", templates: [], sealed: true })).toContain("milestone first kiss");
  });
});
