import { beforeAll, describe, expect, test } from "bun:test";
import { checkKinds, type KindChecked } from "../src/lore/quality";
import { addItem, applyCritique, createDraft, critiqueDraft, getDraft, patchDraft, queueWrite, reviewDraft, runStudioJob } from "../src/lore/studio";
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

const entry = (p: Partial<KindChecked>): KindChecked => ({ id: "x", title: "An entry", kind: null, content: "", keys: [], parts: {}, secrets: [], subjects: [], missingSubjects: 0, ...p });
const msgs = (e: KindChecked, opts: Parameters<typeof checkKinds>[1] = {}) => (checkKinds([e], opts).x ?? []).map((i) => i.message);

describe("6.1 checks by kind: each fails and passes", () => {
  test("voice", () => {
    expect(msgs(entry({ kind: "voice", parts: { "sample lines": ["warm and gruff"] } }))).toHaveLength(2);
    expect(msgs(entry({ kind: "voice", parts: { "sample lines": ["a: Off with you.", "b: Sit down.", "c: Babe, come here."], "never says": ["babe"] } }))[0]).toContain("never use");
    expect(msgs(entry({ kind: "voice", parts: { "sample lines": ["a: Off with you.", "b: Sit down.", "c: Love, come here."], "never says": ["babe"] } }))).toEqual([]);
  });

  test("current", () => {
    const past = "The raiders came at night. They burned the docks and took the boats. Mira was there and fled. Years ago the town had been quiet; long ago it was a fort.";
    expect(msgs(entry({ kind: "current", content: past, parts: { happening: "a raid" } }))).toHaveLength(3);
    expect(msgs(entry({ kind: "current", content: "Raiders burn the docks. Mira hides Joss in the oil store while the Guild searches.", parts: { happening: "a raid", who: "the raiders", where: "the docks" } }))).toEqual([]);
  });

  test("upcoming", () => {
    expect(msgs(entry({ kind: "upcoming", title: "The Fleet Returns", content: "The fleet returned and the harbour cheered." }), { history: ["The Fleet Returns"] })).toHaveLength(2);
    expect(msgs(entry({ kind: "upcoming", title: "The Fleet Returns", content: "The Guild's fleet will be back at midwinter; gulls inland are the first sign." }), { history: ["The Drowning"] })).toEqual([]);
  });

  test("relationship", () => {
    expect(msgs(entry({ kind: "relationship", subjects: ["Mira Vell", "Joss Arden"], content: "Mira saved him once." }))).toHaveLength(2);
    expect(msgs(entry({ kind: "relationship", subjects: ["Mira Vell", "Joss Arden"], content: "Mira saved Joss once; now she won't look at him." }))).toEqual([]);
  });

  test("reaction", () => {
    expect(msgs(entry({ kind: "reaction", subjects: ["Mira Vell"], keys: ["Mira"] }))[0]).toContain("Keyed on");
    expect(msgs(entry({ kind: "reaction", subjects: ["Mira Vell"] }))[0]).toContain("No trigger");
    expect(msgs(entry({ kind: "reaction", subjects: ["Mira Vell"], keys: ["her mother"], parts: { trigger: "her mother" } }))).toEqual([]);
  });

  test("secret, belief and mystery keep their truth", () => {
    expect(msgs(entry({ kind: "secret", content: "Joss keeps to the oil store." }))[0]).toContain("isn't kept as a secret");
    expect(msgs(entry({ kind: "belief", content: "Mira thinks the storm is over.", secrets: [{ text: "It isn't.", knownBy: ["Joss"] }] }))).toEqual([]);
  });

  test("mystery", () => {
    expect(msgs(entry({ kind: "mystery", parts: { clues: ["soot"] }, secrets: [{ text: "her father", knownBy: [] }] }))).toHaveLength(2);
    expect(msgs(entry({ kind: "mystery", parts: { clues: ["soot"] }, secrets: [{ text: "her father", knownBy: [] }] }), { length: "lean" })).toHaveLength(1);
    expect(msgs(entry({ kind: "mystery", parts: { clues: ["soot", "boots", "a page"], "red herrings": ["the Guild"] }, secrets: [{ text: "her father", knownBy: [] }] }))).toEqual([]);
  });

  test("lexicon and money", () => {
    const terms = ["dark lamp: no light", "little fish: a newcomer", "keeper: lamp minder", "brine: bad luck", "tide-cut: a fair price"];
    expect(msgs(entry({ kind: "lexicon", parts: { terms: terms.slice(0, 2) }, keys: [] }))).toHaveLength(2);
    expect(msgs(entry({ kind: "lexicon", parts: { terms }, keys: ["dark lamp", "little fish", "keeper", "brine", "tide-cut"] }))).toEqual([]);
    expect(msgs(entry({ kind: "money", parts: { coins: ["crown: twenty bits"], prices: ["oil: a crown"] } }))).toHaveLength(1);
    expect(msgs(entry({ kind: "money", parts: { coins: ["crown: twenty bits", "bit: a loaf"], prices: ["oil: a crown", "a bed: two bits", "a boat: forty crowns"] } }))).toEqual([]);
  });

  test("routine", () => {
    expect(msgs(entry({ kind: "routine", parts: { schedule: ["dawn: Mira Vell, the tower", "noon: Old Brand, the market"] } }), { known: ["Mira Vell"] })).toEqual([
      "Only 2 times in the schedule: three or more place people through a day.",
      "Old Brand isn't in the plan or the book.",
    ]);
    expect(msgs(entry({ kind: "routine", parts: { schedule: ["dawn: Mira Vell, the tower", "noon: Mira, the market", "dusk: the fishwives, the quay"] } }), { known: ["Mira Vell"] })).toEqual([]);
  });

  test("timeline boundary, and satellites whose subject is gone", () => {
    expect(msgs(entry({ kind: "timeline", parts: { "as of": "after the siege" } }), { basedOn: "Port Ellis (TV)" })[0]).toContain("No “not yet” list");
    expect(msgs(entry({ kind: "timeline", parts: { "as of": "after the siege" } }))).toEqual([]);
    expect(msgs(entry({ kind: "voice", missingSubjects: 1, parts: { "sample lines": ["a: x y.", "b: Go on.", "c: Sit."] } }))[0]).toContain("isn't in the plan");
  });
});

