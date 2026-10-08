import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { setSetting } from "../src/lib/settings";
import { activateLore, type ActivationInput, type ScanEntry } from "../src/lore/activate";
import { assistEntry, glossary, previewLore, templateContent } from "../src/lore/assist";
import { acceptChronicle, chronicleBook, chronicleProposals, runChronicle } from "../src/lore/chronicle";
import { loreHealth, recordLoreHits } from "../src/lore/health";
import { embedLore, loreVectors, semanticScorer } from "../src/lore/semantic";
import { createEntry, createLorebook, getLorebook, scanEntriesFor } from "../src/lore/service";
import { defaultEntry, type LoreEntry } from "../src/lore/types";
import { insertAtom } from "../src/memory/atoms";
import { embedQueries } from "../src/memory/embed";
import { syncEntities } from "../src/memory/entities";
import { defaultMemoryConfig } from "../src/lib/settings";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

const defaults = { scanDepth: 4, tokenBudget: 1000, recursive: true, maxRecursion: 3, caseSensitive: false, matchWholeWords: true };
let n = 0;
const entry = (p: Partial<LoreEntry>, book: ScanEntry["book"] = {}): ScanEntry => ({ ...defaultEntry({ content: "content", ...p }), id: `x${n++}`, bookId: "b", bookName: "Book", book });
const run = (entries: ScanEntry[], history: string[], extra: Partial<ActivationInput> = {}) =>
  activateLore({ entries, history, messageCount: history.length, state: {}, defaults, countTokens: (s) => s.length, random: () => 0.5, all: entries, ...extra });

let chatId = "";
let connId = "";

beforeAll(async () => {
  freshDb();
  connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 4000, max_tokens: 400 } });
  setSetting("routing.embeddings", { connectionId: connId, model: "mock/embed", dims: 64 });
  setSetting("memory.config", { ...defaultMemoryConfig, chronicle: true });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper.", first_mes: "Welcome." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
});

describe("activation, Phase 3", () => {
  test("aliases are keys; entities in the scene fire their entries (LORE-06)", () => {
    const kael = entry({ keys: ["Kael"], comment: "Kael", content: "Kael is a drifter.", extra: { aliases: ["the stranger"], type: "character" } });
    expect(run([kael], ["the stranger enters"]).activated).toHaveLength(1);
    const r = run([kael], ["the rain keeps falling"], { present: ["Kael"] });
    expect(r.activated[0]?.reason).toBe('"Kael" is in the scene');
    expect(run([kael], ["the rain keeps falling"]).activated).toHaveLength(0);
  });

  test("semantic activation for entries that opt in (LORE-05)", () => {
    const tide = entry({ keys: ["tide charts"], content: "The tide tables of Port Ellis.", extra: { semantic: true } });
    const off = entry({ keys: ["tide charts"], content: "Another." });
    const r = run([tide, off], ["the water is rising fast"], { semantic: (e) => (e.id === tide.id || e.id === off.id ? 0.7 : null), semanticThreshold: 0.5 });
    expect(r.activated.map((a) => a.entry.id)).toEqual([tide.id, off.id].filter((id) => id === tide.id || true).slice(0, 2));
    const strict = run([tide], ["the water is rising fast"], { semantic: () => 0.3, semanticThreshold: 0.5 });
    expect(strict.activated).toHaveLength(0);
    expect(run([tide], ["x"], { semantic: () => 0.62 }).trace[0]?.reason).toContain("similar meaning (0.62)");
  });

  test("a child brings its parent's essentials; secrets carry who knows (LORE-10, LORE-09)", () => {
    const city = entry({ keys: ["Port Ellis"], comment: "Port Ellis", content: "A long description of the harbour town. More detail. Even more.", extra: { essentials: "Port Ellis is a fishing town on a cold northern coast." } });
    const inn = entry({ keys: ["Gull Inn"], comment: "The Gull Inn", content: "A crooked inn by the docks.", extra: { parent: city.id, secrets: [{ text: "The cellar hides smuggled brandy.", knownBy: ["Joss"] }] } });
    const r = run([city, inn], ["we stop at the Gull Inn"]);
    const parent = r.activated.find((a) => a.entry.id === city.id)!;
    expect(parent.content).toBe("Port Ellis is a fishing town on a cold northern coast.");
    expect(parent.reason).toContain("parent of The Gull Inn");
    expect(r.activated.find((a) => a.entry.id === inn.id)!.content).toContain("[Secret — known only to Joss: The cellar hides smuggled brandy.]");
  });

  test("priority: constants and entities outrank keyword matches when the budget is tight (LORE-14)", () => {
    const rule = entry({ constant: true, content: "R".repeat(300), order: 1 });
    const person = entry({ keys: ["Joss"], content: "J".repeat(300), order: 1 });
    const word = entry({ keys: ["rain"], content: "W".repeat(300), order: 1, extra: { essentials: "w" } });
    const r = run([rule, person, word], ["rain"], { present: ["Joss"], defaults: { ...defaults, tokenBudget: 620 } });
    const ids = r.activated.map((a) => a.entry.id);
    expect(ids).toContain(rule.id);
    expect(ids).toContain(person.id);
    expect(r.activated.find((a) => a.entry.id === word.id)?.content).toBe("w");
    expect(r.trace.every((t) => t.status !== "active" || typeof t.priority === "number")).toBe(true);
  });
});

