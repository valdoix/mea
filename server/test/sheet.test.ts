import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { spreadNews } from "../src/sim/news";
import { buildRoster } from "../src/sim/roster";
import { readSheets, rosterFor, sheetsToRead } from "../src/sim/service";
import { checkRead, type Sheet, sheetsFor } from "../src/sim/sheet";
import { currentFold, linesToOps, saveCastProfile, writeEvents } from "../src/trackers/store";
import { foldEvents, type FoldConfig } from "../src/trackers/fold";
import { parseLine } from "../src/trackers/dsl";
import { freshDb } from "./helpers";

/** docs/21 Part 2: the person sheet, read once from the lore, before the engine's guesses. */
const cfg: FoldConfig = { userName: "Alex", mainName: "Mira", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: [] };
const world = (lines: string[]) => foldEvents(lines.map((l, i) => ({ id: `e${i}`, messageId: "m1", seq: 1, source: "init" as const, op: parseLine(l)! })), cfg).state;
const base = ["clock: Day 1 20:00", "at: Port Ellis › Lighthouse › Lamp room", "cast: Mira@spot · Alex@spot", "cast: Joss@left"];
const sheet = (o: Partial<Sheet>): Sheet => ({ kind: "person", status: "alive", whereabouts: null, far: false, inStory: "now", basis: "x", at: 0, ...o });

describe("the person sheet in the roster", () => {
  test("the lore read beats the old guesses, and says where it came from", () => {
    // The regexes would call Dru dead ("killed by"); the reading says she came back and is in Los Angeles.
    const lore = [{ name: "Dru", text: "Dru was killed by Joss in 1997, then raised again; she left for Los Angeles and runs a club." }];
    const guessed = buildRoster({ state: world(base), profiles: {}, lore, userName: "Alex" });
    expect(guessed.byName("Dru")!.basis.standing).toBe("guess");
    const read = buildRoster({ state: world(base), profiles: {}, lore, userName: "Alex", sheets: { dru: sheet({ status: "absent", whereabouts: "Los Angeles", far: true, quote: "she left for Los Angeles" }) } });
    const dru = read.byName("Dru")!;
    expect(dru.standing).toBe("away");
    expect(dru.dead).toBe(false);
    expect(dru.where).toEqual(["Los Angeles"]);
    expect(dru.reach).toBe("far");
    expect(dru.basis).toEqual({ standing: "lore", where: "lore", quote: "she left for Los Angeles" });
  });

  test("what you set and what the story showed beat the sheet", () => {
    const st = world([...base, "dead Joss — drowned in the storm"]);
    const r = buildRoster({ state: st, profiles: { kit: { name: "Kit", standing: "captive" } }, lore: [{ name: "Kit", text: "Kit is a smuggler." }], userName: "Alex", sheets: { joss: sheet({}), kit: sheet({ status: "alive" }) } });
    expect(r.byName("Joss")!.standing).toBe("dead");
    expect(r.byName("Joss")!.basis.standing).toBe("story");
    expect(r.byName("Kit")!.standing).toBe("captive");
    expect(r.byName("Kit")!.basis.standing).toBe("you");
    // The lore says she lives far off; the story has since put her in the harbour.
    const back = buildRoster({ state: world([...base, "cast: Edda@left(→ Port Ellis › Harbour)"]), profiles: {}, lore: [], userName: "Alex", sheets: { edda: sheet({ status: "absent", whereabouts: "London", far: true }) } });
    expect(back.byName("Edda")).toMatchObject({ standing: "here", where: ["Port Ellis", "Harbour"] });
    expect(back.byName("Edda")!.basis.where).toBe("story");
  });

  test("groups, things and people from before the story aren't people the world moves", () => {
    const lore = [
      { name: "Harbour Guild", text: "The Harbour Guild runs the docks. Its members are sworn." },
      { name: "Old Tom", text: "Old Tom kept the lamp before Mira. He was a quiet man." },
      { name: "Ruth", text: "Ruth is the house cat. She is grey and sleeps on the stove." },
    ];
    const r = buildRoster({ state: world(base), profiles: {}, lore, userName: "Alex", sheets: { "harbour guild": sheet({ kind: "group" }), "old tom": sheet({ inStory: "past", status: "dead" }), ruth: sheet({ kind: "animal" }) } });
    expect(r.byName("Harbour Guild")).toBeUndefined();
    expect(r.byName("Old Tom")).toBeUndefined();
    expect(r.byName("Ruth")!.standing).toBe("companion");
    // Away isn't gone: a model that calls someone abroad "past" doesn't take them out of the world.
    const away = buildRoster({ state: world(base), profiles: {}, lore: [{ name: "Rupert Giles", text: "Rupert Giles has just left for England." }], userName: "Alex", sheets: { "rupert giles": sheet({ inStory: "past", status: "alive", whereabouts: "England", far: true }) } });
    expect(away.byName("Rupert Giles")).toMatchObject({ standing: "away", reach: "far" });
  });

  test("a reading is held to what was asked, and its quote to the text", () => {
    expect(checkRead({ name: "Dru", kind: "person", status: "absent", whereabouts: "Los Angeles", far: true, inStory: "now", quote: "left for  Los Angeles" }, "She left for Los Angeles.", "b")?.quote).toBe("left for  Los Angeles");
    expect(checkRead({ name: "Dru", kind: "person", status: "absent", whereabouts: null, far: false, inStory: "now", quote: "made up words" }, "She left.", "b")?.quote).toBeUndefined();
    expect(checkRead({ name: "Dru", kind: "wizard", status: "alive", whereabouts: null, far: false, inStory: "now", quote: "" }, "x", "b")).toBeNull();
  });
});

