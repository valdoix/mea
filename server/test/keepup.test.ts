import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all, one } from "../src/db/db";
import { actOnInbox, inboxItems } from "../src/accuracy/inbox";
import { createFact, factsNow, getFact, listFacts, updateFact } from "../src/lore/facts";
import { decideUpdate, staleSentences, updateProposals, runKeepup, afterApplied } from "../src/lore/keepup";
import "../src/lore/keepupinbox";
import { createEntry, createLorebook, getEntries, updateLorebook } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { createAtom } from "../src/memory/atoms";
import { applyChange, checkChanges, undoStep } from "../src/meus/changes";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, editMessage } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { filingsFor, undoFiling } from "../src/services/filings";
import { registerJob } from "../src/services/jobs";
import { restoreStash } from "../src/services/undo";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
let bookId = "";
let wren = "";
const msgs: string[] = [];

/** Tracker lines as the model would have read them from a reply. */
const story = (i: number, lines: string[]) => writeEvents(chatId, { messageId: msgs[i]!, swipeIdx: 0 }, linesToOps(lines).ops, "model");
const where = () => factsNow(wren, chatId).filter((f) => f.slot === "where").map((f) => f.value);
const cards = () => updateProposals(chatId).filter((p) => p.kind === "update" && p.entryId === wren);

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "tracker.update", "tracker.init", "lore.keepup", "lore.chronicle"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 8000 } });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Wren", description: "A ferry pilot.", first_mes: "Wren ties off the ferry." } });
  const characterId = createCharacter(data);
  chatId = createChat({ characterId }).id;
  bookId = createLorebook({ name: "Wren's book", links: [{ target_type: "character", target_id: characterId }] });
  wren = createEntry(bookId, defaultEntry({ comment: "Wren", keys: ["Wren"], content: "Wren lives in Riverrun and pilots the ferry.", extra: { type: "character" } })).id;
  for (let i = 0; i < 10; i++) msgs.push(addMessage(chatId, i % 2 ? "assistant" : "user", i % 2 ? `Wren answers (${i}).` : `You speak (${i}).`, i % 2 ? { name: "Wren" } : {}));
});

describe("2.1 proposals from tracker changes", () => {
  test("a tracker move proposes a location fact; applying it adds it from the message it came from", async () => {
    story(1, ["clock: Day 1 08:00", "at: Riverrun", "cast: Wren@spot"]);
    const r = await runKeepup(chatId);
    expect(r.proposed).toHaveLength(1);
    const card = cards()[0]!;
    expect(card.diff.ops.map((o) => [o.op, o.slot, o.value, o.origin])).toEqual([["add", "where", "Riverrun", "tracker"]]);
    expect(card.diff.ops[0]!.messageId).toBe(msgs[1]!);
    decideUpdate(card.id, "accept");
    expect(where()).toEqual(["Riverrun"]);
    // Nothing changed since: nothing is asked again.
    expect((await runKeepup(chatId)).proposed).toHaveLength(0);
  });

  test("a second move supersedes the old fact (kept in History), as one card per entry", async () => {
    story(3, ["at: Saltpans"]);
    await runKeepup(chatId);
    const card = cards()[0]!;
    expect(card.diff.ops.map((o) => [o.op, o.old, o.value])).toEqual([["supersede", "Riverrun", "Saltpans"]]);
    // The Inbox shows it as a diff line, with Apply / Not this.
    const item = inboxItems({ chatId }).find((i) => i.key === `lore-update:${card.id}`)!;
    expect(item.after).toBe("Where: Riverrun → Saltpans");
    expect(item.labels).toEqual({ accept: "Apply", reject: "Not this" });
    actOnInbox(item.key, "accept");
    expect(where()).toEqual(["Saltpans"]);
    expect(listFacts(wren, { chatId }).find((f) => f.value === "Riverrun")!.now).toBe(false);
  });

  test("a rejected proposal is never asked again for the same change", async () => {
    story(5, ["body Wren: injury: left arm, wound"]);
    await runKeepup(chatId);
    const card = cards()[0]!;
    expect(card.diff.ops[0]).toMatchObject({ op: "add", slot: "injury (left arm)", value: "a wound" });
    decideUpdate(card.id, "reject");
    await runKeepup(chatId);
    expect(cards()).toHaveLength(0);
  });

  test("2.4: the core still names the old place: a rewrite is offered, and only saved when kept", async () => {
    const applied = one<{ id: string }>("SELECT id FROM chronicle_proposals WHERE entry_id = ? AND kind = 'update' AND status = 'accepted' AND diff LIKE '%Saltpans%'", wren)!;
    expect(staleSentences("Wren lives in Riverrun and pilots the ferry. She hums.", ["Riverrun"])).toEqual(["Wren lives in Riverrun and pilots the ferry."]);
    const core = (await afterApplied(applied.id)) ?? updateProposals(chatId).find((p) => p.kind === "core")?.id;
    const p = updateProposals(chatId).find((x) => x.id === core)!;
    expect(p.diff.core!.after).toBe("Wren lives in Saltpans and pilots the ferry.");
    expect(getEntries(bookId).find((e) => e.id === wren)!.content).toContain("Riverrun");
    const item = inboxItems({ chatId }).find((i) => i.key === `lore-update:${p.id}`)!;
    expect(item.labels).toEqual({ accept: "Keep", reject: "Not now" });
    const r = decideUpdate(p.id, "accept");
    expect(getEntries(bookId).find((e) => e.id === wren)!.content).toBe("Wren lives in Saltpans and pilots the ferry.");
    restoreStash(r.undo!);
    expect(getEntries(bookId).find((e) => e.id === wren)!.content).toContain("Riverrun");
  });
});

