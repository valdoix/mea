import { describe, expect, test } from "bun:test";
import { createConnection, createProfile, resolveProfile } from "../src/services/connections";
import { freshDb } from "./helpers";
import { normalizeCard } from "../src/cards/card";
import { assemblePrompt, type AssembleInput } from "../src/prompt/assemble";
import { meaPreset } from "../src/prompt/mea";
import { ADAPTERS, detectFamily, modelNotes, resolveFamily } from "../src/prompt/models";

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
    expect(prose).toContain("For this model: Your habits to catch, in the plan as in the story: office and courtroom words");
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
    expect(notes).not.toContain("office and courtroom words");
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
