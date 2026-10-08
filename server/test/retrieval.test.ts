import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all, one } from "../src/db/db";
import { defaultMemoryConfig, memoryConfig, setSetting } from "../src/lib/settings";
import { atomOut, getAtom, insertAtom } from "../src/memory/atoms";
import { buildSummary, storyNeedsRebuild } from "../src/memory/build";
import { consolidate, findDuplicates } from "../src/memory/consolidate";
import { deepSearch, excerpt } from "../src/memory/deep";
import { createEntity, duplicateSuggestions, entityGraph, listEntities, mergeEntities, resolver, syncEntities, updateEntity } from "../src/memory/entities";
import { relativeTime, TimeIndex } from "../src/memory/format";
import { decideJournalProposal, editJournal, listJournals, updateJournal } from "../src/memory/journals";
import { cachedVerdict, contextText, resetLibrarian, runLibrarian } from "../src/memory/librarian";
import { markPromise, promises, revealSecret, secrets } from "../src/memory/ledgers";
import { applyMemoryProfile, matchingProfile, normalizeMemoryConfig } from "../src/memory/profiles";
import { buildQueries, moodMatches, povAllows, recall, type RecallInput, reinforcement } from "../src/memory/recall";
import { claimedElapsed, reconcileScene } from "../src/memory/reconcile";
import { referenced, reinforce } from "../src/memory/reinforce";
import { correctMemory, rememberSelection } from "../src/memory/remember";
import { queueBuilds, segmentChat } from "../src/memory/scheduler";
import { levelRows, setMemState, storyRow } from "../src/memory/store";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { previewPrompt } from "../src/services/generation";
import { registerJob } from "../src/services/jobs";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

function chatWith(name = "Mira") {
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name, description: "Keeper of the lighthouse.", first_mes: "Welcome, {{user}}." } });
  return createChat({ characterId: createCharacter(data) }).id;
}

function baseInput(chatId: string, over: Partial<RecallInput> = {}): RecallInput {
  const cfg = { ...memoryConfig(), librarian: false, deepSearch: false };
  return {
    chatId,
    evicted: 1000,
    budget: 600,
    queries: [{ text: "the brass lantern", weight: 1, label: "newest message" }],
    qvecs: [null],
    excludeSummaryIds: new Set(),
    seed: "s",
    cfg,
    pov: null,
    present: [],
    mood: null,
    librarian: null,
    times: new TimeIndex(chatId),
    skipCards: new Set(),
    povName: "Mira",
    ...over,
  };
}

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "quota.refresh", "cache.probe"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 4000, max_tokens: 400 } });
  setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false, lag: 1 });
});

describe("queries (MEM-14)", () => {
  test("newest lines weigh most; the draft leads; scene cast and the rewrite join in", () => {
    const q = buildQueries(
      [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
      ],
      { present: ["Joss"], rewritten: "lantern repair promise" },
    );
    expect(q[0]).toMatchObject({ text: "c", weight: 1, label: "newest message" });
    expect(q.find((x) => x.label === "librarian's query")?.weight).toBe(0.9);
    expect(q.find((x) => x.label === "who's in the scene")?.text).toBe("Joss");
    const d = buildQueries([{ role: "user", content: "a" }], { draft: "my draft" });
    expect(d[0]).toMatchObject({ text: "my draft", label: "your draft" });
  });
});

