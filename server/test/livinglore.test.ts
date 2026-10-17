import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createFact, factsNow, getFact, listFacts, supersedeFact } from "../src/lore/facts";
import { decideUpdate, runKeepup, updateProposals } from "../src/lore/keepup";
import { createEntry, createLorebook, updateLorebook } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { createCharacter } from "../src/services/characters";
import { addMessage, addSwipe, createChat, deleteSwipe, editMessage, getMessage, restoreMessage, rewindAfter, setActiveSwipe, softDeleteMessage, updateSwipe } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { previewPrompt } from "../src/services/generation";
import { registerJob } from "../src/services/jobs";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/**
 * The golden test (docs/15, 8.4): a long chat with known facts at known messages, run through
 * activation, keep-up and the branch rules. Every stage checks the facts true now AND the prompt,
 * so a fact that leaks from a gone branch (a swipe, an edit, a delete, a rewind) fails it.
 */

let chatId = "";
let wren = "";
const m: string[] = [];
const where = () => factsNow(wren, chatId).filter((f) => f.slot === "where").map((f) => f.value);
const values = () => factsNow(wren, chatId).map((f) => f.value);
const prompt = async () => (await previewPrompt(chatId)).messages.map((x) => x.content).join("\n");
const reads = (i: number, lines: string[], swipe = 0) => writeEvents(chatId, { messageId: m[i]!, swipeIdx: swipe }, linesToOps(lines).ops, "model");

/** No value from a gone branch in the facts, and none in the prompt's lore. */
async function noLeak(gone: string[], kept: string[]) {
  const now = values();
  const p = await prompt();
  for (const g of gone) {
    expect(now).not.toContain(g);
    expect(p).not.toContain(`- ${g}`);
    expect(p).not.toContain(`: ${g}\n`);
  }
  for (const k of kept) expect(now.some((v) => v === k)).toBe(true);
}

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "tracker.update", "tracker.init", "lore.keepup", "lore.time", "lore.bond", "lore.compact", "lore.chronicle"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 12000 } });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Wren", description: "A ferry pilot.", first_mes: "Wren ties off the ferry." } });
  const characterId = createCharacter(data);
  chatId = createChat({ characterId }).id;
  const book = createLorebook({ name: "Wren's book", links: [{ target_type: "character", target_id: characterId }] });
  wren = createEntry(book, defaultEntry({ comment: "Wren", keys: ["Wren"], constant: true, content: "Wren pilots the ferry.", extra: { type: "character" } })).id;
  updateLorebook(book, { settings: { keepup: "tracker" } });
  for (let i = 0; i < 24; i++) m.push(addMessage(chatId, i % 2 ? "assistant" : "user", i % 2 ? `Wren answers (${i}).` : `You speak (${i}).`, i % 2 ? { name: "Wren" } : {}));
  createFact(wren, { value: "grey", slot: "eyes", origin: "card" });
});

describe("8.4 the golden test: a long chat that swipes, edits, deletes and rewinds", () => {
  test("stage 1: the story builds facts at known messages (trackers apply, the rest are kept from the text)", async () => {
    reads(3, ["clock: Day 1 08:00", "cast: Wren@spot", "at: Riverrun"]);
    await runKeepup(chatId);
    expect(where()).toEqual(["Riverrun"]);
    createFact(wren, { value: "Scar on her left hand", chatId, messageId: m[5]!, origin: "story" });
    reads(9, ["at: Saltpans"]);
    await runKeepup(chatId);
    expect(where()).toEqual(["Saltpans"]);
    const scar = factsNow(wren, chatId).find((f) => f.value === "Scar on her left hand")!;
    supersedeFact(scar.id, { value: "Scar on her right hand", messageId: m[11]!, origin: "story" });
    createFact(wren, { value: "Owes Joss a debt", chatId, messageId: m[15]!, origin: "story" });
    reads(19, ["at: Pyke"]);
    await runKeepup(chatId);
    await noLeak([], ["Pyke", "Scar on her right hand", "Owes Joss a debt", "grey"]);
    // The prompt carries them, in the entry's Now block.
    expect(await prompt()).toContain("- Where: Pyke");
  });

  test("stage 2: swipe a reply away and its facts go; swipe back and they return", async () => {
    const idx = addSwipe(m[19]!, "done");
    updateSwipe(m[19]!, idx, { content: "Wren stays put." });
    await runKeepup(chatId);
    await noLeak(["Pyke"], ["Saltpans", "Owes Joss a debt"]);
    setActiveSwipe(m[19]!, 0);
    await runKeepup(chatId);
    await noLeak([], ["Pyke"]);
    deleteSwipe(m[19]!, idx);
    await noLeak([], ["Pyke"]);
  });

  test("stage 3: edit a fact's source and it asks for a re-check (it doesn't silently stay)", async () => {
    const debt = factsNow(wren, chatId).find((f) => f.value === "Owes Joss a debt")!;
    editMessage(m[15]!, "Wren answers, debts long paid.");
    expect(getFact(debt.id)!.stale).toBe(true);
  });

  test("stage 4: delete the message that changed a fact and the old value is back; restore it and the change returns", async () => {
    softDeleteMessage(m[11]!);
    await noLeak(["Scar on her right hand"], ["Scar on her left hand"]);
    restoreMessage(m[11]!);
    await noLeak(["Scar on her left hand"], ["Scar on her right hand"]);
  });

  test("stage 5: rewind and nothing from after the rewind survives, in the facts or the prompt", async () => {
    rewindAfter(m[10]!);
    await runKeepup(chatId);
    await noLeak(["Pyke", "Scar on her right hand", "Owes Joss a debt"], ["Saltpans", "Scar on her left hand", "grey"]);
    // History still knows what was, on this branch.
    expect(listFacts(wren, { chatId }).filter((f) => f.slot === "where").map((f) => [f.value, f.now])).toEqual([
      ["Riverrun", false],
      ["Saltpans", true],
    ]);
    // A tracker move's card on the gone branch isn't waiting either.
    for (const p of updateProposals(chatId)) for (const o of p.diff.ops) expect(o.value).not.toBe("Pyke");
    void decideUpdate;
    void getMessage;
  });
});
