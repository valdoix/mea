import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all } from "../src/db/db";
import { actOnInbox, inboxItems } from "../src/accuracy/inbox";
import { activateLore } from "../src/lore/activate";
import { factsNow, listFacts } from "../src/lore/facts";
import { runKeepup, updateProposals } from "../src/lore/keepup";
import "../src/lore/keepupinbox";
import { scanEntriesFor } from "../src/lore/service";
import { addSinceLine, cardSentence, sinceCardEntry, sinceCardPage } from "../src/lore/sincecard";
import { createAtom } from "../src/memory/atoms";
import { buildBrief } from "../src/meus/brief";
import { applyChange, checkChanges, undoStep } from "../src/meus/changes";
import { createCharacter } from "../src/services/characters";
import { addMessage, addSwipe, createChat, mustChat, setActiveSwipe } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { createPersona } from "../src/services/personas";
import { restoreStash } from "../src/services/undo";
import { freshDb } from "./helpers";

/** Since the card: a per-chat note on how the character and persona have changed since their cards. */
let chatId = "";
const msgs: string[] = [];
const CARD = "Wren is a ferry pilot. Wren is cold and distrustful of everyone. She lives alone.";
const cards = () => updateProposals(chatId).filter((p) => p.title.startsWith("Since the card:"));
const lines = (who: "character" | "persona") => sinceCardPage(chatId).people.find((p) => p.who === who)!.lines.map((f) => f.value);

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "tracker.update", "tracker.init", "lore.keepup", "lore.chronicle", "lore.bond"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 8000 } });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Wren", description: CARD, first_mes: "Wren ties off the ferry." } });
  const characterId = createCharacter(data);
  const personaId = createPersona({ name: "Alex", data: { description: "Alex is a stranger in town." } });
  chatId = createChat({ characterId, personaId }).id;
  for (let i = 0; i < 6; i++) msgs.push(addMessage(chatId, i % 2 ? "assistant" : "user", i % 2 ? `Wren answers (${i}).` : `You speak (${i}).`, i % 2 ? { name: "Wren" } : {}));
});

describe("proposals from the story", () => {
  test("memories that change nothing make no entry", async () => {
    createAtom(chatId, { type: "fact", content: "Wren ties a bowline.", entities: ["Wren"], importance: 4, messageIds: [msgs[1]!] });
    await runKeepup(chatId);
    expect(sinceCardEntry(chatId, "character", false)).toBeNull();
    expect(cards()).toHaveLength(0);
  });

  test("a lasting change becomes an Inbox card that quotes the card it updates", async () => {
    createAtom(chatId, { type: "relationship", content: "Wren trusts Alex now. MOCK_SINCE temperament: warm with Alex, still wary of strangers | card: cold and distrustful of everyone", entities: ["Wren", "Alex"], importance: 8, messageIds: [msgs[3]!] });
    await runKeepup(chatId);
    const card = cards()[0]!;
    expect(card.title).toBe("Since the card: Wren");
    expect(card.diff.ops[0]).toMatchObject({ op: "add", slot: "temperament", value: "warm with Alex, still wary of strangers", messageId: msgs[3]!, against: "Wren is cold and distrustful of everyone." });
    const item = inboxItems({ chatId }).find((i) => i.key === `lore-update:${card.id}`)!;
    expect(item.why).toContain("The card says “Wren is cold and distrustful of everyone.”");
    expect(item.why).toContain("the card itself isn't changed");
    actOnInbox(item.key, "accept");
    expect(lines("character")).toEqual(["warm with Alex, still wary of strangers"]);
    // Read once: nothing is asked again.
    await runKeepup(chatId);
    expect(cards()).toHaveLength(0);
  });

  test("a quote that isn't in the card is left off", () => {
    expect(cardSentence(CARD, "Wren hates the sea")).toBeUndefined();
    expect(cardSentence(CARD, "lives alone")).toBe("She lives alone.");
  });

  test("the persona gets its own note", async () => {
    createAtom(chatId, { type: "fact", content: "Alex has moved into the ferry house. MOCK_SINCE life: lives at the ferry house with Wren | card: a stranger in town", entities: ["Alex"], importance: 7, messageIds: [msgs[4]!] });
    await runKeepup(chatId);
    const card = cards().find((p) => p.title === "Since the card: Alex")!;
    expect(card.diff.ops[0]!.against).toBe("Alex is a stranger in town.");
    actOnInbox(`lore-update:${card.id}`, "accept");
    expect(lines("persona")).toEqual(["lives at the ferry house with Wren"]);
  });
});

