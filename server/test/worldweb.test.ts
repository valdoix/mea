import { describe, expect, test } from "bun:test";
import { applySim } from "../src/sim/fold";
import { buildRoster } from "../src/sim/roster";
import { type BeatCard, canStep, forcedStep, tick, type TickInput } from "../src/sim/storyteller";
import { tellingPrompt, validateTelling } from "../src/sim/telling";
import type { Arc, Beat } from "../src/sim/types";
import { bearingsOn, conditionsFor, eventsOf, peopleOf, tied, webMod } from "../src/sim/web";
import { parseLine } from "../src/trackers/dsl";
import { foldEvents, type FoldConfig } from "../src/trackers/fold";
import type { WorldState } from "../src/trackers/types";

const cfg: FoldConfig = { userName: "Alex", mainName: "Mira", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: [] };

function world(): WorldState {
  const lines = ["clock: Day 1 20:00", "at: Port Ellis › Lighthouse › Lamp room", "cast: Mira@spot · Alex@spot", "cast: Joss@left(→ Port Ellis › Harbour)", "cast: Edda@left(→ Port Ellis › Infirmary)"];
  return foldEvents(lines.map((l, i) => ({ id: `e${i}`, messageId: "m1", seq: 1, source: "init" as const, op: parseLine(l)! })), cfg).state;
}

function input(st: WorldState, over: Partial<TickInput> = {}): TickInput {
  const roster = buildRoster({ state: st, profiles: {} as never, lore: [], userName: "Alex" });
  return { chatId: "c1", state: st, roster, mode: "living", director: "steady", seeding: "off", fates: "allow", genres: [], tech: "modern", from: null, now: st.time!.minutes, recent: new Set(), ...over };
}

const beat = (at: number, result: Beat["result"], text: string): Beat => ({ at, roll: [3, 3], mod: 0, why: [], result, stage: "rising", text, told: "template", seq: 1 });

function arc(o: Partial<Arc> & Pick<Arc, "id" | "kind" | "lead" | "leadName">): Arc {
  return {
    cast: [], premise: `${o.leadName} has a plan.`, want: "to get what they're after", fear: "it slips away", grounds: ["player"], secrecy: "private",
    clock: { cur: 1, max: 8 }, tally: { win: 0, cost: 0, loss: 0 }, heat: 1, stage: "rising", beats: [], nextAt: 0, status: "running", by: "player", createdAt: 0, seq: 1, ...o,
  };
}

/** Joss works against Edda (a revenge aimed at her); Edda has her own story. */
function setup(jossResult: Beat["result"] = "win") {
  const st = world();
  const now = st.time!.minutes;
  const r = input(st).roster;
  const joss = r.byName("Joss")!;
  const edda = r.byName("Edda")!;
  st.sim.arcs.revenge = arc({ id: "revenge", kind: "revenge", lead: joss.id, leadName: "Joss", cast: [edda.id], target: edda.id, want: "to make Edda pay", beats: [beat(now - 60, jossResult, "Joss went to the infirmary asking questions about Edda.")] });
  st.sim.arcs.hers = arc({ id: "hers", kind: "pursuit", lead: edda.id, leadName: "Edda", want: "to keep her post at the infirmary", beats: [beat(now - 600, "cost", "Edda worked a double shift.")] });
  return { st, now, joss, edda };
}

