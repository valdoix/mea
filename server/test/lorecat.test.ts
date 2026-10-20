import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { listOffpage } from "../src/accuracy/offpage";
import { createCharacter } from "../src/services/characters";
import { createChat } from "../src/services/chats";
import { writeDepthBook } from "../src/creator/books";
import { db, run } from "../src/db/db";
import { migrations } from "../src/db/migrations";
import { CATEGORIES, CATEGORY_INFO, categoryOf, dreamWeaverCategory, guessCategory, isCurrent, kindsOn, kindTemplate, SHELVES, withCategory } from "../src/lore/format";
import { SLOTS } from "../src/lore/slots";
import { lorePersonName } from "../src/sim/roster";
import { LORE_CATEGORIES } from "../../web/src/lib/lorecats";
import { createLorebook, getEntries } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { freshDb } from "./helpers";

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };
const post = async (path: string, body: unknown) => (await app.fetch(new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), local)).json() as Promise<any>;
const g = (comment: string, content = "", extra: Record<string, unknown> = {}) => guessCategory({ ...defaultEntry({ comment, content, extra }) });

beforeAll(() => {
  freshDb();
  app = createApp();
});

describe("lorebook categories (I1)", () => {
  test("auto-sort reads titles and words", () => {
    expect(g("Buffy & Spike - Truce")).toMatchObject({ category: "relationship" });
    expect(g("Buffy & Spike - Truce").confidence).toBeGreaterThan(0.8);
    expect(g("OOC: keep replies short").category).toBe("ooc");
    expect(g("Timeline: after season 5").category).toBe("timeline");
    expect(g("Scene: the Bronze on a Friday").category).toBe("scene");
    expect(g("Spike's voice").category).toBe("voice");
    expect(g("Customs of the Watchers Council").category).toBe("customs");
    expect(g("The Slayer's Scythe", "", { type: "item" }).category).toBe("item");
    expect(g("Willow", "Nobody knows she brought Buffy back.").category).toBe("secret");
    expect(g("Something vague").confidence).toBeLessThan(0.3);
  });

  test("Dream Weaver books are recognised by their names", () => {
    expect(dreamWeaverCategory("DW Rules")).toBe("rule");
    expect(dreamWeaverCategory("Dream Weaver – NPCs")).toBe("character");
    expect(dreamWeaverCategory("DW Depth")).toBeNull();
    expect(dreamWeaverCategory("My own book")).toBeNull();
    expect(guessCategory(defaultEntry({ comment: "Giles" }), "DW NPCs")).toMatchObject({ category: "character", why: "a Dream Weaver book" });
  });

  test("a category sets a sensible place and priority, and the Codex type", () => {
    const e = withCategory(defaultEntry({ comment: "No magic without cost" }), "rule", { defaults: true });
    expect(e).toMatchObject({ position: "before_char", order: 10, constant: true, extra: { category: "rule", type: "rule" } });
    expect(categoryOf(e)).toBe("rule");
    const kept = withCategory(defaultEntry({ comment: "x", position: "depth" }), "location");
    expect(kept.position).toBe("depth");
  });

  test("Auto-sort this book (routes), one-tap correction, and a Secret kept off the page", async () => {
    const bookId = createLorebook({ name: "Sunnydale", entries: [defaultEntry({ comment: "Buffy & Spike - Truce", content: "An uneasy truce." }), defaultEntry({ comment: "Willow's secret", keys: ["Heaven"], content: "Willow pulled Buffy out of Heaven. The others don't know." })] });
    const dry = await post(`/api/lorebooks/${bookId}/autosort`, {});
    expect(dry.entries.map((x: any) => x.category)).toEqual(["relationship", "secret"]);
    expect(getEntries(bookId).every((e) => !categoryOf(e))).toBe(true);
    await post(`/api/lorebooks/${bookId}/autosort`, { apply: true, defaults: true });
    const [truce, secret] = getEntries(bookId);
    expect(categoryOf(truce!)).toBe("relationship");
    expect(truce!.order).toBe(110);
    const fixed = await post(`/api/lorebooks/${bookId}/entries/${truce!.id}/category`, { category: "current", defaults: true });
    expect(fixed).toMatchObject({ position: "depth", depth: 2, extra: { category: "current", categoryConfidence: 1 } });
    // Auto-sort again leaves what you set alone.
    const again = await post(`/api/lorebooks/${bookId}/autosort`, { apply: true });
    expect(again.entries[0]).toMatchObject({ category: "current", why: "set by you" });
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Patrol." } });
    const chatId = createChat({ characterId: createCharacter(data) }).id;
    await post(`/api/lorebooks/${bookId}/entries/${secret!.id}/offpage`, { chatId });
    expect(listOffpage(chatId)[0]).toMatchObject({ label: "Willow pulled Buffy out of Heaven.", neverSay: ["Heaven"] });
  });
  test("depth books are never Current: the creator's entries, guesses, and ones saved before", () => {
    // The creator's depth entries carry no category, so they fire on meaning, not in every prompt.
    const bookId = createLorebook({ name: "Marisol depth book", settings: { role: "depth" } });
    writeDepthBook(bookId, [{ id: "q1", title: "Why she won't swim", content: "Her brother drowned off the pier when she was nine.", keys: ["swim"] }]);
    const [made] = getEntries(bookId);
    expect(categoryOf(made!)).toBeNull();
    expect(isCurrent(made!)).toBe(false);
    expect(made).toMatchObject({ position: "after_char", order: 120, extra: { creatorDepth: "q1" } });
    // A depth book's titles never guess Current; elsewhere they still do.
    const status = defaultEntry({ comment: "Her status in the clan now", content: "Outcast since the trial." });
    expect(guessCategory(status, "Marisol depth book").category).not.toBe("current");
    expect(guessCategory(status, "Clan notes", "depth").category).not.toBe("current");
    expect(guessCategory(status, "DW Depth").category).not.toBe("current");
    expect(guessCategory(status, "Clan notes").category).toBe("current");
    expect(guessCategory(defaultEntry({ comment: "Something", content: "x" }), "", "depth").why).not.toBe("a Dream Weaver book");

    // Migration 31 repairs what was saved before: the creator's and guessed ones go, a Current you picked stays.
    const put = (book: string, extra: Record<string, unknown>) => {
      const id = crypto.randomUUID();
      run("INSERT INTO lorebook_entries (id, lorebook_id, data, sort, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 0)", id, book, JSON.stringify(defaultEntry({ comment: "x", extra })));
      return id;
    };
    const plain = createLorebook({ name: "Sunnydale" });
    const old = put(bookId, { creatorDepth: "q0", category: "current", categoryConfidence: 1 });
    const guessed = put(bookId, { category: "current", categoryConfidence: 0.75 });
    const picked = put(bookId, { category: "current", categoryConfidence: 1 });
    const elsewhere = put(plain, { category: "current", categoryConfidence: 0.7 });
    migrations.find((m) => m.id === 31)!.up!(db());
    const cat = (id: string) => categoryOf([...getEntries(bookId), ...getEntries(plain)].find((e) => e.id === id)!);
    expect([cat(old), cat(guessed), cat(picked), cat(elsewhere)]).toEqual([null, null, "current", "current"]);
  });
});

