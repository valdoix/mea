import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { activateLore, type ScanEntry } from "../src/lore/activate";
import { pickFactEntry } from "../src/lore/factpick";
import { createFact, deleteFact, factsNow, factsNowFor, listFacts, retireFact, supersedeFact, updateFact } from "../src/lore/facts";
import { createEntry, createLorebook, getLorebook } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { applyMeus, meusTurn, undoMeus } from "../src/meus/meus";
import { createCharacter } from "../src/services/characters";
import { addMessage, addSwipe, createChat, deleteSwipe, getMessage, restoreMessage, setActiveSwipe, softDeleteMessage, updateSwipe } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { previewPrompt } from "../src/services/generation";
import { registerJob } from "../src/services/jobs";
import { restoreStash } from "../src/services/undo";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
let chatId = "";
let bookId = "";
let wren = "";
let inn = "";
const msgs: string[] = [];

async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.fetch(
    new Request(`http://localhost${path}`, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body === undefined ? undefined : JSON.stringify(body) }),
    { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) },
  );
  return { status: res.status, json: (await res.json()) as T };
}

const values = (entryId: string, seq?: number) => factsNow(entryId, chatId, seq).map((f) => f.value);
const seqOf = (i: number) => getMessage(msgs[i]!)!.seq;

beforeAll(async () => {
  freshDb();
  app = createApp();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "tracker.update", "tracker.init"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 8000 } });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Wren", description: "A ferry pilot.", first_mes: "Wren ties off the ferry." } });
  const characterId = createCharacter(data);
  chatId = createChat({ characterId }).id;
  bookId = createLorebook({ name: "Wren's book", links: [{ target_type: "character", target_id: characterId }] });
  wren = createEntry(bookId, defaultEntry({ comment: "Wren", keys: ["Wren"], content: "Wren pilots the ferry across the Saltpans.", extra: { type: "character" } })).id;
  inn = createEntry(bookId, defaultEntry({ comment: "The Gull", keys: ["the Gull", "inn"], content: "An inn on the docks." })).id;
  for (let i = 0; i < 6; i++) msgs.push(addMessage(chatId, i % 2 ? "assistant" : "user", i % 2 ? `Wren answers (${i}).` : `You speak (${i}).`, i % 2 ? { name: "Wren" } : {}));
  msgs.push(addMessage(chatId, "assistant", "Wren rolls up her sleeve. The scar on her left hand is pale in the lamplight.", { name: "Wren" }));
});

