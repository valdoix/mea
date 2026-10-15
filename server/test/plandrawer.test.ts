import { describe, expect, test } from "bun:test";
import { parsePlan, planSource } from "../../web/src/lib/plan";

describe("the plan drawer reads the planning pass step by step", () => {
  test("labelled lines become steps, in the order written", () => {
    const p = parsePlan("Tier: Charged\nNOW — night, the lamp room; Mira and Ash.\nSEAL — SAID: why stay. Stop on her answer.\nMINDS — Mira: wants company, fears pity.\n  Ash: curious.\nMOVE — obvious: deflect; only-her: the truth; sideways: the lamp fails. Choose the truth.\nVOICE — short, quiet.");
    expect(p.tier).toBe("Charged");
    expect(p.steps.map((s) => s.key)).toEqual(["NOW", "SEAL", "MINDS", "MOVE", "VOICE"]);
    expect(p.steps[2]!.text).toBe("Mira: wants company, fears pity.\n  Ash: curious.");
    expect(p.rest).toBe("");
  });

  test("bold, heading, bullet and colon styles all count", () => {
    const p = parsePlan("**NOW —** dusk.\n## SEAL: he asks.\n- **KNOW**: only Mira knows.\n* RISK – writing for Ash.\nWORLD (a line) — the bell rings.");
    expect(p.steps).toEqual([
      { key: "NOW", text: "dusk." },
      { key: "SEAL", text: "he asks." },
      { key: "KNOW", text: "only Mira knows." },
      { key: "RISK", text: "writing for Ash." },
      { key: "WORLD", text: "the bell rings." },
    ]);
  });

  test("thinking before the pass and after its last step stays apart, as other reasoning", () => {
    const p = parsePlan("Okay, let me think about where the scene is before I start the pass.\n[BEFORE YOU WRITE — the planning pass]\nNOW — night.\nMOVE — she offers tea.\nVOICE — short.\n\nRight, now I'll write it, keeping the opening different from last time.");
    expect(p.steps.map((s) => s.key)).toEqual(["NOW", "MOVE", "VOICE"]);
    expect(p.steps.at(-1)!.text).toBe("short.");
    expect(p.rest).toContain("let me think about where the scene is");
    expect(p.rest).toContain("now I'll write it");
    expect(p.rest).not.toContain("BEFORE YOU WRITE");
  });

  test("a step written twice is joined; think tags and the stop rule are dropped", () => {
    const p = parsePlan("<think>NOW — night.\nMOVE — tea.\nMOVE — no: the truth.\nSTOP RULE: done.</think>");
    expect(p.steps).toEqual([
      { key: "NOW", text: "night." },
      { key: "MOVE", text: "tea.\nno: the truth." },
    ]);
  });

  test("a pass written inline splits at its labels too", () => {
    const p = parsePlan("Keep continuity with the lighthouse scene. NOW — evening, the lamp room. MOVE — Mira offers tea. VOICE — short.");
    expect(p.steps).toEqual([
      { key: "NOW", text: "evening, the lamp room." },
      { key: "MOVE", text: "Mira offers tea." },
      { key: "VOICE", text: "short." },
    ]);
    expect(p.rest).toBe("Keep continuity with the lighthouse scene.");
  });

  test("reasoning that isn't the pass has no steps and stays whole; lower-case words aren't labels", () => {
    const p = parsePlan("Now — she would answer. Move on to the reply.\nThe user wants a quiet scene.");
    expect(p.steps).toEqual([]);
    expect(p.tier).toBeNull();
    expect(p.rest).toContain("The user wants a quiet scene.");
    expect(parsePlan(null)).toEqual({ steps: [], tier: null, rest: "" });
  });

  test("where the plan came from", () => {
    expect(planSource("rescue")).toBe("Planned by the planner model, as a last resort: the writer skipped its plan twice.");
    expect(planSource("none")).toBeNull();
  });
});