describe("lore kinds (docs/17, Part 1)", () => {
  test("the registry: every kind complete, orders unique per place, every shelf used, slots real", () => {
    expect(CATEGORIES.length).toBe(28);
    for (const c of CATEGORIES) {
      const i = CATEGORY_INFO[c];
      expect(i.id).toBe(c);
      expect(i.label && i.hint && i.example).toBeTruthy();
      expect(i.fields.length).toBeGreaterThan(0);
      expect(i.lengthScale).toBeGreaterThan(0);
      if (i.slots) expect(SLOTS.some((s) => s.group === i.slots)).toBe(true);
    }
    const seen = new Set<string>();
    for (const c of CATEGORIES) {
      const k = `${CATEGORY_INFO[c].position}:${CATEGORY_INFO[c].order}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
    for (const s of SHELVES) expect(kindsOn(s.id).length).toBeGreaterThan(0);
    // The web's picker lists the same kinds, in the same order, on the same shelves.
    expect(LORE_CATEGORIES.map((c): string[] => [c.id, c.shelf, c.label])).toEqual(CATEGORIES.map((c): string[] => [c, CATEGORY_INFO[c].shelf, CATEGORY_INFO[c].label]));
    expect(kindTemplate("reaction", "Mira")).toBe("Mira. Trigger: \nWhat they do: \nWhat they say: \nWhy: ");
  });

  test("the guesser knows the new kinds, by tag, title and words", () => {
    const cases: [string, string, string][] = [
      ["Reaction: Mira, when her mother comes up", "", "reaction"],
      ["Mira, when her mother comes up", "", "reaction"],
      ["Moment: the lighthouse", "", "moment"],
      ["The night we met", "", "moment"],
      ["The Vell family", "", "family"],
      ["Tidecalling magic", "", "power"],
      ["Selkie species", "", "species"],
      ["Gods of the Deep", "", "faith"],
      ["Harbour slang", "", "lexicon"],
      ["Currency of Port Ellis", "", "money"],
      ["Weather in the bay", "", "climate"],
      ["Hook: an inspection at dawn", "", "hook"],
      ["Who relit the lamp?", "", "mystery"],
      ["A day on the quay", "", "routine"],
      ["Lamp oil", "A cask costs 4 crowns at the quay.", "money"],
      ["The old feud", "Whenever someone mentions the war, Joss leaves the room.", "reaction"],
      ["The lamp", "No one knows who relit it that night.", "mystery"],
    ];
    for (const [title, text, want] of cases) expect([title, g(title, text).category]).toEqual([title, want]);
    // Kept apart from their neighbours.
    expect(g("The Merchants' Trade Guild").category).toBe("faction");
    expect(g("The Winter Festival").category).toBe("customs");
    expect(g("Rules of the Guild").category).toBe("rule");
    // A kind's tag never makes a person for the world sim.
    expect(lorePersonName(defaultEntry({ comment: "Reaction: Mira", content: "She goes quiet." }))).toBeNull();
  });

  test("a new entry of a kind: its place, priority and parts to fill", async () => {
    const bookId = createLorebook({ name: "Port Ellis" });
    const e = await post(`/api/lorebooks/${bookId}/entries/kind`, { category: "lexicon", title: "Harbour slang" });
    expect(e).toMatchObject({ comment: "Harbour slang", position: "before_char", order: 74, content: "Terms: \nWho says them: ", extra: { category: "lexicon", type: "concept" } });
    const ar = await post(`/api/lorebooks/${bookId}/autosort`, {});
    expect(ar.shelves.map((s: any) => s.id)).toEqual(["ground", "people", "world", "time", "scenes"]);
    expect(ar.categories.find((c: any) => c.id === "mystery")).toMatchObject({ shelf: "time", subject: "none", fires: "topic" });
  });
});