describe("reading the lore", () => {
  let chatId = "";
  beforeAll(async () => {
    freshDb();
    registerJob("world.sheet", async () => {});
    const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
    await syncModels(connId);
    createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 300 } });
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "Welcome." } });
    chatId = createChat({ characterId: createCharacter(data) }).id;
    const msg = addMessage(chatId, "assistant", "The storm rolls in.");
    writeEvents(chatId, { messageId: msg, swipeIdx: 0 }, linesToOps(["clock: Day 1 08:00", "at: Port Ellis › Lighthouse", "cast: Mira@spot"]).ops, "model");
    saveCastProfile(chatId, "Dru", { description: "Dru is a seer, last seen in Los Angeles in early 2001." });
    saveCastProfile(chatId, "Ruth", { description: "Ruth is the lighthouse cat, grey and old." });
  });

  test("everyone unread is read once; the roster then follows the sheet", async () => {
    expect(sheetsToRead(chatId).map((p) => p.name).sort()).toEqual(["Dru", "Ruth"]);
    expect((await readSheets({ chatId })).read).toBe(2);
    const s = sheetsFor(chatId);
    expect(s.dru).toMatchObject({ status: "absent", whereabouts: "Los Angeles", far: true });
    expect(s.ruth?.kind).toBe("animal");
    const r = rosterFor(chatId, currentFold(chatId).result.state);
    expect(r.byName("Dru")).toMatchObject({ standing: "away", reach: "far" });
    expect(r.byName("Ruth")!.standing).toBe("companion");
    // Read already: nothing to do until their text changes.
    expect(sheetsToRead(chatId)).toEqual([]);
    expect((await readSheets({ chatId })).read).toBe(0);
    saveCastProfile(chatId, "Dru", { description: "Dru is a seer, back in town and dead set on revenge." });
    expect(sheetsToRead(chatId).map((p) => p.name)).toEqual(["Dru"]);
  });
});

