import { describe, expect, test } from "bun:test";
import { createConnection, createProfile, resolveProfile } from "../src/services/connections";
import { freshDb } from "./helpers";
import { normalizeCard } from "../src/cards/card";
import { assemblePrompt, type AssembleInput } from "../src/prompt/assemble";
import { meaPreset } from "../src/prompt/mea";
import { ADAPTERS, adapterSuggestion, detectFamily, modelNotes, plansFirst, resolveFamily } from "../src/prompt/models";

const { data: card } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Mira keeps the lighthouse.", personality: "", first_mes: "" } });

function prompt(extra: Partial<AssembleInput> = {}) {
  const r = assemblePrompt({
    kind: "story",
    preset: meaPreset(),
    card,
    userName: "Alex",
    personaText: "",
    mode: "companion",
    history: [
      { id: "1", role: "assistant", content: "Mira lit the lamp." },
      { id: "2", role: "user", content: "Hi." },
    ],
    lore: null,
    contextTarget: 64000,
    modelId: "glm-4.6",
    vars: {},
    seed: "s",
    ...extra,
  });
  // docs/29 §4.4: the plan notes ride in <pass>, the prose habits on the prose card.
  const pass = r.messages.map((m) => m.content).find((c) => c.startsWith("<pass>")) ?? "";
  const prose = r.messages.map((m) => m.content).find((c) => c.startsWith("<prose>")) ?? "";
  return { notes: `${pass}\n${prose}`, pass, prose, trace: r.trace };
}

const ROUTES = [
  { planned: false, providerReasoning: false },
  { planned: false, providerReasoning: true },
  { planned: true, providerReasoning: false },
];

describe("model adapters", () => {
  test("ids map to their families, and MiMo has none of its own", () => {
    expect(detectFamily("anthropic/claude-sonnet-4.5")).toBe("claude");
    expect(detectFamily("deepseek-ai/DeepSeek-V3.2")).toBe("deepseek");
    expect(detectFamily("google/gemini-3-pro-preview")).toBe("gemini");
    expect(detectFamily("z-ai/glm-4.6")).toBe("glm");
    expect(detectFamily("moonshotai/kimi-k2-thinking")).toBe("kimi");
    expect(detectFamily("xiaomi/mimo-v2-flash")).toBe("");
  });

  test("every model, known or not, is told not to draft, on every route", () => {
    for (const family of [...ADAPTERS.map((a) => a.family), "", "none"]) {
      for (const route of ROUTES) expect(modelNotes(family, route).plan).toMatch(/^.*Draft nothing/);
    }
  });

  test("the drafting line names where the plan is written", () => {
    expect(modelNotes("glm", ROUTES[0]!).plan).toContain("Draft nothing in the <think> block");
    expect(modelNotes("claude", ROUTES[1]!).plan).toContain("Draft nothing in your reasoning");
    expect(modelNotes("kimi", ROUTES[2]!).plan).toContain("write the story once, straight through");
  });

  test("the preset sends the family's notes with the drafting line", () => {
    const { pass, prose, trace } = prompt();
    expect(pass).toContain("No self-talk, no rechecking.");
    expect(pass).toContain("Draft nothing in the <think> block");
    expect(pass.indexOf("Draft nothing")).toBeLessThan(pass.indexOf("STOP RULE"));
    expect(prose).toContain("For this model: Your habits to catch, in the plan as in the story: office, bank and courtroom words");
    expect(trace.model).toEqual({ family: "glm", label: "GLM", chosen: false });
  });

  test("an unknown model still gets the drafting line", () => {
    const { pass, prose, trace } = prompt({ modelId: "xiaomi/mimo-v2-flash" });
    expect(pass).toContain("\nDraft nothing in the <think> block: no sentence, line of dialogue, opening or outline of the reply. Write the story once, inside <story>.\nSTOP RULE");
    expect(prose).not.toContain("For this model:");
    expect(trace.model?.label).toBe("Other");
  });

  test("the profile's choice and extra notes win over the id", () => {
    const { pass, prose, trace } = prompt({ modelId: "some-router/finetune-x", modelFamily: "claude", modelNotes: "Catch \"a beat\".", providerReasoning: true });
    expect(pass).toContain("Extended thinking is the planning pass");
    expect(pass).toContain("Draft nothing in your reasoning");
    expect(prose).toContain("Catch \"a beat\".\n</prose>");
    expect(trace.model).toEqual({ family: "claude", label: "Claude", chosen: true });
  });

  test("None drops the family's notes but keeps the drafting line", () => {
    const { notes } = prompt({ modelFamily: "none" });
    expect(notes).not.toContain("For this model:");
    expect(notes).toContain("Draft nothing");
  });

  test("a profile setting that isn't a family falls back to the id", () => {
    expect(resolveFamily("mimo", "z-ai/glm-4.6")).toBe("glm");
    expect(resolveFamily("none", "z-ai/glm-4.6")).toBe("none");
    expect(resolveFamily(undefined, "claude-opus")).toBe("claude");
  });
});

