import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { newId, now, run } from "../src/db/db";
import { setSetting, defaultMemoryConfig } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, setActiveSwipe, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { previewPrompt } from "../src/services/generation";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { lessonsFor, updateLesson } from "../src/steer/lessons";
import { planOutcomes } from "../src/steer/planbook";
import { notebookText, plannerNotes, reviewPlans, ruleNotes } from "../src/steer/plannernotes";
import { freshDb } from "./helpers";

let chatId = "";
const PLAN = (tier: string, move = "she offers tea.") => `Tier: ${tier}\nNOW — night.\nMINDS — Mira wary.\nMOVE — ${move}\nVOICE — short.`;

/** An answered, planned reply: its takes (the passed-over ones planned with `passed`), its tier and slips. */
function reply(o: { tier?: string; takes?: number; slips?: string[]; kept?: string; passed?: string } = {}) {
  const id = addMessage(chatId, "assistant", "Take 0.", { name: "Mira", meta: { plan: "own", model: "m/one" } });
  run("UPDATE swipes SET reasoning = ? WHERE message_id = ?", PLAN(o.tier ?? "Routine", o.passed), id);
  for (let i = 1; i < (o.takes ?? 1); i++) {
    run("INSERT INTO swipes (id, message_id, idx, content, reasoning, status, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'done', '{\"plan\":\"own\"}', ?, ?)", newId(), id, i, `Take ${i}.`, PLAN(o.tier ?? "Routine", o.kept), now(), now());
  }
  if ((o.takes ?? 1) > 1) setActiveSwipe(id, (o.takes ?? 1) - 1);
  if (o.slips?.length) {
    run(
      "INSERT INTO continuity_flags (id, chat_id, message_id, swipe_idx, issues, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)",
      newId(), chatId, id, Math.max(0, (o.takes ?? 1) - 1), JSON.stringify(o.slips.map((kind) => ({ id: newId(), kind, severity: "minor", claim: "", conflict: "", citations: [], fix: "", by: "rules" }))), now(), now(),
    );
  }
  addMessage(chatId, "user", "Go on.");
}

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "accuracy.check", "quota.refresh", "cache.probe", "tracker.update", "lessons.learn", "planner.review", "offpage.reword"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  const profile = createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 12000, max_tokens: 300 } });
  setSetting("routing.story", profile);
  setSetting("routing.tasks", { summarizer: null, helper: profile, tracker: null, world: null, assistant: null });
  setSetting("memory.config", { ...defaultMemoryConfig, checkerModel: false });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "The lamp hums." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
  addMessage(chatId, "user", "Hello.");
});
afterAll(() => pauseJobs(false));

describe("the learning planner: notes from how plans turned out", () => {
  test("rules: the story's commonest slip becomes a RISK note; routine beats that keep failing, a TIER note", () => {
    for (let i = 0; i < 6; i++) reply({ tier: "Routine", takes: i % 3 === 0 ? 1 : 2, slips: i < 3 ? ["leak"] : [] });
    for (let i = 0; i < 4; i++) reply({ tier: "Charged" });
    const notes = ruleNotes(planOutcomes({ chatId }));
    expect(notes.map((n) => [n.step, n.rule])).toEqual([
      ["RISK", "risk:leak"],
      ["TIER", "tier:routine-up"],
    ]);
    expect(notes[0]!.text).toContain("someone knowing what they shouldn't");
    expect(notes[0]!.why).toContain("3 of the last 10");
  });

  test("review: notes arrive as suggestions with their step, and one you turned down never comes back", async () => {
    const found = await reviewPlans(chatId);
    expect(found.map((l) => [l.status, l.data.from, l.data.step])).toEqual([
      ["suggested", "planner", "RISK"],
      ["suggested", "planner", "TIER"],
    ]);
    // Suggestions don't reach the plan until kept.
    expect(plannerNotes(chatId)).toEqual([]);
    updateLesson(found[1]!.id, { status: "rejected" });
    updateLesson(found[0]!.id, { status: "kept", chatId });
    expect(await reviewPlans(chatId)).toEqual([]);
    expect(plannerNotes(chatId).map((n) => n.step)).toEqual(["RISK"]);
  });

  test("a kept note goes into the planning pass, in its step, and not into the [LESSONS] lane", async () => {
    const p = await previewPrompt(chatId);
    const planning = p.trace.blocks.find((b) => b.id === "mea-planning");
    expect(planning?.note).toContain("with the planner's notebook");
    const sent = JSON.stringify(p.messages);
    expect(sent).toContain("THE PLANNER'S NOTEBOOK");
    expect(sent).toContain("- for RISK: Check for someone knowing what they shouldn't first");
    expect(p.trace.blocks.find((b) => b.id === "extra:lessons" || b.id === "lane:lessons")?.text ?? "").not.toContain("someone knowing");
    expect(notebookText([])).toBe("");
  });

  test("Rules + model: the helper compares the plans of the takes you kept with the ones you passed over", async () => {
    updateChat(chatId, { settings: { guards: { lessons: "model" } } });
    for (let i = 0; i < 3; i++) reply({ tier: "Charged", takes: 2, kept: "MOCK_NOTE the lamp goes out.", passed: "she answers plainly." });
    const found = await reviewPlans(chatId, { force: true });
    const note = found.find((l) => l.by === "model");
    expect(note).toMatchObject({ status: "suggested", text: "Prefer the sideways consequence over the obvious answer.", data: { from: "planner", step: "MOVE" } });
    // Lessons off: no planner notes at all.
    updateChat(chatId, { settings: { guards: { lessons: "off" } } });
    expect(await reviewPlans(chatId, { force: true })).toEqual([]);
    // The kept RISK note and the helper's MOVE suggestion (the TIER one you turned down is gone).
    expect(lessonsFor(chatId).filter((l) => l.data.from === "planner").map((l) => l.data.step).sort()).toEqual(["MOVE", "RISK"]);
  });
});
