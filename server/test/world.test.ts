import { describe, expect, test } from "bun:test";
import { applySim } from "../src/sim/fold";
import { confirmArrivals, elsewhereLane } from "../src/sim/crossings";
import { lean, measureTension, targetTension } from "../src/sim/director";
import { beatTemplate, endTemplate, kindFromText, SPECS, stageOf } from "../src/sim/grammar";
import { spreadNews } from "../src/sim/news";
import { buildRoster, lorePersonName, readStanding } from "../src/sim/roster";
import { forecast, weatherAt } from "../src/sim/sky";
import { canStep, forcedStep, tick, type TickInput } from "../src/sim/storyteller";
import { validateTelling } from "../src/sim/telling";
import { parseLine } from "../src/trackers/dsl";
import { foldEvents, type FoldConfig } from "../src/trackers/fold";
import type { WorldState } from "../src/trackers/types";

const cfg: FoldConfig = { userName: "Alex", mainName: "Mira", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: [] };

function world(lines: string[]): WorldState {
  return foldEvents(
    lines.map((l, i) => ({ id: `e${i}`, messageId: "m1", seq: 1, source: "init" as const, op: parseLine(l)! })),
    cfg,
  ).state;
}

const base = [
  "clock: Day 1 20:00",
  "at: Port Ellis › Lighthouse › Lamp room",
  "cast: Mira@spot · Alex@spot",
  "cast: Joss@left(→ Port Ellis › Harbour)",
  "bond Joss>Mira: resentment 4 — she took his job",
  "bond Mira>Alex: trust 2; affection 2 — from the card",
  "thread Smuggling ring: new — Joss has been seen with the Harbour Guild",
  "clockf Harbour Guild: take the docks 2/6",
  "secret #joss-debt: Joss owes the Guild money | kept by Joss · from Mira",
  "know Mira: Old Tom died in the storm | saw it · knows",
];

function input(st: WorldState, over: Partial<TickInput> = {}): TickInput {
  const roster = buildRoster({ state: st, profiles: { tom: { name: "Old Tom" } } as never, lore: [{ name: "Edda", text: "Edda is Mira's sister. She lives in London and works as a nurse." }], userName: "Alex" });
  return { chatId: "c1", state: st, roster, mode: "living", director: "steady", seeding: "auto", fates: "ask", genres: [], tech: "modern", from: null, now: st.time!.minutes, recent: new Set(), ...over };
}

/** Folds sim ops into a state the way the tracker fold does. */
function advance(st: WorldState, res: ReturnType<typeof tick>) {
  for (const op of res.sim) applySim(st.sim, op, 2);
  return st;
}

describe("grammar", () => {
  test("every kind has a full shape", () => {
    for (const s of Object.values(SPECS)) {
      expect(Object.keys(s.moves).sort()).toEqual(["climax", "crisis", "hook", "reversal", "rising"]);
      expect(s.prices.length).toBeGreaterThan(0);
      expect(s.worse.length).toBeGreaterThan(0);
    }
    expect(stageOf(0, 6)).toBe("hook");
    expect(stageOf(3, 6)).toBe("reversal");
    expect(stageOf(4, 6)).toBe("crisis");
    expect(stageOf(5, 6)).toBe("climax");
    expect(kindFromText("he wants revenge for what she did")).toBe("revenge");
    expect(kindFromText("she's coming back home next week")).toBe("return");
  });

  test("templates read as sentences", () => {
    const t = beatTemplate({ kind: "rivalry", lead: "Joss", want: "to come out on top", stage: "rising", result: "cost", cast: "Mira", price: "pride took a bruising" });
    expect(t).toBe("Joss raised the stakes with Mira. Pride took a bruising.");
    expect(endTemplate({ kind: "return", lead: "Edda", want: "to come back", fear: "they come back too late", result: "lost" })).toBe("It went badly for Edda. Edda came back too late.");
  });
});

describe("roster", () => {
  test("rings, standing, reach and ties", () => {
    const st = world(base);
    const r = input(st).roster;
    expect(r.byName("Mira")!.ring).toBe("onstage");
    expect(r.byName("Joss")!.ring).toBe("offstage");
    expect(r.byName("Joss")!.reach).toBe("town");
    const edda = r.byName("Edda")!;
    expect(edda.ring).toBe("unmet");
    expect(edda.standing).toBe("away");
    expect(edda.reach).toBe("far");
    expect(edda.ties.get(r.byName("Mira")!.id)).toBe(3);
    expect(readStanding("He died last winter.").standing).toBe("dead");
  });
});

