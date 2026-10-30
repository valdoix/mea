import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { newId, now, run } from "../src/db/db";
import { defaultMemoryConfig } from "../src/lib/settings";
import { afterStory, telescope } from "../src/memory/context";
import { TimeIndex } from "../src/memory/format";
import { doneMatcher, doneRecords, openAsOf } from "../src/memory/openlist";
import { recall } from "../src/memory/recall";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, historyForPrompt } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { advisorInput, steerFor } from "../src/steer/advisor";
import { pendingDone, planCorrection } from "../src/steer/plancheck";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/**
 * What a summary left open was open then. In Filed Under Stay the Story So Far stopped at #532 with
 * the "I love you" "still unsaid, due tonight"; Buffy said it at #542, and at #629 the plan set it
 * for that night. These are its words.
 */
const OPEN = "Buffy's promised 'I love you' — 'the whole word. No takebacks' — still unsaid, due tonight after Dawn sleeps";
const CLOSED = "Buffy's promise to say 'I love you' tonight, face to face, eyes open, no takebacks — fulfilled";
const THREE = "The countdown to the three words — both said them";
const MOVE = "Dawn's final yes/no on the move — she chose 'maybe' and the reading-nook room";

let chatId = "";
const state = () => currentFold(chatId).result.state;
const add = (level: string, start: number, end: number, content: string, data: Record<string, unknown> = {}, title = "t") =>
  run("INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, data, state, story_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'ready', ?, ?, ?)", newId(), chatId, level, start, end, title, content, JSON.stringify(data), level === "story" ? "through Thursday evening" : null, now(), now());

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "accuracy.check", "tracker.update", "lessons.learn", "offpage.reword"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "Tacos are done.", { name: "Buffy" });
  writeEvents(chatId, { messageId: first, swipeIdx: 0 }, linesToOps(["clock: Day 1 19:00", "cast: Buffy@spot · Dawn@spot", "promise Buffy → Dawn: tacos every Friday", "promise Buffy → Dawn: offer him the hills house"]).ops, "model");
  for (let i = 0; i < 20; i++) addMessage(chatId, i % 2 ? "assistant" : "user", `Message ${i}.`, i % 2 ? { name: "Buffy" } : {});
  const keep = addMessage(chatId, "assistant", "She says it.", { name: "Buffy" });
  writeEvents(chatId, { messageId: keep, swipeIdx: 0 }, linesToOps(["promise Buffy → Dawn: offer him the hills house | kept"]).ops, "model");
  addMessage(chatId, "user", "Dinner?");
  add("story", 1, 5, `Buffy and Gabriel grew close.\nStill open: ${OPEN}; ${MOVE}`, { openThreads: [OPEN, MOVE] });
  add("chapter", 6, 12, "Buffy said the three words to him.\nStill open: Hardware store on Friday", { openThreads: ["Hardware store on Friday"] }, "The Whole Word");
  add("scene", 6, 9, "She said it.\nLeft open: Hardware store on Friday", { threadsClosed: [CLOSED, THREE], threadsOpened: ["Hardware store on Friday"] });
  add("scene", 10, 12, "They slept.", { threadsClosed: ["The static is gone"] });
  add("scene", 13, 15, "Morning.");
});
afterAll(() => pauseJobs(false));

describe("an open list reads as of its record", () => {
  const list = (text: string) => {
    const done = doneRecords(chatId, state());
    return openAsOf(text, 5, done, doneMatcher(state(), done));
  };

  test("what a later scene closed comes off it and is said to be done, and the rest stays", () => {
    const text = list(`The story.\nStill open: ${OPEN}; ${MOVE}`);
    expect(text).not.toContain("still unsaid");
    expect(text).toContain(`Still open as of #5: ${MOVE}`);
    expect(text).toContain(`Done since: ${CLOSED} (#9)`);
  });

  test("nothing closed after the record: an open list only says when it's from", () => {
    const done = doneRecords(chatId, state());
    expect(openAsOf(`x\nStill open: ${OPEN}`, 9, done, doneMatcher(state(), done))).toBe(`x\nStill open as of #9: ${OPEN}`);
  });

  test("a list with everything closed goes, and a record with no list is left alone", () => {
    expect(list(`The story.\nStill open: ${OPEN}`)).toBe(`The story.\nDone since: ${CLOSED} (#9)`);
    expect(list("The story.")).toBe("The story.");
  });

  test("groceries meet grocery", () => {
    const done = [{ text: "The grocery portion of the Thursday list — completed", seq: 9 }];
    expect(doneMatcher(state(), done)("Grocery shopping trip planned — the Thursday list", 5)?.seq).toBe(9);
    expect(doneMatcher(state(), done)("Thursday's list: groceries and a toaster", 5)?.seq).toBe(9);
  });

  test("a kept promise's few words don't close a thread that only shares them", () => {
    const done = doneRecords(chatId, state());
    const kept = done.find((d) => d.text.startsWith("Promise kept"));
    expect(kept).toEqual({ text: "Promise kept: offer him the hills house", seq: expect.any(Number), strict: true });
    expect(doneMatcher(state(), done)("Moving Buffy, Dawn, and Ruth into Gabriel's house in the hills", 1)).toBeNull();
  });

  test("a promise named on both sides takes fewer shared words than two threads that only sound alike", () => {
    const closes = (text: string) => doneMatcher(state(), [{ text, seq: 9 }]);
    expect(closes("Buffy's promise of love, face, eyes, door, kitchen, takebacks")("Buffy's promised love: takebacks, whole, word, sleeps, unsaid", 5)?.seq).toBe(9);
    expect(closes("Buffy's love of face, eyes, door, kitchen, takebacks")("Buffy's love: takebacks, whole, word, sleeps, unsaid", 5)).toBeNull();
  });

  test("two threads that only share a filing word aren't the same thread", () => {
    const done = [{ text: "Buffy's inability to say 'boyfriend' — she said it out loud, the filing system processing", seq: 9 }];
    expect(doneMatcher(state(), done)("Buffy filed Gabriel's chest under S for stay — a new category in the filing system", 5)).toBeNull();
  });
});

