import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { all, run as sql } from "../src/db/db";
import { defaultMemoryConfig } from "../src/lib/settings";
import { insertAtom } from "../src/memory/atoms";
import { TimeIndex } from "../src/memory/format";
import { buildQueries, recall } from "../src/memory/recall";
import { namedTerms } from "../src/memory/text";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { freshDb } from "./helpers";

/**
 * In Filed Under Forever, #791: "That's Brongel for you!" Two memories held the nickname and who'd
 * heard it (#88, #638). Neither reached the planner or the writer, the plan called it new, and Buffy said
 * "you never mentioned this?" A name just used now brings back what the few records holding it say.
 */

const terms = (text: string) => namedTerms(text).map((t) => t.term);

describe("namedTerms", () => {
  test("finds a name written partway through a sentence", () => {
    expect(terms(`"Yes!" He pumps his fist to the air. "That's Brongel for you!"`)).toContain("brongel");
    expect(namedTerms("They called me *The Brongel*.")).toEqual([{ term: "brongel", proper: true }]);
    expect(terms("A banner that said BRONGEL FOR PRESIDENT.")).toContain("brongel");
  });

  test("finds a word set apart in quotes, which is no proof it's a name", () => {
    expect(namedTerms(`She said the word back: "facefriend" and grinned.`)).toEqual([{ term: "facefriend", proper: false }]);
  });

  test("a sentence's first word isn't a name, nor is a word only emphasised", () => {
    expect(terms("Thirty minutes later, they sit. Anyway, it's settled.")).toEqual([]);
    expect(terms("You're *extremely* late, and I'm not sorry.")).toEqual([]);
    expect(namedTerms(`He said, "Stay." I'm here.`)).toEqual([{ term: "stay", proper: false }]);
  });

  test("a possessive is the name", () => {
    expect(terms("She took Brongel's keys.")).toEqual(["brongel"]);
  });
});

