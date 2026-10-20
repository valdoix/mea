import { beforeAll, describe, expect, test } from "bun:test";
import { activateLore } from "../src/lore/activate";
import { createEntry, createLorebook, getLorebook } from "../src/lore/service";
import { commitDraft, createDraft, getDraft, mutate, planOutline, queueWrite, runStudioJob } from "../src/lore/studio";
import { defaultEntry } from "../src/lore/types";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { createChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { registerJob } from "../src/services/jobs";
import { buildRoster, routinesFrom } from "../src/sim/roster";
import { worldConfig } from "../src/sim/service";
import { situationCands, tick, type TickInput } from "../src/sim/storyteller";
import { parseLine } from "../src/trackers/dsl";
import { foldEvents } from "../src/trackers/fold";
import type { WorldState } from "../src/trackers/types";
import { freshDb } from "./helpers";

beforeAll(async () => {
  freshDb();
  for (const kind of ["lore.studio", "lore.embed", "lore.details"]) registerJob(kind, async () => {});
  const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(conn);
  createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 4000 } });
});

const world = (lines: string[]): WorldState =>
  foldEvents(
    lines.map((l, i) => ({ id: `e${i}`, messageId: "m1", seq: 1, source: "init" as const, op: parseLine(l)! })),
    { userName: "Alex", mainName: "Mira", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: [] },
  ).state;

describe("5.1 a timeline boundary from the plan", () => {
  test("a Fandom AU plan holds a boundary, written with what has happened and what hasn't", async () => {
    const d = createDraft({ kind: "idea", text: "Mira Vell keeps the lighthouse at Port Ellis.", options: { size: "small", mix: { timeline: "few", character: "each" } } });
    mutate(d.id, (cur) => {
      cur.basedOn = "The Port Ellis Chronicles (TV)";
      cur.research = { basedOn: cur.basedOn, at: Date.now(), wikis: [], sources: [], names: [], brief: "A show about a lighthouse." };
    });
    const planned = await planOutline(d.id);
    const boundary = planned.items.filter((i) => i.category === "timeline");
    expect(boundary).toHaveLength(1);
    expect(boundary[0]).toMatchObject({ constant: true, title: "Timeline: where the story stands" });
    expect(boundary[0]!.pitch).toContain("The Port Ellis Chronicles");
    // Without an existing work, or with a mix that leaves it out, there's none.
    const plain = createDraft({ kind: "idea", text: "Mira Vell keeps the lighthouse.", options: { size: "small", mix: { character: "each" } } });
    expect((await planOutline(plain.id)).items.some((i) => i.category === "timeline")).toBe(false);

    queueWrite(d.id, { itemIds: [boundary[0]!.id] });
    await runStudioJob(d.id);
    const parts = getDraft(d.id)!.items.find((i) => i.id === boundary[0]!.id)!.entry!.parts!;
    expect(parts["already happened"]).toHaveLength(2);
    expect(parts["not yet"]).toHaveLength(2);
  });
});

