import { describe, expect, test } from "bun:test";
import { vetPattern } from "../src/lib/regex";
import { planFrom, planOnly, splitLeakedPlan } from "../src/services/generation";

describe("the plan step's answer", () => {
  const pass = "NOW — dusk, the lamp room. SEAL — Ash arrived and spoke. MINDS — Mira wary, hopeful. MOVE — she offers tea. VOICE — short.";
  test("takes the pass in <think>, written out, or as plain lines, and nothing after it", () => {
    expect(planFrom(`<think>${pass}</think>\n\nMira looks up.`, "")).toBe(pass);
    expect(planFrom(pass.replace(/\. /g, ".\n"), "")).toContain("MOVE — she offers tea");
    expect(planFrom(`<think>${pass}`, "")).toBe(pass);
  });
  test("falls back to the route's reasoning, and refuses a token plan or a story", () => {
    expect(planFrom("", pass)).toBe(pass);
    expect(planFrom("<think>NOW — dusk.</think>", "")).toBeNull();
    expect(planFrom("Mira looks up from the logbook and sets the kettle on.", "")).toBeNull();
  });
});
import { salvageJson } from "../src/services/llm";
import { parseEditorReply } from "../src/steer/editor";

describe("M14: salvaging a cut-off JSON reply", () => {
  test("keeps the finished items of an open list", () => {
    expect(salvageJson('{"items":[{"name":"Mira","age":30},{"name":"Ash","age":2')).toEqual({ items: [{ name: "Mira", age: 30 }] });
    expect(salvageJson('```json\n{"tags":["harbour","fog","sto')).toEqual({ tags: ["harbour", "fog"] });
    expect(salvageJson('{"a":{"list":[[1,2],[3,4],[5')).toEqual({ a: { list: [[1, 2], [3, 4]] } });
  });
  test("brackets and quotes inside strings don't confuse it", () => {
    expect(salvageJson('{"lines":["she said \\"[no]\\" {twice}","and')).toEqual({ lines: ['she said "[no]" {twice}'] });
  });
  test("returns null when nothing was cut or nothing can be kept", () => {
    expect(salvageJson('{"items":[1]}')).toBeNull();
    expect(salvageJson('{"text":"half a sent')).toBeNull();
    expect(salvageJson("no json here")).toBeNull();
  });
});

describe("M14: the editor's plain-text reply", () => {
  test("UNCHANGED means no edit", () => {
    expect(parseEditorReply("UNCHANGED").changed).toBe(false);
    expect(parseEditorReply("<think>fine</think>\nunchanged.").changed).toBe(false);
  });
  test("the edited reply and its notes", () => {
    const r = parseEditorReply('Mira nods. "Fine."\n\nShe waits.\n---NOTES---\n- cut a line for the player\n2. fixed tense\n');
    expect(r).toEqual({ changed: true, text: 'Mira nods. "Fine."\n\nShe waits.', notes: ["cut a line for the player", "fixed tense"] });
  });
});

describe("M17: a written-out plan leaves the story", () => {
  test("a reply that opens with the planning steps keeps only the story", () => {
    const reply = "NOW — dusk, the lighthouse, Mira and Ash.\nSEAL — SAID: hello\n  - stop before Ash answers\nVOICE — short\n\nMira looks up from the logbook.";
    const out = splitLeakedPlan(reply);
    expect(out.text).toBe("Mira looks up from the logbook.");
    expect(out.reasoning).toContain("SEAL — SAID: hello");
  });
  test("ordinary prose is left alone", () => {
    for (const t of ["Now — she said — we wait.", "NOW — the bell rings.\nMira runs.", "Mira waits.\nMOVE — later"]) expect(splitLeakedPlan(t).reasoning).toBe("");
  });
});

describe("the plan-only watch: a reply that is only its plan", () => {
  const pass = "NOW — dusk, the lighthouse, Mira and Ash.\n\nSEAL — SAID: hello. Reply ends on her question.\n\nMOVE — she offers tea, warily.\n\nVOICE — short, quiet, no recap.";
  test("a written-out plan, a <think> plan or the provider's reasoning with no story after it", () => {
    expect(planOnly(pass, "")).toBe(pass);
    expect(planOnly(`<think>${pass}</think>\n\n`, "")).toBe(pass);
    expect(planOnly(`${pass}\n</think>`, "")).toBe(pass);
    expect(planOnly("", pass)).toBe(pass);
  });
  test("a story after the plan, or a token plan, is not one", () => {
    expect(planOnly(`${pass}\n\nMira looks up from the logbook.`, "")).toBeNull();
    expect(planOnly("<think>NOW — dusk.</think>", "")).toBeNull();
    expect(planOnly("", "")).toBeNull();
    expect(planOnly("Mira looks up from the logbook.", pass)).toBeNull();
  });
});

describe("M33: regex patterns are vetted on save", () => {
  test("slow and broken patterns are turned away, ordinary ones pass", () => {
    expect(vetPattern("/(\\w+\\s?)+$/")).toContain("too long");
    expect(vetPattern("/(a+)+$/")).toContain("too long");
    expect(vetPattern("/(/")).toContain("valid");
    expect(vetPattern("/\\*([^*]+)\\*/g")).toBeNull();
    expect(vetPattern('/"([^"]*)"/g')).toBeNull();
    expect(vetPattern("")).toBeNull();
  });
});
