import { describe, expect, test } from "bun:test";
import { emptyCard } from "../src/cards/card";
import { type AssembleInput, assemblePrompt } from "../src/prompt/assemble";
import { expandMacros, type MacroContext } from "../src/prompt/macros";
import { meaControls } from "../src/prompt/mea";
import { controlValues, defaultPreset, importStPreset } from "../src/prompt/preset";

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
    expect(r.messages.filter((m) => m.role === "user").at(-1)).toEqual({ role: "user", content: "Hello Mira." });
    // Mea's preset ends with this reply's frame and the output contract, after the history.
    expect(r.messages.at(-1)!.content).toStartWith("[OUTPUT]");
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
    expect(r.messages[idx + 2]!.content).toBe("m7");
  });

  test("history is trimmed to the budget, newest kept", () => {
    const history = Array.from({ length: 50 }, (_, i) => ({ id: String(i), role: "user" as const, content: `message ${i} `.repeat(40) }));
    const lean = defaultPreset();
    lean.blocks = lean.blocks.filter((b) => b.id === "main" || b.kind === "history").map((b) => (b.id === "main" ? { ...b, content: "You are {{char}}." } : b));
    const r = assemblePrompt(base({ preset: lean, history, contextTarget: 3000 }));
    expect(r.trace.history.dropped).toBeGreaterThan(0);
    expect(r.messages.at(-1)!.content).toContain("message 49");
    expect(r.estPromptTokens).toBeLessThanOrEqual(3000);
  });

  test("continue, impersonate, expand tails and regen feedback", () => {
    expect(assemblePrompt(base({ kind: "continue" })).messages.at(-1)!.content).toContain("Continue your last reply");
    expect(assemblePrompt(base({ kind: "impersonate" })).messages.at(-1)!.content).toContain("write Ash's next message");
    expect(assemblePrompt(base({ kind: "expand", draft: "smile, wave" })).messages.at(-1)!.content).toContain("smile, wave");
    const fb = assemblePrompt(base({ feedback: "more dialogue" }));
    expect(fb.messages.some((m) => m.content === "[Note for this reply: more dialogue]")).toBe(true);
  });

  test("a card's system prompt follows Mea's Charter instead of replacing it (M12)", () => {
    const r = assemblePrompt(base({ card: { ...emptyCard("Mira"), system_prompt: "Custom. {{original}}" } }));
    const main = r.messages[0]!.content;
    expect(main.startsWith("You are Mira")).toBe(true);
    expect(main).toContain("What decides, highest first");
    expect(main).toContain("[The character card's own instructions]\nCustom.");
  });

  test("with an imported preset, the card's system prompt still replaces main with {{original}}", () => {
    const preset = importStPreset({ prompts: [{ identifier: "main", name: "Main", role: "system", content: "Be {{char}}." }, { identifier: "chatHistory", name: "Chat History", marker: true }], prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }, { identifier: "chatHistory", enabled: true }] }] }, "Imported");
    const r = assemblePrompt(base({ preset, card: { ...emptyCard("Mira"), system_prompt: "Custom. {{original}}" } }));
    expect(r.messages[0]!.content.startsWith("Custom. Be Mira.")).toBe(true);
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
    expect(p.blocks.map((b) => b.kind)).toEqual(["text", "controls", "memory_story", "history", "memory_recall", "post_history", "text", "authors_note"]);
    expect(p.blocks[6]).toMatchObject({ position: "depth", depth: 2, enabled: false });
    expect(p.importNotes?.some((n) => n.includes("wi_format"))).toBe(true);
  });
});

