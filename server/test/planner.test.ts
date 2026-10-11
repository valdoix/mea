import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { newId, one, run } from "../src/db/db";
import { setSetting, defaultMemoryConfig } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, historyForPrompt, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { subscribe } from "../src/lib/events";
import { previewPrompt, startStory } from "../src/services/generation";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { editPlan, planFor, plannerSteps, runAdvisor, steerFor, turnKey } from "../src/steer/advisor";
import { freshDb } from "./helpers";

let chatId = "";

beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "accuracy.check", "quota.refresh", "cache.probe", "tracker.update", "lessons.learn", "offpage.reword"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 12000, max_tokens: 300 } });
  setSetting("memory.config", { ...defaultMemoryConfig, checkerModel: false });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "The lamp hums." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  addMessage(chatId, "assistant", "The lamp hums.", { name: "Mira" });
  addMessage(chatId, "user", "Why do you stay up here?");
});
afterAll(() => pauseJobs(false));

const block = (p: Awaited<ReturnType<typeof previewPrompt>>, id: string) => p.trace.blocks.find((b) => b.id === id);

describe("a separate planner model (H3)", () => {
  test("the planner gets Mea's planning pass, resolved for this chat", () => {
    const steps = plannerSteps("Ash", true);
    expect(steps).toStartWith("NOW —");
    expect(steps).toContain("SEAL —");
    expect(steps).toContain("VOICE —");
    expect(steps).not.toContain("{{");
    expect(steps).toContain("Ash");
  });

  test("in the reply (today): the writer keeps its own planning pass", async () => {
    const p = await previewPrompt(chatId);
    expect(block(p, "mea-planning")?.included).toBe(true);
    expect(steerFor(chatId).planner).toBe(false);
  });

  test("separate planner: the writer gets <director-plan> and no planning pass of its own", async () => {
    updateChat(chatId, { settings: { planning: "planner" } });
    expect(steerFor(chatId)).toMatchObject({ planner: true, advisorOn: true });
    const plan = await runAdvisor(chatId);
    expect(plan?.pass).toContain("NOW — the lamp room");
    expect(plan?.pass).toContain("LANES — seen");
    const p = await previewPrompt(chatId);
    expect(block(p, "mea-planning")).toMatchObject({ included: false, note: "the separate planner planned this reply" });
    const adv = block(p, "extra:advisor");
    expect(adv?.name).toBe("Director's plan");
    expect(adv?.text).toContain("<director-plan>");
    expect(adv?.text).toContain("don't open with <think>");
    expect(one<{ kind: string }>("SELECT kind FROM generations WHERE chat_id = ? AND task = 'planner'", chatId)?.kind).toBe("planner");
  });

  test("separate planner: the reply shows the planner's pass as its reasoning", async () => {
    const ended = new Promise<void>((resolve) => {
      const off = subscribe((e) => {
        if (e.type === "gen.end" && e.chatId === chatId) {
          off();
          resolve();
        }
      });
    });
    const { messageId } = await startStory(chatId, "new");
    await ended;
    const s = one<{ content: string; reasoning: string | null }>("SELECT content, reasoning FROM swipes WHERE message_id = ?", messageId)!;
    expect(s.reasoning).toStartWith("NOW — the lamp room");
    expect(s.content).not.toContain("NOW — the lamp room");
    run("DELETE FROM messages WHERE id = ?", messageId);
  });

  test("Edit the plan: the regenerated take is written from your edit", async () => {
    const key = turnKey(historyForPrompt(chatId));
    const gen = newId();
    run("UPDATE advisor_plans SET used_at = 1, generation_id = ? WHERE chat_id = ? AND key = ?", gen, chatId, key);
    expect(editPlan(chatId, gen, "NOW — dawn instead.\nMOVE — she changes the subject.")).toBe(true);
    expect(planFor(chatId, key)?.pass).toBe("NOW — dawn instead.\nMOVE — she changes the subject.");
    const p = await previewPrompt(chatId);
    expect(block(p, "extra:advisor")?.text).toContain("she changes the subject");
  });

  test("planner late or failing: the writer plans for itself as today", async () => {
    addMessage(chatId, "assistant", "She shrugs.", { name: "Mira" });
    addMessage(chatId, "user", "MOCK_PLANNER_FAIL tell me.");
    expect(await runAdvisor(chatId)).toBeNull();
    const p = await previewPrompt(chatId);
    expect(block(p, "mea-planning")?.included).toBe(true);
    updateChat(chatId, { settings: { planning: "reply" } });
  });
});
