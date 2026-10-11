import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { canonOf, laterItem, moveCutoff, passedEvents, setCanon, suggestCanon } from "../src/accuracy/canoncut";
import { checkReply } from "../src/accuracy/checker";
import { actOnInbox, inboxItems } from "../src/accuracy/inbox";
import { normalizeCard } from "../src/cards/card";
import { run } from "../src/db/db";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { applyChange, checkChanges, undoStep } from "../src/meus/changes";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, getChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { previewPrompt } from "../src/services/generation";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { freshDb } from "./helpers";

let chatId = "";

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn", "canon.suggest"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 300 } });
  setSetting("memory.config", { ...defaultMemoryConfig, checkerModel: false });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Sunnydale, 1997." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  addMessage(chatId, "user", "Hi.", { name: "Willow" });
});
afterAll(() => pauseJobs(false));

describe("canon cutoff (C1)", () => {
  test("where the story stands and what hasn't happened go to the model in the [CANON] lane", async () => {
    setCanon(chatId, { source: "Buffy the Vampire Slayer", point: "Season 2, before Innocence", later: [laterItem("event", "Angel loses his soul", ["Angelus", "loses his soul"]), laterItem("character", "Dawn")] });
    const p = await previewPrompt(chatId);
    const lane = p.trace.blocks.find((b) => b.lane === "canon");
    expect(lane?.text).toContain("stands at: Season 2, before Innocence");
    expect(lane?.text).toContain("- Angel loses his soul");
    expect(lane?.text).toContain("Haven't appeared yet (don't introduce them): Dawn");
  });

  test("later characters and terms in a reply are flagged", async () => {
    const id = addMessage(chatId, "assistant", "Buffy looks at the stars. Angelus smiles in the dark. Her sister Dawn calls from upstairs.", { name: "Buffy" });
    const issues = ((await checkReply(chatId, id, 0)) ?? []).filter((i) => i.kind === "canon");
    expect(issues.map((i) => i.conflict)).toEqual([expect.stringContaining("“Angelus” is from later"), expect.stringContaining("Dawn hasn't appeared yet")]);
    expect(issues[1]!.severity).toBe("major");
  });

  test("a canon event that won't happen here becomes a story truth, and leaves with it", () => {
    const c = canonOf(chatId);
    setCanon(chatId, { ...c, wont: [{ id: "w1", text: "Jenny lives" }] });
    expect(getChat(chatId)!.settings.truths).toContain("In this story, canon diverges: Jenny lives.");
    setCanon(chatId, { ...canonOf(chatId), wont: [] });
    expect(getChat(chatId)!.settings.truths ?? []).not.toContain("In this story, canon diverges: Jenny lives.");
  });

  test("Suggest from the wiki: proposals wait in the Inbox; approving adds them", async () => {
    setCanon(chatId, { ...canonOf(chatId), source: "MOCK_CANON Buffy" });
    const fresh = await suggestCanon(chatId);
    // "Dawn" is already watched, so only the new one is proposed.
    expect(fresh.map((f) => f.text)).toEqual(["Buffy dies saving Dawn"]);
    const items = inboxItems({ chatId }).filter((i) => i.source === "canon");
    const gift = items.find((i) => i.after === "Buffy dies saving Dawn")!;
    expect(gift.why).toContain("The Gift (Buffyverse Wiki)");
    actOnInbox(gift.key, "accept");
    expect(canonOf(chatId).later!.some((i) => i.text === "Buffy dies saving Dawn" && i.terms.includes("swan dive"))).toBe(true);
    expect(canonOf(chatId).proposed!.some((i) => i.text === "Buffy dies saving Dawn")).toBe(false);
  });

  test("when a scene summary shows a later event happened, a card offers to move the cutoff", () => {
    const t = Date.now();
    run("INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, state, created_at, updated_at) VALUES ('s1', ?, 'scene', 1, 2, 1, 'The bell', 'Angelus walks out of the bedroom; Angel loses his soul and leaves Buffy crying.', 'ok', ?, ?)", chatId, t, t);
    const passed = passedEvents(chatId);
    expect(passed.map((p) => p.item.text)).toEqual(["Angel loses his soul"]);
    const card = inboxItems({ chatId }).find((i) => i.title === "Move the cutoff forward?")!;
    // "Not yet": it stays, and the card goes.
    actOnInbox(card.key, "reject");
    expect(passedEvents(chatId)).toHaveLength(0);
    expect(canonOf(chatId).later!.some((i) => i.text === "Angel loses his soul")).toBe(true);
    // Moving it by hand: it leaves the list, and the story stands after it.
    const id = canonOf(chatId).later!.find((i) => i.text === "Angel loses his soul")!.id;
    moveCutoff(chatId, id);
    expect(canonOf(chatId).point).toBe("after Angel loses his soul");
    expect(canonOf(chatId).later!.some((i) => i.id === id)).toBe(false);
  });

  test("Meus can change the cutoff, and Undo puts it (and the truths) back", () => {
    const before = canonOf(chatId);
    const { changes } = checkChanges(chatId, [{ kind: "canon", point: "Season 3", wont: ["Faith never turns"] }]);
    const steps = applyChange(chatId, { ...changes[0]!, id: "c1" });
    expect(canonOf(chatId).point).toBe("Season 3");
    expect(getChat(chatId)!.settings.truths).toContain("In this story, canon diverges: Faith never turns.");
    for (const s of steps.reverse()) undoStep(chatId, s);
    expect(canonOf(chatId).point).toBe(before.point);
    expect(getChat(chatId)!.settings.truths ?? []).not.toContain("In this story, canon diverges: Faith never turns.");
  });
});
