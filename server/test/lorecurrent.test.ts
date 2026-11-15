import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { newId, now, run } from "../src/db/db";
import { activateLore, type ScanEntry } from "../src/lore/activate";
import { isStub, OPENING_MESSAGES, pastCurrent } from "../src/lore/current";
import { createEntry, createLorebook, getLorebook } from "../src/lore/service";
import { createCharacter } from "../src/services/characters";
import { createChat } from "../src/services/chats";
import { freshDb } from "./helpers";

/** Audit of 15 November: opening-day "Current" lore was still in the prompt at message 982. */
let chatId = "";
let entries: ScanEntry[] = [];
const scan = (bookId: string) => {
  const b = getLorebook(bookId)!;
  return b.entries.map((e) => ({ ...e, bookId: b.id, bookName: b.name, book: b.settings }) as ScanEntry);
};
const fact = (entryId: string, seq: number) =>
  run("INSERT INTO lore_facts (id, entry_id, chat_id, value, since_seq, origin, created_at, updated_at) VALUES (?, ?, ?, 'Now: still so', ?, 'story', ?, ?)", newId(), entryId, chatId, seq, now(), now());

beforeAll(() => {
  freshDb();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  const book = createLorebook({ name: "Canon" });
  createEntry(book, { comment: "Current: Hellions Raid Sunnydale", keys: ["Hellions"], content: "The Hellions are raiding Sunnydale.", extra: { category: "current" } });
  createEntry(book, { comment: "Current: Spike Protects Dawn", keys: ["Spike"], content: "Spike keeps a nightly watch over Dawn.", extra: { category: "current" } });
  createEntry(book, { comment: "The Bronze", keys: ["Bronze"], content: "A club where everyone goes.", constant: true });
  entries = scan(book);
  fact(entries.find((e) => e.comment.includes("Spike"))!.id, 950);
});

describe("Current lore retires once the story is past its opening", () => {
  test("in the opening stretch, every Current entry stays", () => {
    expect(pastCurrent(chatId, entries, OPENING_MESSAGES).size).toBe(0);
  });

  test("well past it, one nothing has kept up to date stops; one kept up recently stays", () => {
    const past = pastCurrent(chatId, entries, 982);
    const raid = entries.find((e) => e.comment.includes("Hellions"))!;
    const spike = entries.find((e) => e.comment.includes("Spike"))!;
    expect(past.get(raid.id)).toBe("true at the opening");
    expect(past.has(spike.id)).toBe(false);
    const r = activateLore({
      entries,
      history: ["Buffy: Pasta tonight."],
      messageCount: 982,
      state: {},
      defaults: { scanDepth: 4, tokenBudget: 5000, recursive: false, maxRecursion: 1, caseSensitive: false, matchWholeWords: true },
      countTokens: (s) => Math.ceil(s.length / 4),
      pastCurrent: past,
    });
    const on = r.activated.map((a) => a.entry.comment);
    expect(on).toContain("Current: Spike Protects Dawn");
    expect(on).toContain("The Bronze");
    expect(on).not.toContain("Current: Hellions Raid Sunnydale");
    // Nor by its key: it's how things stood, not how they stand.
    const named = activateLore({ entries, history: ["Buffy: Remember the Hellions?"], messageCount: 982, state: {}, defaults: { scanDepth: 4, tokenBudget: 5000, recursive: false, maxRecursion: 1, caseSensitive: false, matchWholeWords: true }, countTokens: (s) => Math.ceil(s.length / 4), pastCurrent: past });
    expect(named.activated.map((a) => a.entry.comment)).not.toContain("Current: Hellions Raid Sunnydale");
  });

  test("a Chronicle stub says nothing and is left out; a short entry you wrote isn't", () => {
    const chron = createLorebook({ name: "Chronicle", settings: { chronicleFor: chatId } });
    createEntry(chron, { comment: "stairs", keys: ["stairs"], content: "The stairs." });
    createEntry(chron, { comment: "Ruth", keys: ["Ruth"], content: "Ruth is an orange cat who rules the kitchen and the automatic feeder." });
    const mine = createLorebook({ name: "Rules" });
    createEntry(mine, { comment: "No swearing", keys: [], content: "No swearing.", constant: true });
    expect(scan(chron).map(isStub)).toEqual([true, false]);
    expect(scan(mine).map(isStub)).toEqual([false]);
  });
});
