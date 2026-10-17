import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { gradeSlot, runQuiz, slotQuestions } from "../src/accuracy/quiz";
import { chronicleBook } from "../src/lore/chronicle";
import { canonEntryFor } from "../src/lore/coverage";
import { createFact, factsNow, overrideFact, promoteFact } from "../src/lore/facts";
import { runKeepup, updateProposals } from "../src/lore/keepup";
import { createEntry, createLorebook } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { createPersona } from "../src/services/personas";
import { registerJob } from "../src/services/jobs";
import { restoreStash } from "../src/services/undo";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let characterId = "";
let chatA = "";
let chatB = "";
let wren = "";
let sam = "";
let reply = "";

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "tracker.update", "tracker.init", "lore.keepup", "lore.time", "lore.bond", "lore.compact"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 8000 } });
  const personaId = createPersona({ name: "Sam", data: { description: "A sailor." }, isDefault: true });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Wren", description: "A ferry pilot.", first_mes: "Hi." } });
  characterId = createCharacter(data);
  chatA = createChat({ characterId }).id;
  chatB = createChat({ characterId }).id;
  const companion = createLorebook({ name: "Wren's book", links: [{ target_type: "character", target_id: characterId }] });
  wren = createEntry(companion, defaultEntry({ comment: "Wren", keys: ["Wren"], content: "Wren pilots the ferry.", extra: { type: "character" } })).id;
  const pbook = createLorebook({ name: "Sam's book", links: [{ target_type: "persona", target_id: typeof personaId === "string" ? personaId : (personaId as { id: string }).id }] });
  sam = createEntry(pbook, defaultEntry({ comment: "Sam", keys: ["Sam"], content: "Sam sails.", extra: { type: "character" } })).id;
  addMessage(chatA, "user", "You wave.", { name: "Sam" });
  reply = addMessage(chatA, "assistant", "Wren refuses to swim.", { name: "Wren" });
  createFact(wren, { value: "grey", slot: "eyes", origin: "card" });
});

describe("8.1 make it canon / only in this chat", () => {
  test("a story fact in the Chronicle made canon moves to the companion book and shows in a new chat", () => {
    const chron = createEntry(chronicleBook(chatA), defaultEntry({ comment: "Wren", keys: ["Wren"], content: "Wren in this story." })).id;
    const f = createFact(chron, { value: "Can't swim", slot: "never", kind: "never", messageId: reply, origin: "story" }).fact;
    expect(factsNow(wren, chatB).some((x) => x.value === "Can't swim")).toBe(false);
    const to = canonEntryFor(chatA, chron)!;
    expect(to).toBe(wren);
    const r = promoteFact(f.id, to);
    expect(r.fact).toMatchObject({ chatId: null, entryId: wren, source: { chatId: chatA, messageId: reply } });
    expect(factsNow(wren, chatB).some((x) => x.value === "Can't swim")).toBe(true);
    const fresh = createChat({ characterId }).id;
    expect(factsNow(wren, fresh).some((x) => x.value === "Can't swim")).toBe(true);
    restoreStash(r.undo);
    expect(factsNow(wren, chatB).some((x) => x.value === "Can't swim")).toBe(false);
    expect(factsNow(chron, chatA).some((x) => x.value === "Can't swim")).toBe(true);
  });

  test("an override wins in its chat only", () => {
    const canon = factsNow(wren, null).find((f) => f.slot === "eyes")!;
    const r = overrideFact(canon.id, chatA, "green");
    expect(factsNow(wren, chatA).filter((f) => f.slot === "eyes").map((f) => f.value)).toEqual(["green"]);
    expect(factsNow(wren, chatB).filter((f) => f.slot === "eyes").map((f) => f.value)).toEqual(["grey"]);
    expect(factsNow(wren, null).filter((f) => f.slot === "eyes").map((f) => f.value)).toEqual(["grey"]);
    // A chat's own value for a single slot wins even when added directly.
    createFact(wren, { value: "amber", slot: "eyes", chatId: chatB, origin: "you" });
    expect(factsNow(wren, chatB).filter((f) => f.slot === "eyes").map((f) => f.value)).toEqual(["amber"]);
    restoreStash(r.undo);
    expect(factsNow(wren, chatA).filter((f) => f.slot === "eyes").map((f) => f.value)).toEqual(["grey"]);
  });
});

describe("8.2 persona lore", () => {
  test("a tracker change to your persona proposes an update on its book", async () => {
    writeEvents(chatA, { messageId: reply, swipeIdx: -1 }, linesToOps(["clock: Day 1 08:00", "cast: Wren@spot · Sam@spot", "at: Pyke", "body Sam: injury: left hand, wound"]).ops, "user");
    await runKeepup(chatA);
    const card = updateProposals(chatA).find((p) => p.entryId === sam)!;
    expect(card.diff.ops.map((o) => o.slot)).toEqual(expect.arrayContaining(["where", "injury (left hand)"]));
  });
});

describe("8.3 the continuity quiz", () => {
  test("the detail sheet makes questions with exact answers, and “gray” is right for grey", async () => {
    const qs = slotQuestions(chatB);
    const eyes = qs.find((q) => q.slot === "eyes")!;
    expect(eyes.question).toBe("What colour are Wren's eyes?");
    expect(eyes.answer).toBe("amber");
    expect(gradeSlot("eyes", "grey", "gray")).toBe(true);
    expect(gradeSlot("eyes", "grey", "steel-grey, I think")).toBe(true);
    expect(gradeSlot("eyes", "grey", "brown")).toBe(false);
    const run = await runQuiz(chatB, { n: 4 });
    expect(run.slots).not.toBeNull();
    expect(run.questions.some((q) => q.slot === "eyes")).toBe(true);
    expect(run.settings.model).toBe("mock/storyteller");
  });
});
