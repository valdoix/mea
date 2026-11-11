import { describe, expect, test } from "bun:test";
import { overBilled } from "../src/accuracy/health";
import { forScene, NOW_RECALLED, NOW_SHOWN } from "../src/lore/facts";
import { PLAN_SCALE, planScale } from "../src/services/generation";
import { DRAFT_NEW_WORDS, DRAFT_PLANS, draftWorthPlanning } from "../src/steer/advisor";

/** docs/33 8b: send less. */
describe("a list that only grows rides with its newest and what the scene names", () => {
  const milestone = (value: string) => ({ slot: "milestone", kind: "event", value });
  const many = Array.from({ length: 30 }, (_, i) => milestone(`Buffy and Gabriel shared moment number ${i} together`));

  test("the newest stay, the older go", () => {
    const out = forScene(many, "Buffy pours the coffee.");
    expect(out).toHaveLength(NOW_SHOWN);
    expect(out.at(-1)!.value).toContain("number 29");
  });

  test("an older one comes back when the scene is about it, the leads' names aside", () => {
    const facts = [milestone("Buffy kissed Gabriel on the kitchen counter, egg on their mouths"), ...many];
    expect(forScene(facts, "Gabriel cracks an egg by the counter in the kitchen.").some((f) => f.value.includes("kitchen counter"))).toBe(true);
    // Only the names: not enough.
    expect(forScene(facts, "Buffy looks at Gabriel.").some((f) => f.value.includes("kitchen counter"))).toBe(false);
  });

  test("at most a few come back, and standing facts are never cut", () => {
    const old = Array.from({ length: 10 }, (_, i) => milestone(`The ice rink dance on skates, take ${i}`));
    const standing = Array.from({ length: 20 }, (_, i) => ({ slot: null, kind: "attribute", value: `Fact ${i}` }));
    const out = forScene([...standing, ...old, ...many], "They go back to the ice rink with their skates.");
    expect(out.filter((f) => f.kind === "attribute")).toHaveLength(20);
    expect(out.filter((f) => f.value.includes("ice rink"))).toHaveLength(NOW_RECALLED);
  });

  test("a short list is sent whole", () => {
    expect(forScene(many.slice(0, NOW_SHOWN), "")).toHaveLength(NOW_SHOWN);
  });
});

describe("the plan step's prompt", () => {
  test("is smaller without a prompt cache, and the same with one", () => {
    expect(planScale(false)).toBe(PLAN_SCALE);
    expect(PLAN_SCALE).toBeLessThan(1);
    expect(planScale(true)).toBe(1);
  });
});

describe("plans while you type", () => {
  test("the first pause plans; the next only with enough new words; never past the cap", () => {
    expect(draftWorthPlanning(undefined, "I")).toBe(true);
    expect(draftWorthPlanning({ draft: "I walk to the door", n: 1 }, "I walk to the door and wait")).toBe(false);
    const more = "I walk to the door and knock twice, calling out for Dawn about the missing groceries";
    expect(DRAFT_NEW_WORDS).toBeGreaterThan(3);
    expect(draftWorthPlanning({ draft: "I walk to the door", n: 1 }, more)).toBe(true);
    expect(draftWorthPlanning({ draft: "I walk to the door", n: DRAFT_PLANS }, more)).toBe(false);
  });
});

describe("a route that counts more than it was sent", () => {
  const gen = (model: string, est: number, reported: number) => ({ model, est, prompt_tokens: reported, chars: est * 4 });
  test("named when most of its calls count far past what the prompt could hold", () => {
    const gens = [gen("[SP]claude-opus-5-5", 90_000, 280_000), gen("[SP]claude-opus-5-5", 100_000, 300_000), gen("[SP]claude-opus-5-5", 80_000, 250_000), gen("glm-5.3", 90_000, 91_000)];
    expect(overBilled(gens)).toEqual({ model: "[SP]claude-opus-5-5", n: 3, times: 3.1 });
  });
  test("a tokenizer that counts a little more is not", () => {
    expect(overBilled([gen("claude-opus-5-5", 90_000, 145_000), gen("claude-opus-5-5", 90_000, 150_000), gen("claude-opus-5-5", 90_000, 140_000)])).toBeNull();
  });
});
