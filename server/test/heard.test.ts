import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { now, one, run } from "../src/db/db";
import { deepSearch } from "../src/memory/deep";
import { heardFilter } from "../src/memory/named";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import type { WorldState } from "../src/trackers/types";
import { freshDb } from "./helpers";

/** docs/27 Part 5: quotes only come from what the point-of-view character heard. */
describe("who heard an old message", () => {
  test("they heard it if they were there or said it; older than the log, it passes", () => {
    const st = { presence: [{ seq: 5, who: ["buffy"] }, { seq: 10, who: ["dawn"] }] } as unknown as WorldState;
    const heard = heardFilter(st, "buffy", new Set(["buffy", "buffy summers"]))!;
    expect(heard({ seq: 3, name: "Dawn", role: "assistant" })).toBe(true);
    expect(heard({ seq: 7, name: "You", role: "user" })).toBe(true);
    expect(heard({ seq: 12, name: "Dawn", role: "assistant" })).toBe(false);
    expect(heard({ seq: 12, name: "Buffy Summers", role: "assistant" })).toBe(true);
    expect(heardFilter({ presence: [] } as unknown as WorldState, "buffy", new Set())).toBeNull();
    expect(heardFilter(st, undefined, new Set())).toBeNull();
  });

  describe("deep search", () => {
    let chatId = "";
    const seqOf = (text: string) => one<{ seq: number }>("SELECT m.seq FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.chat_id = ? AND s.content = ?", chatId, text)!.seq;
    const SECRET = "Dawn whispered that the silver locket is buried under the porch.";

    beforeAll(() => {
      freshDb();
      const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", description: "A Slayer.", first_mes: "Hi." } });
      chatId = createChat({ characterId: createCharacter(data) }).id;
      for (let i = 1; i <= 20; i++) addMessage(chatId, i % 2 ? "user" : "assistant", i === 6 ? SECRET : `Line ${i}: they walked through the rain.`, { name: i % 2 ? "You" : "Dawn" });
      const t = now();
      run("INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, state, created_at, updated_at) VALUES ('s1', ?, 'scene', 1, 20, 1, 'The porch', 'They talked on the porch about a locket.', 'ready', ?, ?)", chatId, t, t);
    });

    test("quotes a message the point of view heard, and never one it didn't", () => {
      const found = deepSearch(chatId, { query: "silver locket porch", qvec: null, beforeSeq: 20 });
      expect(found.some((h) => h.seq === seqOf(SECRET))).toBe(true);
      const filtered = deepSearch(chatId, { query: "silver locket porch", qvec: null, beforeSeq: 20, heard: (m) => m.seq !== seqOf(SECRET) });
      expect(filtered.some((h) => h.seq === seqOf(SECRET))).toBe(false);
    });
  });
});
