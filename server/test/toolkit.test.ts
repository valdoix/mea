import { describe, expect, test } from "bun:test";
import { emptyCard } from "../src/cards/card";
import { compactVisuals } from "../src/memory/text";
import { type AssembleInput, assemblePrompt, toolkitRhythm } from "../src/prompt/assemble";
import { controlValues, defaultPreset } from "../src/prompt/preset";
import { normalizeQuotes } from "../src/steer/style";

const reply = (content: string) => ({ role: "assistant", content });
const said = (content: string) => ({ role: "user", content });

const base = (ctl: Record<string, string>, history: AssembleInput["history"]): AssembleInput => {
  const preset = defaultPreset();
  return {
    kind: "story",
    preset,
    card: { ...emptyCard("Mira"), description: "Keeper of the lighthouse." },
    userName: "Ash",
    personaText: "A traveler.",
    mode: "companion",
    history,
    lore: null,
    contextTarget: 40000,
    reserve: 1000,
    modelId: "test",
    vars: {},
    seed: "t",
    controlValues: { ...controlValues(preset.controls), ...ctl },
  };
};
const text = (r: ReturnType<typeof assemblePrompt>) => r.messages.map((m) => m.content).join("\n");
const hist = (...contents: [string, string][]) => contents.map(([role, content], i) => ({ id: String(i), role: role as "user" | "assistant", content }));

describe("the toolkit's rhythm", () => {
  test("every reply, and lavish, are always due", () => {
    expect(toolkitRhythm("every", [])).toEqual({ due: true, rest: false });
    expect(toolkitRhythm("lavish", [reply("<note>x</note>")])).toEqual({ due: true, rest: false });
  });

  test("every other reply rests right after a visual and is due after one without", () => {
    expect(toolkitRhythm("alternate", [said("hi"), reply("<texts with=\"Jo\">Jo: hey</texts>"), said("ok")])).toEqual({ due: false, rest: true });
    expect(toolkitRhythm("alternate", [reply("<mind of=\"Jo\">!no</mind>"), said("a"), reply("Plain prose."), said("b")])).toEqual({ due: true, rest: false });
  });

  test("every third reply waits two replies", () => {
    const h = [reply("<vtk kind=\"x\"><div>hi</div></vtk>"), said("a"), reply("prose"), said("b")];
    expect(toolkitRhythm("third", h)).toEqual({ due: false, rest: true });
    expect(toolkitRhythm("third", [...h, reply("prose"), said("c")])).toEqual({ due: true, rest: false });
  });

  test("a chat with no visual yet is due; organic rhythms set neither", () => {
    expect(toolkitRhythm("alternate", [reply("prose")])).toEqual({ due: true, rest: false });
    expect(toolkitRhythm("organic", [])).toEqual({ due: false, rest: false });
    expect(toolkitRhythm("often", [])).toEqual({ due: false, rest: false });
  });
});

describe("the toolkit in Mea's preset", () => {
  test("on, the catalogue and the rhythm reach the prompt", () => {
    const t = text(assemblePrompt(base({ artifacts: "on", rhythm: "every" }, hist(["assistant", "The lamp."], ["user", "I wait."]))));
    expect(t).toContain("[VISUAL TOOLKIT");
    expect(t).toContain("<achievement title icon points>");
    expect(t).toContain("<fx kind=");
    expect(t).toContain("this reply carries at least one visual");
    expect(t).not.toContain("YOUR OWN VISUALS");
  });

  test("wild adds the model's own designs; a resting reply is told so", () => {
    const t = text(assemblePrompt(base({ artifacts: "wild", rhythm: "alternate" }, hist(["assistant", "<note from=\"Jo\">hi</note>"], ["user", "I read it."]))));
    expect(t).toContain("YOUR OWN VISUALS");
    expect(t).toContain("no visual this reply");
  });

  test("off, nothing about the toolkit is sent", () => {
    const t = text(assemblePrompt(base({ artifacts: "off", rhythm: "every" }, hist(["assistant", "The lamp."], ["user", "I wait."]))));
    expect(t).not.toContain("VISUAL TOOLKIT");
    expect(t).not.toContain("Toolkit:");
  });

  test("old visuals of the model's own keep their words, not their markup", () => {
    const vtk = `<vtk kind="mindscape" title="Jo"><style>.a{color:red}</style><div class="a">WHY <b>now</b></div></vtk>`;
    const h = hist(["assistant", `Before. ${vtk} After.`], ["user", "1"], ["assistant", "2"], ["user", "3"], ["assistant", "4"], ["user", "5"]);
    const t = text(assemblePrompt(base({ artifacts: "wild" }, h)));
    expect(t).toContain(`<vtk kind="mindscape" title="Jo">WHY now</vtk>`);
    expect(t).not.toContain(".a{color:red}");
  });
});

describe("visual helpers", () => {
  test("compactVisuals leaves text without visuals alone", () => {
    expect(compactVisuals("plain <note>x</note>")).toBe("plain <note>x</note>");
  });

  test("curly quotes never touch a visual's CSS", () => {
    const css = `<style>.a::before{content:"x"}</style>`;
    expect(normalizeQuotes(`"Hi," she said. ${css}`, "curly")).toBe(`“Hi,” she said. ${css}`);
  });
});