describe("1.1 facts table and branch-safe reads", () => {
  test("a story fact holds from its message on, and not before", () => {
    const at = msgs[3]!;
    createFact(wren, { value: "Lives at the Gull", messageId: at, origin: "story" });
    expect(values(wren, seqOf(3))).toContain("Lives at the Gull");
    expect(values(wren, seqOf(3) + 1)).toContain("Lives at the Gull");
    expect(values(wren, seqOf(3) - 1)).not.toContain("Lives at the Gull");
    // Canon facts hold everywhere, from the start.
    createFact(wren, { value: "Grey", slot: "eyes", origin: "card" });
    expect(values(wren, 1)).toContain("Grey");
    expect(factsNow(wren, null).map((f) => f.value)).toEqual(["Grey"]);
  });

  test("swiping the message hides it; swiping back restores it; deleting the message drops it", () => {
    const at = msgs[3]!;
    const idx = addSwipe(at, "done");
    updateSwipe(at, idx, { content: "Wren says something else." });
    expect(values(wren)).not.toContain("Lives at the Gull");
    setActiveSwipe(at, 0);
    expect(values(wren)).toContain("Lives at the Gull");
    softDeleteMessage(at);
    expect(values(wren)).not.toContain("Lives at the Gull");
    restoreMessage(at);
    expect(values(wren)).toContain("Lives at the Gull");
  });

  test("a fact you add in a chat stays on every swipe; deleting a swipe takes its facts and renumbers the rest", () => {
    const at = msgs[5]!;
    createFact(wren, { value: "Hums sea shanties", chatId, messageId: at, origin: "you" });
    const idx = addSwipe(at, "done");
    createFact(wren, { value: "Owes the harbourmaster", messageId: at, origin: "story" });
    expect(values(wren)).toEqual(expect.arrayContaining(["Hums sea shanties", "Owes the harbourmaster"]));
    setActiveSwipe(at, 0);
    expect(values(wren)).toContain("Hums sea shanties");
    expect(values(wren)).not.toContain("Owes the harbourmaster");
    // Another swipe after it: deleting the first moves the one we made down to 0, with its fact.
    setActiveSwipe(at, idx);
    deleteSwipe(at, 0);
    expect(getMessage(at)!.activeSwipe).toBe(0);
    expect(values(wren)).toContain("Owes the harbourmaster");
  });

  test("supersede keeps one value per slot; the old one returns when the new one's swipe goes", () => {
    const eyes = factsNow(wren, chatId).find((f) => f.slot === "eyes")!;
    const at = msgs[6]!;
    const r = supersedeFact(eyes.id, { value: "Steel-grey", messageId: at, origin: "story" });
    expect(factsNow(wren, chatId).filter((f) => f.slot === "eyes").map((f) => f.value)).toEqual(["Steel-grey"]);
    // Before the change it's still grey, in this chat.
    expect(factsNow(wren, chatId, seqOf(6) - 1).filter((f) => f.slot === "eyes").map((f) => f.value)).toEqual(["Grey"]);
    const idx = addSwipe(at, "done");
    expect(factsNow(wren, chatId).filter((f) => f.slot === "eyes").map((f) => f.value)).toEqual(["Grey"]);
    setActiveSwipe(at, 0);
    expect(listFacts(wren, { chatId }).filter((f) => f.slot === "eyes").map((f) => [f.value, f.now])).toEqual([
      ["Grey", false],
      ["Steel-grey", true],
    ]);
    // Undo puts the old one back and takes the new one away.
    restoreStash(r.undo);
    expect(factsNow(wren, chatId).filter((f) => f.slot === "eyes").map((f) => f.value)).toEqual(["Grey"]);
    expect(idx).toBe(1);
  });

  test("retire, lock, delete, all with Undo", () => {
    const f = createFact(inn, { value: "Its sign is a gull", chatId, origin: "you" }).fact;
    const ret = retireFact(f.id);
    expect(factsNow(inn, chatId).map((x) => x.value)).not.toContain("Its sign is a gull");
    expect(listFacts(inn, { chatId }).find((x) => x.id === f.id)!.now).toBe(false);
    restoreStash(ret.undo);
    expect(factsNow(inn, chatId).map((x) => x.value)).toContain("Its sign is a gull");
    updateFact(f.id, { locked: true });
    expect(() => updateFact(f.id, { value: "Its sign is a crow" })).toThrow(/locked/);
    expect(() => supersedeFact(f.id, { value: "Its sign is a crow" })).toThrow(/locked/);
    const d = deleteFact(f.id);
    expect(listFacts(inn, { chatId }).some((x) => x.id === f.id)).toBe(false);
    restoreStash(d.undo);
    expect(factsNow(inn, chatId).find((x) => x.id === f.id)?.locked).toBe(true);
  });

  test("a chat's facts stay in that chat; canon shows in every chat, even after one chat changes it", () => {
    const other = createChat({ characterId: getLorebook(bookId)!.links[0]!.id }).id;
    expect(factsNow(wren, other).map((f) => f.value)).toEqual(["Grey"]);
    const canon = factsNow(wren, other)[0]!;
    const greeting = addMessage(other, "assistant", "Wren squints.", { name: "Wren" });
    const here = createFact(wren, { value: "Dark", slot: "hair", messageId: greeting, origin: "story" });
    const r = supersedeFact(canon.id, { value: "Hazel", messageId: greeting, origin: "story" });
    expect(factsNow(wren, other).map((f) => f.value).sort()).toEqual(["Dark", "Hazel"]);
    // The canon row is untouched: still Grey in the first chat and in the book, and changeable again.
    expect(factsNow(wren, null).map((f) => f.value)).toEqual(["Grey"]);
    expect(factsNow(wren, chatId).find((f) => f.slot === "eyes")?.value).toBe("Grey");
    restoreStash(r.undo);
    restoreStash(here.undo);
    expect(factsNow(wren, other).map((f) => f.value)).toEqual(["Grey"]);
  });
});

describe("1.2 facts in the prompt", () => {
  const scan = (): ScanEntry[] => getLorebook(bookId)!.entries.map((e) => ({ ...e, bookId, bookName: "Wren's book", book: {} }));
  const fire = (facts: ReturnType<typeof factsNowFor>) =>
    activateLore({ entries: scan(), history: ["Wren and the inn"], messageCount: 10, state: {}, defaults: { scanDepth: 4, tokenBudget: 0, recursive: false, maxRecursion: 0, caseSensitive: false, matchWholeWords: true }, countTokens: (s) => s.length, facts });

  test("a fired entry carries a Now: block; superseded facts are left out; secrets name their keepers", () => {
    const eyes = factsNow(wren, chatId).find((f) => f.slot === "eyes")!;
    supersedeFact(eyes.id, { value: "Grey-green", messageId: msgs[6]!, origin: "story" });
    createFact(wren, { value: "Smuggles letters for the rebels", chatId, knownBy: ["Wren", "Tam"], origin: "you" });
    const r = fire(factsNowFor([wren, inn], chatId));
    const text = r.activated.find((a) => a.entry.id === wren)!.content;
    expect(text).toContain("Wren pilots the ferry");
    expect(text).toContain("Now:\n- ");
    expect(text).toContain("- Eyes: Grey-green");
    expect(text).not.toContain("Eyes: Grey\n");
    expect(text).toContain("Smuggles letters for the rebels [secret — known only to Wren, Tam]");
    const trace = r.trace.find((t) => t.id === wren)!;
    expect(trace.facts).toContain("Eyes: Grey-green");
  });

  test("the chat's prompt has them, and the Inspector lists them", async () => {
    const p = await previewPrompt(chatId);
    expect(p.messages.map((m) => m.content).join("\n")).toContain("- Eyes: Grey-green");
    expect(p.trace.lore.find((t) => t.id === wren)?.facts).toContain("Lives at the Gull");
  });
});

