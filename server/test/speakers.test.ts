import { describe, expect, test } from "bun:test";
import { extractSpeakers, speakerRule, withoutSpeakerMarks } from "../src/lib/speakers";
import { cleanText } from "../src/memory/text";

describe("speaker marks", () => {
  test("marks come out and each line keeps its speaker and tone", () => {
    const { text, lines } = extractSpeakers(`[spk=Mara#2|whisper]"You gave it back."[/spk] She doesn't look up.\n\n[spk=Pell]"I did,"[/spk] he said. [spk=?]"Who's there?"[/spk]`);
    expect(text).toBe(`"You gave it back." She doesn't look up.\n\n"I did," he said. "Who's there?"`);
    expect(lines).toEqual([
      { text: `"You gave it back."`, name: "Mara", tone: "whisper" },
      { text: `"I did,"`, name: "Pell" },
      { text: `"Who's there?"`, name: null },
    ]);
  });

  test("a mark around narration keeps only the quote; one left open takes its quote; strays are dropped", () => {
    const { text, lines } = extractSpeakers(`[spk=Wren|shout]“Down!” Wren dove.[/spk] [spk=Kael]"Go." He ran. Then [spk=Pell]`);
    expect(text).toBe(`“Down!” Wren dove. "Go." He ran. Then `);
    expect(lines).toEqual([
      { text: "“Down!”", name: "Wren", tone: "shout" },
      { text: `"Go."`, name: "Kael" },
    ]);
  });

  test("an unknown tone is left out, and text without marks is untouched", () => {
    expect(extractSpeakers(`[spk=Mara|angrily]"No."[/spk]`).lines).toEqual([{ text: `"No."`, name: "Mara" }]);
    const plain = `"Hello," she said.`;
    expect(extractSpeakers(plain)).toEqual({ text: plain, lines: [] });
  });

  test("memory never sees a mark a cut-short save left behind", () => {
    expect(cleanText(`[spk=Mara]"Stay."[/spk] She turned.`)).toBe(`"Stay." She turned.`);
    expect(withoutSpeakerMarks(`[spk=Mara]"Stay.`)).toBe(`"Stay.`);
  });

  test("the rule names the cast and keeps a sealed persona's lines out", () => {
    expect(speakerRule("Ava", ["Mara", "Pell"], true)).toContain("(Mara, Pell)");
    expect(speakerRule("Ava", ["Mara"], true)).toContain("never mark one as theirs");
    expect(speakerRule("Ava", ["Mara"], false)).toContain("[spk=Ava]");
    expect(speakerRule("Ava", ["Mara"], true)).not.toContain("left its lines unmarked");
    expect(speakerRule("Ava", ["Mara"], true, true)).toContain("left its lines unmarked");
  });
});