describe("Mea's default preset", () => {
  const long = "Mira set the lantern on the sill and watched the rain cross the harbour for a long while before she said anything at all to him. ".repeat(2);
  const story = [
    { id: "1", role: "assistant" as const, content: long },
    { id: "2", role: "user" as const, content: "I step inside." },
  ];
  const all = (over: Partial<AssembleInput> = {}) => assemblePrompt(base({ history: story, ...over })).messages.map((m) => m.content).join("\n\n");

  test("your defaults: continuity persona, fast romance, explicit, drama, fair judging", () => {
    const p = all();
    expect(p).toContain("finish the plain, inevitable tail");
    expect(p).toContain("Romance pace: fast");
    expect(p).toContain("Intimacy: explicit");
    expect(p).toContain("Lead genre — DRAMA");
    expect(p).toContain("are judged fairly");
    expect(p).toContain("World texture: insistent");
    expect(p).toContain("[BEFORE YOU WRITE]");
    expect(p).toContain("open your reasoning with the [BEFORE YOU WRITE] pass");
    expect(p).not.toContain("{{");
  });

  test("the turn frame: first reply, echo guard, rotating hazards; nothing for impersonation", () => {
    const p = all();
    expect(p).toContain("keep its facts, not its habits");
    expect(p).toContain("Your last reply opened «Mira set the lantern");
    expect(p).toContain("Avoid above all:");
    expect(all({ kind: "impersonate" })).not.toContain("[THIS REPLY]");
  });

  test("the rules agree with each other: OOC answers, the inline ledger, planning only for story replies", () => {
    const p = all();
    expect(p).toContain("an out-of-character question from the player gets a short answer before the story");
    expect(p).not.toContain("the <ledger> block follows the story");
    expect(all({ extras: [{ id: "ledger", name: "Ledger", content: "LEDGER", depth: 0 }] })).toContain("the <ledger> block follows the story");
    expect(all({ kind: "impersonate" })).not.toContain("[BEFORE YOU WRITE]");
  });

  test("no card greeting: no reply is told the opening came from the card", () => {
    const noGreeting = [
      { id: "1", role: "user" as const, content: "I step inside." },
      { id: "2", role: "assistant" as const, content: long },
      { id: "3", role: "user" as const, content: "I sit." },
    ];
    expect(assemblePrompt(base({ history: noGreeting })).messages.map((m) => m.content).join("\n")).not.toContain("keep its facts, not its habits");
  });

  test("a swipe opens differently from the take it replaces", () => {
    const p = all({ swipe: { rejected: "The rain had not stopped all night when Ash came up the stairs." } });
    expect(p).toContain("A fresh take on the same moment");
    expect(p).toContain("opened «The rain had not stopped all night");
  });

  test("controls shape the blocks: full cast unseals, the fair die holds across swipes, hard limits close the prompt", () => {
    const values = { ...controlValues(meaControls(), {}), persona: "full_cast", outcomes: "die", limits: "gore" };
    const p = all({ mode: "narrator", controlValues: values });
    expect(p).toContain("Ash included as the persona rule allows");
    expect(p).not.toContain("Stop before you would speak");
    expect(p).toContain("Never depict: gore.");
    const die = (m: string) => m.match(/Fair die for any contested attempt by Ash this reply: (\d+)/)?.[1];
    const first = die(p);
    expect(first).toBeDefined();
    expect(die(all({ mode: "narrator", controlValues: values, swipe: { rejected: "x" } }))).toBe(first);
  });

  test("scene modules follow the story state", () => {
    expect(all()).not.toContain("[SCENE ·");
    const p = all({ when: (c) => c === "mode = conflict" });
    expect(p).toContain("[SCENE · CONFLICT");
    expect(p).not.toContain("[SCENE · INTIMACY");
  });

  test("an empty send lets the world move", () => {
    const p = assemblePrompt(base({ history: [story[0]!] })).messages.at(-1)!.content;
    expect(p).toContain("The player waits");
  });

  test("it stays lean: about 4.5k tokens of instructions", () => {
    const r = assemblePrompt(base({ history: story }));
    expect(r.estPromptTokens).toBeLessThan(5200);
  });
});

describe("per-turn macros", () => {
  test("rotate and turnroll change with the turn, not with each call", () => {
    const at = (turn: number) => expandMacros("{{rotate::a::b::c::d::e::f::g}} {{turnroll::1d1000}}", ctx({ turn }));
    expect(at(4)).toBe(at(4));
    expect(new Set([at(1), at(2), at(3), at(4), at(5)]).size).toBeGreaterThan(1);
  });

  test("a control the preset doesn't have reads as empty", () => {
    expect(expandMacros("{{if ctl.nothing}}yes{{else}}no{{/if}}", ctx())).toBe("no");
  });
});
