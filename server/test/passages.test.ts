import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all, now, one, run } from "../src/db/db";
import { setSetting } from "../src/lib/settings";
import { deepSearch } from "../src/memory/deep";
import { embedChat, embedQuery, passageChunks } from "../src/memory/embed";
import { heardFilter } from "../src/memory/named";
import { setMemState } from "../src/memory/store";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, syncModels } from "../src/services/connections";
import type { WorldState } from "../src/trackers/types";
import { freshDb } from "./helpers";

/** docs/27 Part 5: old messages by meaning. */
describe("passage vectors", () => {
  let chatId = "";
  const ORANGE = "Ruth said her favourite colour was the orange of a late streetlight, and nobody ever asked again.";
  const said = (seq: number) => one<{ id: string; swipe: string }>("SELECT m.id, s.id AS swipe FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.chat_id = ? AND m.seq = ?", chatId, seq)!;
  // The greeting is #1, so the orange line is wherever it landed: looked up by its words.
  const orange = () => one<{ seq: number }>("SELECT m.seq FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe WHERE m.chat_id = ? AND s.content = ?", chatId, ORANGE)!.seq;
  const passages = () => all<{ owner_id: string }>("SELECT owner_id FROM embeddings WHERE chat_id = ? AND owner_type = 'passage'", chatId).map((r) => r.owner_id);

  beforeAll(async () => {
    freshDb();
    const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
    await syncModels(connId);
    setSetting("routing.embeddings", { connectionId: connId, model: "mock/embed", dims: 64 });
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", description: "A Slayer.", first_mes: "Hi." } });
    chatId = createChat({ characterId: createCharacter(data) }).id;
    for (let i = 1; i <= 30; i++) addMessage(chatId, i % 2 ? "user" : "assistant", i === 7 ? ORANGE : `Line ${i}: they walked on through the rain and talked about the weather.`, { name: i % 2 ? "You" : "Buffy" });
    const t = now();
    run("INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, state, created_at, updated_at) VALUES ('s1', ?, 'scene', 1, 20, 1, 'A walk', 'They walked in the rain.', 'ready', ?, ?)", chatId, t, t);
    setMemState(chatId, { evictedThrough: 20 });
  });

  test("a message is cut on sentence boundaries, the same way every time", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} says a little more about the harbor.`).join(" ");
    const parts = passageChunks(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(1200);
    for (const p of parts) expect(p.endsWith(".")).toBe(true);
    expect(passageChunks(long)).toEqual(parts);
    expect(parts.join(" ")).toBe(long);
  });

  test("only messages out of the window get vectors", async () => {
    await embedChat(chatId);
    const ids = passages();
    expect(ids.length).toBe(20);
    expect(ids).toContain(`${said(orange()).swipe}:0`);
    expect(ids).not.toContain(`${said(21).swipe}:0`);
  });

  test("deep search finds a message by meaning alone, and quotes it", async () => {
    const qvec = await embedQuery(ORANGE);
    const hits = deepSearch(chatId, { query: "", qvec, beforeSeq: 20 });
    expect(hits[0]?.messageId).toBe(said(orange()).id);
    expect(hits[0]?.excerpt).toContain("orange");
    expect(hits[0]?.reasons.some((r) => r.startsWith("close in meaning"))).toBe(true);
  });

  test("a message the point-of-view character didn't hear is never quoted", async () => {
    const qvec = await embedQuery(ORANGE);
    const hits = deepSearch(chatId, { query: "", qvec, beforeSeq: 20, heard: (m) => m.seq !== orange() });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.messageId === said(orange()).id)).toBe(false);
  });

  test("an edit re-embeds, a hidden message loses its vectors, and a purged swipe takes them along", async () => {
    run("UPDATE swipes SET content = ? WHERE id = ?", "Line 9: something else entirely happened at the docks.", said(9).swipe);
    const before = one<{ hash: string }>("SELECT hash FROM embeddings WHERE owner_id = ?", `${said(9).swipe}:0`)!.hash;
    await embedChat(chatId);
    expect(one<{ hash: string }>("SELECT hash FROM embeddings WHERE owner_id = ?", `${said(9).swipe}:0`)!.hash).not.toBe(before);

    run("UPDATE messages SET hidden = 1 WHERE id = ?", said(11).id);
    await embedChat(chatId);
    expect(passages()).not.toContain(`${said(11).swipe}:0`);

    const gone = said(13).swipe;
    run("DELETE FROM swipes WHERE id = ?", gone);
    expect(passages().some((id) => id.startsWith(`${gone}:`))).toBe(false);
  });
});

describe("who heard an old message", () => {
  test("the point-of-view character heard it if they were there or said it; older than the log, it passes", () => {
    const st = { presence: [{ seq: 5, who: ["buffy"] }, { seq: 10, who: ["dawn"] }] } as unknown as WorldState;
    const heard = heardFilter(st, "buffy", new Set(["buffy", "buffy summers"]))!;
    expect(heard({ seq: 3, name: "Dawn", role: "assistant" })).toBe(true);
    expect(heard({ seq: 7, name: "You", role: "user" })).toBe(true);
    expect(heard({ seq: 12, name: "Dawn", role: "assistant" })).toBe(false);
    expect(heard({ seq: 12, name: "Buffy Summers", role: "assistant" })).toBe(true);
    expect(heardFilter({ presence: [] } as unknown as WorldState, "buffy", new Set())).toBeNull();
  });
});
