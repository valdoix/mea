import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadScenarios, runScenario } from "../src/golden/run";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { freshDb } from "./helpers";

/** K1: the golden scenarios, graded on the mock provider (free; runs in CI). */
beforeAll(async () => {
  freshDb();
  pauseJobs(true);
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "accuracy.check", "quota.refresh", "cache.probe", "tracker.update", "lessons.learn", "offpage.reword", "lore.embed"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 12000, max_tokens: 300 } });
  setSetting("memory.config", { ...defaultMemoryConfig, checkerModel: false });
});
afterAll(() => pauseJobs(false));

describe("golden scenarios (K1)", () => {
  const scenarios = loadScenarios();
  test("there's one for each thing Mea promises to keep", () => {
    expect(scenarios.map((s) => s.name)).toEqual(["agency", "knowledge-leak", "clock", "weather", "people-present", "promise-kept", "offpage-secret", "canon-cutoff", "safety-floor", "ledger-shape", "planning-leak", "separate-planner", "planner-fallback", "revealed-secret", "retold-past", "promise-day-count", "told-wrong-stays", "deliberate-retelling"]);
  });
  for (const s of scenarios) {
    test(s.name, async () => {
      const r = await runScenario(s);
      const failed = r.checks.filter((c) => !c.pass);
      expect(failed).toEqual([]);
      expect(r.checks.length).toBeGreaterThan(0);
    });
  }
});
