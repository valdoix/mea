import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { newId, now, run } from "../src/db/db";
import { privateParts, updateJournal } from "../src/memory/journals";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { freshDb } from "./helpers";

/**
 * Audit of 15 November: Dawn's journal told a cemetery scene she wasn't at (its summary said Buffy
 * had "promised Dawn dinner"), and Ruth's told a sexual scene act by act. A journal reads only the
 * scenes its person was in, and never sees the explicit sentences.
 */
let chatId = "";

function scene(start: number, end: number, title: string, content: string, participants: string[]) {
  const t = now();
  run(
    "INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, data, state, created_at, updated_at) VALUES (?, ?, 'scene', ?, ?, 1, ?, ?, ?, 'ready', ?, ?)",
    newId(),
    chatId,
    start,
    end,
    title,
    content,
    JSON.stringify({ participants }),
    t,
    t,
  );
}

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "accuracy.check", "quota.refresh", "cache.probe", "tracker.update", "lessons.learn"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 300 } });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  for (let i = 0; i < 6; i++) addMessage(chatId, i % 2 ? "assistant" : "user", `Message ${i}.`, { name: i % 2 ? "Buffy" : "Gabriel" });
  scene(1, 2, "Omelettes", "Dawn cracked four eggs clean and made her first omelette.", ["Buffy Summers", "Dawn", "Walter (in living room)"]);
  scene(3, 4, "The kitchen", "She dropped to her knees and took his cock into her mouth. Then she called to Walter that any paper works.", ["Buffy Summers", "Gabriel Winters", "Ruth the orange cat"]);
  scene(5, 6, "Restfield", "They met a young vampire at the cemetery and Gabriel fed him from his finger, though Buffy had promised Dawn dinner.", ["Buffy Summers", "Gabriel Winters", "Desmond"]);
});
afterAll(() => pauseJobs(false));

describe("a journal reads only its own scenes, and none of the explicit sentences", () => {
  test("being named in a scene isn't being there", async () => {
    const dawn = (await updateJournal(chatId, "Dawn"))!;
    expect(dawn.content).toContain("Omelettes");
    expect(dawn.content).not.toContain("Restfield");
  });

  test("a participant listed with a note ('Ruth the orange cat', 'Walter (in living room)') was there", async () => {
    expect((await updateJournal(chatId, "Walter"))!.content).toContain("Omelettes");
    const ruth = (await updateJournal(chatId, "Ruth"))!;
    expect(ruth.content).toContain("The kitchen");
  });

  test("the explicit sentence never reaches the journal writer", async () => {
    const ruth = (await updateJournal(chatId, "Ruth", { fromScratch: true }))!;
    expect(ruth.content).not.toContain("cock");
    expect(ruth.content).toContain("called to Walter");
    expect(privateParts("She dropped to her knees. They laughed about the toast.")).toBe(
      "They laughed about the toast. (Part of this scene was intimate and private: the journal says no more than that.)",
    );
    expect(privateParts("Dawn came downstairs and made toast.")).toBe("Dawn came downstairs and made toast.");
  });
});