describe("recall ranking", () => {
  let chatId = "";
  beforeAll(() => {
    chatId = chatWith();
    for (let i = 0; i < 12; i++) addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}`, { name: i % 2 ? "Mira" : "You" });
    const src = all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? ORDER BY seq", chatId);
    const s = (i: number) => [{ id: src[i]!.id, seq: src[i]!.seq }];
    insertAtom(chatId, null, { type: "secret", content: "Joss hid the brass lantern key under the floorboards.", knownBy: ["Joss"], importance: 8, entities: ["Joss"] }, s(1));
    insertAtom(chatId, null, { type: "promise", content: "Mira promised to fix the brass lantern before winter.", importance: 8, entities: ["Mira"], emotions: ["hope"] }, s(2));
    for (let i = 0; i < 4; i++) insertAtom(chatId, null, { type: "fact", content: `The brass lantern on the tower is old and cracked, version ${i}.`, importance: 6, entities: [] }, s(3 + i));
    insertAtom(chatId, null, { type: "fact", content: "The brass lantern was a gift from Mira's grandmother, who kept the light for forty years.", importance: 6, entities: ["Mira"], emotions: ["grief"] }, s(8));
    insertAtom(chatId, null, { type: "fact", content: "Joss runs the harbor tavern and owes money to the smugglers.", importance: 7, entities: ["Joss", "harbor tavern"] }, s(9));
    insertAtom(chatId, null, { type: "fact", content: "Joss lost a bet at the harbor tavern.", importance: 5, entities: ["Joss"] }, s(10));
  });

  test("point of view filters before ranking (MEM-16)", () => {
    const mira = { names: new Set(["mira"]), label: "Mira" };
    expect(povAllows({ known_by: '["Joss"]' }, mira)).toBe(false);
    expect(povAllows({ known_by: '["Joss","Mira"]' }, mira)).toBe(false || true);
    expect(povAllows({ known_by: "[]" }, mira)).toBe(true);
    expect(povAllows({ known_by: '["everyone"]' }, mira)).toBe(true);
    const asMira = recall(baseInput(chatId, { pov: mira }));
    expect(asMira.items.some((i) => i.content.includes("floorboards"))).toBe(false);
    expect(asMira.stats.filteredPov).toBe(1);
    const narrator = recall(baseInput(chatId));
    expect(narrator.items.some((i) => i.content.includes("floorboards"))).toBe(true);
  });

  test("diversity keeps near-copies from filling the budget (MEM-15)", () => {
    const tight = { ...memoryConfig(), librarian: false, deepSearch: false, entityRecall: false, slots: { recent: 0, relevant: 1, serendipity: 0 } };
    const queries = [{ text: "is the old brass lantern on the tower cracked", weight: 1, label: "newest message" }];
    const plain = recall(baseInput(chatId, { budget: 110, queries, cfg: { ...tight, diversity: 0 } }));
    const diverse = recall(baseInput(chatId, { budget: 110, queries, cfg: { ...tight, diversity: 0.7 } }));
    const copies = (r: typeof plain) => r.items.filter((i) => i.content.includes("old and cracked")).length;
    expect(copies(diverse)).toBeLessThan(copies(plain));
    expect(diverse.items.some((i) => i.content.includes("grandmother") || i.content.includes("promised"))).toBe(true);
  });

  test("entities in the scene bring their card and top facts (MEM-17)", () => {
    syncEntities(chatId, true);
    const joss = resolver(chatId).find("Joss")!;
    updateEntity(joss.id, { description: "Mira's brother, a tavern keeper with debts." });
    const r = recall(baseInput(chatId, { present: ["Joss"], queries: [{ text: "rain on the windows", weight: 1, label: "newest message" }] }));
    const card = r.items.find((i) => i.ownerType === "entity");
    expect(card?.content).toContain("tavern keeper");
    expect(r.items.filter((i) => i.slot === "entity" && i.ownerType === "memory").length).toBeGreaterThan(0);
    expect(r.stats.entities).toContain("Joss");
  });

  test("emotion and mood lift memories (MEM-18)", () => {
    expect(moodMatches("wistful", ["grief"])).toBe(true);
    expect(moodMatches("furious", ["hope"])).toBe(false);
    const r = recall(baseInput(chatId, { mood: "wistful" }));
    const g = r.items.find((i) => i.content.includes("grandmother"));
    expect(g?.reasons.some((x) => x.includes("fits the mood"))).toBe(true);
  });

  test("used memories gain weight; unused trivia fades; core never does (MEM-19)", () => {
    expect(referenced("Mira promised to fix the brass lantern before winter.", ["Mira"], "\"I'll fix the brass lantern before the winter storms,\" she says.")).toBe(true);
    expect(referenced("Mira promised to fix the brass lantern before winter.", ["Mira"], "The sea is calm tonight.")).toBe(false);
    const base = { importance: 3, pinned: 0, user_edited: 0, recall_count: 0, ref_count: 0, max_seq: 0 };
    expect(reinforcement(base, 1400).weight).toBeLessThan(0.5);
    expect(reinforcement({ ...base, importance: 9 }, 1400).weight).toBe(1);
    expect(reinforcement({ ...base, ref_count: 3 }, 1400).weight).toBeGreaterThan(1);
    // reinforce() counts recalled and used memories from a reply's usage rows.
    const promise = all<{ id: string }>("SELECT id FROM memories WHERE chat_id = ? AND type = 'promise'", chatId)[0]!.id;
    const other = all<{ id: string }>("SELECT id FROM memories WHERE chat_id = ? AND content LIKE '%bet%'", chatId)[0]!.id;
    for (const id of [promise, other]) {
      all("INSERT INTO memory_usage (generation_id, chat_id, owner_type, owner_id, slot, created_at) VALUES ('g1', ?, 'memory', ?, 'relevant', 0)", chatId, id);
    }
    const used = reinforce(chatId, "g1", "She touches the brass lantern. \"Before winter, I promised. I'll fix it.\"", 12);
    expect(used).toEqual([promise]);
    expect(getAtom(promise)).toMatchObject({ recall_count: 1, ref_count: 1, last_ref_seq: 12 });
    expect(getAtom(other)).toMatchObject({ recall_count: 1, ref_count: 0 });
  });

  test("the librarian's pick sharpens recall (MEM-23)", async () => {
    resetLibrarian();
    const ctx = contextText([{ content: "Tell me about the tavern debts" }, { content: "Joss and the smugglers" }]);
    const cands = all<{ id: string; content: string }>("SELECT id, content FROM memories WHERE chat_id = ?", chatId).map((a) => ({ key: `memory:${a.id}`, text: a.content }));
    const v = await runLibrarian(chatId, ctx, "", cands);
    expect(v?.keep.size).toBeGreaterThan(0);
    expect(cachedVerdict(chatId, ["nope", ctx])).toBe(v);
    const r = recall(baseInput(chatId, { librarian: v, queries: [{ text: "tavern smugglers", weight: 1, label: "newest message" }] }));
    expect(r.stats.librarian).toBe("used");
    expect(r.items.some((i) => i.reasons.includes("the librarian picked it"))).toBe(true);
  });
});

describe("story time (MEM-36)", () => {
  test("relative labels read naturally", () => {
    const day = 1440;
    expect(relativeTime(10 * day + 600, 10 * day + 620)).toBe("moments ago");
    expect(relativeTime(9 * day + 19 * 60, 10 * day + 600)).toBe("yesterday evening");
    expect(relativeTime(7 * day, 10 * day)).toBe("3 days ago");
    expect(relativeTime(0, 100 * day)).toBe("3 months ago");
  });
});

describe("entities (MEM-26, MEM-28)", () => {
  let chatId = "";
  beforeAll(() => {
    chatId = chatWith();
    const ids = [0, 1, 2, 3].map((i) => addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}`, { name: i % 2 ? "Mira" : "You" }));
    writeEvents(chatId, { messageId: ids[1]!, swipeIdx: -1 }, linesToOps(["clock: Day 1 20:00", "at: Port Ellis › Harbor › Tavern", "cast: Mira@spot · Kael@spot", "bond Mira>Kael: trust +2 — he saved her", "item Silver locket: +Kael — found in the cave"]).ops, "model");
    const src = [{ id: ids[2]!, seq: 3 }];
    insertAtom(chatId, null, { type: "fact", content: "The stranger wore a grey cloak.", entities: ["the stranger"] }, src);
    insertAtom(chatId, null, { type: "fact", content: "The stranger asked about the lighthouse.", entities: ["the stranger"] }, src);
    insertAtom(chatId, null, { type: "relationship", content: "Captain Mira and Kael are wary allies.", entities: ["Captain Mira", "Kael"] }, src);
    insertAtom(chatId, null, { type: "fact", content: "Captain Mira commands the watch.", entities: ["Captain Mira"] }, src);
  });

  test("synced from trackers and memories, with kinds", () => {
    syncEntities(chatId, true);
    const list = listEntities(chatId);
    const by = (n: string) => list.find((e) => e.name === n);
    expect(by("Kael")?.kind).toBe("person");
    expect(by("Tavern")?.kind).toBe("place");
    expect(by("Tavern")?.path).toEqual(["Port Ellis", "Harbor", "Tavern"]);
    expect(by("Silver locket")?.kind).toBe("object");
    expect(by("Silver locket")?.holder).toBe("Kael");
    expect(by("the stranger")).toBeTruthy();
  });

  test("aliases resolve, duplicates are suggested, merges keep everything", () => {
    const sugg = duplicateSuggestions(chatId);
    expect(sugg.some((s) => [s.keep.name, s.merge.name].sort().join("|") === "Captain Mira|Mira")).toBe(true);
    const kael = resolver(chatId).find("Kael")!;
    const stranger = resolver(chatId).find("the stranger")!;
    const merged = mergeEntities(kael.id, [stranger.id]);
    expect(merged.aliases).toContain("the stranger");
    expect(resolver(chatId).find("The Stranger")?.id).toBe(kael.id);
    // A later sync doesn't split them apart again.
    syncEntities(chatId, true);
    expect(listEntities(chatId).filter((e) => e.name === "the stranger")).toHaveLength(0);
  });

  test("your edits are locked against syncs (MEM-27)", () => {
    const kael = resolver(chatId).find("Kael")!;
    updateEntity(kael.id, { description: "A drifter with a past.", status: "missing" });
    syncEntities(chatId, true);
    const after = listEntities(chatId).find((e) => e.id === kael.id)!;
    expect(after.description).toBe("A drifter with a past.");
    expect(after.status).toBe("missing");
    expect(after.descSource).toBe("you");
  });

  test("the graph has bonds with history, holdings and relationship memories", () => {
    const g = entityGraph(chatId);
    expect(g.edges.some((e) => e.kind === "bond" && e.strength === 2 && e.history.length === 1)).toBe(true);
    expect(g.edges.some((e) => e.kind === "holds")).toBe(true);
    createEntity(chatId, { name: "Old Tom", kind: "person" });
    expect(resolver(chatId).find("Tom")?.name).toBe("Old Tom");
  });
});