describe("2.3 trust levels, locks and re-checks", () => {
  test("“apply tracker facts” applies a move with a chip and Undo, and still asks about a memory change", async () => {
    updateLorebook(bookId, { settings: { keepup: "tracker" } });
    story(7, ["at: Saltpans › The Gull"]);
    createAtom(chatId, { type: "fact", content: "Wren now goes by Wrennie at the inn", entities: ["Wren"], importance: 6, messageIds: [msgs[7]!] });
    const r = await runKeepup(chatId);
    expect(r.applied[0]!.ops.map((o) => o.value)).toEqual(["Saltpans › The Gull"]);
    expect(where()).toEqual(["Saltpans › The Gull"]);
    const chip = filingsFor(chatId).find((f) => f.kind === "lore_update" && f.messageId === msgs[7]!)!;
    expect(chip.label).toContain("Where: Saltpans → Saltpans › The Gull");
    // The memory change still waits for you, citing the memory.
    const ask = cards().find((c) => c.diff.ops.some((o) => o.slot === "nickname"))!;
    expect(ask.diff.ops[0]).toMatchObject({ op: "add", value: "Wrennie", origin: "story" });
    expect(ask.diff.ops[0]!.citeText).toContain("Wrennie");
    // The chip's Undo takes the move back.
    undoFiling(chip.id);
    expect(where()).toEqual(["Saltpans"]);
    decideUpdate(ask.id, "accept");
    expect(factsNow(wren, chatId).find((f) => f.slot === "nickname")?.value).toBe("Wrennie");
  });

  test("a locked fact gets a contradiction card instead of a change", async () => {
    updateLorebook(bookId, { settings: { keepup: "all" } });
    const f = factsNow(wren, chatId).find((x) => x.slot === "where")!;
    updateFact(f.id, { locked: true });
    story(9, ["at: Pyke"]);
    const r = await runKeepup(chatId);
    expect(r.applied).toHaveLength(0);
    expect(where()).toEqual(["Saltpans"]);
    const card = updateProposals(chatId).find((p) => p.diff.contradiction)!;
    const item = inboxItems({ chatId }).find((i) => i.key === `lore-update:${card.id}`)!;
    expect(item.labels).toEqual({ accept: "Update it", reject: "Keep mine" });
    actOnInbox(item.key, "accept");
    expect(where()).toEqual(["Pyke"]);
  });

  test("editing a fact's source message marks it for a re-check", () => {
    const made = createFact(wren, { value: "Has a scar on her left hand", chatId, messageId: msgs[3]!, origin: "story" }).fact;
    expect(getFact(made.id)!.stale).toBe(false);
    editMessage(msgs[3]!, "Wren answers, and her hands are unmarked.");
    expect(getFact(made.id)!.stale).toBe(true);
    const item = inboxItems({ chatId }).find((i) => i.key === `lore-recheck:${made.id}`)!;
    expect(item.labels).toEqual({ accept: "Still true", reject: "Retire it" });
    actOnInbox(item.key, "accept");
    expect(getFact(made.id)!.stale).toBe(false);
  });
});

