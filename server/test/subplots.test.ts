import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { buildRoster } from "../src/sim/roster";
import { ownIncident, seedCandidates, type TickInput } from "../src/sim/storyteller";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { parseLine } from "../src/trackers/dsl";
import { foldEvents, type FoldConfig } from "../src/trackers/fold";
import { drawPressure, pressuresAfterReply } from "../src/trackers/pressures";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import type { WorldState } from "../src/trackers/types";
import { freshDb } from "./helpers";

/** docs/33 Part 12: subplots, pressures and incidents come from the story, not from a template. */
const cfg: FoldConfig = { userName: "Gabriel", mainName: "Buffy", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: [] };
function world(messages: string[][]): WorldState {
  let n = 0;
  return foldEvents(
    messages.flatMap((lines, i) => lines.map((l) => ({ id: `e${++n}`, messageId: `m${i + 1}`, seq: i + 1, source: "init" as const, op: parseLine(l)! }))),
    cfg,
  ).state;
}
function input(st: WorldState, over: Partial<TickInput> = {}): TickInput {
  const roster = buildRoster({ state: st, profiles: {} as never, lore: [], userName: "Gabriel" });
  return { chatId: "c1", state: st, roster, mode: "living", director: "steady", seeding: "ask", fates: "ask", genres: [], tech: "modern", from: null, now: st.time!.minutes, recent: new Set(), ...over };
}
const offstage = (inp: TickInput) => [...inp.roster.actors.values()].filter((a) => !a.isUser && a.ring !== "onstage");
const seeds = (inp: TickInput) => seedCandidates(inp, offstage(inp));

const story = () =>
  world([
    ["clock: 2001-10-09 22:00", "at: Sunnydale › hills › Winters Residence › kitchen", "cast: Buffy@spot · Gabriel@spot · Ruth@spot", "trait Ruth: cat, orange", "cast: Willow@left(→ Sunnydale › dorm)", "cast: Powell@left(→ Sunnydale)", "thread first day back: new — Willow watched Buffy eat the last bite of a waffle", "drive Willow: want: to be forgiven; fear: that she broke it for good"],
    ["thread empty house: new — Ruth has the house to herself"],
    ["thread the apology: new — Willow owes Gabriel an apology to his face"],
  ]);

describe("subplot seeds (12.1–12.4)", () => {
  test("a thread untouched for two chapters seeds nothing; a live one does, with what its lead wants", () => {
    const st = story();
    const old = seeds(input(st, { liveFrom: 3 }));
    expect(old.some((c) => c.grounds.includes("thread:first-day-back") || /waffle/.test(c.premise))).toBe(false);
    const live = old.find((c) => /apology/.test(c.premise));
    expect(live?.leadName).toBe("Willow");
    expect(live?.premise).toContain("Willow wants to be forgiven");
    expect(live?.premise).not.toContain("has their own stake");
    expect(live?.why).toContain("last touched at #3");
  });
  test("a pet leads nothing, and someone with no want of their own isn't given a stake", () => {
    const all = seeds(input(story(), { liveFrom: 0 }));
    expect(all.some((c) => c.leadName === "Ruth")).toBe(false);
    expect(all.some((c) => /has their own stake/.test(c.premise))).toBe(false);
  });
  test("what the story left open is a seed, led by whoever it names first", () => {
    const st = story();
    const long = [
      { id: "L1", kind: "conflict", text: "Willow must return and apologize to Gabriel's face" },
      { id: "L2", kind: "promise", text: "Powell's delivery with Willow next week" },
    ];
    const got = seeds(input(st, { liveFrom: 99, long }));
    const willow = got.find((c) => c.grounds.includes("long:L1"));
    expect(willow?.leadName).toBe("Willow");
    expect(willow?.why).toBe("something the story left unsettled");
    expect(got.filter((c) => c.grounds.includes("long:L2")).map((c) => c.leadName)).toEqual(["Powell"]);
    expect(willow!.score).toBeGreaterThan(3);
  });
  test("a kind turned down three times running rests", () => {
    const st = story();
    const long = [{ id: "L1", kind: "conflict", text: "Willow must return and apologize to Gabriel's face" }];
    const before = seeds(input(st, { liveFrom: 99, long })).find((c) => c.grounds.includes("long:L1"))!;
    st.sim.declined = [`a|${before.kind}|x`, `b|${before.kind}|y`, `c|${before.kind}|z`];
    expect(seeds(input(st, { liveFrom: 99, long })).some((c) => c.kind === before.kind)).toBe(false);
    st.sim.declined = [`a|${before.kind}|x`, "b|other|y", "c|other|z"];
    expect(seeds(input(st, { liveFrom: 99, long })).some((c) => c.kind === before.kind)).toBe(true);
  });
});

describe("incidents from the setting (12.6)", () => {
  test("made of the story's own places, with a way onto the page", () => {
    const st = world([["clock: 2001-10-15 14:00", "at: Sunnydale › Revello Drive › Summers Residence › Kitchen", "cast: Buffy@spot", "at: Sunnydale › Sunnydale Mall › Food Court", "at: Sunnydale › Restfield Cemetery"]]);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      let k = i;
      const t = ownIncident(input(st), () => ((k = (k * 9301 + 49297) % 233280), k / 233280));
      if (t) seen.add(t);
    }
    expect(seen.size).toBeGreaterThan(2);
    for (const t of seen) {
      expect(t).toMatch(/Revello Drive|Sunnydale Mall|Restfield Cemetery/);
      expect(t).toMatch(/\((?:it was on the car radio|someone mentions it in passing|seen on the drive past|the local paper has it)\)\.$/);
      expect(t).not.toMatch(/high street|harbour|market|prices/);
    }
  });
  test("nothing known, nothing made up", () => {
    const st = world([["clock: Day 1 12:00", "cast: Buffy@spot"]]);
    expect(ownIncident(input(st), () => 0.5)).toBeNull();
  });
});

describe("pressures (12.5)", () => {
  let chatId = "";
  const reply = (lines: string[]) => {
    const id = addMessage(chatId, "assistant", "…", { name: "Buffy" });
    writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
    return id;
  };
  const state = () => currentFold(chatId).result.state;
  const who = (name: string) => Object.values(state().chars).find((c) => c.name === name)!;
  beforeAll(() => {
    freshDb();
    pauseJobs(true);
    for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update", "offpage.reword", "lessons.learn"]) registerJob(kind, async () => {});
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", description: "The Slayer.", first_mes: "Hi." } });
    chatId = createChat({ characterId: createCharacter(data) }).id;
    reply(["clock: Day 1 09:00", "cast: Buffy@spot · Ruth@spot · Walter@spot · Spike@spot", "trait Ruth: cat, orange tabby", "trait Spike: bleached hair; black coat"]);
    for (let i = 0; i < 7; i++) reply(["clock: +5m", "cast: Buffy@spot · Ruth@spot · Walter@spot · Spike@spot"]);
  });
  test("a pet draws none, nor does someone the story has said nothing about", () => {
    expect(drawPressure(chatId, state(), who("Ruth"))).toBeNull();
    expect(drawPressure(chatId, state(), who("Walter"))).toBeNull();
    expect(drawPressure(chatId, state(), who("Spike"))?.text).toBeTruthy();
    const m = reply(["clock: +5m", "cast: Buffy@spot · Ruth@spot · Walter@spot · Spike@spot"]);
    pressuresAfterReply(chatId, m, 0);
    expect(who("Ruth").pressure).toBeFalsy();
    expect(who("Walter").pressure).toBeFalsy();
    expect(who("Spike").pressure?.text).toBeTruthy();
  });
});
