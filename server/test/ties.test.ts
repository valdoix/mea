import { beforeAll, describe, expect, test } from "bun:test";
import { checkReply } from "../src/accuracy/checker";
import { tieKinds } from "../src/accuracy/ties";
import { normalizeCard } from "../src/cards/card";
import { all, one, run } from "../src/db/db";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { insertAtom } from "../src/memory/atoms";
import { buildSummary } from "../src/memory/build";
import { onLedgerChange, segmentChat } from "../src/memory/scheduler";
import { levelRows } from "../src/memory/store";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, onLedgerEdit } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { freshDb } from "./helpers";

let chatId = "";
const ids: string[] = [];
const seqOf = (id: string) => one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", id)!.seq;

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "accuracy.check", "quota.refresh", "cache.probe", "tracker.update", "tracker.init"]) registerJob(kind, async () => {});
  onLedgerEdit(onLedgerChange);
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 4000, max_tokens: 400 } });
  setSetting("memory.config", { ...defaultMemoryConfig, sceneTokenCap: 100_000, boundaryCheck: false, lag: 1, journals: false, chronicle: false, consolidate: false, verify: true, autoRepair: true });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", description: "A Slayer.", first_mes: "Hey, {{user}}." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  for (let i = 0; i < 2; i++) ids.push(addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}. The night is quiet over Sunnydale.`, { name: i % 2 ? "Buffy" : "You" }));
  insertAtom(chatId, null, { type: "fact", content: "Spike knew George Winters, Gabriel's great-great-grandfather, at London parties in 1880.", importance: 9, entities: ["Spike", "George Winters", "Gabriel"] }, [{ id: ids[0]!, seq: seqOf(ids[0]!) }]);
});

describe("ties across generations", () => {
  test("the kind of tie a word names", () => {
    expect([...tieKinds("a man who knew her great-great-grandfather")]).toEqual(["line"]);
    expect([...tieKinds("his grandfather taught him tea")]).toEqual(["grand"]);
    expect([...tieKinds("the ancestors of the Winters line")]).toEqual(["line"]);
    expect(tieKinds("her father and his mother").size).toBe(0);
  });

  test("a reply that flips a tie is flagged against the memory that set it up", async () => {
    const m = addMessage(chatId, "assistant", "Her thumb maps his jaw. It has the geometry of a man who knew her great-great-grandfather MOCK_TIE. She doesn't stop.", { name: "Buffy" });
    const issues = await checkReply(chatId, m, 0, { model: false });
    const tie = issues!.find((i) => i.kind === "ties");
    expect(tie?.claim).toContain("great-great-grandfather");
    expect(tie?.citations[0]?.label).toContain("Spike knew George Winters");
    expect(tie?.fix).toBeTruthy();
  });

  test("rules first: no tie word, or no record of that kind, means no helper call", async () => {
    // The mock would flag MOCK_TIE if it were asked.
    const plain = addMessage(chatId, "assistant", "She laughs at him MOCK_TIE. The kettle clicks off.", { name: "Buffy" });
    expect((await checkReply(chatId, plain, 0, { model: false }))!.some((i) => i.kind === "ties")).toBe(false);
    const grand = addMessage(chatId, "assistant", "His grandfather taught him tea MOCK_TIE.", { name: "Buffy" });
    expect((await checkReply(chatId, grand, 0, { model: false }))!.some((i) => i.kind === "ties")).toBe(false);
  });

  test("a scene note that keeps the slip is written again, and kept disputed if it still flips the tie", async () => {
    addMessage(chatId, "user", "The next morning, she traces his jaw, the geometry of a man who knew her great-great-grandfather MOCK_TIE.", { name: "You" });
    addMessage(chatId, "assistant", "Buffy smiles and says nothing.", { name: "Buffy" });
    await segmentChat(chatId);
    // Closed by hand: the scene under test is the newest one.
    const scene = levelRows(chatId, "scene").at(-1)!;
    expect(scene.start_seq).toBeGreaterThan(seqOf(ids[0]!));
    run("UPDATE summaries SET closed = 1, end_seq = (SELECT MAX(seq) FROM messages WHERE chat_id = ?) WHERE id = ?", chatId, scene.id);
    await buildSummary(scene.id);
    const notes = all<{ content: string; status: string }>("SELECT content, status FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND content LIKE '%geometry%great-great%'", chatId);
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n.status).toBe("disputed");
    // The record that set the tie up is untouched.
    expect(one<{ status: string }>("SELECT status FROM memories WHERE content LIKE 'Spike knew George Winters%'", chatId)?.status).toBe("active");
  });
});
