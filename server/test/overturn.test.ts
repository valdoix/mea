import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { setSetting, defaultMemoryConfig } from "../src/lib/settings";
import { getAtom, insertAtom } from "../src/memory/atoms";
import { contentWords, covers, restoreUnaware, retireUnaware, runTruthsJob, truthCandidates, truthsChanged, unawareOf } from "../src/memory/overturn";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, getMessageRow, onTruthsChanged, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { run } from "../src/db/db";
import { freshDb } from "./helpers";

let chatId = "";
const ids: string[] = [];

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "memory.truths", "lore.chronicle", "accuracy.check", "accuracy.drift", "quota.refresh", "cache.probe"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 400 } });
  setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false, checkerModel: false });
  const charId = createCharacter(normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", description: "A slayer.", first_mes: "Hi." } }).data);
  chatId = createChat({ characterId: charId }).id;
  for (let i = 0; i < 8; i++) ids.push(addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}.`, { name: i % 2 ? "Buffy" : "You" }));
});

const seqOf = (id: string) => getMessageRow(id)!.seq;
const remember = (content: string, at: number) => insertAtom(chatId, null, { type: "fact", content }, [{ id: ids[at]!, seq: seqOf(ids[at]!) }]);

describe("what someone doesn't know (docs/33 Part 2)", () => {
  test("reads who doesn't know what, and nothing else", () => {
    expect(unawareOf("Dawn is fifteen years old and does not know Buffy is alive — Buffy has been dead for 147 days")).toEqual({ who: "Dawn", what: "Buffy is alive" });
    expect(unawareOf("Buffy has not told her family she is alive")).toEqual({ who: "her family", what: "Buffy is alive", teller: "Buffy" });
    expect(unawareOf("Dawn does not know the college fund is gone; Buffy decided not to tell her")).toEqual({ who: "Dawn", what: "the college fund is gone" });
    expect(unawareOf("Buffy doesn't know if Dawn is safe or where she is")).toBeNull();
    expect(unawareOf("The price tag doesn't know what forever means")).toBeNull();
    expect(unawareOf("Gabriel made cream soup with nutmeg.")).toBeNull();
  });
  test("a fact covers it only when most of its words are there", () => {
    expect(covers("Buffy is alive", "Buffy is alive")).toBe(true);
    expect(covers("Buffy is alive", "Buffy is alive, warm, smells like French shampoo")).toBe(true);
    expect(covers("the college fund is gone", "Buffy is alive")).toBe(false);
    expect(covers("alive", "Buffy is alive")).toBe(false);
    expect([...contentWords("Buffy's boots were bought")]).toEqual(["buffy", "boot", "bought"]);
  });
  test("retires once the trackers record them knowing it, and comes back with the swipe", () => {
    const stale = remember("Dawn is fifteen years old and does not know Buffy is alive", 1);
    const other = remember("Dawn does not know the college fund is gone", 1);
    const family = remember("Buffy has not told her family she is alive", 1);
    const mine = remember("Dawn does not know Buffy is alive (my note)", 1);
    // Your own memory is never touched.
    updateMine(mine);
    expect(retireUnaware(chatId)).toBe(0);
    // The teller knowing it, or someone knowing that another doesn't, proves nothing.
    writeEvents(chatId, { messageId: ids[3]!, swipeIdx: 0 }, linesToOps(["know Buffy Summers: Dawn is fifteen and doesn't know Buffy is alive · knows · true", "know Buffy Summers: Buffy is alive · knows · true"]).ops, "model");
    expect(retireUnaware(chatId)).toBe(0);
    writeEvents(chatId, { messageId: ids[5]!, swipeIdx: 0 }, linesToOps(["know Dawn Summers: Buffy is alive | heard her voice on the phone · knows · true"]).ops, "model");
    expect(retireUnaware(chatId)).toBe(2);
    expect(getAtom(stale)!.status).toBe("superseded");
    expect(getAtom(family)!.status).toBe("superseded");
    expect(getAtom(other)!.status).toBe("active");
    expect(getAtom(mine)!.status).toBe("active");
    const by = getAtom(getAtom(stale)!.superseded_by!)!;
    expect(by.content).toContain("Dawn Summers knows now: Buffy is alive");
    // A second pass changes nothing.
    expect(retireUnaware(chatId)).toBe(0);
    // Swiping to a take where nobody learned it brings the old memories back...
    run("UPDATE messages SET active_swipe = 1 WHERE id = ?", ids[5]!);
    expect(restoreUnaware(chatId)).toBe(1);
    expect(getAtom(stale)!.status).toBe("active");
    expect(getAtom(family)!.status).toBe("active");
    // ...and back again retires them again.
    run("UPDATE messages SET active_swipe = 0 WHERE id = ?", ids[5]!);
    expect(retireUnaware(chatId)).toBe(2);
  });
  test("knowing it before the memory was made doesn't retire it", () => {
    writeEvents(chatId, { messageId: ids[2]!, swipeIdx: 0 }, linesToOps(["know Tara: the spell worked · knows · true"]).ops, "model");
    const later = remember("Tara does not know the spell worked", 6);
    expect(retireUnaware(chatId)).toBe(0);
    expect(getAtom(later)!.status).toBe("active");
  });
});

function updateMine(id: string) {
  // As if you had edited it.
  run("UPDATE memories SET user_edited = 1 WHERE id = ?", id);
}

describe("story truths (docs/33 Part 2)", () => {
  test("a truth retires the memories it rules out, and becomes a memory of yours", async () => {
    const wrong = remember("Buffy's new boots were bought with a dead woman's debit card. MOCK_CONTRADICTS", 3);
    const fine = remember("Buffy's new boots are black, low heel, patrol-and-dinner.", 3);
    const away = remember("Spike plays cards with Dawn on Tuesdays.", 3);
    expect(truthCandidates(chatId, "Buffy's shoes and clothes were bought by Gabriel").map((r) => r.id)).toContain(wrong);
    expect(truthCandidates(chatId, "Buffy's shoes and clothes were bought by Gabriel").map((r) => r.id)).not.toContain(away);
    await runTruthsJob({ chatId, truths: ["Buffy's boots and clothes were bought by Gabriel"] });
    expect(getAtom(wrong)!.status).toBe("superseded");
    expect(getAtom(fine)!.status).toBe("active");
    const truth = getAtom(getAtom(wrong)!.superseded_by!)!;
    expect(truth.content).toBe("Buffy's boots and clothes were bought by Gabriel");
    expect(truth.user_edited).toBe(1);
  });
  test("adding a truth queues the check; removing one doesn't", () => {
    onTruthsChanged(truthsChanged);
    updateChat(chatId, { settings: { truths: ["Dawn already knew about Brongel"] } });
    updateChat(chatId, { settings: { truths: [] } });
    expect(require("../src/db/db").all("SELECT payload FROM jobs WHERE kind = 'memory.truths'").length).toBe(1);
  });
});
