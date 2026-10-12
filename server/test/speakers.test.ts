import { describe, expect, test } from "bun:test";
import { extractSpeakers, quotedLines, resolveSpeaker, rosterLine, speakerFromLabel, speakerRule, voiceRoster, withoutSpeakerMarks, withSpeakerMarks, type SpokenLine } from "../src/lib/speakers";
import { assemblePrompt } from "../src/prompt/assemble";
import { meaPreset } from "../src/prompt/mea";
import { emptyCard } from "../src/cards/card";
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

  test("the rule lists the numbered cast and keeps a sealed persona's lines out", () => {
    expect(speakerRule("Ava", "Mara#1, Pell#2", true)).toContain("Mara#1, Pell#2");
    expect(speakerRule("Ava", "Mara#1", true)).toContain("no mark is ever theirs");
    expect(speakerRule("Ava", "Ava#0, Mara#1", false)).toContain("Ava is 0");
    expect(speakerRule("Ava", "Mara#1", true)).not.toContain("left its lines unmarked");
    expect(speakerRule("Ava", "Mara#1", true, true)).toContain("left its lines unmarked");
  });

  const chars = [
    { name: "Ava", isUser: true },
    { name: "Jackie Taylor", isMain: true, firstSeq: 0, tier: "spot" },
    { name: "Misty Quigley", aliases: ["Crystal"], firstSeq: 4, tier: "spot" },
    { name: "Ben Scott", firstSeq: 2, tier: "off" },
    { name: "Laura Lee Taylor", firstSeq: 9, tier: "peri" },
  ];

  test("the roster numbers the cast in order of arrival, the user as 0", () => {
    const roster = voiceRoster("Jackie Taylor", "Ava", chars);
    expect(roster.map((v) => `${v.name}#${v.slot}`)).toEqual(["Ava#0", "Jackie Taylor#1", "Ben Scott#2", "Misty Quigley#3", "Laura Lee Taylor#4"]);
    expect(rosterLine(roster, true)).toBe("Jackie Taylor#1, Ben Scott#2, Misty Quigley#3, Laura Lee Taylor#4");
    expect(rosterLine(roster, false)).toStartWith("Ava#0, ");
    // Without a story state, the card's character alone.
    expect(voiceRoster("Mara", "Ava", []).map((v) => v.name)).toEqual(["Ava", "Mara"]);
  });

  test("a mark is read back as the cast's own name, so a person keeps one colour", () => {
    const roster = voiceRoster("Jackie Taylor", "Ava", chars);
    expect(resolveSpeaker("Misty", 3, roster)).toBe("Misty Quigley");
    expect(resolveSpeaker("Jacqueline ‘Jackie’ Taylor", 1, roster)).toBe("Jackie Taylor");
    expect(resolveSpeaker("crystal", undefined, roster)).toBe("Misty Quigley");
    // A shared family name: the number settles it, then a first name.
    expect(resolveSpeaker("Taylor", 4, roster)).toBe("Laura Lee Taylor");
    expect(resolveSpeaker("Mrs. Taylor", undefined, roster)).toBe("Mrs. Taylor");
    // Someone new keeps their name, even with a number already taken.
    expect(resolveSpeaker("Coach Ben", 3, roster)).toBe("Ben Scott");
    expect(resolveSpeaker("Natalie", 3, roster)).toBe("Natalie");
    expect(extractSpeakers(`[spk=Misty#3|whisper]"Hold still."[/spk] [spk=#1]"Go."[/spk]`, roster).lines).toEqual([
      { text: `"Hold still."`, name: "Misty Quigley", tone: "whisper" },
      { text: `"Go."`, name: "Jackie Taylor" },
    ]);
  });

  test("the default preset carries the rule, filled in with the roster", () => {
    const preset = meaPreset();
    expect(preset.blocks.some((b) => b.id === "mea-speakers")).toBe(true);
    const base = { card: emptyCard("Mara"), preset, userName: "Ava", personaText: "", mode: "companion" as const, lore: null, contextTarget: 16000, modelId: "test", vars: {}, seed: "s", history: [{ id: "u1", role: "user" as const, content: "Hi." }] };
    const on = assemblePrompt({ ...base, kind: "story", speakers: { roster: "Mara#1, Pell#2", dropped: true } }).messages.map((m) => m.content).join("\n");
    expect(on).toContain("[SPEAKER MARKS");
    expect(on).toContain("Mara#1, Pell#2");
    expect(on).toContain("left its lines unmarked");
    const off = assemblePrompt({ ...base, kind: "story" }).messages.map((m) => m.content).join("\n");
    expect(off).not.toContain("[SPEAKER MARKS");
  });

  test("earlier replies are marked again for the prompt, with the cast's numbers", () => {
    const roster = voiceRoster("Jackie Taylor", "James", [{ name: "Jackie Taylor", isMain: true }, { name: "Nat", firstSeq: 2 }]);
    const text = `"Water!" James grins. "We found it." Nat shrugs. "It's a lake."`;
    const lines: SpokenLine[] = [
      { text: `"Water!"`, name: "James" },
      { text: `"We found it."`, name: "James", tone: "shout" },
      { text: `"It's a lake."`, name: "Nat" },
      { text: `"Edited away."`, name: "Nat" },
    ];
    expect(withSpeakerMarks(text, lines, roster)).toBe(`[spk=James#0]"Water!"[/spk] James grins. [spk=James#0|shout]"We found it."[/spk] Nat shrugs. [spk=Nat#2]"It's a lake."[/spk]`);
    // Marked again, it reads back the same.
    expect(extractSpeakers(withSpeakerMarks(text, lines, roster), roster).lines).toEqual(lines.slice(0, 3));
    expect(withSpeakerMarks(text, undefined, roster)).toBe(text);
  });

  test("the helper's lines: every quote in order, a wrongly curled close included; its names read as the cast's", () => {
    expect(quotedLines(`“Shipman. Hey. You —“

“Shauna.” She kneels. "Okay," Nat says.`)).toEqual([`“Shipman. Hey. You —“`, `“Shauna.”`, `"Okay,"`]);
    const roster = voiceRoster("Jackie Taylor", "James", [{ name: "Jackie Taylor", isMain: true, aliases: ["Jackie"] }]);
    expect(speakerFromLabel("Jackie#1", roster)).toBe("Jackie Taylor");
    expect(speakerFromLabel("?", roster)).toBeNull();
    expect(speakerFromLabel("Travis", roster)).toBe("Travis");
  });
});
