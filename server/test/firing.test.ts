import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { activateLore, type ActivationInput, type ScanEntry } from "../src/lore/activate";
import { createFact, factsNowFor } from "../src/lore/facts";
import { loreFiredAgo, recordLoreHits } from "../src/lore/health";
import { reachBack, recallLore } from "../src/lore/recallhook";
import { createEntry, createLorebook, scanEntriesFor } from "../src/lore/service";
import { defaultEntry, type LoreEntry } from "../src/lore/types";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { freshDb } from "./helpers";

const defaults = { scanDepth: 4, tokenBudget: 0, recursive: false, maxRecursion: 0, caseSensitive: false, matchWholeWords: true };
let n = 0;
const entry = (p: Partial<LoreEntry>): ScanEntry => ({ ...defaultEntry({ content: "content", ...p }), id: `e${n++}`, bookId: "b", bookName: "Book", book: {} });
const fire = (entries: ScanEntry[], history: string[], extra: Partial<ActivationInput> = {}) =>
  activateLore({ entries, history, messageCount: 10, state: {}, defaults, countTokens: (s) => s.length, random: () => 0.5, all: entries, ...extra });
const LONG = "Wren pilots the ferry across the Saltpans. She learned the tides from her mother, who drowned in the great storm. She keeps the brass lantern lit every night and hums old songs when she's nervous.";

describe("6.1 tiers", () => {
  const wren = entry({ comment: "Wren", keys: ["Wren"], content: LONG, extra: { type: "character", essentials: "Wren pilots the Saltpans ferry." } });
  const tam = entry({ comment: "Tam", keys: ["Tam"], content: "Tam is the deckhand. He owes everyone money and lies about where he was born, which changes every week.", extra: { type: "character", essentials: "Tam, the deckhand." } });
  const rules = entry({ comment: "House rules", constant: true, content: "Magic costs blood." });

  test("someone in the room but not the focus costs only their essentials (and what's true now)", () => {
    const facts = new Map([[wren.id, [{ slot: "eyes", value: "grey", kind: "attribute", status: "active", knownBy: [] }]]]);
    const r = fire([wren, tam, rules], ["The ferry rocks."], { present: ["Wren", "Tam"], tiers: { focus: [], focusText: "I ask Tam about the money." }, facts });
    const w = r.activated.find((a) => a.entry.id === wren.id)!;
    const t = r.activated.find((a) => a.entry.id === tam.id)!;
    expect(w.content).toBe("Wren pilots the Saltpans ferry.\nNow:\n- Eyes: grey");
    expect(w.tier).toBe("around");
    expect(t.content).toContain("lies about where he was born");
    expect(t.tier).toBe("focus");
    // Rules aren't tiered.
    expect(r.activated.find((a) => a.entry.id === rules.id)!.content).toBe("Magic costs blood.");
    expect(r.trace.find((x) => x.id === wren.id)).toMatchObject({ tier: "around", why: "in the scene" });
    expect(r.trace.find((x) => x.id === tam.id)).toMatchObject({ tier: "focus", why: "focus" });
  });

  test("naming them sends the full entry; the place you're in and who speaks are the focus too", () => {
    const r = fire([wren, tam], ["The ferry rocks."], { present: ["Wren", "Tam"], tiers: { focus: ["Wren"], focusText: "Where is everyone?" } });
    expect(r.activated.find((a) => a.entry.id === wren.id)!.content).toBe(LONG);
    expect(r.activated.find((a) => a.entry.id === tam.id)!.tier).toBe("around");
    // Without tiers (Light and Balanced), everything is sent whole, as before.
    expect(fire([wren, tam], ["The ferry rocks."], { present: ["Wren", "Tam"] }).activated.every((a) => !a.tier)).toBe(true);
  });
});

describe("6.3 budget by need, and why it fired", () => {
  test("over budget, a long-unfired entry is cut before a fresh one of the same score; both are listed with reasons", () => {
    const a = entry({ comment: "Fresh", keys: ["harbour"], content: "x".repeat(60) });
    const b = entry({ comment: "Stale", keys: ["harbour"], content: "y".repeat(60) });
    const r = fire([b, a], ["The harbour is quiet."], { defaults: { ...defaults, tokenBudget: 100 }, firedAgo: new Map([[a.id, 1], [b.id, 60]]) });
    expect(r.activated.map((x) => x.entry.comment)).toEqual(["Fresh"]);
    const cut = r.trace.find((x) => x.id === b.id)!;
    expect(cut.status).toBe("inactive");
    expect(cut.reason).toContain("over token budget");
    expect(cut.why).toBe("named");
    expect(r.trace.find((x) => x.id === a.id)!.why).toBe("named");
  });
});

describe("6.2 remember when…", () => {
  let chatId = "";
  let characterId = "";
  let mill = "";
  beforeAll(() => {
    freshDb();
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Wren", description: "A ferry pilot.", first_mes: "Hi." } });
    characterId = createCharacter(data);
    chatId = createChat({ characterId }).id;
    const book = createLorebook({ name: "Places", links: [{ target_type: "character", target_id: characterId }] });
    mill = createEntry(book, defaultEntry({ comment: "Harrow's Mill", keys: ["Harrow's Mill"], content: "An old watermill upriver.", extra: { type: "location" } })).id;
    createEntry(book, defaultEntry({ comment: "The ferry", keys: ["ferry"], content: "The Saltpans ferry." }));
    const m = addMessage(chatId, "assistant", "The storm broke over the mill.", { name: "Wren" });
    createFact(mill, { value: "The night of the storm, Wren and you hid in the mill", kind: "event", messageId: m, origin: "story" });
  });

  test("a “remember when” message pulls an event fact no keyword matched", () => {
    expect(reachBack("Do you remember the night at the mill?")).toBe("night at the mill");
    expect(reachBack("Remember?")).toBeNull();
    expect(reachBack("I walk to the pier.")).toBeNull();
    const scan = scanEntriesFor({ characterId, chatId });
    const recalled = recallLore(chatId, "Do you remember the night at the mill?", scan);
    expect([...recalled.keys()]).toEqual([mill]);
    expect(recalled.get(mill)).toContain("hid in the mill");
    const r = fire(scan, ["Do you remember the night at the mill?"], { recalled, facts: factsNowFor(scan.map((e) => e.id), chatId) });
    const hit = r.activated.find((x) => x.entry.id === mill)!;
    expect(hit.reason).toContain("recalled");
    expect(hit.content).toContain("hid in the mill");
    // No "remember", no reaching back.
    expect(recallLore(chatId, "The night at the mill was cold.", scan).size).toBe(0);
  });

  test("how long since each entry fired is counted in messages", async () => {
    recordLoreHits(chatId, [mill]);
    await Bun.sleep(5);
    addMessage(chatId, "user", "And then?");
    addMessage(chatId, "assistant", "Then the river rose.", { name: "Wren" });
    expect(loreFiredAgo(chatId).get(mill)).toBe(2);
  });

});