describe("1.3 facts from the editor and the Codex (routes)", () => {
  test("add, lock, retire, and undo, as canon (editor) and in a chat (Codex)", async () => {
    const add = await api("POST", `/api/lore/entries/${inn}/facts`, { value: "Three storeys, crooked" });
    expect(add.status).toBe(201);
    expect(add.json.fact.chatId).toBeNull();
    const inChat = await api("POST", `/api/lore/entries/${inn}/facts`, { value: "The back door sticks", chatId });
    expect(inChat.json.fact.chatId).toBe(chatId);
    expect(inChat.json.fact.swipeIdx).toBe(-1);
    const lock = await api("PATCH", `/api/lore/facts/${add.json.fact.id}`, { locked: true });
    expect(lock.json.fact.locked).toBe(true);
    const ret = await api("POST", `/api/lore/facts/${inChat.json.fact.id}/retire`, {});
    expect(ret.status).toBe(200);
    const list = await api("GET", `/api/lore/entries/${inn}/facts?chatId=${chatId}`);
    expect(list.json.facts.find((f: { id: string }) => f.id === inChat.json.fact.id).now).toBe(false);
    await api("POST", `/api/undo/${ret.json.undo}`);
    const after = await api("GET", `/api/lore/entries/${inn}/facts?chatId=${chatId}`);
    expect(after.json.facts.find((f: { id: string }) => f.id === inChat.json.fact.id).now).toBe(true);
    // The editor (no chat) sees canon and every chat's, with the chat named.
    const all = await api("GET", `/api/lore/entries/${inn}/facts`);
    expect(all.json.facts.map((f: { value: string }) => f.value)).toEqual(expect.arrayContaining(["Three storeys, crooked", "The back door sticks"]));
    await api("POST", `/api/undo/${add.json.undo}`);
    expect((await api("GET", `/api/lore/entries/${inn}/facts`)).json.facts.some((f: { id: string }) => f.id === add.json.fact.id)).toBe(false);
  });

  test("deleting an entry takes its facts, and Undo brings them back", async () => {
    const e = createEntry(bookId, defaultEntry({ comment: "Tam", keys: ["Tam"], content: "A deckhand." })).id;
    createFact(e, { value: "Left-handed", origin: "you" });
    const d = await api("DELETE", `/api/lorebooks/${bookId}/entries/${e}`);
    expect(factsNow(e, null)).toHaveLength(0);
    await api("POST", `/api/undo/${d.json.undo}`);
    expect(factsNow(e, null).map((f) => f.value)).toEqual(["Left-handed"]);
  });
});

describe("1.4 remember as a fact", () => {
  test("selecting “the scar on her left hand” offers Wren's entry with the fact pre-filled", async () => {
    const at = msgs[6]!;
    const pick = pickFactEntry(chatId, at, "the scar on her left hand");
    expect(pick.candidates[0]!.entryId).toBe(wren);
    expect(pick.value).toBe("The scar on her left hand");
    const r = await api("POST", `/api/chats/${chatId}/lore/fact/pick`, { messageId: at, text: "the scar on her left hand." });
    expect(r.json.candidates[0].entryId).toBe(wren);
    const made = await api("POST", `/api/lore/entries/${wren}/facts`, { value: r.json.value, messageId: at, chatId, fromText: true });
    expect(made.json.fact.origin).toBe("story");
    expect(made.json.fact.swipeIdx).toBe(getMessage(at)!.activeSwipe);
    expect(values(wren)).toContain("The scar on her left hand");
  });

  test("Meus can add the same fact from a sentence, and Undo takes it back", async () => {
    const v = await meusTurn(chatId, "lore fact: Wren — Can't swim");
    const c = v.proposal!.changes[0]!;
    expect(c.kind).toBe("lore_fact");
    const a = applyMeus(chatId, [c.id]);
    expect(values(wren)).toContain("Can't swim");
    undoMeus(chatId, a.setId!);
    expect(values(wren)).not.toContain("Can't swim");
  });
});
