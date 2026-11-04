import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { isStockLine } from "../src/sim/grammar";
import { heedItems, heedOps, touchedBy } from "../src/sim/heed";
import { authorArc, runHeed } from "../src/sim/service";
import { validateWording, wordingAbout, wordingPrompt } from "../src/sim/wording";
import { userEdit } from "../src/trackers/service";
import { currentFold, linesToOps } from "../src/trackers/store";
import { emptySim } from "../src/sim/types";
import type { WorldState } from "../src/trackers/types";
import { freshDb } from "./helpers";

const card = { id: "p:1", kind: "scheme" as const, lead: "Mira", cast: ["Joss"], premise: "Mira is scheming.", want: "to gain the upper hand", fear: "the plot comes to light", why: "a rivalry" };

describe("what a new subplot wants and fears", () => {
  test("stock lines are known, whichever way they come back", () => {
    expect(isStockLine("to gain the upper hand")).toBe(true);
    expect(isStockLine("gain the upper hand.")).toBe(true);
    expect(isStockLine("the plot comes to light")).toBe(true);
    expect(isStockLine("to make Joss pay")).toBe(true);
    expect(isStockLine("to make Joss pay for the burned boats")).toBe(false);
    expect(isStockLine("the Guild reads the forged ledger first")).toBe(false);
  });

  test("the model isn't handed the stock lines, but is handed what's known", () => {
    const { user } = wordingPrompt([{ ...card, about: ["ABOUT Mira: keeps the lighthouse and the harbour's accounts."] }], { userName: "Alex", truths: [], genres: [], scene: "The storm took the pier." });
    expect(user).not.toContain("upper hand");
    expect(user).not.toContain("comes to light");
    expect(user).toContain("harbour's accounts");
    expect(user).toContain("The storm took the pier.");
    // A want that already says something specific stays as a lead.
    const specific = wordingPrompt([{ ...card, want: "to collect what Joss owes" }], { userName: "Alex", truths: [], genres: [] });
    expect(specific.user).toContain("to collect what Joss owes");
  });

  test("a wording that gives back a stock line is turned back", () => {
    expect(validateWording({ premise: "Mira moves.", want: "to gain the upper hand", fear: "Joss reads the ledger" }, { userName: "Alex" })).toContain("stock line");
    expect(validateWording({ premise: "Mira moves.", want: "to buy Joss's boat before the thaw", fear: "Joss reads the ledger" }, { userName: "Alex" })).toBeNull();
  });

  test("what's known comes from the lore, the bond and what it grew from", () => {
    const st = { chars: {}, sim: emptySim(), facts: {}, obligations: {}, threads: { locket: { id: "locket", title: "Lost locket", latest: "It turned up at the pawnbroker's.", status: "open" } }, bonds: { x: { from: "mira", to: "joss", axes: { resentment: 4 }, tags: [], history: [{ axis: "resentment", from: 0, to: 4, delta: 4, cause: "Joss sold the boat", seq: 1 }] } } } as unknown as WorldState;
    const roster = { actors: new Map([["mira", { name: "Mira", text: "Keeps the lighthouse.", want: "to leave", isUser: false }], ["joss", { name: "Joss", text: "A boatman.", isUser: false }]]) } as never;
    const about = wordingAbout({ id: "a", lead: "mira", leadName: "Mira", cast: ["joss"], grounds: ["thread:locket"] }, st, roster).join("\n");
    expect(about).toContain("Keeps the lighthouse.");
    expect(about).toContain("wants to leave");
    expect(about).toContain("resentment 4");
    expect(about).toContain("Joss sold the boat");
    expect(about).toContain("pawnbroker");
  });
});