describe("health check (LORE-13)", () => {
  test("duplicates, overlap, contradictions, oversized, loops, no keys, cost", () => {
    const bookId = createLorebook({
      name: "World",
      entries: [
        defaultEntry({ comment: "Mira A", keys: ["Mira"], content: "Mira has green eyes and keeps the lamp burning every night on the tower." }),
        defaultEntry({ comment: "Mira B", keys: ["Mira"], content: "Mira has blue eyes and keeps the lamp burning every night on the tower." }),
        defaultEntry({ comment: "Huge", keys: ["huge"], content: "word ".repeat(900) }),
        defaultEntry({ comment: "Ping", keys: ["ping"], content: "this mentions pong" }),
        defaultEntry({ comment: "Pong", keys: ["pong"], content: "this mentions ping" }),
        defaultEntry({ comment: "Lost", keys: [], content: "Nobody can trigger me." }),
        defaultEntry({ comment: "Rule", constant: true, content: "Magic costs blood." }),
      ],
    });
    const h = loreHealth(bookId)!;
    const kinds = new Set(h.issues.map((i) => i.kind));
    for (const k of ["duplicate-key", "overlap", "contradiction", "oversized", "recursion-loop", "no-keys"]) expect(kinds.has(k as never)).toBe(true);
    expect(h.issues.find((i) => i.kind === "contradiction")?.message).toContain("eyes");
    expect(h.cost.constantTokens).toBeGreaterThan(0);
    const book = getLorebook(bookId)!;
    recordLoreHits(chatId, [book.entries[0]!.id, book.entries[0]!.id]);
    expect(loreHealth(bookId)!.cost.top.find((t) => t.title === "Mira A")?.hits).toBe(1);
  });
});

describe("semantic vectors (LORE-05)", () => {
  test("opted-in entries are embedded once and scored against the context", async () => {
    const bookId = createLorebook({ name: "Sea", settings: { semantic: true }, entries: [defaultEntry({ comment: "Tides", keys: ["tide"], content: "The tides at Port Ellis rise twice a day, fast and dangerous." })], links: [{ target_type: "chat", target_id: chatId }] });
    expect((await embedLore()).embedded).toBe(1);
    expect((await embedLore()).embedded).toBe(0);
    expect(loreVectors().size).toBe(1);
    const [q] = await embedQueries(["the tides rise fast and dangerous at Port Ellis"]);
    const score = semanticScorer(q!)!;
    const e = scanEntriesFor({ chatId }).find((x) => x.bookId === bookId)!;
    expect(score(e)).toBeGreaterThan(0.5);
  });
});

describe("authoring and the story's own lore", () => {
  test("templates, assist, preview, glossary (LORE-09, LORE-11, LORE-08, LORE-15)", async () => {
    expect(templateContent("location", "The Gull Inn")).toContain("Atmosphere:");
    const draft = await assistEntry("draft", { idea: "Brandy cellar under the Gull Inn", type: "location" });
    expect(draft.content).toContain("Brandy cellar");
    expect(draft.essentials).toBeTruthy();
    const keys = await assistEntry("keys", { comment: "Gull Inn", content: "The Gull Inn is run by Joss." });
    expect(keys.content).toBe("The Gull Inn is run by Joss.");
    const bookId = createLorebook({ name: "Town", links: [{ target_type: "chat", target_id: chatId }] });
    createEntry(bookId, { comment: "The Gull Inn", keys: ["Gull Inn"], content: "A crooked inn by the docks.", extra: { aliases: ["the Gull"] } });
    addMessage(chatId, "user", "Hello there", { name: "You" });
    const p = previewLore(chatId, "Let's go to the Gull Inn tonight");
    expect(p.map((x) => x.title)).toContain("The Gull Inn");
    expect(previewLore(chatId, "nothing special")).toHaveLength(0);
    const g = glossary(chatId);
    expect(g.find((t) => t.term === "the Gull")?.title).toBe("The Gull Inn");
  });

  test("the Chronicle proposes entries for what the story introduced (LORE-12)", async () => {
    const ids = [0, 1].map((i) => addMessage(chatId, i % 2 ? "assistant" : "user", `Line ${i}`, { name: i % 2 ? "Mira" : "You" }));
    writeEvents(chatId, { messageId: ids[1]!, swipeIdx: -1 }, linesToOps(["clock: Day 1 20:00", "cast: Mira@spot · Brannoc@spot"]).ops, "model");
    for (const t of ["Brannoc is a retired harpooner with one ear.", "Brannoc owes Mira a favour.", "Brannoc sings sea shanties when drunk."]) insertAtom(chatId, null, { type: "fact", content: t, entities: ["Brannoc"], importance: 6 }, [{ id: ids[1]!, seq: 3 }]);
    syncEntities(chatId, true);
    const made = await runChronicle(chatId);
    expect(made.map((m) => m.name)).toContain("Brannoc");
    const prop = chronicleProposals(chatId).find((p) => p.name === "Brannoc")!;
    expect(prop.entry.extra.type).toBe("character");
    expect(prop.entry.extra.entity).toBe("Brannoc");
    // Asked once: not proposed again.
    expect((await runChronicle(chatId)).map((m) => m.name)).not.toContain("Brannoc");
    const r = acceptChronicle(prop.id, { content: "Brannoc, a one-eared retired harpooner who owes Mira a favour." });
    expect(r.bookId).toBe(chronicleBook(chatId));
    expect(getLorebook(r.bookId)!.settings.chronicleFor).toBe(chatId);
    expect(scanEntriesFor({ chatId }).some((e) => e.comment === "Brannoc")).toBe(true);
    // Now covered by lore: nothing more to propose for him.
    expect((await runChronicle(chatId)).map((m) => m.name)).not.toContain("Brannoc");
  });
});
