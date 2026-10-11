import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkReply, dismissIssue } from "../src/accuracy/checker";
import { healthDot, storyHealth } from "../src/accuracy/health";
import { normalizeCard } from "../src/cards/card";
import { one, run } from "../src/db/db";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { statusTiles } from "../src/services/status";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
let bad = "";

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "lessons.learn"]) registerJob(kind, async () => {});
  setSetting("memory.config", { ...defaultMemoryConfig, checkerModel: false });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "Welcome." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const first = addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 2 21:30", "cast: Mira@spot · Old Tom@left", "dead Old Tom — lost in the storm"]).ops, "model");
  for (let i = 0; i < 5; i++) {
    addMessage(chatId, "user", `Line ${i}.`, { name: "You" });
    const id = addMessage(chatId, "assistant", `Mira pours the tea and listens to the rain, round ${i}.`, { name: "Mira" });
    writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps([`clock: +5m`]).ops, "model");
  }
});
afterAll(() => pauseJobs(false));

describe("story health (D3)", () => {
  test("a clean stretch of story is healthy, with every part", () => {
    const h = storyHealth(chatId);
    expect(h.parts.map((p) => p.part)).toEqual(["continuity", "leaks", "repetition", "ledger", "lessons", "cost"]);
    expect(h.parts.find((p) => p.part === "continuity")!.score).toBe(100);
    expect(h.level).toBe("good");
    expect(h.trend.length).toBeGreaterThan(0);
  });

  test("slips pull it down, point at the reply, and give Meus something to fix", async () => {
    addMessage(chatId, "user", "Who's there?", { name: "You" });
    bad = addMessage(chatId, "assistant", "Old Tom says hello from the doorway, grinning.", { name: "Mira" });
    writeEvents(chatId, { messageId: bad, swipeIdx: 0 }, linesToOps([`clock: +5m`]).ops, "model");
    await checkReply(chatId, bad, 0);
    const p = storyHealth(chatId).parts.find((x) => x.part === "continuity")!;
    expect(p.score).toBeLessThan(100);
    expect(p.open).toMatchObject({ messageId: bad });
    expect(p.ask).toContain("Old Tom is dead");
  });

  test("a dismissed finding no longer counts", () => {
    const f = one<{ id: string }>("SELECT id FROM continuity_flags WHERE message_id = ?", bad)!;
    dismissIssue(f.id, null);
    expect(storyHealth(chatId).parts.find((x) => x.part === "continuity")!.score).toBe(100);
  });

  test("replies the trackers didn't read show under Story records", () => {
    addMessage(chatId, "user", "And?", { name: "You" });
    addMessage(chatId, "assistant", "Unread one.", { name: "Mira" });
    addMessage(chatId, "user", "And?", { name: "You" });
    addMessage(chatId, "assistant", "Unread two (the newest may still be reading).", { name: "Mira" });
    const p = storyHealth(chatId).parts.find((x) => x.part === "ledger")!;
    expect(p.detail).toContain("1 reply the trackers didn't read");
  });

  test("the Status tile and Home's dot", () => {
    expect(statusTiles(chatId).find((t) => t.id === "health")).toMatchObject({ label: "story health" });
    expect(healthDot(chatId)).toMatchObject({ level: expect.stringMatching(/good|fair|poor/) });
    run("DELETE FROM messages WHERE chat_id = ?", "nope");
  });
});
