import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { actOnInbox, inboxItems } from "../src/accuracy/inbox";
import { compactEntry, decideCompaction, lostNames, namesAndNumbers } from "../src/lore/compact";
import { coverageFindings, fixFinding, mergeEntries } from "../src/lore/coverage";
import { createFact, factsNow, listFacts, supersedeFact } from "../src/lore/facts";
import { recordLoreHits } from "../src/lore/health";
import "../src/lore/keepupinbox";
import { createEntry, createLorebook, getEntries } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { createAtom } from "../src/memory/atoms";
import { createEntity } from "../src/memory/entities";
import { run } from "../src/db/db";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { registerJob } from "../src/services/jobs";
import { restoreStash } from "../src/services/undo";
import { freshDb } from "./helpers";

let chatId = "";
let world = "";
let companion = "";
let wrenW = "";
let wrenC = "";
let joss = "";

beforeAll(() => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "tracker.update", "tracker.init", "lore.keepup", "lore.time", "lore.bond", "lore.compact"]) registerJob(kind, async () => {});
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "A keeper.", first_mes: "Hi." } });
  const characterId = createCharacter(data);
  chatId = createChat({ characterId }).id;
  world = createLorebook({ name: "The world", links: [{ target_type: "character", target_id: characterId }] });
  companion = createLorebook({ name: "Mira's book", links: [{ target_type: "character", target_id: characterId }] });
  wrenW = createEntry(world, defaultEntry({ comment: "Wren", keys: ["Wren"], content: "Wren pilots the ferry across the Saltpans, and has done so for years without missing a crossing.", extra: { type: "character" } })).id;
  wrenC = createEntry(companion, defaultEntry({ comment: "Wren Tully", keys: ["Wren"], content: "Mira's oldest friend.", extra: { type: "character" } })).id;
  joss = createEntry(world, defaultEntry({ comment: "Joss", keys: ["Joss"], content: "The innkeeper.", extra: { type: "character" } })).id;
  createFact(wrenW, { value: "grey", slot: "eyes", origin: "you" });
  createFact(wrenC, { value: "brown", slot: "eyes", origin: "you" });
  // Joss is busy in the story (12 mentions, the last one just now); his entry says little and never fires.
  for (let i = 0; i < 12; i++) {
    addMessage(chatId, "user", "You ask.");
    addMessage(chatId, "assistant", `Joss pours another drink, and Old Joss laughs (${i}).`, { name: "Mira" });
  }
  // The Codex knows him as Joss and Old Joss, busy and seen just now.
  const ent = createEntity(chatId, { name: "Joss", kind: "person", aliases: ["Old Joss"] });
  run("UPDATE entities SET mentions = 24, first_seq = 2, last_seq = 25 WHERE id = ?", typeof ent === "string" ? ent : (ent as { id: string }).id);
  for (let i = 0; i < 12; i++) createAtom(chatId, { type: "event", content: `Joss pours drink number ${i + 1}`, entities: ["Joss"], importance: 3 });
});

describe("7.1 coverage findings", () => {
  test("each finding appears: thin, quiet, a fact conflict and the same alias across books, invented facts", () => {
    createAtom(chatId, { type: "fact", content: "Old Joss is Joss's nickname at the docks", entities: ["Joss"], importance: 5 });
    createFact(joss, { value: "19 March", slot: "birthday", origin: "invented" });
    const kinds = coverageFindings(chatId).map((f) => `${f.kind}:${f.entries.map((e) => e.title).sort().join("+")}`);
    expect(kinds).toEqual(expect.arrayContaining(["alias-twice:Wren+Wren Tully", "fact-conflict:Wren+Wren Tully", "invented:Joss"]));
    const all = coverageFindings(chatId);
    const thin = all.find((f) => f.kind === "thin");
    const quiet = all.find((f) => f.kind === "quiet");
    expect(thin?.entries[0]!.title).toBe("Joss");
    expect(quiet?.fix).toBe("add-key");
    // In the Inbox, with the fix as its button.
    const item = inboxItems({ chatId }).find((i) => i.key === `lore-health:${quiet!.key}`)!;
    expect(item.labels).toEqual({ accept: "Add key", reject: "Not now" });
  });

  test("Add key and Confirm fix what they find, with Undo", () => {
    const quiet = coverageFindings(chatId).find((f) => f.kind === "quiet")!;
    const r = fixFinding(chatId, quiet.key);
    expect(getEntries(world).find((e) => e.id === joss)!.keys.length).toBeGreaterThan(1);
    restoreStash(r.undo!);
    expect(getEntries(world).find((e) => e.id === joss)!.keys).toEqual(["Joss"]);
    const inv = coverageFindings(chatId).find((f) => f.kind === "invented")!;
    actOnInbox(`lore-health:${inv.key}`, "accept");
    expect(factsNow(joss, null).find((f) => f.slot === "birthday")!.status).toBe("active");
    // Not now hides a finding.
    recordLoreHits(chatId, [joss]);
    const thin = coverageFindings(chatId).find((f) => f.kind === "thin")!;
    actOnInbox(`lore-health:${thin.key}`, "reject");
    expect(coverageFindings(chatId).some((f) => f.key === thin.key)).toBe(false);
  });
});

