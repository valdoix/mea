import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all, newId, now, run } from "../src/db/db";
import { deleteAtom, dropAtoms, insertAtom, restoreAtom, supersede, updateAtom } from "../src/memory/atoms";
import { forgetEntitySync, pruneMemoryMarks, syncEntities } from "../src/memory/entities";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/**
 * M20: the entity sync reads only the memories that changed since it last ran. After every kind of
 * change, what it writes must be exactly what a sync that reads everything again writes.
 */

let chatId = "";
const msgs: { id: string; seq: number }[] = [];
// Names in several spellings, pronouns and too-short ones, the way models write them.
const POOL = ["Joss", "joss", "Brenna", "Old Tom", "old  Tom", "Captain Vey", "the brass lantern", "Gull Inn", "Harbor Guild", "she", "X", "Mira", "Kael", "the Lamp room"];
const mem: string[] = [];
let k = 0;
const addMem = (n = 1) => {
  for (let i = 0; i < n; i++, k++) {
    const src = msgs[(k * 7) % msgs.length]!;
    mem.push(insertAtom(chatId, null, { type: "fact", content: `Fact ${k}.`, entities: [POOL[k % POOL.length]!, POOL[(k * 5 + 3) % POOL.length]!], importance: 5 }, [src, msgs[(k * 3) % msgs.length]!]));
  }
};

/** Entity rows as a sync leaves them (ids of new rows are random, so they're left out). */
const table = () =>
  all<Record<string, unknown>>("SELECT kind, name, aliases, description, status, data, first_seq, last_seq, mentions, merged_into IS NOT NULL AS merged, deleted_at FROM entities WHERE chat_id = ? ORDER BY name, kind", chatId);

/** Syncs from what the sync remembers, then (rolled back) from scratch: both must write the same. */
function expectIncrementalEqualsFull(label: string) {
  run("SAVEPOINT cmp");
  syncEntities(chatId, true);
  const incremental = table();
  run("ROLLBACK TO cmp");
  run("RELEASE cmp");
  forgetEntitySync(chatId);
  syncEntities(chatId, true);
  expect(incremental, label).toEqual(table());
  expect(incremental.length).toBeGreaterThan(3);
}

beforeAll(() => {
  freshDb();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "Welcome." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  for (let i = 0; i < 20; i++) {
    const id = addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}`);
    msgs.push({ id, seq: i + 1 });
  }
  writeEvents(chatId, { messageId: msgs[1]!.id, swipeIdx: 0 }, linesToOps(["cast: Mira@spot · Joss@peri", "at: Port Ellis › Lighthouse › Lamp room", "item Brass lantern: → Mira"]).ops, "model");
  addMem(60);
  syncEntities(chatId, true);
});

describe("incremental entity sync (M20)", () => {
  test("new memories", () => {
    addMem(5);
    expectIncrementalEqualsFull("added");
  });
  test("superseded, deleted, restored and dropped memories", () => {
    supersede(mem[3]!, mem[4]!);
    expectIncrementalEqualsFull("superseded");
    deleteAtom(mem[10]!);
    expectIncrementalEqualsFull("deleted");
    restoreAtom(mem[10]!);
    expectIncrementalEqualsFull("restored");
    dropAtoms("id IN (?, ?)", mem[0]!, mem[1]!);
    expectIncrementalEqualsFull("dropped");
  });
  test("a memory's names and seqs edited", () => {
    updateAtom(mem[20]!, { entities: ["Joss", "Saltmarsh Ferry", "Saltmarsh Ferry"] });
    expectIncrementalEqualsFull("names edited");
    run("UPDATE memories SET min_seq = 1, max_seq = 19 WHERE id = ?", mem[21]!);
    expectIncrementalEqualsFull("seqs moved");
  });
  test("changes made straight in the database", () => {
    run(
      "INSERT INTO memories (id, chat_id, type, content, entities, created_at, updated_at, min_seq, max_seq) VALUES (?, ?, 'fact', 'Raw.', ?, ?, ?, 2, 3)",
      newId(),
      chatId,
      JSON.stringify(["Ilse", "Ilse", "Joss"]),
      now(),
      now(),
    );
    expectIncrementalEqualsFull("raw insert");
    run("UPDATE memories SET status = 'superseded' WHERE id = ?", mem[30]!);
    run("DELETE FROM memories WHERE id = ?", mem[31]!);
    expectIncrementalEqualsFull("raw update and delete");
  });
  test("after old marks are pruned", () => {
    syncEntities(chatId, true);
    pruneMemoryMarks();
    expect(all("SELECT id FROM memory_marks WHERE chat_id = ?", chatId).length).toBe(0);
    addMem(3);
    updateAtom(mem[40]!, { entities: ["Brenna"] });
    expectIncrementalEqualsFull("after prune");
  });
});
