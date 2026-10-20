import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { writeDepthBook } from "../src/creator/books";
import { answerQuestion, composeDepth, createCreatorDraft, creatorReadback, getCreatorDraft, interviewPlan, nextQuestion, patchCreator, saveCreator } from "../src/creator/creator";
import { worldContext } from "../src/creator/world";
import { all, run } from "../src/db/db";
import { runDetailsJob } from "../src/lore/details";
import { factsNow } from "../src/lore/facts";
import { createEntry, createLorebook, getLorebook, linkLorebook } from "../src/lore/service";
import { addItem, commitDraft, createDraft, getDraft, ownerBlock, planOutline, queueWrite, runStudioJob } from "../src/lore/studio";
import { defaultEntry } from "../src/lore/types";
import { voiceFacts, voiceLines } from "../src/lore/voice";
import { createCharacter } from "../src/services/characters";
import { createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { createPersona } from "../src/services/personas";
import { freshDb } from "./helpers";

beforeAll(async () => {
  freshDb();
  for (const kind of ["lore.studio", "lore.embed", "lore.details", "memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "tracker.update", "tracker.init", "lore.keepup", "lore.chronicle", "accuracy.check", "creator.write"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
});

describe("7.1 companion books: the card is the subject", () => {
  test("satellites about the card, no Character or Voice entry for it, and its voice as facts", async () => {
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "The keeper's daughter at Port Ellis.", first_mes: "You came back." } });
    const characterId = createCharacter(data);
    const d = createDraft({ kind: "character", refId: characterId, text: "THE CHARACTER BIBLE: MOCK_OWNER Mira\nVoice: she calls {{user}} “little fish”, and her catchphrase is “Tides willing”." });
    expect(d.options.recipe).toBe("companion");
    const planned = await planOutline(d.id);
    expect(planned.items.some((i) => (i.category === "character" || i.category === "voice") && /^(Voice: )?Mira$/.test(i.title))).toBe(false);
    expect(planned.planNotes).toEqual(expect.arrayContaining([expect.stringContaining("Left out “Voice: Mira”")]));
    const aboutCard = planned.items.filter((i) => i.about.includes(`card:${characterId}`));
    expect(aboutCard.map((i) => i.category)).toEqual(expect.arrayContaining(["reaction"]));
    expect(aboutCard.some((i) => i.category === "voice")).toBe(false);

    queueWrite(d.id, { itemIds: aboutCard.map((i) => i.id) });
    await runStudioJob(d.id);
    const { bookId } = commitDraft(d.id);
    linkLorebook(bookId, "character", characterId);
    const job = all<{ payload: string }>("SELECT payload FROM jobs WHERE kind = 'lore.details' AND status = 'queued'").map((j) => JSON.parse(j.payload)).find((p) => p.characterId === characterId)!;
    run("DELETE FROM jobs WHERE kind = 'lore.details'");
    await runDetailsJob(job);
    const lines = voiceLines(voiceFacts(createChat({ characterId }).id, "Mira"), "Sam");
    expect(lines).toEqual(expect.arrayContaining(["Calls Sam: “little fish”", "Says: “Tides willing”"]));
  });
});

describe("7.2 persona books never speak for {{user}}", () => {
  test("the Persona recipe is the default, and kinds that would speak for the persona are dropped with a note", async () => {
    const personaId = createPersona({ name: "Ren", data: { description: "A courier in Port Ellis." } });
    const d = createDraft({ kind: "persona", refId: personaId, text: "MOCK_OWNER Ren" });
    expect(d.options.recipe).toBe("persona");
    const planned = await planOutline(d.id);
    expect(planned.items.filter((i) => ownerBlock(planned, i))).toEqual([]);
    expect(planned.items.some((i) => i.title === "Secret: what Ren hides" || i.title === "Voice: Ren" || (i.title === "Ren" && i.category === "character"))).toBe(false);
    expect(planned.planNotes).toEqual(expect.arrayContaining([expect.stringContaining("Left out “Secret: what Ren hides”")]));
    // About someone else, a secret is fine; about the persona, a voice or a reaction isn't.
    expect(ownerBlock(planned, { title: "Secret: what Joss keeps from Ren", category: "secret", about: ["joss"] })).toBe("");
    expect(ownerBlock(planned, { title: "Reaction: Ren, when the war comes up", category: "reaction", about: ["user"] })).toContain("decide for the player");
    expect(ownerBlock(planned, { title: "Ren & Joss", category: "relationship", about: ["user", "joss"] })).toBe("");
    expect(ownerBlock(planned, { title: "Secret: what Joss keeps from Ren", category: "secret", about: [] })).toBe("");
    expect(ownerBlock(planned, { title: "Belief: Ren's faith in the tide", category: "belief", about: [] })).toContain("decide for the player");
  });
});

