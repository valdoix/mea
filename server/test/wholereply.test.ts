import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { one } from "../src/db/db";
import { subscribe, type MeaEvent } from "../src/lib/events";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, getMessage, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { startStory } from "../src/services/generation";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { runTenseJob } from "../src/steer/editor";
import { freshDb } from "./helpers";

/**
 * A whole reply, the way GLM writes them, through everything that happens to it after the model:
 * speaker marks, a line cut off with a dash and picked up after narration, straight quotes in a
 * curly-quote story, and the past tense in a present-tense one. Each part has its own tests; this
 * one is for what they do to each other (audit of 15 November: the quote fixer flipped the marks
 * around the speaker marks, and the flipped marks then made the tense fix throw its rewrite away).
 */
let chatId = "";

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

/** Each paragraph's marks alternate open, close, open, close. */
const balanced = (text: string) =>
  text.split("\n").every((p) => [...p.matchAll(/[“”"]/g)].every((m, i) => m[0] === (i % 2 ? "”" : "“")));

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "accuracy.check", "tracker.update", "lessons.learn", "steer.tense", "steer.editor"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 400 } });
  setSetting("memory.config", { ...defaultMemoryConfig, enabled: false });
  setSetting("chat.cutoff", "off");
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "The lamp hums." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  updateChat(chatId, { settings: { story: { tense: "Present" }, style: { quotes: "curly" } } });
  addMessage(chatId, "user", "MOCK_DASHES Will you be free on Tuesday?", { name: "Ash" });
});
afterAll(() => pauseJobs(false));

describe("a whole reply, marks, dashes and a tense slip", () => {
  let messageId = "";
  test("is saved with its marks gone and every quote the right way round", async () => {
    const ended = waitEnd();
    messageId = (await startStory(chatId, "new")).messageId;
    await ended;
    const text = getMessage(messageId)!.content;
    expect(text).toContain("She pulled the logbook out");
    expect(text).not.toContain("[spk");
    expect(text).toContain("“I need to be back by five for — hold on —”");
    expect(text).toContain("“— yes, Tuesday’s clear.”");
    expect(balanced(text)).toBe(true);
  });

  test("is queued for the tense fix, and the fix lands with every spoken word kept", async () => {
    expect(one("SELECT 1 FROM jobs WHERE kind = 'steer.tense' AND payload LIKE ?", `%${messageId}%`)).toBeTruthy();
    const before = getMessage(messageId)!.content;
    await runTenseJob({ chatId, messageId, swipeIdx: 0 });
    const after = getMessage(messageId)!;
    expect(after.content).toContain("She pulls the logbook out and scrolls down the page");
    expect(after.content).toContain("cup clatters onto the saucer");
    for (const line of ["I need to be back by five for — hold on —", "— yes, Tuesday’s clear.", "One, then. Only one."]) expect(after.content).toContain(line);
    expect((after.meta.edit as { status: string; original: string }).original).toBe(before);
    expect(balanced(after.content)).toBe(true);
  });

  test("a reply the model curled the wrong way itself still gets its tense fixed", async () => {
    // As reply 982 was saved: “ closes a line cut off with a dash, ” opens the next.
    const flipped = getMessage(messageId)!.meta.edit as { original: string };
    const wrongWay = flipped.original.replace("hold on —”", "hold on —“").replace("“— yes, Tuesday’s clear.”", "”— yes, Tuesday’s clear.“");
    const id = addMessage(chatId, "assistant", wrongWay, { name: "Mira" });
    await runTenseJob({ chatId, messageId: id, swipeIdx: 0 });
    expect(getMessage(id)!.content).toContain("She pulls the logbook out and scrolls down the page");
    expect(getMessage(id)!.content).toContain("hold on —“ She pulls");
  });
});