describe("ties (docs/21 Part 3)", () => {
  const news = (st: ReturnType<typeof world>, r: ReturnType<typeof buildRoster>) => spreadNews({ state: st, roster: r, hours: 500, rand: () => 0, tech: "modern", now: 0, max: 20 }).ops.map((o) => o.subject);
  const fact = "know Joss: The chandlery burned down in the storm | saw it · knows";

  test("a tie has a kind and says whether they're in touch; only in-touch ties that talk carry news", () => {
    const st = world([...base, fact]);
    const lore = [
      { name: "Dru", text: "Dru is a seer and former lover of Joss." },
      { name: "Kit", text: "Kit is Joss's sister. She runs the ferry." },
      { name: "Bea", text: "Bea is a smuggler who has heard of Joss." },
    ];
    const r = buildRoster({ state: st, profiles: {}, lore, userName: "Alex" });
    const joss = r.byName("Joss")!;
    const kind = (n: string) => joss.tieKind.get(r.byName(n)!.id);
    expect(kind("Dru")).toMatchObject({ type: "past", inTouch: false, by: "guess" });
    expect(kind("Kit")).toMatchObject({ type: "close", inTouch: true, by: "guess" });
    expect(kind("Bea")).toMatchObject({ type: "knowsOf", inTouch: false });
    // Knowing only of someone, or knowing them once, isn't a tie the subplots count.
    expect(joss.ties.has(r.byName("Bea")!.id)).toBe(false);
    expect(news(st, r)).toEqual(["Kit"]);
  });

  test("the lore read's ties beat the old reading, and 'not in touch' holds back news", () => {
    const st = world([...base, fact]);
    const lore = [{ name: "Kit", text: "Kit is Joss's sister. She runs the ferry." }];
    const sheets = { kit: { kind: "person", status: "alive", whereabouts: null, far: false, inStory: "now", basis: "x", at: 0, ties: [{ name: "Joss", type: "close", inTouch: false, quote: "hasn't spoken to Joss in years" }] } as Sheet };
    const r = buildRoster({ state: st, profiles: {}, lore, userName: "Alex", sheets });
    expect(r.byName("Joss")!.tieKind.get(r.byName("Kit")!.id)).toMatchObject({ type: "close", inTouch: false, by: "lore" });
    expect(news(st, r)).toEqual([]);
  });

  test("a bond on the page beats the lore, and a quiet one gives way to it", () => {
    const st = world([...base, fact, "cast: Kit@left", "bond Joss>Kit: affection 3 — old friends"]);
    const sheets = { kit: { kind: "person", status: "alive", whereabouts: null, far: false, inStory: "now", basis: "x", at: 0, ties: [{ name: "Joss", type: "enemy", inTouch: false }] } as Sheet };
    const r = buildRoster({ state: st, profiles: {}, lore: [], userName: "Alex", sheets });
    expect(r.byName("Joss")!.tieKind.get("kit")).toMatchObject({ type: "friend", inTouch: true, by: "story" });
    st.lastSeq = 500;
    // Quiet for 500 messages: the lore's word wins; with no lore, a friendly bond is still taken as in touch.
    expect(buildRoster({ state: st, profiles: {}, lore: [], userName: "Alex", sheets }).byName("Joss")!.tieKind.get("kit")).toMatchObject({ type: "enemy", inTouch: false, by: "lore" });
    expect(buildRoster({ state: st, profiles: {}, lore: [], userName: "Alex" }).byName("Joss")!.tieKind.get("kit")).toMatchObject({ type: "friend", inTouch: true, by: "guess" });
  });

  test("the lore's full name finds the person the story knows by an alias", () => {
    const st = world([...base, "cast: Giles@left"]);
    st.chars.giles!.aliases.push("Rupert Giles");
    const r = buildRoster({ state: st, profiles: {}, lore: [{ name: "Rupert Giles", text: "Rupert Giles is a Watcher. He has just left for England." }], userName: "Alex" });
    expect([...r.actors.values()].filter((a) => /giles/i.test(a.name)).map((a) => a.name)).toEqual(["Giles"]);
  });
});