describe("6.2–6.3 the kind-aware critique, and review by shelf", () => {
  test("shelf totals add up; an add carries its kind; a split-out satellite is about its person", async () => {
    const d = createDraft({ kind: "idea", text: "MOCK_SPLIT Mira Vell keeps the lighthouse at Port Ellis.", options: { overview: true } });
    patchDraft(d.id, { overview: "A harbour town in the fog. MOCK_SPLIT" });
    const mira = addItem(d.id, { title: "Mira Vell", category: "character", pitch: "The keeper's daughter." }).item;
    addItem(d.id, { title: "Port Ellis", category: "location" });
    addItem(d.id, { title: "Raiders Burn the Docks", category: "current" });
    queueWrite(d.id);
    await runStudioJob(d.id);
    const r = reviewDraft(d.id);
    expect(r.shelves.reduce((n, s) => n + s.tokens, 0)).toBe(r.cost.totalTokens);
    expect(r.shelves.reduce((n, s) => n + s.alwaysOnTokens, 0)).toBe(r.cost.alwaysOnTokens + r.tokens[getDraft(d.id)!.items.find((i) => i.category === "current")!.id]!);
    expect(r.shelves.find((s) => s.shelf === "people")!.entries).toBe(1);

    const cur = await critiqueDraft(d.id);
    expect(cur.critique!.find((c) => c.kind === "gap")!.add).toMatchObject({ title: "The Ferry", kind: "location" });
    const split = cur.critique!.find((c) => c.kind === "split")!;
    expect(split.add).toMatchObject({ title: "Voice: Mira Vell", kind: "voice", about: [mira.id] });
    applyCritique(d.id, split.id);
    expect(getDraft(d.id)!.items.find((i) => i.title === "Voice: Mira Vell")).toMatchObject({ category: "voice", about: [mira.id] });
  });
});