describe("subplots bear on each other", () => {
  test("two subplots are tied when one is about the other's lead, not when they only share a cast member", () => {
    const { st } = setup();
    const r = input(st).roster;
    expect(tied(st.sim.arcs.revenge!, st.sim.arcs.hers!, r).map((a) => a.name)).toEqual(["Edda"]);
    const mira = r.byName("Mira")!;
    const a = arc({ id: "a", kind: "pursuit", lead: r.byName("Joss")!.id, leadName: "Joss", cast: [mira.id] });
    const b = arc({ id: "b", kind: "pursuit", lead: r.byName("Edda")!.id, leadName: "Edda", cast: [mira.id] });
    expect(tied(a, b, r)).toEqual([]);
  });

  test("a subplot against someone turns their next roll by how its latest step went, once", () => {
    const { st, now } = setup("win");
    const r = input(st).roster;
    const all = Object.values(st.sim.arcs);
    const bs = bearingsOn(st.sim.arcs.hers!, all, r, now);
    expect(bs[0]).toMatchObject({ arc: "revenge", stance: "against", dir: "theirs", person: "Edda", fresh: true, mod: -1 });
    expect(webMod(bs)).toEqual({ mod: -1, why: ["tied: Joss's revenge went against Edda"] });
    // Joss stumbled: Edda gets the better of it.
    const lost = setup("loss");
    expect(webMod(bearingsOn(lost.st.sim.arcs.hers!, Object.values(lost.st.sim.arcs), r, now)).mod).toBe(1);
    // Once Edda has answered it, it no longer pulls.
    st.sim.arcs.hers!.beats.push(beat(now - 30, "win", "Edda kept her post."));
    expect(webMod(bearingsOn(st.sim.arcs.hers!, all, r, now)).mod).toBe(0);
  });

  test("a subplot on someone's side gains or loses with that person's own steps", () => {
    const { st, now, joss, edda } = setup();
    st.sim.arcs.revenge = arc({ id: "protect", kind: "protect", lead: joss.id, leadName: "Joss", cast: [edda.id], target: edda.id, want: "to keep Edda safe", createdAt: now - 900 });
    st.sim.arcs.hers!.beats.push(beat(now - 30, "loss", "Edda lost her post at the infirmary."));
    const r = input(st).roster;
    const bs = bearingsOn(st.sim.arcs.revenge!, Object.values(st.sim.arcs), r, now);
    expect(bs[0]).toMatchObject({ stance: "for", dir: "mine", person: "Edda", mod: -1 });
  });

  test("what a step takes from someone stands until a later step gives it back", () => {
    const { st, now } = setup();
    const r = input(st).roster;
    const people = peopleOf(st.sim.arcs.hers!, r);
    const ev = (at: number, text: string) => ({ arc: "revenge", lead: "joss", leadName: "Joss", kind: "revenge" as const, result: "win", text, at });
    expect(conditionsFor(people, [ev(now - 50, "Joss tried to take Edda's memories.")], now)).toEqual([]);
    const taken = conditionsFor(people, [ev(now - 50, "In the end, Joss took Edda's memories.")], now);
    expect(taken.map((c) => c.text)).toEqual(["Edda's memories are gone"]);
    expect(conditionsFor(people, [ev(now - 50, "Joss took Edda's memories."), ev(now - 10, "Edda got her memories back.")], now)).toEqual([]);
  });

  test("a step's dice, its card and its telling see the tied subplots", () => {
    const { st } = setup("win");
    const inp = input(st);
    expect(canStep(st.sim.arcs.hers!, inp.roster)).toBe(true);
    st.sim.arcs.hers!.force = "cost";
    const res = forcedStep(inp, "hers");
    const b = res.sim.find((o) => o.type === "arc.beat");
    expect(b?.type === "arc.beat" && b.beat.why).toContain("tied: Joss's revenge went against Edda");
    const card = res.cards[0]!;
    expect(card.meanwhile?.[0]).toContain("Joss's revenge (against Edda)");
    expect(card.names).toContain("Joss");
    const { user } = tellingPrompt([card], { userName: "Alex", truths: [], genres: [] });
    expect(user).toContain("MEANWHILE Joss's revenge");
    // The telling may name Joss now: he is in what happened meanwhile.
    expect(validateTelling("Edda kept her post, though Joss had been asking about her. She is wary now.", card, { userName: "Alex", places: [] })).toBeNull();
    const bare: BeatCard = { ...card, names: undefined };
    expect(validateTelling("Edda kept her post, though Joss had been asking about her. She is wary now.", bare, { userName: "Alex", places: [] })).not.toBeNull();
  });

  test("a twist can run into a tied subplot, and that subplot takes a step too", () => {
    let collided = false;
    for (let i = 0; i < 60 && !collided; i++) {
      const { st } = setup();
      st.time = { minutes: st.time!.minutes + i, form: "day" };
      st.sim.arcs.revenge!.force = "twist";
      const res = forcedStep(input(st), "revenge");
      const mine = res.sim.find((o) => o.type === "arc.beat" && o.id === "revenge");
      if (mine?.type !== "arc.beat" || mine.beat.twist !== "collide") continue;
      collided = true;
      const theirs = res.sim.find((o) => o.type === "arc.beat" && o.id === "hers");
      expect(theirs?.type === "arc.beat" && theirs.beat.twist).toBe("collide");
      expect(theirs?.type === "arc.beat" && theirs.beat.text).toContain("ran into Joss's own business");
      expect(res.cards.map((c) => c.arc)).toEqual(["revenge", "hers"]);
      // Edda's step answers Joss's, which came in the same moment.
      expect(res.cards[1]!.meanwhile?.[0]).toContain("[since this subplot's last step]");
    }
    expect(collided).toBe(true);
  });

  test("an ending shakes the subplots tied to it", () => {
    const { st, now } = setup();
    const r = input(st).roster;
    st.sim.arcs.revenge = { ...st.sim.arcs.revenge!, kind: "rivalry", clock: { cur: 7, max: 8 }, force: "win", push: true };
    st.sim.arcs.hers = { ...st.sim.arcs.hers!, nextAt: now + 5000, heat: 1 };
    const res = tick(input(st, { from: now - 60 }));
    expect(res.sim.some((o) => o.type === "arc.end" && o.id === "revenge")).toBe(true);
    const shake = res.sim.find((o) => o.type === "arc.set" && o.id === "hers");
    expect(shake?.type === "arc.set" && shake.patch.heat).toBe(2);
    expect(shake?.type === "arc.set" && shake.patch.nextAt! <= now + 120).toBe(true);
    // Its ending is now what the tied subplot sees last.
    for (const op of res.sim) applySim(st.sim, op, 2);
    expect(eventsOf(st.sim.arcs.revenge!).at(-1)!.ending).toBe(true);
    expect(bearingsOn(st.sim.arcs.hers!, Object.values(st.sim.arcs), r, now)[0]!.ending).toBe(true);
  });
});