describe("the profile's model notes", () => {
  test("go with its own model, never into the request, and not across a quick switch", () => {
    freshDb();
    const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
    const id = createProfile({ name: "Story", connectionId: conn, modelId: "router/finetune-x", params: { model_family: "glm", model_notes: " Catch counts. " } });
    const own = resolveProfile(id);
    expect(own.modelFamily).toBe("glm");
    expect(own.modelNotes).toBe("Catch counts.");
    expect("model_family" in own.params).toBe(false);
    expect("model_notes" in own.params).toBe(false);
    const switched = resolveProfile(id, { connectionId: conn, modelId: "claude-sonnet" });
    expect(switched.modelFamily).toBeUndefined();
    expect(switched.modelNotes).toBeUndefined();
  });
});

describe("adapters filled from the census (docs/29 Part 5)", () => {
  test("Claude's notes carry its measured habits, GLM's its own", () => {
    const claude = modelNotes("claude", ROUTES[0]!).prose;
    for (const habit of ["drumbeat fragments", "one-line paragraphs", "broken off with a dash", "load-bearing", "teaser ending"]) expect(claude).toContain(habit);
    const glm = modelNotes("glm", ROUTES[0]!).prose;
    expect(glm).toContain("clinical and textbook words");
    // GLM 5.x breaks off a line in 15% of replies, not every one: the clause went.
    expect(glm).not.toContain("broken off");
  });

  test("the planning ceilings shrink where a family over-plans", () => {
    expect(prompt().pass).toContain("a line each, 90 words at most");
    expect(prompt().pass).toContain("WORLD a line, 220 words at most");
    const thinking = prompt({ modelId: "claude-opus-5-5", providerReasoning: true }).pass;
    expect(thinking).toContain("a line each, 70 words at most");
    expect(thinking).toContain("WORLD a line, 180 words at most");
    expect(thinking).toContain("every step in full, 320 words at most");
    // Claude without extended thinking follows the order literally and keeps the full ceilings.
    expect(prompt({ modelId: "claude-opus-5-5" }).pass).toContain("a line each, 90 words at most");
    expect(prompt({ modelId: "deepseek-ai/DeepSeek-V3.2" }).pass).toContain("a line each, 70 words at most");
  });

  test("DeepSeek plans in its own step from the start, Gemini only with its reasoning hidden; no other family does", () => {
    const hidden = { hidesReasoning: true };
    const shown = { hidesReasoning: false };
    expect(plansFirst("deepseek", hidden)).toBe(true);
    expect(plansFirst("deepseek", shown)).toBe(true);
    expect(plansFirst("gemini", hidden)).toBe(true);
    expect(plansFirst("gemini", shown)).toBe(false);
    for (const f of ["claude", "glm", "kimi", "gpt", "open", "", "none"]) {
      expect(plansFirst(f, hidden), f).toBe(false);
      expect(plansFirst(f, shown), f).toBe(false);
    }
  });

  test("sampler suggestions come from each maker's guidance, and only where there is some", () => {
    expect(adapterSuggestion("z-ai/glm-5.3").samplers).toMatchObject({ temperature: 1, top_p: 0.95 });
    expect(adapterSuggestion("google/gemini-4-argon").samplers).toMatchObject({ temperature: 1 });
    expect(adapterSuggestion("moonshotai/Kimi-K2-Instruct").samplers?.temperature).toBe(0.6);
    expect(adapterSuggestion("moonshotai/kimi-k2-thinking").samplers?.temperature).toBe(1);
    expect(adapterSuggestion("moonshotai/kimi-k3.1-pro").samplers).toBeNull();
    expect(adapterSuggestion("claude-opus-5-5").samplers).toBeNull();
    expect(adapterSuggestion("deepseek/deepseek-latest").samplers).toBeNull();
    // The profile's family wins, and None suggests nothing.
    expect(adapterSuggestion("router/finetune-x", "glm")).toMatchObject({ family: "glm", label: "GLM" });
    expect(adapterSuggestion("z-ai/glm-5.3", "none")).toEqual({ family: "none", label: "None", samplers: null });
  });
});