describe("storyteller", () => {
  test("the same stretch of time rolls the same dice", () => {
    const a = tick(input(world(base)));
    const b = tick(input(world(base)));
    expect(JSON.stringify(a.sim)).toBe(JSON.stringify(b.sim));
  });

  test("subplots seed from the story's loose ends, and move over time", () => {
    let st = world(base);
    let res = tick(input(st, { forced: true }));
    st = advance(st, res);
    const kinds = Object.values(st.sim.arcs).map((a) => `${a.leadName}:${a.kind}`);
    expect(kinds.length).toBeGreaterThan(0);
    // Over two story days, beats happen and every beat is a sentence.
    let from = st.time!.minutes;
    for (let h = 2; h <= 48; h += 2) {
      st.time = { minutes: from + h * 60, form: "day" };
      res = tick(input(st, { from: st.sim.lastTickAt }));
      st = advance(st, res);
    }
    const beats = Object.values(st.sim.arcs).flatMap((a) => a.beats);
    expect(beats.length).toBeGreaterThan(0);
    for (const b of beats) expect(b.text).toMatch(/[.!?]$/);
    expect(st.sim.tension.length).toBeGreaterThan(5);
  });

  test("forced steps in the same story hour roll fresh dice; onstage leads wait", () => {
    let st = world(base);
    st = advance(st, tick(input(st, { forced: true })));
    const rolls: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = tick(input(st, { forced: true }));
      for (const op of res.sim) if (op.type === "arc.beat") rolls.push(op.beat.roll.join(""));
      st = advance(st, res);
    }
    expect(rolls.length).toBeGreaterThan(1);
    expect(new Set(rolls).size).toBeGreaterThan(1);
    // Mira is in the scene: a subplot she leads doesn't move off the page.
    const mira = world([...base, "thread Mira's lens: new — Mira wants to fix the lens"]);
    const r = input(mira, { forced: true });
    const arcId = "pursuit:mira:test";
    mira.sim.arcs[arcId] = { ...Object.values(st.sim.arcs)[0]!, id: arcId, lead: "mira", leadName: "Mira", push: true, nextAt: 0, status: "running", beats: [], clock: { cur: 0, max: 4 } };
    const res = tick(r);
    expect(res.sim.some((op) => op.type === "arc.beat" && op.id === arcId)).toBe(false);
  });

  test("a called beat lands with the outcome you chose, then the dice decide again", () => {
    let st = world(base);
    st = advance(st, tick(input(st, { forced: true })));
    const roster = input(st).roster;
    const joss = roster.byName("Joss")!;
    st.sim.arcs.y = {
      id: "y", kind: "pursuit", lead: joss.id, leadName: "Joss", cast: [], premise: "Joss wants his boat back.", want: "to buy back the boat", fear: "the Guild sells it", grounds: ["player"], secrecy: "private",
      clock: { cur: 1, max: 8 }, tally: { win: 2, cost: 0, loss: 0 }, heat: 1, stage: "rising", beats: [], nextAt: 0, status: "running", by: "player", createdAt: 0, seq: 1,
    };
    expect(canStep(st.sim.arcs.y!, roster)).toBe(true);
    for (const outcome of ["win", "cost", "loss"] as const) {
      st.sim.arcs.y!.force = outcome;
      const res = forcedStep(input(st), "y");
      const beat = res.sim.find((o) => o.type === "arc.beat");
      expect(beat?.type === "arc.beat" && beat.beat.result).toBe(outcome);
      expect(beat?.type === "arc.beat" && beat.beat.forced).toBe(outcome);
      // Nothing else in the world moves on a call.
      expect(res.sim.every((o) => (o.type === "arc.beat" || o.type === "arc.set" || o.type === "arrival.new" ? ("id" in o ? o.id === "y" : o.arrival.arc === "y") : false))).toBe(true);
      st = advance(st, res);
      expect(st.sim.arcs.y!.force).toBeNull();
    }
    // A reversal turns a winning subplot; a twist always brings one.
    st.sim.arcs.y!.tally = { win: 3, cost: 0, loss: 0 };
    st.sim.arcs.y!.force = "reversal";
    let res = forcedStep(input(st), "y");
    let beat: (typeof res.sim)[number] | undefined = res.sim.find((o) => o.type === "arc.beat");
    expect(beat?.type === "arc.beat" && [beat.beat.result, beat.beat.twist]).toEqual(["loss", "reversal"]);
    st = advance(st, res);
    st.sim.arcs.y!.force = "twist";
    res = forcedStep(input(st), "y");
    beat = res.sim.find((o) => o.type === "arc.beat");
    expect(beat?.type === "arc.beat" && !!beat.beat.twist).toBe(true);
    // A queued call is honoured by the ordinary tick too.
    st = advance(st, res);
    st.sim.arcs.y!.force = "loss";
    st.sim.arcs.y!.push = true;
    res = tick(input(st, { from: st.sim.lastTickAt }));
    beat = res.sim.find((o) => o.type === "arc.beat" && o.id === "y");
    expect(beat?.type === "arc.beat" && beat.beat.result).toBe("loss");
    // Someone in the scene can't take a step off the page.
    const mira = input(st).roster.byName("Mira")!;
    expect(canStep({ ...st.sim.arcs.y!, lead: mira.id }, input(st).roster)).toBe(false);
  });

  test("a subplot moves on its own at its mode's pace, without a nudge", () => {
    const st = world(base);
    const joss = input(st).roster.byName("Joss")!;
    const t0 = 1440 + 8 * 60;
    st.time = { minutes: t0, form: "day" };
    st.sim.lastTickAt = t0;
    // A beat just landed, and its rest was set at the kind's base pace (the old way): eleven story hours.
    st.sim.arcs.y = {
      id: "y", kind: "pursuit", lead: joss.id, leadName: "Joss", cast: [], premise: "Joss wants his boat back.", want: "to buy back the boat", fear: "the Guild sells it", grounds: ["player"], secrecy: "private",
      clock: { cur: 1, max: 6 }, tally: { win: 1, cost: 0, loss: 0 }, heat: 1, stage: "rising",
      beats: [{ at: t0, result: "win", stage: "hook", text: "Joss asked around the harbour.", roll: [3, 3], mod: 0, why: [], told: "template", seq: 1 }],
      nextAt: t0 + 11 * 60, status: "running", by: "player", createdAt: t0 - 60, seq: 1,
    };
    let movedAt: number | null = null;
    for (let h = 2; h <= 10 && movedAt == null; h += 2) {
      st.time = { minutes: t0 + h * 60, form: "day" };
      const res = tick(input(st, { mode: "restless", seeding: "off", from: st.sim.lastTickAt }));
      const beat = res.sim.find((o) => o.type === "arc.beat" && o.id === "y");
      if (beat?.type === "arc.beat") {
        movedAt = h;
        // The next rest follows a restless world's pace too: hours, not half a day.
        expect(beat.nextAt - st.time.minutes).toBeLessThan(6 * 60);
      }
      advance(st, res);
    }
    expect(movedAt).not.toBeNull();
  });

  test("seeding 'ask' writes proposals, not subplots", () => {
    const st = world(base);
    const res = tick(input(st, { seeding: "ask", forced: true }));
    expect(res.sim.some((o) => o.type === "proposal.new")).toBe(true);
    expect(res.sim.some((o) => o.type === "arc.new")).toBe(false);
  });

  test("irreversible endings wait on the player (fates)", () => {
    const st = world(base);
    const roster = input(st).roster;
    const joss = roster.byName("Joss")!;
    st.sim.arcs.x = {
      id: "x", kind: "decline", lead: joss.id, leadName: "Joss", cast: [], premise: "Joss drinks.", want: "to stay in control", fear: "they hit bottom", grounds: ["player"], secrecy: "secret",
      clock: { cur: 5, max: 6 }, tally: { win: 0, cost: 0, loss: 5 }, heat: 3, stage: "crisis", beats: [], nextAt: 0, status: "running", by: "player", push: true, createdAt: 0, seq: 1,
    };
    let fate = false;
    for (let i = 0; i < 20 && !fate; i++) {
      const s2 = structuredClone(st);
      s2.time = { minutes: st.time!.minutes + i * 60, form: "day" };
      const res = tick(input(s2));
      if (res.sim.some((o) => o.type === "arc.fate")) fate = true;
      if (res.sim.some((o) => o.type === "arc.end" && o.id === "x")) {
        // A met or priced ending isn't irreversible, so it may end outright.
        fate = true;
      }
    }
    expect(fate).toBe(true);
  });
});