describe("ledgers, corrections and the remember button (MEM-30, MEM-31, MEM-41)", () => {
  let chatId = "";
  let ids: string[] = [];
  beforeAll(() => {
    chatId = chatWith();
    ids = [0, 1, 2, 3].map((i) => addMessage(chatId, i % 2 ? "assistant" : "user", i === 3 ? "Her eyes are green, and she keeps the logbook locked." : `Line ${i}`, { name: i % 2 ? "Mira" : "You" }));
    writeEvents(chatId, { messageId: ids[1]!, swipeIdx: -1 }, linesToOps(["clock: Day 1 20:00", "cast: Mira@spot · Alex@spot", "promise Mira>Alex: fix the brass lantern | open", "secret #logbook: a page of the logbook is missing | kept by Mira · from Alex"]).ops, "model");
    insertAtom(chatId, null, { type: "promise", content: "Mira promised Alex she would fix the brass lantern.", entities: ["Mira", "Alex"] }, [{ id: ids[1]!, seq: 2 }]);
    insertAtom(chatId, null, { type: "secret", content: "Mira burned the smuggler's letter.", knownBy: ["Mira"] }, [{ id: ids[2]!, seq: 3 }]);
    insertAtom(chatId, null, { type: "fact", content: "Mira has blue eyes.", entities: ["Mira"] }, [{ id: ids[3]!, seq: 4 }]);
  });

  test("a promise seen by trackers and memory is one entry; marking it reaches both", () => {
    const list = promises(chatId);
    const lantern = list.filter((p) => p.what.includes("lantern"));
    expect(lantern).toHaveLength(1);
    expect(lantern[0]!.source).toBe("tracker");
    expect(lantern[0]!.memoryIds).toHaveLength(1);
    const kept = markPromise(chatId, lantern[0]!.key, "kept");
    expect(kept?.status).toBe("kept");
    const atom = getAtom(lantern[0]!.memoryIds[0]!)!;
    expect(atomOut(atom).ledger?.status).toBe("kept");
    expect(atom.user_edited).toBe(1);
  });

  test("secrets show keepers, and revealing one updates who knows", () => {
    const list = secrets(chatId);
    expect(list.find((s) => s.source === "tracker")?.keepers).toContain("Mira");
    const letter = list.find((s) => s.statement.includes("letter"))!;
    const after = revealSecret(chatId, letter.key, "Alex", "she confessed");
    expect(after?.revealed[0]?.to).toContain("Alex");
    expect(getAtom(letter.memoryIds[0]!)!.known_by).toContain("Alex");
    const tr = revealSecret(chatId, list.find((s) => s.source === "tracker")!.key, "Alex");
    expect(tr?.revealed.length).toBe(1);
  });

  test("remember this, and that's wrong", () => {
    const m = rememberSelection(chatId, { messageId: ids[3]!, text: "she keeps the logbook locked", pin: true });
    expect(m).toMatchObject({ pinned: true, userEdited: true, importance: 9 });
    expect(m.sources?.[0]?.messageId).toBe(ids[3]);
    const fix = correctMemory(chatId, { wrong: "Mira has blue eyes", right: "Mira has green eyes.", messageId: ids[3] });
    expect(fix.superseded.some((a) => a.content === "Mira has blue eyes.")).toBe(true);
    expect(fix.memory).toMatchObject({ content: "Mira has green eyes.", userEdited: true });
    expect(fix.memory.importance).toBeGreaterThanOrEqual(9);
    expect(one<{ status: string }>("SELECT status FROM memories WHERE content = 'Mira has blue eyes.'")?.status).toBe("superseded");
  });
});