describe("7.3 depth entries get their kind", () => {
  test("a composed answer carries its kind; a secret's truth is kept; a reaction keys on its topic; never Current", async () => {
    const d = createCreatorDraft({ kind: "character", name: "Mira", idea: "Mira keeps the lighthouse." });
    await creatorReadback(d.id);
    patchCreator(d.id, { facts: interviewPlan(getCreatorDraft(d.id)!).map((p) => ({ section: p.key, text: `${p.label} settled.` })) });
    const deep = (await nextQuestion(d.id)).questions.at(-1)!;
    await answerQuestion(d.id, deep.id, { answer: "I keep the brass key of the old ferry hidden from Tam." });
    const composed = (await composeDepth(d.id)).depth[0]!;
    expect(composed).toMatchObject({ kind: "secret", truth: "Mira keep the brass key of the old ferry hidden from Tam." });

    const bookId = createLorebook({ name: "Mira: depth" });
    const ids = writeDepthBook(
      bookId,
      [
        { id: "a", title: "The brass key", content: "Mira keeps something from Tam.", keys: ["brass key"], kind: "secret", truth: "She has the ferry's brass key." },
        { id: "b", title: "When the war comes up", content: "Mira goes quiet and leaves the room.", keys: ["Mira", "the war"], kind: "reaction" },
        { id: "c", title: "The storm", content: "The storm took her father.", keys: ["storm"], kind: "current" },
      ],
      "Mira",
    );
    const entries = getLorebook(bookId)!.entries;
    const of = (k: string) => entries.find((e) => e.id === ids[k])!;
    expect(of("a")).toMatchObject({ position: "after_char", order: 120, extra: { category: "secret", secrets: [{ text: "She has the ferry's brass key.", knownBy: ["Mira"] }] } });
    expect(of("a").content).not.toContain("brass key");
    expect(of("b").keys).toEqual(["the war"]);
    expect((of("c").extra as { category?: string }).category).toBeUndefined();
    expect(of("c").constant).toBe(false);
  });
});

describe("7.4 a lore person becomes a card, and back", () => {
  test("the Voice seeds the bible; after saving there's one voice text and the facts stay", async () => {
    const lore = createDraft({ kind: "idea", text: "Mira Vell keeps the lighthouse.", options: { secrets: false } });
    const mira = addItem(lore.id, { title: "Mira Vell", category: "character", pitch: "The keeper's daughter." }).item;
    const joss = addItem(lore.id, { title: "Joss Arden", category: "character", pitch: "A deserter." }).item;
    const voice = addItem(lore.id, { title: "Voice: Mira Vell", category: "voice", about: [mira.id] }).item;
    addItem(lore.id, { title: "Mira Vell & Joss Arden", category: "relationship", about: [mira.id, joss.id] });
    addItem(lore.id, { title: "Reaction: Mira Vell, when her mother comes up", category: "reaction", about: [mira.id] });
    queueWrite(lore.id);
    await runStudioJob(lore.id);
    const { bookId } = commitDraft(lore.id);
    const voiceEntry = getLorebook(bookId)!.entries.find((e) => e.comment === "Voice: Mira Vell")!;
    const facts = factsNow(voiceEntry.id, null).map((f) => f.value);
    expect(facts.length).toBeGreaterThan(0);

    const c = createCreatorDraft({ kind: "character", fromLore: { draftId: lore.id, itemId: mira.id } });
    const section = (k: string) => c.bible.find((b) => b.key === k)?.text ?? "";
    expect(section("voice")).toContain("Calls {{user}}: pet names one, pet names two.");
    expect(section("voice")).toContain("(teasing) “You'll want boots for that, little fish.”");
    expect(section("relationships")).toContain("- Mira Vell & Joss Arden:");
    expect(section("tensions")).toMatch(/^IF trigger of Reaction THEN does of Reaction, saying “says of Reaction”$/);

    patchCreator(c.id, { fields: { description: "The keeper's daughter.", first_mes: "The lamp is lit." } });
    const saved = saveCreator(c.id);
    const after = getLorebook(bookId)!.entries.find((e) => e.id === voiceEntry.id)!;
    expect(after.content).toBe("");
    expect(after.enabled).toBe(true);
    expect(factsNow(voiceEntry.id, null).map((f) => f.value)).toEqual(facts);
    expect(getDraft(lore.id)!.items.find((i) => i.id === voice.id)!.about).toEqual([`card:${saved.id}`]);
    // Saving again doesn't lose the retired text.
    saveCreator(c.id);
    expect((getLorebook(bookId)!.entries.find((e) => e.id === voiceEntry.id)!.extra as { retiredText?: string }).retiredText).toContain("Sounds like");
  });
});

describe("7.5 the creator reads the world by shelf", () => {
  test("a world's lexicon comes ahead of its places and people; other people's satellites are left out", () => {
    const bookId = createLorebook({ name: "Port Ellis" });
    createEntry(bookId, defaultEntry({ comment: "Joss Arden", keys: ["Joss"], content: "A deserter.", extra: { category: "character", type: "character" } }));
    createEntry(bookId, defaultEntry({ comment: "The Lighthouse", keys: ["lighthouse"], content: "A tower on the point.", extra: { category: "location", type: "location" } }));
    createEntry(bookId, defaultEntry({ comment: "Harbour slang", keys: ["dark lamp"], content: "dark lamp: a night with no light.", extra: { category: "lexicon" } }));
    createEntry(bookId, defaultEntry({ comment: "Voice: Joss Arden", keys: ["Joss"], content: "Clipped and dry.", extra: { category: "voice", entity: "Joss Arden" } }));
    const text = worldContext({ bookIds: [bookId] });
    expect(text.indexOf("Harbour slang")).toBeGreaterThan(-1);
    expect(text.indexOf("Harbour slang")).toBeLessThan(text.indexOf("Joss Arden"));
    expect(text.indexOf("Joss Arden")).toBeLessThan(text.indexOf("The Lighthouse"));
    expect(text).not.toContain("Voice: Joss Arden");
  });
});
