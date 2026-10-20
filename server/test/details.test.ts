import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { acceptIssue, checkReply, flagsFor } from "../src/accuracy/checker";
import { buildAnchor } from "../src/accuracy/anchor";
import { neverRule, neverPattern, slotRule, verbForms } from "../src/accuracy/loreslots";
import { actOnInbox, inboxItems } from "../src/accuracy/inbox";
import { setSetting } from "../src/lib/settings";
import { detailsEntry, draftDetails } from "../src/lore/details";
import { addFact, createFact, factLine, factsNow, listFacts } from "../src/lore/facts";
import "../src/lore/keepupinbox";
import { createEntry, createLorebook } from "../src/lore/service";
import { normalizeValue, sameValue, slotsFor, heightCm, numberOf } from "../src/lore/slots";
import { defaultEntry } from "../src/lore/types";
import { furthestVoiceSlot, voiceFacts, voiceLines } from "../src/lore/voice";
import { applyChange, checkChanges } from "../src/meus/changes";
import { createCharacter, getCard } from "../src/services/characters";
import { addMessage, createChat, getMessage, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
let characterId = "";
let bookId = "";
let wren = "";

const reply = (text: string) => addMessage(chatId, "assistant", text, { name: "Wren" });

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "tracker.update", "tracker.init", "lore.keepup", "lore.chronicle", "accuracy.check"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 8000 } });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Wren", description: "A ferry pilot with grey eyes.", first_mes: "Wren ties off the ferry." } });
  characterId = createCharacter(data);
  chatId = createChat({ characterId }).id;
  bookId = createLorebook({ name: "Wren's book", links: [{ target_type: "character", target_id: characterId }] });
  wren = createEntry(bookId, defaultEntry({ comment: "Wren", keys: ["Wren"], content: "Wren pilots the ferry.", extra: { type: "character" } })).id;
  const first = addMessage(chatId, "user", "You wave.");
  writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["clock: Day 1 08:00", "cast: Wren@spot"]).ops, "model");
});

describe("3.1 slots", () => {
  test("a character entry offers its slots, voice included", () => {
    const keys = slotsFor("character").map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["eyes", "hair", "scar", "handedness", "birthday", "never", "pet names", "catchphrases"]));
    expect(slotsFor("location").map((s) => s.key)).toContain("rooms");
    expect(slotsFor(undefined)).toEqual([]);
  });

  test("a second value for eyes supersedes the first; a list slot just adds", () => {
    addFact(wren, { value: "brown", slot: "eyes", origin: "you" });
    const r = addFact(wren, { value: "grey", slot: "eyes", origin: "you" });
    expect(r.replaced?.value).toBe("brown");
    expect(factsNow(wren, null).filter((f) => f.slot === "eyes").map((f) => f.value)).toEqual(["grey"]);
    expect(listFacts(wren).filter((f) => f.slot === "eyes").map((f) => [f.value, f.now])).toEqual([
      ["brown", false],
      ["grey", true],
    ]);
    addFact(wren, { value: "salt licorice", slot: "likes", origin: "you" });
    addFact(wren, { value: "rain", slot: "likes", origin: "you" });
    expect(factsNow(wren, null).filter((f) => f.slot === "likes")).toHaveLength(2);
  });

  test("the normaliser maps “steel-grey” and “gray” to the same colour, and reads heights and ages", () => {
    expect(sameValue("eyes", "steel-grey", "gray")).toBe(true);
    expect(sameValue("eyes", "grey", "brown")).toBe(false);
    expect(normalizeValue("eyes", "Steel-Grey")).toBe("grey");
    expect(heightCm("5'7\"")).toBe(170);
    expect(heightCm("170 cm")).toBe(170);
    expect(numberOf("twenty-four")).toBe(24);
    expect(normalizeValue("handedness", "Left-handed")).toBe("left");
  });
});

describe("3.3 the slot check", () => {
  test("a reply that gives grey eyes brown is flagged with the fact; accepting it updates the slot", async () => {
    const id = reply("Wren's brown eyes narrow at the tide.");
    const issues = await checkReply(chatId, id, 0, { model: false });
    const issue = issues!.find((i) => i.kind === "lore-slot")!;
    expect(issue.conflict).toContain("grey");
    expect(issue.citations[0]).toMatchObject({ type: "lore", id: wren });
    acceptIssue(flagsFor(chatId, { messageIds: [id] })[0]!.id, issue.id);
    const eyes = factsNow(wren, chatId).find((f) => f.slot === "eyes")!;
    expect(eyes.value).toBe("brown");
    expect(eyes.messageId).toBe(id);
    // The book itself still says grey: the change belongs to this chat.
    expect(factsNow(wren, null).find((f) => f.slot === "eyes")!.value).toBe("grey");
  });

  test("the scar on the wrong hand is flagged; the same colour in other words is not (her eyes are brown in this chat now)", () => {
    createFact(wren, { value: "a scar on her left hand", slot: "scar", origin: "you" });
    const st = currentFold(chatId).result.state;
    expect(slotRule(chatId, "Wren flexes the scar on her right hand.", st, "Wren").map((i) => i.kind)).toEqual(["lore-slot"]);
    expect(slotRule(chatId, "Wren flexes the scar on her left hand.", st, "Wren")).toEqual([]);
    expect(slotRule(chatId, "Wren's chestnut eyes gleam.", st, "Wren")).toEqual([]);
  });

  test("the check can be switched off in Chat › Guards", async () => {
    updateChat(chatId, { settings: { guards: { slips: { "lore-slot": false } } } as never });
    const id = reply("Wren's blue eyes narrow.");
    const issues = await checkReply(chatId, id, 0, { model: false });
    expect((issues ?? []).some((i) => i.kind === "lore-slot")).toBe(false);
    updateChat(chatId, { settings: { guards: { slips: {} } } as never });
  });
});