describe("7.2 merge across books", () => {
  test("a merge keeps every fact (with its history) and is undone cleanly", () => {
    const old = factsNow(wrenC, null).find((f) => f.slot === "eyes")!;
    supersedeFact(old.id, { value: "hazel" });
    const before = listFacts(wrenC).length;
    const r = mergeEntries(wrenW, wrenC);
    expect(listFacts(wrenW).length).toBe(1 + before);
    expect(r.moved).toBe(before);
    expect(getEntries(companion).some((e) => e.id === wrenC)).toBe(false);
    const merged = getEntries(world).find((e) => e.id === wrenW)!;
    expect(merged.content).toContain("Mira's oldest friend.");
    expect(listFacts(wrenW).map((f) => f.value).sort()).toEqual(["brown", "grey", "hazel"]);
    restoreStash(r.undo);
    expect(getEntries(companion).find((e) => e.id === wrenC)!.content).toBe("Mira's oldest friend.");
    expect(listFacts(wrenC).map((f) => f.value).sort()).toEqual(["brown", "hazel"]);
    expect(getEntries(world).find((e) => e.id === wrenW)!.content).not.toContain("oldest friend");
  });
});

describe("7.3 compaction with history", () => {
  const LONG = Array.from({ length: 70 }, (_, i) => `On day ${i + 1} the ferry crossed from Saltpans to Riverrun with Wren at the helm and ${i + 3} passengers aboard.`).join(" ");

  test("names and numbers are what a rewrite must keep", () => {
    expect(namesAndNumbers("Wren crossed to Riverrun. She took 12 crates.")).toEqual(expect.arrayContaining(["12", "Riverrun"]));
    expect(lostNames("Wren crossed to Riverrun with 12 crates.", "Wren crossed with crates.")).toEqual(["12", "Riverrun"]);
  });

  test("a long core compacts with every name and number kept; a rewrite that drops a number is rejected", async () => {
    const id = createEntry(world, defaultEntry({ comment: "The ferry log", keys: ["ferry log"], content: LONG })).id;
    const short = `The ferry crossed from Saltpans to Riverrun each day with Wren at the helm: days ${Array.from({ length: 70 }, (_, i) => i + 1).join(", ")}, carrying ${Array.from({ length: 70 }, (_, i) => i + 3).join(", ")} passengers.`;
    const dropped = await compactEntry(id, { rewrite: async () => short.replace(", 72 passengers", " passengers") });
    expect(dropped.status).toBe("rejected");
    // Your text: a proposal in the Inbox, kept only when you keep it.
    const r = await compactEntry(id, { rewrite: async () => short });
    expect(r.status).toBe("proposed");
    expect(getEntries(world).find((e) => e.id === id)!.content).toBe(LONG);
    const item = inboxItems().find((i) => i.key === `lore-compact:${id}`)!;
    expect(item.before).toBe(LONG);
    actOnInbox(item.key, "accept");
    expect(getEntries(world).find((e) => e.id === id)!.content).toBe(short);
    decideCompaction(id, "undo");
    expect(getEntries(world).find((e) => e.id === id)!.content).toBe(LONG);
  });

  test("Mea's own text is just replaced, with Undo", async () => {
    const id = createEntry(world, defaultEntry({ comment: "Chronicle note", keys: ["note"], content: LONG, extra: { writtenBy: "mea" } })).id;
    const r = await compactEntry(id, { rewrite: async (t) => t.split(". ").slice(0, 35).join(". ") + ` Days 36–70 too: ${Array.from({ length: 35 }, (_, i) => `${i + 36} (${i + 38})`).join(", ")}.` });
    expect(r.status).toBe("replaced");
    decideCompaction(id, "undo");
    expect(getEntries(world).find((e) => e.id === id)!.content).toBe(LONG);
  });
});
