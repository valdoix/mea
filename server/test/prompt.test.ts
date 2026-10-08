import { describe, expect, test } from "bun:test";
import { emptyCard } from "../src/cards/card";
import { type AssembleInput, assemblePrompt } from "../src/prompt/assemble";
import { expandMacros, type MacroContext } from "../src/prompt/macros";
import { defaultPreset, importStPreset } from "../src/prompt/preset";

const ctx = (extra: Partial<MacroContext> = {}): MacroContext => ({ char: "Mira", user: "Ash", vars: {}, mode: "companion", seed: "chat1", random: () => 0, ...extra });

describe("macros", () => {
  test("basic substitution and unknown macros", () => {
    expect(expandMacros("{{char}} waves at {{user}}.", ctx())).toBe("Mira waves at Ash.");
    expect(expandMacros("{{notAMacro}} stays", ctx())).toBe("{{notAMacro}} stays");
    expect(expandMacros("a {{// comment}}b", ctx())).toBe("a b");
  });

  test("if / else, comparisons, nesting", () => {
    expect(expandMacros("{{if mode == narrator}}N{{else}}C{{/if}}", ctx())).toBe("C");
    expect(expandMacros("{{if mode == narrator}}N{{else}}C{{/if}}", ctx({ mode: "narrator" }))).toBe("N");
    expect(expandMacros("{{if {{getvar::x}}}}yes{{else}}no{{/if}}", ctx({ vars: { x: "1" } }))).toBe("yes");
    expect(expandMacros("{{if not mode == narrator}}{{if char == Mira}}both{{/if}}{{/if}}", ctx())).toBe("both");
  });

  test("variables, random, pick, roll, trim", () => {
    const c = ctx();
    expect(expandMacros("{{setvar::mood::happy}}{{getvar::mood}}", c)).toBe("happy");
    expect(c.vars.mood).toBe("happy");
    expect(expandMacros("{{incvar::n}}{{incvar::n}}", c)).toBe("12");
    expect(expandMacros("{{random::a::b::c}}", ctx())).toBe("a");
    expect(expandMacros("{{random:x,y}}", ctx())).toBe("x");
    const p1 = expandMacros("{{pick::a::b::c::d}}", ctx());
    expect(expandMacros("{{pick::a::b::c::d}}", ctx())).toBe(p1);
    expect(expandMacros("{{roll:2d6+3}}", ctx())).toBe("5");
    expect(expandMacros("a   {{trim}}   b", ctx())).toBe("ab");
  });
});

const base = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  kind: "story",
  preset: defaultPreset(),
  card: { ...emptyCard("Mira"), description: "Keeper of the lighthouse.", personality: "wistful", post_history_instructions: "" },
  userName: "Ash",
  personaText: "A traveler.",
  mode: "companion",
  history: [
    { id: "1", role: "assistant", content: "Welcome, Ash." },
    { id: "2", role: "user", content: "Hello Mira." },
  ],
  lore: null,
  contextTarget: 48000,
  modelId: "test",
  vars: {},
  seed: "c",
  ...over,
});

describe("prompt assembly", () => {
  test("default preset produces system + history in order", () => {
    const r = assemblePrompt(base());
    expect(r.messages[0]!.role).toBe("system");
    expect(r.messages[0]!.content).toContain("You are Mira");
    expect(r.messages[0]!.content).toContain("Keeper of the lighthouse.");
    expect(r.messages[0]!.content).toContain("About Ash:");
    expect(r.messages.at(-1)).toEqual({ role: "user", content: "Hello Mira." });
    expect(r.trace.history.included).toBe(2);
  });

  test("narrator mode switches the main prompt", () => {
    expect(assemblePrompt(base({ mode: "narrator" })).messages[0]!.content).toContain("You are the narrator");
  });

  test("author's note goes in at depth", () => {
    const history = Array.from({ length: 8 }, (_, i) => ({ id: String(i), role: (i % 2 ? "user" : "assistant") as "user" | "assistant", content: `m${i}` }));
    const r = assemblePrompt(base({ history, authorsNote: { content: "Keep it rainy.", depth: 2 } }));
    const idx = r.messages.findIndex((m) => m.content === "Keep it rainy.");
    expect(r.messages[idx + 1]!.content).toBe("m6");
    expect(r.messages.length - idx).toBe(3);
  });

  test("history is trimmed to the budget, newest kept", () => {
    const history = Array.from({ length: 50 }, (_, i) => ({ id: String(i), role: "user" as const, content: `message ${i} `.repeat(40) }));
    const r = assemblePrompt(base({ history, contextTarget: 3000 }));
    expect(r.trace.history.dropped).toBeGreaterThan(0);
    expect(r.messages.at(-1)!.content).toContain("message 49");
    expect(r.estPromptTokens).toBeLessThanOrEqual(3000);
  });

  test("continue, impersonate, expand tails and regen feedback", () => {
    expect(assemblePrompt(base({ kind: "continue" })).messages.at(-1)!.content).toContain("Continue your last reply");
    expect(assemblePrompt(base({ kind: "impersonate" })).messages.at(-1)!.content).toContain("Write Ash's next message");
    expect(assemblePrompt(base({ kind: "expand", draft: "smile, wave" })).messages.at(-1)!.content).toContain("smile, wave");
    const fb = assemblePrompt(base({ feedback: "more dialogue" }));
    expect(fb.messages.at(-1)!.content).toContain("more dialogue");
  });

  test("character system prompt replaces main with {{original}}", () => {
    const r = assemblePrompt(base({ card: { ...emptyCard("Mira"), system_prompt: "Custom. {{original}}" } }));
    expect(r.messages[0]!.content.startsWith("Custom. You are Mira")).toBe(true);
  });
});

describe("SillyTavern preset import", () => {
  test("maps prompt order, markers and samplers", () => {
    const p = importStPreset(
      {
        temperature: 0.8,
        openai_max_tokens: 900,
        prompts: [
          { identifier: "main", name: "Main", role: "system", content: "Be {{char}}." },
          { identifier: "chatHistory", name: "Chat History", marker: true },
          { identifier: "jailbreak", name: "PHI", role: "system", content: "Stay in character." },
          { identifier: "custom1", name: "Depth note", role: "system", content: "deep", injection_position: 1, injection_depth: 2 },
        ],
        prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }, { identifier: "chatHistory", enabled: true }, { identifier: "jailbreak", enabled: true }, { identifier: "custom1", enabled: false }] }],
        wi_format: "[{0}]",
      },
      "Imported",
    );
    expect(p.samplers.temperature).toBe(0.8);
    expect(p.samplers.max_tokens).toBe(900);
    expect(p.blocks.map((b) => b.kind)).toEqual(["text", "history", "post_history", "text", "authors_note"]);
    expect(p.blocks[3]).toMatchObject({ position: "depth", depth: 2, enabled: false });
    expect(p.importNotes?.some((n) => n.includes("wi_format"))).toBe(true);
  });
});