describe("3.4 never facts", () => {
  test("they're sent as plain statements", () => {
    expect(factLine({ slot: "never", value: "Can't swim", knownBy: [], status: "active", kind: "never" }, "Wren")).toBe("Wren can't swim.");
    expect(neverPattern("has never met Arya")).toEqual({ verb: "meet", object: "Arya" });
    expect(verbForms("swim")).toEqual(expect.arrayContaining(["swims", "swam", "swimming"]));
  });

  test("a reply where Wren swims is flagged with the fact; saying she can't isn't", () => {
    createFact(wren, { value: "Can't swim", slot: "never", kind: "never", origin: "you" });
    createFact(wren, { value: "Has never met Arya", slot: "never", kind: "never", origin: "you" });
    const st = currentFold(chatId).result.state;
    const hit = neverRule(chatId, "Wren dives off the pier and swims to the buoy.", st, "Wren");
    expect(hit).toHaveLength(1);
    expect(hit[0]!.conflict).toContain("Can't swim");
    expect(neverRule(chatId, "Wren can't swim, so she waits on the pier.", st, "Wren")).toEqual([]);
    expect(neverRule(chatId, "Wren met Arya at the gate, as always.", st, "Wren")).toHaveLength(1);
  });
});

describe("3.2 invented details at build time", () => {
  test("a sparse card's book proposes invented slots; the card's own become canon", async () => {
    const entry = detailsEntry(bookId, getCard(characterId)!.name);
    expect(entry).toBe(wren);
    const fresh = createEntry(bookId, defaultEntry({ comment: "Tam", keys: ["Tam"], content: "A deckhand.", extra: { type: "character" } })).id;
    const r = await draftDetails(fresh, characterId);
    expect(r.card.map((f) => [f.slot, f.value, f.origin])).toEqual([["eyes", "grey", "card"]]);
    expect(r.invented.map((f) => [f.slot, f.status])).toEqual([
      ["birthday", "invented"],
      ["handedness", "invented"],
    ]);
    // Unconfirmed: sent as likely.
    expect(factLine(r.invented[0]!)).toBe("Birthday: 19 January [likely, not confirmed]");
    const item = inboxItems().find((i) => i.key === `lore-details:${bookId}`)!;
    expect(item.labels).toEqual({ accept: "Keep all", reject: "Clear them" });
    actOnInbox(item.key, "accept", "Birthday: 2 March\nleft-handed");
    const kept = factsNow(fresh, null);
    expect(kept.find((f) => f.slot === "birthday")).toMatchObject({ value: "2 March", status: "active" });
    expect(factLine(kept.find((f) => f.slot === "birthday")!)).toBe("Birthday: 2 March");
  });

  test("Meus clears drafted details (lore_detail)", async () => {
    const tam = createEntry(bookId, defaultEntry({ comment: "Joss", keys: ["Joss"], content: "The innkeeper.", extra: { type: "character" } })).id;
    await draftDetails(tam, characterId);
    const { changes } = checkChanges(chatId, [{ kind: "lore_detail", entry: "Joss", action: "clear" }]);
    applyChange(chatId, { ...changes[0]!, id: "x" });
    expect(factsNow(tam, null).filter((f) => f.status === "invented")).toHaveLength(0);
  });
});

describe("3.5 voice slots in the re-anchor", () => {
  test("the re-anchor includes the voice slots; a drift alert names one", () => {
    createFact(wren, { value: "love", slot: "pet names", kind: "voice", origin: "you" });
    createFact(wren, { value: "Tides willing", slot: "catchphrases", kind: "voice", origin: "you" });
    const lines = voiceLines(voiceFacts(chatId, "Wren"), "Sam");
    expect(lines).toEqual(["Calls Sam: “love”", "Says: “Tides willing”"]);
    const card = getCard(characterId)!;
    expect(buildAnchor({ card, userName: "Sam", characterId, voice: lines })).toContain("Calls Sam: “love”");
    expect(furthestVoiceSlot(voiceFacts(chatId, "Wren"), "Tides willing, she says.")).toBe("hasn't used their pet names for you (“love”) lately");
    expect(furthestVoiceSlot(voiceFacts(chatId, "Wren"), "Tides willing, love.")).toBeNull();
    void getMessage;
    void setSetting;
  });
});
