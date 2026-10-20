import { beforeAll, describe, expect, test } from "bun:test";
import { activateLore } from "../src/lore/activate";
import { getLorebook } from "../src/lore/service";
import { cleanParts, joinParts, textGivesAway, withFiring, wordsFor } from "../src/lore/shapes";
import { addItem, commitDraft, createDraft, getDraft, patchItem, queueWrite, reviewDraft, runStudioJob } from "../src/lore/studio";
import { defaultEntry } from "../src/lore/types";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { freshDb } from "./helpers";

beforeAll(async () => {
  freshDb();
  for (const kind of ["lore.studio", "lore.embed", "lore.details"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
});

describe("shapes (docs/17, 3.1–3.3)", () => {
  test("word targets scale by kind; parts are cleaned to the kind's shape", () => {
    expect(wordsFor("90–170", "reaction")).toBe("45–85");
    expect(wordsFor("90–170", "lexicon")).toBe("125–240");
    expect(wordsFor("90–170", "character")).toBe("90–170");
    expect(cleanParts("voice", { register: " plain ", "pet names": "love", "sample lines": ["a: x", ""], junk: "y" })).toEqual({ register: "plain", "pet names": ["love"], "sample lines": ["a: x"] });
    expect(cleanParts("character", { register: "plain" })).toEqual({});
  });

  test("parts are joined by the kind's layout; a hidden truth never is", () => {
    expect(joinParts("voice", "Low and short.", { register: "plain", "sample lines": ["teasing: You'll want boots, little fish.", "Say it again."] })).toBe("Low and short.\nSounds like: “You'll want boots, little fish.” (teasing) “Say it again.”");
    expect(joinParts("lexicon", "Harbour words.", { terms: ["dark lamp: a night with no light", "keeper: whoever minds the lamp"] })).toBe("Harbour words.\n- dark lamp: a night with no light\n- keeper: whoever minds the lamp");
    expect(joinParts("timeline", "", { "as of": "after the siege", "not yet": ["the Guild falls", "Joss returns"] })).toBe("As of: after the siege\nNot yet (don't treat as past): the Guild falls; Joss returns.");
    expect(joinParts("mystery", "Who relit the lamp?", { truth: "her father did", clues: ["soot on the key"] })).toBe("Who relit the lamp?\nClues: soot on the key.");
    expect(textGivesAway("The keeper's father relit the lamp himself with the second key.", "Her father relit the lamp himself with the hidden second key")).toBe(true);
    expect(textGivesAway("Nobody knows who relit the lamp.", "Her father relit the lamp himself with the hidden second key")).toBe(false);
  });

  test("firing by kind: a voice with its person, a reaction on its topic, a relationship on both names, terms, meaning, always", () => {
    const mira = { name: "Mira Vell", aliases: ["Mira"] };
    const joss = { name: "Joss Arden", aliases: [] };
    expect(withFiring(defaultEntry({ keys: ["voice"] }), "voice", [mira], {})).toMatchObject({ keys: ["Mira Vell", "Mira"], extra: { entity: "Mira Vell" } });
    expect(withFiring(defaultEntry({ keys: ["Mira", "her mother"] }), "reaction", [mira], {})).toMatchObject({ keys: ["her mother"], secondaryKeys: ["Mira Vell", "Mira"], logic: "and_any" });
    expect(withFiring(defaultEntry({ keys: ["x"] }), "relationship", [mira, joss], {})).toMatchObject({ keys: ["Mira Vell", "Mira"], secondaryKeys: ["Joss Arden"], logic: "and_any" });
    expect(withFiring(defaultEntry({ keys: ["slang"] }), "lexicon", [], { terms: ["dark lamp: a night with no light"] }).keys).toEqual(["dark lamp", "slang"]);
    expect(withFiring(defaultEntry(), "customs", [], {}).extra).toMatchObject({ semantic: true });
    expect(withFiring(defaultEntry(), "ooc", [], {}).constant).toBe(true);
    expect(withFiring(defaultEntry(), "current", [], {}).constant).toBe(false);
  });
});

describe("the studio writes and saves by kind (docs/17, Part 3)", () => {
  test("satellites read their person, shaped kinds keep their parts, truths stay secret, and each fires its own way", async () => {
    const d = createDraft({ kind: "idea", text: "Mira Vell keeps the lighthouse at Port Ellis. Joss Arden hides in her oil store.", options: { secrets: false } });
    const mira = addItem(d.id, { title: "Mira Vell", category: "character", pitch: "The keeper's daughter." }).item;
    const joss = addItem(d.id, { title: "Joss Arden", category: "character", pitch: "A deserter." }).item;
    const voice = addItem(d.id, { title: "Voice: Mira Vell", category: "voice", about: [mira.id] }).item;
    const reaction = addItem(d.id, { title: "Reaction: Mira Vell, when her mother comes up", category: "reaction", about: [mira.id] }).item;
    const bond = addItem(d.id, { title: "Mira Vell & Joss Arden", category: "relationship", about: [mira.id, joss.id] }).item;
    const mystery = addItem(d.id, { title: "Who Relit the Lamp?", category: "mystery" }).item;
    const lexicon = addItem(d.id, { title: "Harbour slang", category: "lexicon" }).item;
    queueWrite(d.id);
    await runStudioJob(d.id);
    let cur = getDraft(d.id)!;
    const of = (id: string) => cur.items.find((i) => i.id === id)!.entry!;

    // The voice read its person, kept its parts, and joined its sample lines.
    expect(of(voice.id).content).toContain("It's about Mira Vell.");
    expect(of(voice.id).content).toContain("Sounds like: “You'll want boots for that, little fish.” (teasing)");
    expect(of(voice.id).parts?.["sample lines"]).toHaveLength(3);
    expect(of(voice.id).keys).not.toContain("Voice: Mira Vell");
    // The mystery's answer is a secret, not text; its clues are text.
    expect(of(mystery.id).secrets[0]!.text).toBe("The keeper's father relit it himself with the hidden second key");
    expect(of(mystery.id).content).toContain("Clues: soot on the second key");
    expect(of(mystery.id).content).not.toContain("relit it himself");
    // Review flags a draft whose text gives its secret away.
    expect(reviewDraft(d.id).issues[mystery.id]?.some((i) => i.kind === "secret-in-text") ?? false).toBe(false);
    patchItem(d.id, mystery.id, { entry: { ...of(mystery.id), content: `${of(mystery.id).content} The keeper's father relit it himself with the hidden second key.` } });
    expect(reviewDraft(d.id).issues[mystery.id]!.map((i) => i.kind)).toContain("secret-in-text");

    // Saved: each kind fires its own way, and keeps its parts.
    cur = getDraft(d.id)!;
    const { bookId } = commitDraft(d.id);
    const entries = getLorebook(bookId)!.entries;
    const saved = (title: string) => entries.find((e) => e.comment === title)!;
    expect(saved("Voice: Mira Vell")).toMatchObject({ keys: ["Mira Vell"], position: "after_char", order: 115, extra: { category: "voice", entity: "Mira Vell" } });
    expect((saved("Voice: Mira Vell").extra as { parts?: Record<string, unknown> }).parts?.["sample lines"]).toHaveLength(3);
    const r = saved(reaction.title);
    expect(r.keys).not.toContain("Mira Vell");
    expect(r).toMatchObject({ secondaryKeys: ["Mira Vell"], logic: "and_any" });
    expect(saved(bond.title)).toMatchObject({ keys: ["Mira Vell"], secondaryKeys: ["Joss Arden"], logic: "and_any" });
    expect(saved(lexicon.title).keys).toEqual(expect.arrayContaining(["dark lamp", "little fish", "keeper"]));
    expect((saved(mystery.title).extra as { secrets?: { text: string }[] }).secrets?.[0]?.text).toContain("second key");

    // The relationship fires only when both are named.
    const scan = (text: string) =>
      activateLore({ entries: entries.map((e) => ({ ...e, bookId, bookName: "b", book: {} })), history: [text], messageCount: 1, state: {}, defaults: { scanDepth: 4, tokenBudget: 100_000, recursive: false, maxRecursion: 0, caseSensitive: false, matchWholeWords: true }, countTokens: (s) => s.length, random: () => 0.5 }).activated.map((a) => a.entry.comment);
    expect(scan("Mira Vell lights the lamp.")).not.toContain(bond.title);
    expect(scan("Mira Vell and Joss Arden argue.")).toContain(bond.title);
    expect(scan("The dark lamp again.")).toContain(lexicon.title);
  });
});
