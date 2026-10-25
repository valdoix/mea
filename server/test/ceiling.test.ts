import { describe, expect, test } from "bun:test";
import { emptyCard } from "../src/cards/card";
import { type AssembleInput, assemblePrompt } from "../src/prompt/assemble";
import { defaultPreset } from "../src/prompt/preset";
import { defaultMemoryConfig } from "../src/lib/settings";

const words = (n: number, w = "lamp") => Array.from({ length: n }, () => w).join(" ");
const base = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  kind: "story",
  preset: defaultPreset(),
  card: { ...emptyCard("Mira"), description: "Keeper of the lighthouse.", personality: "wistful", post_history_instructions: "" },
  userName: "Ash",
  personaText: "A traveler.",
  mode: "companion",
  history: Array.from({ length: 40 }, (_, i) => ({ id: String(i), role: i % 2 ? ("user" as const) : ("assistant" as const), content: `Message ${i}. ${words(30, "tide")}` })),
  lore: null,
  contextTarget: 8000,
  reserve: 1000,
  modelId: "test",
  vars: {},
  seed: "c",
  extras: [
    { id: "canon", name: "Canon order", content: words(60, "canon"), prefix: true },
    { id: "trackers", name: "Story state (trackers)", content: words(300, "state"), depth: 1 },
    { id: "lane:craft", lane: "craft", name: "[CRAFT]", content: words(400, "craft"), depth: 1 },
    { id: "lane:lessons", lane: "lessons", name: "[LESSONS]", content: words(300, "lesson"), depth: 1 },
    { id: "lane:offpage", lane: "offpage", name: "[OFF THE PAGE]", content: words(200, "secret"), depth: 1 },
    { id: "style", name: "Style profile", content: words(200, "style"), prefix: true },
  ],
  ...over,
});
const text = (r: ReturnType<typeof assemblePrompt>) => r.messages.map((m) => m.content).join("\n");

describe("the prompt ceiling (H1)", () => {
  test("under the ceiling nothing is cut", () => {
    const r = assemblePrompt(base({ ceiling: { tokens: 50_000, order: defaultMemoryConfig.cutOrder } }));
    expect(r.trace.ceiling).toMatchObject({ cuts: [], auto: false });
    expect(text(r)).toContain("craft craft");
  });

  test("over it, things go in the order set, and stop once it fits", () => {
    const r = assemblePrompt(base({ ceiling: { tokens: 900, order: defaultMemoryConfig.cutOrder } }));
    const cuts = r.trace.ceiling!.cuts.map((c) => c.key);
    expect(cuts.slice(0, 2)).toEqual(["craft", "style"]);
    expect(r.trace.ceiling!.after).toBeLessThanOrEqual(900);
    expect(text(r)).not.toContain("craft craft");
    expect(text(r)).not.toContain("style style");
    // Cut blocks say so in the Inspector's block list.
    expect(r.trace.blocks.find((b) => b.id === "extra:lane:craft")).toMatchObject({ included: false, note: "cut: over the ceiling" });
  });

  test("the safety lanes and what you keep are never cut", () => {
    const r = assemblePrompt(base({ ceiling: { tokens: 10, order: ["offpage", "canon", "craft", "lessons", "trackers", "style"], keep: ["lessons"] } }));
    const cuts = r.trace.ceiling!.cuts.map((c) => c.key);
    expect(cuts).not.toContain("offpage");
    expect(cuts).not.toContain("canon");
    expect(cuts).not.toContain("lessons");
    expect(text(r)).toContain("secret secret");
    expect(text(r)).toContain("lesson lesson");
  });

  test("the room freed goes back to the history", () => {
    // A target small enough that the whole history doesn't fit inside the window floor.
    const tight = assemblePrompt(base({ contextTarget: 5000, ceiling: { tokens: 50_000, order: [] } }));
    const freed = assemblePrompt(base({ contextTarget: 5000, ceiling: { tokens: 300, order: defaultMemoryConfig.cutOrder } }));
    expect(freed.trace.history.included).toBeGreaterThan(tight.trace.history.included);
  });

  test("automatic: a share of the model's room once the reply's is set aside", () => {
    const r = assemblePrompt(base({ ceiling: { tokens: null, order: defaultMemoryConfig.cutOrder } }));
    expect(r.trace.ceiling).toMatchObject({ auto: true, tokens: Math.round(r.trace.budget.effectiveTarget * 0.3) });
  });
});
