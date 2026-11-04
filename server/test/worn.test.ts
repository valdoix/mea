import { describe, expect, test } from "bun:test";
import { emptyCard } from "../src/cards/card";
import { mendMarks, extractSpeakers, withoutSpeakerMarks } from "../src/lib/speakers";
import { type AssembleInput, assemblePrompt } from "../src/prompt/assemble";
import { controlValues, defaultPreset } from "../src/prompt/preset";
import { stammerCount, wornLine, wornPhrases } from "../src/prompt/worn";

const filler = ["The kettle clicks off.", "Rain starts on the porch roof.", "Dawn drops her bag by the door.", "The bus is late again.", "A dog barks two yards over.", "Someone left the hall light on."];
const tic = (i: number) => `${filler[i % filler.length]} Her thumb finds the raw ring on her right wrist and presses. "Fine," she says.`;

describe("worn phrases", () => {
  test("a phrase that recurs across the newest replies is named, longest wording kept", () => {
    const replies = Array.from({ length: 8 }, (_, i) => tic(i));
    const worn = wornPhrases(replies);
    expect(worn[0]).toContain("raw ring on her right wrist");
    expect(worn[0]!.split(" ").length).toBe(10);
    expect(worn.filter((w) => w.includes("raw") || w.includes("wrist"))).toHaveLength(1);
  });

  test("filler, names and the player's own words are never worn", () => {
    const replies = Array.from({ length: 8 }, (_, i) => `${filler[i % filler.length]} And then she is there with him. Buffy Summers and Gabriel Winters, again. The orange chicken steams on the tray.`);
    const worn = wornPhrases(replies, { names: ["Buffy Summers", "Gabriel Winters"], player: ["Look, the orange chicken steams on the tray, ha."] });
    expect(worn).toEqual([]);
  });

  test("a phrase in only two of twelve replies isn't a habit yet", () => {
    const replies = Array.from({ length: 12 }, (_, i) => (i < 2 ? tic(i) : filler[i % filler.length]!));
    expect(wornPhrases(replies)).toEqual([]);
  });

  test("too few replies to tell", () => {
    expect(wornPhrases([tic(0), tic(1), tic(2)])).toEqual([]);
  });

  test("visual tags and speaker marks don't count as words", () => {
    const replies = Array.from({ length: 6 }, (_, i) => `${filler[i]} <mind of="Dawn" mood="giddy">! one trap</mind> [spk=Dawn#2]"Hi."[/spk]`);
    expect(wornPhrases(replies)).toEqual([]);
  });

  test("the stammer becomes a habit when a third of the replies restart lines twice", () => {
    const st = `"That's — that's fine. I — I mean it."`;
    const replies = [st, st, st, "Plain.", "Plain again.", "Still plain."];
    expect(stammerCount(replies)).toBe(3);
    expect(wornLine(replies)).toContain("that's — that's");
  });
});

describe("misspelt speaker marks", () => {
  test("[/sp], [/spak], [/spc] and a bare [spk] close their line", () => {
    expect(mendMarks('[spk=Spike#3]"Might have plans."[/spak] He shrugs.')).toBe('[spk=Spike#3]"Might have plans."[/spk] He shrugs.');
    expect(mendMarks('"Facefriend."[spk] The word.')).toBe('"Facefriend."[/spk] The word.');
    expect(mendMarks('"Me me."[/sp]')).toBe('"Me me."[/spk]');
    const out = extractSpeakers('[spk=Dawn#2]"Okay."[/spc] She runs. "Three o\'clock."[/sp]');
    expect(out.text).toBe('"Okay." She runs. "Three o\'clock."');
    expect(out.lines.map((l) => l.text)).toEqual(['"Okay."']);
    expect(withoutSpeakerMarks('"Hi."[/spq] Then "Bye."[spk]')).toBe('"Hi." Then "Bye."');
  });

  test("ordinary brackets are left alone", () => {
    expect(mendMarks("[OOC: hi] [s] [spoiler]")).toBe("[OOC: hi] [s] [spoiler]");
  });
});

describe("the turn frame", () => {
  const base = (history: AssembleInput["history"], extras: AssembleInput["extras"] = []): AssembleInput => {
    const preset = defaultPreset();
    return {
      kind: "story",
      preset,
      card: { ...emptyCard("Buffy Summers"), description: "The Slayer." },
      userName: "Gabriel Winters",
      personaText: "A Slayer too.",
      mode: "companion",
      history,
      lore: null,
      contextTarget: 60000,
      reserve: 1000,
      modelId: "test",
      vars: {},
      seed: "t",
      controlValues: controlValues(preset.controls),
      extras,
    };
  };
  const text = (r: ReturnType<typeof assemblePrompt>) => r.messages.map((m) => m.content).join("\n");
  const hist = (n: number) =>
    Array.from({ length: n * 2 }, (_, i) => ({ id: String(i), role: (i % 2 ? "user" : "assistant") as "user" | "assistant", content: i % 2 ? "He waits." : tic(i) }));

  test("worn phrases reach the reply's instructions", () => {
    const t = text(assemblePrompt(base(hist(6))));
    expect(t).toContain("Worn in this story by now");
    expect(t).toMatch(/"[a-z ]*raw ring on her right wrist[a-z ]*"/);
  });

  test("a fresh story has none", () => {
    expect(text(assemblePrompt(base(hist(2))))).not.toContain("Worn in this story");
  });

  test("the story's tense is said again at the end", () => {
    const t = text(assemblePrompt(base(hist(2), [{ id: "story", name: "Story settings", content: "[Story settings]\nPoint of view: third\nTense: present", prefix: true }])));
    expect(t).toContain("Narrate in the present tense, third person, whatever earlier replies drifted into.");
  });

  test("without a tense setting, nothing is said", () => {
    expect(text(assemblePrompt(base(hist(2))))).not.toContain("Narrate in the");
  });
});
