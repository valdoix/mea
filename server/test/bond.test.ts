import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { bondEntry, bondPage, markMilestone, refreshBond } from "../src/lore/bond";
import { factsNow } from "../src/lore/facts";
import { runKeepup, updateProposals } from "../src/lore/keepup";
import { createAtom } from "../src/memory/atoms";
import { applyChange, checkChanges, undoStep } from "../src/meus/changes";
import { createCharacter } from "../src/services/characters";
import { addMessage, addSwipe, createChat, setActiveSwipe, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { createPersona } from "../src/services/personas";
import { previewPrompt } from "../src/services/generation";
import { registerJob } from "../src/services/jobs";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
const msgs: string[] = [];
const story = (i: number, lines: string[]) => writeEvents(chatId, { messageId: msgs[i]!, swipeIdx: 0 }, linesToOps(lines).ops, "model");

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "tracker.update", "tracker.init", "lore.keepup", "lore.chronicle", "lore.bond"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 8000 } });
  createPersona({ name: "Sam", data: { description: "A sailor." }, isDefault: true });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Wren", description: "A ferry pilot.", first_mes: "Wren ties off the ferry." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  for (let i = 0; i < 6; i++) msgs.push(addMessage(chatId, i % 2 ? "assistant" : "user", i % 2 ? `Wren answers (${i}).` : `Sam speaks (${i}).`, i % 2 ? { name: "Wren" } : { name: "Sam" }));
  story(1, ["clock: Day 1 08:00", "cast: Wren@spot · Sam@spot", "bond Wren>Sam: trust +2"]);
  // Your own line: a romance rung the model may not set by itself.
  writeEvents(chatId, { messageId: msgs[1]!, swipeIdx: -1 }, linesToOps(["ladder Wren>Sam: 3 — she keeps finding reasons to stay"]).ops, "user");
});

describe("4.1 the Bond entry and page", () => {
  test("a companion chat's first scene makes the Bond: where things stand, and running bits with where they began", () => {
    story(3, ["motif the lighthouse that isn't there"]);
    const entryId = refreshBond(chatId)!;
    expect(entryId).toBe(bondEntry(chatId, false)!);
    const page = bondPage(chatId);
    expect(page.companion).toBe(true);
    expect(page.stands?.value).toContain("Charged");
    expect(page.stands?.value).toContain("trust +2");
    expect(page.jokes.map((f) => f.value)).toEqual([expect.stringContaining("the lighthouse that isn't there (since #5)")]);
    expect(page.jokes[0]!.messageId).toBe(msgs[3]!);
  });

  test("swiping the scene removes what it added; swiping back brings it back", () => {
    const idx = addSwipe(msgs[3]!, "done");
    refreshBond(chatId);
    expect(bondPage(chatId).jokes).toHaveLength(0);
    setActiveSwipe(msgs[3]!, 0);
    expect(bondPage(chatId).jokes).toHaveLength(1);
    expect(idx).toBe(1);
  });

  test("it's always on and short: the Bond's lines are in the prompt", async () => {
    const p = await previewPrompt(chatId);
    expect(p.messages.map((m) => m.content).join("\n")).toContain("the lighthouse that isn't there");
  });

  test("Meus edits a line (and it stays as you left it)", () => {
    const joke = bondPage(chatId).jokes[0]!;
    const { changes } = checkChanges(chatId, [{ kind: "bond", action: "edit", line: joke.id, value: "The lighthouse joke" }]);
    const steps = applyChange(chatId, { ...changes[0]!, id: "x" });
    refreshBond(chatId);
    expect(bondPage(chatId).jokes.map((f) => f.value)).toEqual(["The lighthouse joke"]);
    for (const s of steps) undoStep(chatId, s);
    expect(bondPage(chatId).jokes[0]!.value).toContain("since #5");
  });
});

describe("4.3 what Wren knows about you", () => {
  test("a persona secret told to Wren shows under knows; one never told stays out", () => {
    createAtom(chatId, { type: "secret", content: "Sam can't read", entities: ["Sam"], knownBy: ["Wren"], importance: 7 });
    createAtom(chatId, { type: "secret", content: "Sam stole the brass lantern", entities: ["Sam"], knownBy: ["Tam"], importance: 7 });
    const page = bondPage(chatId);
    expect(page.knows.map((f) => f.value)).toEqual(["Sam can't read"]);
    // The switch turns it off.
    updateChat(chatId, { settings: { personaFacts: false } });
    expect(bondPage(chatId).knows).toHaveLength(0);
    updateChat(chatId, { settings: { personaFacts: null } });
  });
});

describe("4.2 milestones", () => {
  test("the menu action adds one with the story's date", () => {
    const r = markMilestone(msgs[5]!, "The first real argument");
    expect(r.fact.value).toBe("The first real argument (Day 1 08:00)");
    expect(bondPage(chatId).milestones.map((f) => f.value)).toContain("The first real argument (Day 1 08:00)");
  });

  test("a confession scene proposes a milestone", async () => {
    createAtom(chatId, { type: "relationship", content: "Wren tells Sam she loves him", entities: ["Wren", "Sam"], importance: 9, messageIds: [msgs[5]!] });
    await runKeepup(chatId);
    const card = updateProposals(chatId).find((p) => p.diff.ops.some((o) => o.slot === "milestone"))!;
    expect(card.diff.ops[0]).toMatchObject({ op: "add", slot: "milestone", value: "Wren tells Sam she loves him", kind: "event" });
    expect(factsNow(bondEntry(chatId, false)!, chatId).some((f) => f.value === "Wren tells Sam she loves him")).toBe(false);
  });
});
