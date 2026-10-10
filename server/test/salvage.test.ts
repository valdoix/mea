import { describe, expect, test } from "bun:test";
import { vetPattern } from "../src/lib/regex";
import { splitLeakedPlan } from "../src/services/generation";
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