describe("5.2 kinds the world sim reads", () => {
  const base = ["clock: Day 1 07:00", "at: Port Ellis › Lighthouse", "cast: Mira@spot · Alex@spot"];

  test("a routine's schedule places its person by the story clock", () => {
    const people = [{ id: "tam-reed", name: "Tam Reed" }];
    expect(routinesFrom(["6–9: Tam Reed, at the quay", "noon — Tam Reed — the Anchor", "dawn: the fishwives, the auction", "18:00-21:00: Tam, home"], people).get("tam-reed")).toEqual([
      { from: 6, to: 9, place: "the quay" },
      { from: 12, to: 14, place: "the Anchor" },
      { from: 18, to: 21, place: "home" },
    ]);
    const schedules = ["6–9: Tam Reed, at the quay", "noon: Tam Reed, the Anchor"];
    const lore = [{ name: "Tam Reed", text: "Tam Reed rows the ferry." }];
    const at7 = buildRoster({ state: world(base), profiles: {}, lore, userName: "Alex", schedules });
    expect(at7.byName("Tam Reed")!.where).toEqual(["the quay"]);
    const at13 = buildRoster({ state: world([...base.slice(1), "clock: Day 1 13:00"]), profiles: {}, lore, userName: "Alex", schedules });
    expect(at13.byName("Tam Reed")!.where).toEqual(["the Anchor"]);
    expect(at13.byName("Tam Reed")!.routine).toHaveLength(2);
  });

  test("a hook is offered as a proposal, never started", () => {
    const st = world(base);
    const roster = buildRoster({ state: st, profiles: {}, lore: [{ name: "Joss Arden", text: "Joss Arden is a deserter hiding in the oil store." }], userName: "Alex" });
    const inp: TickInput = { chatId: "c1", state: st, roster, mode: "living", director: "steady", seeding: "auto", fates: "ask", genres: [], tech: "modern", from: null, now: st.time!.minutes, recent: new Set(), situations: [{ key: "joss arden needs a boat", title: "Joss Arden Needs a Boat", text: "Joss Arden needs a boat out of Port Ellis before the Guild finds him.", hook: true }] };
    expect(situationCands(inp).find((c) => c.grounds[0] === "hook:joss arden needs a boat")?.leadName).toBe("Joss Arden");
    const res = tick(inp);
    expect(res.sim.some((o) => o.type === "arc.new" && (o as { arc: { grounds: string[] } }).arc.grounds.includes("hook:joss arden needs a boat"))).toBe(false);
    expect(res.sim.some((o) => o.type === "proposal.new" && (o as { proposal: { grounds: string[] } }).proposal.grounds.includes("hook:joss arden needs a boat"))).toBe(true);
  });

  test("a Climate entry wins over the guessed climate", () => {
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Mira lives in London.", first_mes: "Rain again." } });
    const characterId = createCharacter(data);
    const chatId = createChat({ characterId }).id;
    expect(worldConfig(chatId).climate).toBe("maritime");
    const bookId = createLorebook({ name: "Mira's world", links: [{ target_type: "character", target_id: characterId }] });
    createEntry(bookId, defaultEntry({ comment: "Climate: the Salt Flats", keys: ["Salt Flats"], content: "Dry desert winds all year; the dunes creep closer each summer.", extra: { category: "climate" } }));
    expect(worldConfig(chatId).climate).toBe("desert");
  });
});

describe("5.3 shared moments for companions", () => {
  test("a moment the card's scenario names is planned about the card and {{user}}, and fires on its words", async () => {
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira Vell", description: "The keeper's daughter.", scenario: "{{user}} and Mira haven't spoken since the night of the dark lamp, when the light failed and a ship went down.", first_mes: "You came back." } });
    const characterId = createCharacter(data);
    const d = createDraft({ kind: "character", refId: characterId, options: { size: "small", mix: { moment: "few", location: "few" } } });
    const planned = await planOutline(d.id);
    const moment = planned.items.find((i) => i.category === "moment" && i.about[0] === `card:${characterId}`)!;
    expect(moment).toMatchObject({ title: "The Night of the Dark Lamp", about: [`card:${characterId}`, "user"], cues: ["the dark lamp"] });

    queueWrite(d.id, { itemIds: [moment.id] });
    await runStudioJob(d.id);
    const written = getDraft(d.id)!.items.find((i) => i.id === moment.id)!.entry!;
    expect(written.content).toContain("It's about Mira Vell.");
    expect(written.keys).toContain("the dark lamp");
    const { bookId } = commitDraft(d.id, { itemIds: [moment.id] });
    const entries = getLorebook(bookId)!.entries;
    const scan = (text: string) =>
      activateLore({ entries: entries.map((e) => ({ ...e, bookId, bookName: "b", book: {} })), history: [text], messageCount: 1, state: {}, defaults: { scanDepth: 4, tokenBudget: 100_000, recursive: false, maxRecursion: 0, caseSensitive: false, matchWholeWords: true }, countTokens: (s) => s.length, random: () => 0.5 }).activated.map((a) => a.entry.comment);
    expect(scan("Do you remember the dark lamp?")).toContain("The Night of the Dark Lamp");
    expect(scan("Mira lights the lamp.")).not.toContain("The Night of the Dark Lamp");
  });
});