describe("2.2 proposals from memories", () => {
  test("an operation with no citation is dropped", async () => {
    updateLorebook(bookId, { settings: { keepup: "ask" } });
    createAtom(chatId, { type: "fact", content: "MOCK_UNCITED Wren hums at night", entities: ["Wren"], importance: 5 });
    await runKeepup(chatId);
    expect(all("SELECT 1 FROM chronicle_proposals WHERE diff LIKE '%Something nobody said%'")).toHaveLength(0);
  });

  test("Meus applies a waiting update (lore_update) and Undo takes it back", async () => {
    createAtom(chatId, { type: "fact", content: "Wren goes by Birdie now", entities: ["Wren"], importance: 6, messageIds: [msgs[9]!] });
    await runKeepup(chatId);
    const card = cards().find((c) => c.diff.ops.some((o) => o.value === "Birdie"))!;
    const { changes } = checkChanges(chatId, [{ kind: "lore_update", proposal: `lore-update:${card.id}`, action: "apply" }]);
    expect(changes[0]!.kind).toBe("lore_update");
    const steps = applyChange(chatId, { ...changes[0]!, id: "x" });
    expect(factsNow(wren, chatId).some((f) => f.value === "Birdie")).toBe(true);
    for (const s of steps) undoStep(chatId, s);
    expect(factsNow(wren, chatId).some((f) => f.value === "Birdie")).toBe(false);
  });
});

describe("only the entry a change is about", () => {
  test("a belief or a relationship that fires on a name gets neither the trackers' facts nor the person's memories", async () => {
    const belief = createEntry(bookId, defaultEntry({ comment: "Wren's Belief: The River Keeps Its Dead", keys: ["Wren"], content: "Wren believes the river keeps what it takes.", extra: { category: "belief", entity: "Wren" } })).id;
    const pair = createEntry(bookId, defaultEntry({ comment: "Wren & Joss", keys: ["Wren"], content: "Wren and Joss grew up on the same pier." })).id;
    const on = (id: string) => updateProposals(chatId).filter((p) => p.kind === "update" && p.entryId === id);
    msgs.push(addMessage(chatId, "assistant", "Wren poles to Harlow Pier.", { name: "Wren" }));
    story(10, ["at: Harlow Pier"]);
    createAtom(chatId, { type: "fact", content: "Wren goes by Wrenny at the docks", entities: ["Wren"], importance: 6, messageIds: [msgs[10]!] });
    await runKeepup(chatId);
    expect(on(belief)).toHaveLength(0);
    expect(on(pair)).toHaveLength(0);
    // Wren's own entry still keeps up.
    expect(cards().some((c) => c.diff.ops.some((o) => o.slot === "where" && o.value === "Harlow Pier"))).toBe(true);
    // A memory about what the entry covers still reaches it.
    createAtom(chatId, { type: "fact", content: "Wren goes by Ferrywoman since the river took her brother", entities: ["Wren"], importance: 6, messageIds: [msgs[9]!] });
    createAtom(chatId, { type: "fact", content: "Wren goes by Pierkid around Joss", entities: ["Wren", "Joss"], importance: 6, messageIds: [msgs[9]!] });
    await runKeepup(chatId);
    expect(on(belief).flatMap((c) => c.diff.ops.map((o) => o.value))).toEqual(["Ferrywoman"]);
    expect(on(pair).flatMap((c) => c.diff.ops.map((o) => o.value))).toEqual(["Pierkid"]);
  });

  test("“Voice: Wren” is a voice and “Character: Wren” is Wren, by the title alone", async () => {
    const voice = createEntry(bookId, defaultEntry({ comment: "Voice: Wren", keys: ["Wren"], content: "Low, short, harbour words.", extra: { type: "character" } })).id;
    const profile = createEntry(bookId, defaultEntry({ comment: "Character: Wren", keys: ["Wren"], content: "Wren pilots the ferry." })).id;
    const on = (id: string) => updateProposals(chatId).filter((p) => p.kind === "update" && p.entryId === id).flatMap((c) => c.diff.ops);
    msgs.push(addMessage(chatId, "assistant", "Wren poles to Pyke.", { name: "Wren" }));
    story(11, ["at: Pyke Docks"]);
    createAtom(chatId, { type: "fact", content: "Wren goes by Gull and lost her brother to the river", entities: ["Wren"], importance: 6, messageIds: [msgs[11]!] });
    createAtom(chatId, { type: "fact", content: "Wren calls everyone at the docks love and goes by Skipper", entities: ["Wren"], importance: 6, messageIds: [msgs[11]!] });
    await runKeepup(chatId);
    // The voice gets neither the move nor her family, only how she talks.
    expect(on(voice).map((o) => o.value)).toEqual(["Skipper"]);
    // The profile keeps up with where she is and both memories.
    expect(on(profile).some((o) => o.slot === "where" && o.value === "Pyke Docks")).toBe(true);
    expect(on(profile).filter((o) => o.slot === "nickname").map((o) => o.value)).toEqual(expect.arrayContaining(["Gull", "Skipper"]));
  });
});
