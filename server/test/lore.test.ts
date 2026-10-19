import { describe, expect, test } from "bun:test";
import { type ActivationInput, activateLore, keyMatches, type ScanEntry } from "../src/lore/activate";
import { exportStWorldInfo, fromCardBook, importLorebook, toCardBook } from "../src/lore/convert";
import { defaultEntry, type LoreEntry } from "../src/lore/types";

const defaults = { scanDepth: 4, tokenBudget: 1000, recursive: true, maxRecursion: 3, caseSensitive: false, matchWholeWords: true };
let n = 0;
const entry = (p: Partial<LoreEntry>): ScanEntry => ({ ...defaultEntry({ content: "content", ...p }), id: `e${n++}`, bookId: "b", bookName: "Book", book: {} });
const run = (entries: ScanEntry[], history: string[], extra: Partial<ActivationInput> = {}) =>
  activateLore({ entries, history, messageCount: history.length, state: {}, defaults, countTokens: (s) => s.length, random: () => 0.5, ...extra });

describe("lore activation", () => {
  test("key matching: whole words, case, regex", () => {
    expect(keyMatches("cat", "a cat sat", false, true)).toBe(true);
    expect(keyMatches("cat", "concatenate", false, true)).toBe(false);
    expect(keyMatches("cat", "concatenate", false, false)).toBe(true);
    expect(keyMatches("Cat", "a cat", true, true)).toBe(false);
    expect(keyMatches("/li(ght|ve)house/i", "the LIGHTHOUSE", false, true)).toBe(true);
    expect(keyMatches("old town", "in the old town square", false, true)).toBe(true);
  });

  test("keywords, constants, and scan depth", () => {
    const a = entry({ keys: ["lighthouse"], content: "A" });
    const b = entry({ constant: true, content: "B" });
    const c = entry({ keys: ["dragon"], content: "C" });
    const r = run([a, b, c], ["old message about a dragon", "x", "y", "z", "we reach the lighthouse"]);
    const ids = r.activated.map((x) => x.entry.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(c.id); // outside scan depth 4
    expect(r.trace.find((t) => t.id === c.id)?.reason).toBe("no key matched");
  });

  test("CURRENT entries are in the scene from the first message, once across merged books", () => {
    const raid = entry({ comment: "CURRENT - Hellions Raid Sunnydale", keys: ["Hellions"], content: "The Hellions are raiding Sunnydale." });
    const copy = entry({ comment: "[buffy_s6] CURRENT - Hellions Raid Sunnydale", keys: ["Hellions"], content: "The Hellions are raiding Sunnydale." });
    const byCategory = entry({ comment: "Spike Protects Dawn", keys: ["protect Dawn"], content: "Spike shelters Dawn.", extra: { category: "current" } });
    const faction = entry({ comment: "Faction: The Hellions", keys: ["Hellions"], content: "A biker gang." });
    const r = run([raid, copy, byCategory, faction], ["Buffy wakes in her coffin."]);
    const ids = r.activated.map((x) => x.entry.id);
    expect(ids).toContain(raid.id);
    expect(ids).toContain(byCategory.id);
    expect(ids).not.toContain(copy.id);
    // The faction comes along because the situation names it, not on its own.
    expect(r.activated.find((x) => x.entry.id === faction.id)?.kind).toBe("recursion");
    expect(r.trace.find((t) => t.id === copy.id)?.reason).toBe("the same situation is in another book");
  });

  test("secondary key logic", () => {
    const andAny = entry({ keys: ["sword"], secondaryKeys: ["fire", "ice"], logic: "and_any" });
    const notAny = entry({ keys: ["sword"], secondaryKeys: ["broken"], logic: "not_any" });
    const andAll = entry({ keys: ["sword"], secondaryKeys: ["fire", "ice"], logic: "and_all" });
    const r = run([andAny, notAny, andAll], ["a sword of fire, not broken"]);
    const ids = r.activated.map((x) => x.entry.id);
    expect(ids).toContain(andAny.id);
    expect(ids).not.toContain(notAny.id);
    expect(ids).not.toContain(andAll.id);
  });

  test("recursion, prevent and exclude recursion", () => {
    const first = entry({ keys: ["castle"], content: "The castle has a dragon." });
    const second = entry({ keys: ["dragon"], content: "Dragons breathe fire." });
    const excluded = entry({ keys: ["fire"], content: "never via recursion", excludeRecursion: true });
    const r = run([first, second, excluded], ["we visit the castle"]);
    const ids = r.activated.map((x) => x.entry.id);
    expect(ids).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(ids).not.toContain(excluded.id);

    const blocked = entry({ keys: ["castle"], content: "The castle has a dragon.", preventRecursion: true });
    const second2 = entry({ keys: ["dragon"], content: "x" });
    expect(run([blocked, second2], ["the castle"]).activated.map((x) => x.entry.id)).toEqual([blocked.id]);
  });

  test("inclusion groups pick one winner", () => {
    const a = entry({ keys: ["rain"], group: "weather", order: 10, content: "a" });
    const b = entry({ keys: ["rain"], group: "weather", order: 20, groupOverride: true, content: "b" });
    const r = run([a, b], ["it starts to rain"]);
    expect(r.activated.map((x) => x.entry.id)).toEqual([b.id]);
    expect(r.trace.find((t) => t.id === a.id)?.reason).toContain("inclusion group");
  });

  test("probability, budget and placements", () => {
    const never = entry({ keys: ["tea"], probability: 10, useProbability: true });
    expect(run([never], ["tea time"], { random: () => 0.99 }).activated).toHaveLength(0);

    // LORE-14: over budget, a long entry is trimmed to its essentials before it's dropped.
    const big = entry({ keys: ["tea"], content: "x".repeat(800), order: 1 });
    const small = entry({ keys: ["tea"], content: "y".repeat(300), order: 2 });
    const r = run([big, small], ["tea time"]);
    expect(r.activated.map((x) => x.entry.id).sort()).toEqual([big.id, small.id].sort());
    expect(r.trace.find((t) => t.id === big.id)?.reason).toContain("trimmed");
    expect(r.activated.find((x) => x.entry.id === big.id)!.content.length).toBeLessThanOrEqual(320);
    const tight = run([big, small], ["tea time"], { defaults: { ...defaults, tokenBudget: 400 } });
    expect(tight.activated.map((x) => x.entry.id)).toEqual([small.id]);
    expect(tight.trace.find((t) => t.id === big.id)?.reason).toContain("budget");

    const deep = entry({ keys: ["tea"], position: "depth", depth: 2, role: "user", content: "deep" });
    expect(run([deep], ["tea"]).placements.depth[0]).toMatchObject({ depth: 2, role: "user", content: "deep" });
  });

  test("sticky, cooldown and delay timed effects", () => {
    const sticky = entry({ keys: ["moon"], sticky: 2, cooldown: 3 });
    const r1 = run([sticky], ["the moon"], { messageCount: 10 });
    expect(r1.stateUpdates[sticky.id]).toEqual({ stickyUntil: 12, cooldownUntil: 15 });
    const r2 = run([sticky], ["no keyword"], { messageCount: 11, state: r1.stateUpdates });
    expect(r2.activated[0]?.reason).toContain("sticky");
    const r3 = run([sticky], ["the moon"], { messageCount: 13, state: r1.stateUpdates });
    expect(r3.trace[0]?.reason).toContain("cooldown");
    // M32: another swipe of the same turn isn't held back by its own firing...
    const cool = entry({ keys: ["moon"], cooldown: 3 });
    const c1 = run([cool], ["the moon"], { messageCount: 10 });
    expect(run([cool], ["the moon"], { messageCount: 10, state: c1.stateUpdates }).activated).toHaveLength(1);
    // ...nor, after a rewind, by a firing from the messages that went.
    expect(run([cool], ["the moon"], { messageCount: 6, state: c1.stateUpdates }).activated).toHaveLength(1);
    expect(run([cool], ["the moon"], { messageCount: 12, state: c1.stateUpdates }).activated).toHaveLength(0);
    const delayed = entry({ keys: ["moon"], delay: 5 });
    expect(run([delayed], ["moon"], { messageCount: 2 }).trace[0]?.reason).toContain("delayed");
  });

  test("macros in keys are substituted", () => {
    const e = entry({ keys: ["{{char}}"], content: "about char" });
    expect(run([e], ["I talk to Mira"], { substitute: (s) => s.replace("{{char}}", "Mira") }).activated).toHaveLength(1);
  });
});

describe("lore conversion", () => {
  test("SillyTavern World Info round trip keeps unknown fields", () => {
    const st = {
      name: "World",
      entries: {
        "0": { uid: 0, key: ["a", "b"], keysecondary: ["c"], selectiveLogic: 3, content: "hello", position: 4, depth: 2, role: 1, order: 50, disable: false, sticky: 2, automationId: "keep-me", displayIndex: 0 },
        "1": { uid: 1, key: ["z"], content: "second", constant: true, displayIndex: 1 },
      },
    };
    const book = importLorebook(st);
    expect(book.entries[0]).toMatchObject({ keys: ["a", "b"], secondaryKeys: ["c"], logic: "and_all", position: "depth", depth: 2, role: "user", order: 50, sticky: 2 });
    expect(book.entries[0]!.extra.automationId).toBe("keep-me");
    const back = exportStWorldInfo(book.name, "", book.entries) as { entries: Record<string, any> };
    expect(back.entries["0"].selectiveLogic).toBe(3);
    expect(back.entries["0"].automationId).toBe("keep-me");
  });

  test("character_book conversion both ways", () => {
    const book = fromCardBook({
      name: "Lore",
      extensions: {},
      entries: [{ keys: ["k"], content: "c", extensions: { position: 4, depth: 3, probability: 50, useProbability: true }, enabled: true, insertion_order: 7, secondary_keys: ["s"], constant: false }],
    });
    expect(book.entries[0]).toMatchObject({ position: "depth", depth: 3, probability: 50, order: 7, secondaryKeys: ["s"] });
    const card = toCardBook("Lore", "", {}, book.entries);
    expect(card.entries[0]!.extensions.depth).toBe(3);
    expect(card.entries[0]!.insertion_order).toBe(7);
  });
});