describe("the writer", () => {
  test("the telescope says what closed where it closed, each thing once", () => {
    const done = doneRecords(chatId, state());
    const text = telescope(chatId, 15, 100_000, [], done, doneMatcher(state(), done)).text;
    expect(text).not.toContain("still unsaid");
    expect(text).toContain("Closed here: The static is gone");
    expect(text.match(/fulfilled/g)).toHaveLength(1);
  });

  test("without the records it reads as before, but as of its message", () => {
    expect(telescope(chatId, 15, 100_000).text).toContain("Left open as of #9: Hardware store on Friday");
  });

  test("a recalled summary's list goes through the same door", () => {
    const done = doneRecords(chatId, state());
    const r = recall({
      chatId,
      evicted: 15,
      budget: 2000,
      queries: [{ text: "promised still unsaid whole word takebacks hardware store", weight: 1, label: "newest message" }],
      qvecs: [null],
      excludeSummaryIds: new Set(),
      seed: "s",
      cfg: defaultMemoryConfig,
      pov: null,
      present: [],
      mood: null,
      librarian: null,
      times: new TimeIndex(chatId),
      skipCards: new Set(),
      povName: null,
      done,
      doneMatch: doneMatcher(state(), done),
    });
    const text = r.items.filter((i) => i.ownerType === "summary").map((i) => i.content).join("\n");
    expect(text).toContain("as of #");
    expect(text).not.toContain("still unsaid");
    expect(text).not.toMatch(/^(Left|Still) open: /m);
  });
});

describe("the planner", () => {
  test("it reads the records after the Story So Far, chapters first, then the scenes after them", () => {
    const text = afterStory(chatId, 15, 10_000, state());
    expect(text).toContain("### Chapter: The Whole Word (#6–#12)");
    expect(text).toContain("### Scene: t (#13–#15)");
    expect(text).not.toContain("(#6–#9)");
  });

  test("the newest stay when it's over budget, whole", () => {
    const text = afterStory(chatId, 15, 20, state());
    expect(text).toContain("#13–#15");
    expect(text).not.toContain("The Whole Word");
  });

  test("its input has the Story So Far dated, without what's been done, and the chapter that did it", async () => {
    const history = historyForPrompt(chatId);
    const { user } = await advisorInput(chatId, history, undefined, { ...steerFor(chatId), planner: true });
    expect(user).toContain("STORY SO FAR (its latest chapters, through #5, through Thursday evening):");
    expect(user).not.toContain("still unsaid");
    expect(user).toContain(`Done since: ${CLOSED} (#9)`);
    expect(user).toContain("SINCE THEN");
    expect(user).toContain("Buffy said the three words to him.");
    expect(user.indexOf("SINCE THEN")).toBeLessThan(user.indexOf("STORY STATE"));
  });
});

describe("a plan that waits for what's been done", () => {
  test("it's told it's the past (#629's own lines)", () => {
    const found = pendingDone(chatId, state(), "KNOW — Buffy knows tonight holds her promised whole-word 'I love you' after Dawn sleeps · the Friday file: uninvestigated");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ says: "pending", fact: CLOSED, seq: 9 });
    expect(planCorrection(found)).toContain("already done");
    expect(planCorrection(found)).toContain("(#9)");
  });

  test("a line that knows it's past, or doesn't look ahead, is left alone", () => {
    expect(pendingDone(chatId, state(), "KNOW — she already said the whole-word 'I love you' last night")).toEqual([]);
    expect(pendingDone(chatId, state(), "she loves him, the whole word out loud, I love you, after Dawn sleeps")).toEqual([]);
  });

  test("something still open keeps its line", () => {
    expect(pendingDone(chatId, state(), "tacos every Friday, due tonight, Dawn's room")).toEqual([]);
  });
});