describe("in the prompt", () => {
  const fire = () => {
    const chat = mustChat(chatId);
    const entries = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId });
    const facts = new Map(entries.map((e) => [e.id, factsNow(e.id, chatId)]));
    return activateLore({ entries, history: ["Wren: hi"], messageCount: 6, state: {}, defaults: { scanDepth: 4, tokenBudget: 0, recursive: false, maxRecursion: 0, caseSensitive: false, matchWholeWords: true }, countTokens: (s: string) => s.length, substitute: (s: string) => s.replaceAll("{{char}}", "Wren").replaceAll("{{user}}", "Alex"), facts });
  };

  test("always on, with its lines, and the card's words win nowhere they disagree", () => {
    const text = fire().activated.map((a) => a.content).join("\n");
    expect(text).toContain("Who Wren is now, in this story.");
    expect(text).toContain("- Temperament: warm with Alex, still wary of strangers");
    expect(text).toContain("- Life: lives at the ferry house with Wren");
  });

  test("a swipe away from the message it came from takes the line away; the note stays silent with nothing in it", () => {
    addSwipe(msgs[3]!, "done");
    expect(lines("character")).toEqual([]);
    const traced = fire().trace.find((t) => t.id === sinceCardEntry(chatId, "character", false));
    expect(traced?.reason).toBe("nothing has changed since the card yet");
    setActiveSwipe(msgs[3]!, 0);
    expect(lines("character")).toHaveLength(1);
  });
});

describe("yours", () => {
  test("a line you add is kept as you wrote it, and Undo takes it back", () => {
    const r = addSinceLine(chatId, "character", "Calls Alex “ferryman”", "habit");
    expect(r.fact).toMatchObject({ locked: true, origin: "you", kind: "habit" });
    expect(lines("character")).toContain("Calls Alex “ferryman”");
    restoreStash(r.undo);
    expect(lines("character")).not.toContain("Calls Alex “ferryman”");
  });

  test("Meus adds, edits and retires lines; Undo reverses each", () => {
    const add = checkChanges(chatId, [{ kind: "since_card", who: "persona", action: "add", slot: "fears", value: "losing the ferry house" }]);
    expect(add.dropped).toEqual([]);
    const steps = applyChange(chatId, { ...add.changes[0]!, id: "a" });
    expect(lines("persona")).toContain("losing the ferry house");
    const line = sinceCardPage(chatId).people.find((p) => p.who === "persona")!.lines.find((f) => f.value === "losing the ferry house")!;
    const brief = buildBrief(chatId).text;
    expect(brief).toContain("SINCE THE CARD");
    expect(brief).toContain(`[${line.id}] fears: losing the ferry house`);
    const retire = checkChanges(chatId, [{ kind: "since_card", who: "persona", action: "retire", line: line.id }]);
    const r2 = applyChange(chatId, { ...retire.changes[0]!, id: "b" });
    expect(lines("persona")).not.toContain("losing the ferry house");
    for (const s of r2) undoStep(chatId, s);
    expect(lines("persona")).toContain("losing the ferry house");
    for (const s of steps) undoStep(chatId, s);
    expect(lines("persona")).not.toContain("losing the ferry house");
    expect(checkChanges(chatId, [{ kind: "since_card", who: "persona", action: "edit", line: "nope", value: "x" }]).dropped).toEqual(["there's no such line on the Since the card note"]);
  });

  test("the card text itself is never touched", () => {
    expect(all<{ card: string }>("SELECT card FROM characters").some((r) => r.card.includes("cold and distrustful of everyone"))).toBe(true);
    expect(listFacts(sinceCardEntry(chatId, "character", false)!, { chatId }).every((f) => f.chatId === chatId)).toBe(true);
  });
});