describe("recall of a name just used", () => {
  let chatId: string;
  let seqs: { id: string; seq: number }[];

  const source = (seq: number) => [seqs.find((m) => m.seq === seq)!];
  const atom = (type: string, content: string, seq: number, knownBy: string[] = []) => insertAtom(chatId, null, { type, content, knownBy, importance: 5 }, source(seq));
  const run = (newest: string, opts: { pov?: string; budget?: number } = {}) =>
    recall({
      chatId,
      evicted: 500,
      budget: opts.budget ?? 600,
      queries: buildQueries([{ role: "user", content: newest }]),
      qvecs: [null],
      excludeSummaryIds: new Set(),
      seed: "test",
      cfg: { ...defaultMemoryConfig, entityRecall: false, deepSearch: false },
      pov: { names: new Set([opts.pov ?? "buffy"]), label: opts.pov ?? "Buffy" },
      present: [],
      mood: null,
      librarian: null,
      times: new TimeIndex(chatId),
      skipCards: new Set(),
      povName: opts.pov ?? "Buffy",
    });

  beforeAll(() => {
    freshDb();
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", description: "A Slayer.", first_mes: "Hi." } });
    chatId = createChat({ characterId: createCharacter(data) }).id;
    for (let i = 0; i < 520; i++) {
      const text =
        i === 300
          ? "He laughed. Ask for Cordelia at the door, he said, and she'll know."
          : i === 40
            ? "Ask for Marisol at the door. She runs the place, he said, and she'll wave you in."
            : `Line ${i} of a long talk about nothing in the kitchen.`;
      addMessage(chatId, i % 2 ? "assistant" : "user", text);
    }
    seqs = all<{ id: string; seq: number }>("SELECT id, seq FROM messages WHERE chat_id = ? ORDER BY seq", chatId);
    // What fills an ordinary recall: many memories that match the scene's words better than a name does.
    for (let i = 0; i < 300; i++) atom("event", `Spike and Dawn raced Gabriel at Mario Kart again, round ${i}, and the kitchen laughed about the race.`, 10 + i);
    atom("fact", "Gabriel's frat brothers called him 'The Brongel', brother-angel; he told Buffy.", 88, ["Buffy", "Gabriel"]);
    atom("event", "Resolved: Brongel (the word girlfriend, said aloud)", 217);
    atom("fact", "Gabriel's frat nickname Brongel came up again over the album; Dawn saw the banner.", 300, ["Buffy", "Gabriel", "Dawn"]);
    atom("fact", "Brongel also won the talent night.", 200, ["Buffy", "Gabriel"]);
    atom("fact", "Only Spike knows that Valentina came by at dawn.", 310, ["Spike"]);
    // A regular: more memories hold the name than a name just used brings back.
    for (let i = 0; i < 12; i++) atom("event", `Harmony said something about Harmony's roots, take ${i}.`, 320 + i);
  });

  test("the first and the latest fact come back, however much else matches", () => {
    const r = run(`Spike and Dawn raced Gabriel at Mario Kart in the kitchen. "That's Brongel for you!" He laughs.`);
    const said = r.items.map((i) => i.content);
    expect(said.some((c) => c.includes("he told Buffy"))).toBe(true);
    expect(said.some((c) => c.includes("Dawn saw the banner"))).toBe(true);
    const mine = r.items.find((i) => i.content.includes("he told Buffy"))!;
    expect(mine.reasons).toContain('names "brongel"');
  });

  test("a fact is read ahead of a thread that only holds the word", () => {
    const r = run(`And that's Brongel for you.`);
    expect(r.items.filter((i) => i.reasons.includes('names "brongel"')).map((i) => i.content).join()).not.toContain("Resolved:");
    expect(r.items.filter((i) => i.reasons.includes('names "brongel"')).length).toBe(2);
  });

  test("it never takes more than its share of the budget", () => {
    const r = run(`And that's Brongel for you.`, { budget: 100 });
    const tokens = r.items.filter((i) => i.reasons.some((w) => w.startsWith("names"))).reduce((n, i) => n + i.tokens, 0);
    expect(tokens).toBeLessThanOrEqual(15);
  });

  test("a name in many memories gets no special treatment", () => {
    const r = run(`She says that Harmony called again.`);
    expect(r.items.filter((i) => i.reasons.some((w) => w.startsWith("names")))).toEqual([]);
  });

  test("the point of view still holds: what she can't remember isn't brought back, or quoted", () => {
    const r = run(`She says that Valentina called again.`);
    expect(r.items.map((i) => i.content).join()).not.toContain("Valentina");
    expect(run(`She says that Valentina called again.`, { pov: "spike" }).items.map((i) => i.content).join()).toContain("Valentina");
  });

  test("a name no memory holds is quoted from the message it first appears in", () => {
    const r = run(`He says that Marisol called again.`);
    const quote = r.items.find((i) => i.ownerType === "quote")!;
    expect(quote.reasons).toEqual(['the first mention of "marisol"']);
    expect(quote.seq).toBe(42);
    expect(quote.content).toContain("Ask for Marisol");
  });

  test("docs/26 4: two rare words said together find their memory", () => {
    atom("fact", "He looked like a confused golden retriever about the toothbrush.", 120);
    const r = run("Spike and Dawn raced Gabriel at Mario Kart in the kitchen, and he tilts his head like a confused golden retriever.");
    const mine = r.items.find((i) => i.content.includes("golden retriever"))!;
    expect(mine.reasons).toContain("3 rare words");
  });

  test("docs/26 4: summaries take at most half the relevant slot, however well their scenes match", () => {
    const long = "Spike and Dawn raced Gabriel at Mario Kart in the kitchen and the whole race went round again. ".repeat(12);
    for (let i = 0; i < 8; i++) {
      const id = `scene-${i}`;
      sql("INSERT INTO summaries (id, chat_id, level, start_seq, end_seq, closed, title, content, state, created_at, updated_at) VALUES (?, ?, 'scene', ?, ?, 1, ?, ?, 'ready', 1, 1)", id, chatId, 400 + i * 2, 401 + i * 2, `Race ${i}`, long);
      sql("UPDATE memories SET scene_id = ? WHERE chat_id = ? AND content LIKE ?", id, chatId, `%round ${i},%`);
    }
    const r = run("Spike and Dawn raced Gabriel at Mario Kart in the kitchen.", { budget: 3000 });
    const relevant = r.items.filter((i) => i.slot === "relevant");
    const summaries = relevant.filter((i) => i.ownerType === "summary");
    expect(summaries.length).toBeGreaterThan(0);
    expect(relevant.some((i) => i.ownerType === "memory")).toBe(true);
    // The slot is half of what's left after the cards and carries what the others leave, so measure it by what it spent.
    expect(summaries.reduce((n, i) => n + i.tokens, 0)).toBeLessThanOrEqual(3000 * 0.5);
    expect(summaries.length).toBeLessThan(8);
  });

  test("a word only set apart in quotes isn't quoted from the page", () => {
    const r = run(`She said the word back: "kitchen" and left.`);
    expect(r.items.filter((i) => i.reasons.some((w) => w.startsWith("the first mention")))).toEqual([]);
  });
});