describe("the story changes the subplots", () => {
  const arc = { id: "a1", kind: "loss", lead: "faction:scoobies", leadName: "Scoobies", cast: [], premise: "The Scoobies believe they failed to bring Buffy back.", want: "to bear it", fear: "they don't come back from it", grounds: ["player"], stage: "rising", beats: [], nextAt: 500, status: "running", locked: true };
  const state = (over: object = {}) => ({ chars: {}, sim: { ...emptySim(), arcs: { a1: { ...arc, ...over } } } }) as unknown as WorldState;
  const scene = "Willow dropped the candle. Buffy stood in the doorway, alive, and looked straight at them.";
  const change = { id: "a1", effect: "shift", quote: "Buffy stood in the doorway, alive", happened: "The Scoobies found Buffy alive.", result: "win", premise: "The Scoobies have found Buffy alive, and don't know what they brought back.", want: "to learn what she went through", fear: "she hates them for it" };

  test("only subplots the scene names are read", () => {
    expect(touchedBy(heedItems(state()), scene).map((i) => i.id)).toEqual(["a1"]);
    expect(touchedBy(heedItems(state()), "The rain went on all night.")).toEqual([]);
    // "Buffy's" is Buffy; "Buffyverse" isn't.
    expect(touchedBy(heedItems(state()), "Buffy's coat was on the chair.")).toHaveLength(1);
    expect(touchedBy(heedItems(state()), "The Buffyverse wiki was down.")).toEqual([]);
  });

  test("a change rewrites even your own words, and leaves a step that says why", () => {
    const ops = heedOps(state(), [change], scene, { now: 600 });
    const beat = ops.find((o) => o.type === "arc.beat") as Extract<(typeof ops)[number], { type: "arc.beat" }>;
    expect(beat.beat.page).toBe(true);
    expect(beat.beat.text).toBe("The Scoobies found Buffy alive.");
    expect(beat.beat.why[0]).toContain("Buffy stood in the doorway");
    expect(beat.nextAt).toBe(500);
    const set = ops.find((o) => o.type === "arc.set") as Extract<(typeof ops)[number], { type: "arc.set" }>;
    expect(set.patch.premise).toContain("found Buffy alive");
    expect(set.patch.want).toBe("to learn what she went through");
  });

  test("a change with no words from the scene behind it is dropped", () => {
    expect(heedOps(state(), [{ ...change, quote: "Buffy rose from her grave" }], scene, { now: 600 })).toEqual([]);
    expect(heedOps(state(), [{ ...change, quote: null }], scene, { now: 600 })).toEqual([]);
    expect(heedOps(state(), [{ ...change, effect: "none" }], scene, { now: 600 })).toEqual([]);
  });

  test("it says what the page showed of the user's character, and leaves what's already over", () => {
    // What the page showed of the user's character can be said: when you play Buffy, she's still alive.
    expect(heedOps(state(), [{ ...change, premise: "Buffy is alive, and the Scoobies are reeling." }], scene, { now: 600 }).length).toBe(2);
    expect(heedOps(state({ status: "resolved" }), [change], scene, { now: 600 })).toEqual([]);
  });

  test("an ending ends it, and what was on its way to the scene is called off", () => {
    const st = state();
    st.sim.arrivals = { n1: { id: "n1", arc: "a1", status: "pending" }, n2: { id: "n2", arc: "a1", status: "used" }, n3: { id: "n3", arc: "other", status: "pending" } } as never;
    const ops = heedOps(st, [{ id: "a1", effect: "end", quote: "alive", happened: "Buffy came home.", result: "met" }], scene, { now: 600 });
    expect(ops).toEqual([{ type: "arc.end", id: "a1", result: "met", text: "Buffy came home.", at: 600 }, { type: "arrival.set", id: "n1", status: "expired" }]);
  });

  test("a proposal the story overtook is changed or withdrawn", () => {
    const st = { chars: {}, sim: { ...emptySim(), proposals: { "p:a": { ...arc, id: "p:a", key: "k", why: "x", at: 0 } } } } as unknown as WorldState;
    expect(heedOps(st, [{ ...change, id: "p:a" }], scene, { now: 600 })[0]!.type).toBe("proposal.set");
    expect(heedOps(st, [{ id: "p:a", effect: "end", quote: "alive", happened: "Moot." }], scene, { now: 600 })[0]).toEqual({ type: "proposal.done", id: "p:a", accepted: false });
  });
});

describe("after a reply", () => {
  let chatId: string;
  beforeAll(async () => {
    freshDb();
    for (const kind of ["memory.segment", "memory.build", "memory.embed", "quota.refresh", "cache.probe", "world.tell", "world.word", "world.heed", "world.sheet"]) registerJob(kind, async () => {});
    const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
    await syncModels(connId);
    createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 8000, max_tokens: 400 } });
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "A lighthouse keeper.", first_mes: "It begins." } });
    chatId = createChat({ characterId: createCharacter(data) }).id;
    addMessage(chatId, "assistant", "It begins.", { name: "Mira" });
    userEdit(chatId, linesToOps(["clock: Day 1 20:00"]).ops);
  });

  const reply = (content: string) => addMessage(chatId, "assistant", content, { name: "Mira" });
  const heed = (messageId: string) => runHeed({ chatId, messageId, swipeIdx: 0 });
  const arcs = () => currentFold(chatId).result.state.sim.arcs;

  test("a scene that says nothing about a subplot leaves it alone", async () => {
    const a = authorArc(chatId, "Scoobies", "The Scoobies believe they failed to bring Buffy back.", true);
    await heed(reply("Buffy waved from the road."));
    expect(arcs()[a.id]!.premise).toContain("failed");
  });

  test("a scene that changes it rewrites it, and a later one can end it", async () => {
    const a = Object.values(arcs())[0]!;
    await heed(reply("Buffy walked in, alive. MOCK_HEED"));
    const after = arcs()[a.id]!;
    expect(after.premise).toStartWith("Heeded:");
    expect(after.want).toBe("to deal with what the scene showed");
    expect(after.beats.at(-1)!.page).toBe(true);
    expect(after.status).toBe("running");
    await heed(reply("The Scoobies sat with Buffy at last. MOCK_HEED_END"));
    expect(arcs()[a.id]!.status).toBe("resolved");
  });

  test("a version swiped away isn't read", async () => {
    const a = authorArc(chatId, "Hellions", "The Hellions mean to raid the docks.", true);
    await runHeed({ chatId, messageId: reply("The Hellions raided the docks. MOCK_HEED"), swipeIdx: 3 });
    expect(arcs()[a.id]!.premise).toContain("raid the docks");
  });
});