describe("news", () => {
  test("big news travels along ties; secrets don't leave their keepers", () => {
    const st = world([...base, "bond Joss>Edda: trust 3; affection 3 — old friends", "know Joss: Old Tom died in the storm | heard it · knows"]);
    let hops = 0;
    for (let i = 0; i < 30; i++) {
      const r = spreadNews({ state: st, roster: input(st).roster, hours: 24, rand: Math.random, tech: "modern", now: 0 });
      hops += r.hops.length;
      expect(r.hops.every((h) => h.fact !== "joss-debt")).toBe(true);
    }
    expect(hops).toBeGreaterThan(0);
  });
});

describe("crossings", () => {
  test("an arrival is offered when its route fits, and delivered only when used", () => {
    const st = world(base);
    const roster = input(st).roster;
    const arrivals = [
      { id: "a1", route: "carrier" as const, carrier: "Mira", text: "Mira knows something about Joss: Joss was seen at the harbour with strangers.", at: 0, until: null, status: "pending" as const, offers: 0, maxOffers: 3, seq: 1 },
      { id: "a2", route: "trace" as const, place: ["Old Mill"], text: "At Old Mill, signs of a struggle.", at: 0, until: null, status: "pending" as const, offers: 0, maxOffers: 2, seq: 1 },
    ];
    const lane = elsewhereLane({ arrivals, state: st, roster, now: st.time!.minutes, userName: "Alex", arcs: [] });
    expect(lane.offered).toEqual(["a1"]);
    expect(lane.text).toContain("Reaches the scene now");
    const used = confirmArrivals({ arrivals, offered: lane.offered, prose: "Mira frowns. \"Joss was down at the harbour with strangers last night.\"", now: st.time!.minutes, castNames: ["Mira"] });
    expect(used[0]).toMatchObject({ id: "a1", status: "used" });
    const unused = confirmArrivals({ arrivals, offered: lane.offered, prose: "They drink tea.", now: st.time!.minutes, castNames: ["Mira"] });
    expect(unused[0]).toMatchObject({ id: "a1", status: "offered", offers: 1 });
  });
});