describe("the memory pipeline, Phase 3 (journals, deep search, reconcile, sleep)", () => {
  let chatId = "";

  async function drain() {
    for (let round = 0; round < 14; round++) {
      await segmentChat(chatId);
      let built = 0;
      for (const level of ["scene", "chapter", "arc"] as const) {
        for (const r of levelRows(chatId, level)) {
          if (!r.closed || !(r.state === "pending" || r.state === "stale")) continue;
          await buildSummary(r.id);
          if (level === "scene") reconcileScene(r.id);
          built++;
        }
      }
      queueBuilds(chatId);
      const story = storyRow(chatId);
      if (story && storyNeedsRebuild(chatId)) {
        await buildSummary(story.id);
        built++;
      }
      if (!built) return;
    }
  }

  beforeAll(async () => {
    setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false, lag: 1, scenesPerChapter: 2, chaptersPerArc: 2, sceneTokenCap: 100_000 });
    chatId = chatWith();
    const filler = "The sea rolls against the rocks while the lantern hums above them. ".repeat(14);
    for (let i = 0; i < 22; i++) {
      const skip = i > 0 && i % 4 === 0 ? "The next morning, " : "";
      const special = i === 2 ? " Mira hides the silver locket inside the old logbook." : "";
      addMessage(chatId, i % 2 ? "assistant" : "user", `${skip}Line ${i + 2}.${special} ${filler}`, { name: i % 2 ? "Mira" : "You" });
    }
    // The story clock: two days pass between the first scene's lines.
    const rows = all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? ORDER BY seq", chatId);
    writeEvents(chatId, { messageId: rows[0]!.id, swipeIdx: -1 }, linesToOps(["clock: Day 1 08:00"]).ops, "model");
    writeEvents(chatId, { messageId: rows[3]!.id, swipeIdx: -1 }, linesToOps(["clock: Day 3 09:00"]).ops, "model");
    await drain();
  });

  test("deep search goes chapter → scene → the message itself (MEM-22)", () => {
    expect(levelRows(chatId, "chapter").length).toBeGreaterThan(0);
    const hits = deepSearch(chatId, { query: "where is the silver locket hidden", qvec: null, beforeSeq: 1000 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.excerpt).toContain("silver locket");
    expect(hits[0]!.seq).toBe(one<{ seq: number }>("SELECT m.seq FROM messages m JOIN swipes s ON s.message_id = m.id WHERE m.chat_id = ? AND s.content LIKE '%silver locket%'", chatId)!.seq);
    expect(excerpt("One. Two three silver locket here. Four.".repeat(20), new Set(["silver", "locket"]), 60)).toContain("silver locket");
  });

  test("records agree with the story clock (SUM-22)", () => {
    expect(claimedElapsed("Three days later, they met again")?.[0]).toBeGreaterThan(2000);
    expect(claimedElapsed("They talked for a while")).toBeNull();
    const first = levelRows(chatId, "scene")[0]!;
    expect(first.story_time).toContain("Day 1");
    expect(first.content).toContain("Time passing: about");
  });

  test("journals are written first person and wait for you once you edit them (MEM-29)", async () => {
    const j = await updateJournal(chatId, "Mira", { fromScratch: true });
    expect(j?.content).toContain("I, Mira, remember");
    editJournal(j!.id, "My own words.");
    await updateJournal(chatId, "Mira", { fromScratch: true });
    const after = listJournals(chatId)[0]!;
    expect(after.content).toBe("My own words.");
    expect(after.proposal?.content).toContain("I, Mira, remember");
    expect(decideJournalProposal(after.id, true).content).toContain("I, Mira, remember");
  });

  test("the prompt carries recall with story time, the journal, and quotes from long ago", async () => {
    setMemState(chatId, { evictedThrough: 18 });
    addMessage(chatId, "user", "Do you remember where you hid the silver locket?", { name: "You" });
    const p = await previewPrompt(chatId);
    const all2 = p.messages.map((m) => m.content).join("\n");
    expect(all2).toContain("Mira's own memory");
    expect(p.trace.memory?.queries?.length).toBeGreaterThan(1);
    expect(p.trace.memory?.pov).toBe("Mira");
    const quotes = p.trace.memory!.recall.filter((r) => r.slot === "deep");
    expect(quotes.length).toBeGreaterThan(0);
    expect(all2).toContain("Exact words from long ago");
  });

  test("sleep merges duplicates and folds old trivia (MEM-42)", async () => {
    const rows = all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? ORDER BY seq", chatId);
    const a = insertAtom(chatId, null, { type: "fact", content: "The lighthouse lamp burns whale oil every night.", importance: 5 }, [{ id: rows[1]!.id, seq: 2 }]);
    const b = insertAtom(chatId, null, { type: "fact", content: "Every night the lighthouse lamp burns whale oil.", importance: 4 }, [{ id: rows[2]!.id, seq: 3 }]);
    expect(findDuplicates(chatId).some(([x, y]) => [x.id, y.id].sort().join() === [a, b].sort().join())).toBe(true);
    const scene = levelRows(chatId, "scene")[0]!;
    for (const t of ["A gull landed on the rail.", "Tea was served in chipped cups.", "The stove needed more coal."]) insertAtom(chatId, scene.id, { type: "event", content: t, importance: 2 }, [{ id: rows[1]!.id, seq: 2 }]);
    setMemState(chatId, { evictedThrough: 600 });
    const report = await consolidate(chatId);
    expect(report?.merged).toBeGreaterThan(0);
    expect(getAtom(b)!.status).toBe("superseded");
    expect(report?.digests).toBeGreaterThan(0);
  });
});

describe("memory profiles (MEM-44)", () => {
  test("presets apply, and hand changes become custom", () => {
    const light = applyMemoryProfile("light");
    expect(light).toMatchObject({ profile: "light", librarian: false, verify: false });
    expect(matchingProfile(light)).toBe("light");
    expect(normalizeMemoryConfig({ ...light, librarian: true }).profile).toBe("custom");
    expect(applyMemoryProfile("deep").librarian).toBe(true);
  });
});
