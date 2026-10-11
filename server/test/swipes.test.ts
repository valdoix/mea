import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { one } from "../src/db/db";
import { subscribe, type MeaEvent } from "../src/lib/events";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { addMessage, addSwipe, createChat, getSwipes, getMessageRow, setActiveSwipe, updateSwipe } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { prepare, startStory } from "../src/services/generation";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { digestNote, keptPrefix, rejectedDigest, takeShape } from "../src/steer/swipes";
import { freshDb } from "./helpers";

let chatId = "";
let replyId = "";

const TAKE_1 = 'The door creaks open. Rain blows in across the floor. "You came back," Mira says, and she does not smile.';
const TAKE_2 = "Mira is asleep by the stove when you come in. The kettle has boiled dry. A letter lies open on the table, its seal broken.";

function waitEnd() {
  return new Promise<MeaEvent>((resolve, reject) => {
    const t = setTimeout(() => (off(), reject(new Error("no gen.end"))), 8000);
    const off = subscribe((e) => {
      if (e.type === "gen.end") {
        clearTimeout(t);
        off();
        resolve(e);
      }
    });
  });
}

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "accuracy.check", "tracker.update", "lessons.learn"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 300 } });
  setSetting("memory.config", { ...defaultMemoryConfig, enabled: false });
  setSetting("chat.cutoff", "off");
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "The lamp hums." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  addMessage(chatId, "user", "I knock on the lighthouse door.", { name: "Ash" });
  replyId = addMessage(chatId, "assistant", TAKE_1, { name: "Mira" });
  const i = addSwipe(replyId, "done");
  updateSwipe(replyId, i, { content: TAKE_2, status: "done" });
});

afterAll(() => pauseJobs(false));

describe("swipe with an angle (A2)", () => {
  test("a take's shape: its opening and the line carrying the most", () => {
    const s = takeShape(TAKE_1);
    expect(s.opening).toBe("The door creaks open.");
    expect(s.beat).toContain("You came back");
  });

  test("a swipe hears every earlier take, not just the one it replaces", async () => {
    expect(rejectedDigest(replyId)).toHaveLength(2);
    const p = await prepare(chatId, "story", { excludeMessageId: replyId });
    const block = p.assembled.trace.blocks.find((b) => b.id === "extra:swipe-digest");
    expect(block?.included).toBe(true);
    const text = p.assembled.messages.map((m) => m.content).join("\n");
    expect(text).toContain("passed over 2 earlier takes");
    expect(text).toContain("The door creaks open.");
    expect(text).toContain("Mira is asleep by the stove when you come in.");
    expect(text).toContain("don't drift back to any of them");
    // A new reply (not a swipe) has none.
    const fresh = await prepare(chatId, "story");
    expect(fresh.assembled.trace.blocks.some((b) => b.id === "extra:swipe-digest")).toBe(false);
  });

  test("an angle is a one-shot note for that take", async () => {
    const ended = waitEnd();
    const r = await startStory(chatId, "swipe", { messageId: replyId, angle: "quieter" });
    await ended;
    const gen = one<{ request: string }>("SELECT request FROM generations WHERE id = ?", r.generationId)!;
    expect(gen.request).toContain("Quieter: a softer, more intimate take");
    expect(getSwipes(replyId)).toHaveLength(3);
    expect(digestNote(rejectedDigest(replyId))).toContain("3 earlier takes");
  });

  test("the angle that names the character uses their name", async () => {
    const ended = waitEnd();
    const r = await startStory(chatId, "swipe", { messageId: replyId, angle: "side" });
    await ended;
    expect(one<{ request: string }>("SELECT request FROM generations WHERE id = ?", r.generationId)!.request).toContain("from Mira's side");
  });

  test("keep this: the take up to the end of the selected sentence", () => {
    expect(keptPrefix(TAKE_1, "Rain blows in")).toBe("The door creaks open. Rain blows in across the floor.");
    expect(keptPrefix(TAKE_1, "The door creaks open.")).toBe("The door creaks open.");
    expect(keptPrefix(TAKE_1, "rain   blows")).toBeNull(); // case matters: it must be the reply's own words
    expect(keptPrefix(TAKE_1, "a sentence that isn't there")).toBeNull();
  });

  test("Keep this, redo the rest: a new take that starts with the kept part and goes on", async () => {
    setActiveSwipe(replyId, 0);
    const before = getSwipes(replyId).length;
    const ended = waitEnd();
    const r = await startStory(chatId, "redo", { messageId: replyId, keep: "Rain blows in" });
    await ended;
    const swipes = getSwipes(replyId);
    expect(swipes).toHaveLength(before + 1);
    const take = swipes.find((s) => s.idx === r.swipeIdx)!;
    expect(take.content.startsWith("The door creaks open. Rain blows in across the floor.")).toBe(true);
    expect(take.content.length).toBeGreaterThan("The door creaks open. Rain blows in across the floor.".length);
    expect(getMessageRow(replyId)!.active_swipe).toBe(r.swipeIdx);
    const req = one<{ request: string }>("SELECT request FROM generations WHERE id = ?", r.generationId)!.request;
    expect(req).toContain("write the rest anew");
  });

  test("a selection that isn't in the reply starts nothing and adds no take", async () => {
    const before = getSwipes(replyId).length;
    await expect(startStory(chatId, "redo", { messageId: replyId, keep: "words that were never written" })).rejects.toThrow(/Select a sentence/);
    expect(getSwipes(replyId)).toHaveLength(before);
  });
});