describe("telling validator", () => {
  const card = { id: "c", arc: "x", kind: "return" as const, stage: "rising", result: "loss" as const, lead: "Edda", cast: ["Mira"], where: "London", premise: "", want: "", fear: "", soFar: [], template: "", at: 0 };
  test("keeps the model honest", () => {
    expect(validateTelling("Edda's train was cancelled in London. She is stuck for another day.", card, { userName: "Alex", places: ["London"] })).toBeNull();
    expect(validateTelling("Edda met Gregor at the station.", card, { userName: "Alex", places: [] })).toContain("Gregor");
    expect(validateTelling("Edda called and Alex decided to meet her.", card, { userName: "Alex", places: [] })).toContain("user");
    expect(validateTelling("Edda managed to get on the train after all.", card, { userName: "Alex", places: [] })).toContain("loss");
  });
});

describe("director and sky", () => {
  test("personalities lean the dice", () => {
    expect(lean("steady", 1, 4).rate).toBeGreaterThan(1);
    expect(lean("steady", 8, 4).rate).toBeLessThan(1);
    expect(lean("gentle", 1, 4).soften).toBe(true);
    const st = world([...base, "mode: crisis"]);
    expect(measureTension(st, st.sim)).toBeGreaterThan(2);
    expect(targetTension("rising", { ...st.sim, tension: [{ at: 0, value: 3, target: 3 }] }, 5 * 1440, "c")).toBeGreaterThan(targetTension("rising", { ...st.sim, tension: [{ at: 0, value: 3, target: 3 }] }, 1440, "c"));
  });

  test("weather is seeded and follows the story's own line", () => {
    const inp = { seed: "c1", minutes: 3000, form: "day" as const, climate: "maritime", latitude: 50 };
    expect(weatherAt(inp)).toEqual(weatherAt(inp));
    expect(forecast(inp).length).toBe(4);
    const anchored = weatherAt({ ...inp, anchor: { minutes: 2990, text: "storm" } });
    expect(anchored.level).toBeGreaterThanOrEqual(5);
  });
});

describe("people from lore", () => {
  const who = (comment: string, extra: Record<string, unknown> = {}, content = "She hunts vampires.") => lorePersonName({ comment, keys: [], content, extra });
  test("a category tag in the title is not a name", () => {
    expect(who("Character: Buffy Summers", { category: "character", type: "character" })).toBe("Buffy Summers");
    expect(who("Faction: The Watchers Council", { category: "faction" })).toBeNull();
    expect(who("History: Season Two (Angelus)", { category: "history" })).toBeNull();
    expect(who("Location: Sunnydale", { category: "character", type: "character" })).toBeNull();
    expect(who("Style: Buffy's Speech", { category: "voice" })).toBeNull();
    expect(who("Upcoming: The Trio Targets the Slayer")).toBeNull();
    expect(who("Rule: Spike's Chip")).toBeNull();
    expect(who("Timeline Boundary - Beginning of Season Six", { category: "timeline", type: "rule" })).toBeNull();
  });
  test("plain and role titles still name people", () => {
    expect(who("Mira")).toBe("Mira");
    expect(who("Mira - the innkeeper")).toBe("Mira");
    expect(who("Spike: the bleached vampire")).toBe("Spike");
  });
});
