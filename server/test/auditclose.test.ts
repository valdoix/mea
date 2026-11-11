import { beforeAll, describe, expect, test } from "bun:test";
import { storyHealth } from "../src/accuracy/health";
import { normalizeCard } from "../src/cards/card";
import { now, run } from "../src/db/db";
import { takenTitles } from "../src/memory/build";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { freshDb } from "./helpers";

/** What the Buffy × Gabriel audit found that no part of docs/33 named: titles, unchecked scenes. */
let chatId = "";

beforeAll(() => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "lessons.learn", "steer.edit", "steer.tense"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  for (let i = 0; i < 4; i++) addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}.`, i % 2 ? { name: "Buffy" } : {});
  const t = now();
  const add = (id: string, level: string, start: number, title: string, verification: string | null) =>
    run(
      "INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, verification, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, 'Text.', ?, 'ready', ?, ?)",
      id,
      chatId,
      level,
      start,
      start + 1,
      title,
      verification,
      t,
      t,
    );
  add("c1", "chapter", 1, "The Whole Word, No Takebacks", null);
  add("c2", "chapter", 5, "Brongel, First of His Name", null);
  add("c3", "chapter", 9, "", null);
  add("s1", "scene", 1, "A scene", JSON.stringify({ verdict: "ok", unsupported: [], omissions: [], skipped: "quota" }));
  add("s2", "scene", 3, "Another", JSON.stringify({ verdict: "ok", unsupported: [], omissions: [] }));
});

describe("a chapter is told the titles taken", () => {
  test("the other chapters' titles, not its own, not another level's", () => {
    expect(takenTitles({ id: "c3", chat_id: chatId, level: "chapter" })).toEqual(["The Whole Word, No Takebacks", "Brongel, First of His Name"]);
    expect(takenTitles({ id: "c1", chat_id: chatId, level: "chapter" })).toEqual(["Brongel, First of His Name"]);
  });
});

describe("the health panel says what can't be found or wasn't checked", () => {
  test("scene records skipped for quota are counted on Story records", () => {
    const records = storyHealth(chatId).parts.find((p) => p.part === "ledger")!;
    expect(records.detail).toContain("1 scene record not checked");
  });
});
