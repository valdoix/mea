import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all, run as sql } from "../src/db/db";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { insertAtom } from "../src/memory/atoms";
import { invalidateVectors } from "../src/memory/embed";
import { TimeIndex } from "../src/memory/format";
import { buildQueries, recall } from "../src/memory/recall";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { freshDb } from "./helpers";

/** docs/27 Part 2: the memories closest in meaning to the newest message get a slot of their own. */
describe("the closest in meaning get in", () => {
  const DIMS = 8;
  let chatId: string;
  let target: string;

  const unit = (v: number[]) => {
    const n = Math.hypot(...v);
    return Float32Array.from(v.map((x) => x / n));
  };
  const axis = (i: number) => unit(Array.from({ length: DIMS }, (_, j) => (j === i ? 1 : 0)));
  const vector = (id: string, v: Float32Array) =>
    sql(
      "INSERT INTO embeddings (owner_type, owner_id, chat_id, model, dims, hash, vector, created_at) VALUES ('memory', ?, ?, 'test-embed', ?, ?, ?, 0)",
      id,
      chatId,
      DIMS,
      id,
      new Uint8Array(v.buffer, v.byteOffset, v.byteLength),
    );

  const run = (newest: string, closest?: number) =>
    recall({
      chatId,
      evicted: 500,
      budget: 300,
      queries: buildQueries([
        { role: "user", content: "They argued about the race in the kitchen." },
        { role: "assistant", content: "Spike said the race was rigged." },
        { role: "user", content: newest },
      ]),
      // The newest message, then the two before it: the target is close to the first alone.
      qvecs: [axis(0), axis(1), axis(2)],
      excludeSummaryIds: new Set(),
      seed: "test",
      cfg: { ...defaultMemoryConfig, entityRecall: false, deepSearch: false, librarian: false, diversity: 0 },
      pov: null,
      present: [],
      mood: null,
      librarian: null,
      times: new TimeIndex(chatId),
      skipCards: new Set(),
      povName: "Buffy",
      closest,
    }).items;

  const slotted = (items: ReturnType<typeof run>) => items.filter((i) => i.reasons.some((r) => r.startsWith("closest in meaning"))).map((i) => i.id);

  beforeAll(() => {
    freshDb();
    setSetting("routing.embeddings", { connectionId: null, model: "test-embed", dims: DIMS });
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", description: "A Slayer.", first_mes: "Hi." } });
    chatId = createChat({ characterId: createCharacter(data) }).id;
    for (let i = 0; i < 520; i++) addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}.`);
    const seqs = all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? ORDER BY seq", chatId);
    const atom = (content: string, seq: number) => insertAtom(chatId, null, { type: "event", content, knownBy: [], importance: 5 }, [seqs.find((m) => m.seq === seq)!]);
    // Fairly close to all three queries: fused, these outrank one that is very close to the newest alone.
    for (let i = 0; i < 40; i++) {
      const id = atom(`Spike and Dawn raced again, round ${i}, and argued about who won.`, 20 + i);
      vector(id, unit([1, 1, 1, 0, 0, 0, 0, (i % 7) / 50]));
    }
    // The oldest, so the recent slot never takes it.
    target = atom("Joyce died in February.", 10);
    vector(target, axis(0));
    invalidateVectors(chatId);
  });

  test("without the slot, fusion leaves the closest memory out", () => {
    expect(run("She thinks of her mother and goes quiet.", 0).some((i) => i.id === target)).toBe(false);
  });

  test("with it, the closest memory gets in, and says why", () => {
    const it = run("She thinks of her mother and goes quiet.").find((i) => i.id === target);
    expect(it?.reasons.some((r) => r.startsWith("closest in meaning 1.00"))).toBe(true);
  });

  test("a message too short to mean anything gets no slot", () => {
    expect(slotted(run("OK."))).toEqual([]);
  });

  test("a memory recalled often and never used doesn't get the slot", () => {
    sql("UPDATE memories SET recall_count = 6, ref_count = 0 WHERE id = ?", target);
    const ids = slotted(run("She thinks of her mother and goes quiet."));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain(target);
    sql("UPDATE memories SET recall_count = 0 WHERE id = ?", target);
  });
});
