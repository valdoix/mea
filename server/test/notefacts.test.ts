import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { parseJson } from "../src/db/db";
import { setSetting, defaultMemoryConfig } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, mustChat, type ChatSettings } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { filingsFor, undoFiling } from "../src/services/filings";
import { previewPrompt } from "../src/services/generation";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { addLesson, getLesson } from "../src/steer/lessons";
import { clausesOf, fileNoteFacts, lessonsToFacts, readNote } from "../src/steer/notefacts";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** docs/19 Part 5: a note that states a fact becomes a record, and a lesson that states knowledge becomes a stance. */
let chatId = "";
let replyId = "";
const state = () => currentFold(chatId).result.state;
const stance = (who: string, words: RegExp) => {
  const st = state();
  const fact = Object.values(st.facts).find((f) => words.test(f.statement));
  const id = Object.entries(st.chars).find(([, c]) => c.name === who)?.[0];
  return fact && id ? fact.stances[id] : undefined;
};
const prompt = async () => (await previewPrompt(chatId)).messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");

// The eight notes from Pretty Hands and Proving It that fixed state, not style.
const NOTES = [
  "buffy doesn't know that giles has left",
  "she doesn't know that he worked as a lifeguard and a barista",
  "Buffy doesn't know those details about him",
  "she already washed her mouth and used the toothbrush",
  "buffy's nails have been cleaned by gabriel yesterday, and she just took a bath",
  "the phone call is already ongoing",
  "gabriel didn't say that buffy is his girlfriend - he thinks it, but doesn't say it",
  "Gabriel bought the socks with Buffy - she's the one who told him Dawn's eyes color",
];

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
  const first = addMessage(chatId, "assistant", "The kitchen is cold.", { name: "Buffy" });
  writeEvents(chatId, { messageId: first, swipeIdx: 0 }, linesToOps(["clock: Day 1 23:00", "cast: Buffy@spot · Dawn@spot · Gabriel@spot"]).ops, "model");
  addMessage(chatId, "user", "I hand Dawn the socks.");
  replyId = addMessage(chatId, "assistant", "Buffy blinks at the socks.", { name: "Buffy" });
});
afterAll(() => pauseJobs(false));

describe("reading a note (5.1)", () => {
  test("clauses split at sentences, dashes and semicolons", () => {
    expect(clausesOf(NOTES[7]!)).toEqual(["Gabriel bought the socks with Buffy", "she's the one who told him Dawn's eyes color"]);
  });

  test("rules read what names its people, and leave the rest to the helper", () => {
    const st = state();
    expect(readNote(st, NOTES[0]!).facts).toEqual([{ kind: "know", who: "Buffy", status: "unaware", fact: "Giles has left", label: "Buffy doesn't know: Giles has left" }]);
    expect(readNote(st, NOTES[1]!)).toEqual({ facts: [], unsure: [NOTES[1]!] });
    const socks = readNote(st, NOTES[7]!);
    expect(socks.facts.map((f) => f.text)).toEqual(["Gabriel bought the socks with Buffy"]);
    expect(socks.unsure).toEqual(["she's the one who told him Dawn's eyes color"]);
  });

  test("style and this reply's moment are never touched", () => {
    const st = state();
    for (const n of ["make it warmer", "Slower, more of her hands", NOTES[5]!, NOTES[6]!]) expect(readNote(st, n)).toEqual({ facts: [], unsure: [] });
  });
});

describe("the eight notes (5.1, golden 18)", () => {
  test("each note that states a lasting fact leaves a record", async () => {
    const saved: string[] = [];
    for (const n of NOTES) saved.push(...(await fileNoteFacts(chatId, replyId, n)).map((f) => f.label));
    expect(saved).toEqual([
      "Saved: Buffy doesn't know: Giles has left",
      "Saved: Buffy doesn't know: Gabriel worked as a lifeguard and a barista",
      "Saved: Buffy already washed her mouth and used the toothbrush",
      "Saved: Buffy's nails have been cleaned by gabriel yesterday, and Buffy just took a bath",
      "Saved: Gabriel bought the socks with Buffy",
      "Saved: Buffy is the one who told Gabriel Dawn's eyes color",
    ]);
    expect(stance("Buffy", /Giles has left/)?.status).toBe("unaware");
    expect(stance("Buffy", /lifeguard/)?.status).toBe("unaware");
    expect(parseJson<ChatSettings>(mustChat(chatId).settings, {}).truths).toContain("Gabriel bought the socks with Buffy");
  });

  test("the next reply holds it", async () => {
    const p = await prompt();
    expect(p).toContain("Giles has left");
    expect(p).toContain("Gabriel bought the socks with Buffy");
  });

  test("the same note isn't saved twice", async () => {
    expect(await fileNoteFacts(chatId, replyId, NOTES[0]!)).toEqual([]);
  });

  test("\"That's only for this reply\" takes it back and it stays taken back", async () => {
    const f = filingsFor(chatId).find((x) => x.label === "Saved: Gabriel bought the socks with Buffy")!;
    undoFiling(f.id, "notMeant");
    expect(parseJson<ChatSettings>(mustChat(chatId).settings, {}).truths ?? []).not.toContain("Gabriel bought the socks with Buffy");
    expect(await fileNoteFacts(chatId, replyId, "Gabriel bought the socks with Buffy")).toEqual([]);
    const g = filingsFor(chatId).find((x) => x.label === "Saved: Buffy doesn't know: Giles has left")!;
    undoFiling(g.id);
    expect(stance("Buffy", /Giles has left/)).toBeUndefined();
  });
});

describe("lessons that are facts (5.2)", () => {
  test("a knowledge lesson becomes a stance; a style lesson stays", () => {
    const heaven = addLesson(chatId, { text: "Dawn doesn't know that Buffy was in heaven, and must not act as if they do.", messageId: replyId });
    const style = addLesson(chatId, { text: "Keep replies short: about 150 words." });
    const moved = lessonsToFacts(chatId);
    expect(moved.map((f) => f.label)).toEqual(["Now a record: Dawn doesn't know: Buffy was in heaven"]);
    expect(getLesson(heaven.id)?.status).toBe("off");
    expect(getLesson(style.id)?.status).toBe("kept");
    expect(stance("Dawn", /Buffy was in heaven/)?.status).toBe("unaware");
    expect(lessonsToFacts(chatId)).toEqual([]);
  });

  test("Keep as a lesson puts it back and drops the stance", () => {
    const f = filingsFor(chatId).find((x) => x.kind === "lesson-fact")!;
    undoFiling(f.id, "notMeant");
    expect(getLesson(String(f.data.lesson))?.status).toBe("kept");
    expect(stance("Dawn", /Buffy was in heaven/)).toBeUndefined();
    // and it isn't moved again
    expect(lessonsToFacts(chatId)).toEqual([]);
  });
});
