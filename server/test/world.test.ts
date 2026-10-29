import { describe, expect, test } from "bun:test";
import { applySim } from "../src/sim/fold";
import { confirmArrivals, elsewhereLane } from "../src/sim/crossings";
import { lean, measureTension, targetTension } from "../src/sim/director";
import { beatTemplate, endTemplate, kindFromText, SPECS, stageOf } from "../src/sim/grammar";
import { spreadNews } from "../src/sim/news";
import { mentions } from "../src/trackers/mentions";
import { buildRoster, diedInLore, lorePersonName, readStanding, samePerson } from "../src/sim/roster";
import { forecast, latitudeFrom, placeClimate, weatherAt } from "../src/sim/sky";
import { canStep, forcedStep, situationCands, threadNames, tick, type TickInput } from "../src/sim/storyteller";
import { retellPrompt, softProblem, validateTelling } from "../src/sim/telling";
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
    expect(readStanding("Joyce Summers died of an aneurysm.", "Joyce Summers").standing).toBe("dead");
    expect(readStanding("status(deceased); ]", "Jenny").standing).toBe("dead");
    // Someone else's death isn't theirs.
    expect(readStanding("habits(shoplifting since Joyce died; keeps a diary)", "Dawn Summers").standing).toBeUndefined();
    expect(readStanding("past(raised Eyghon; Jenny Calendar - murdered love)", "Rupert Giles").standing).toBeUndefined();
    expect(readStanding("her witch mother died when Tara was seventeen", "Tara Maclay").standing).toBeUndefined();
    expect(readStanding("status(chipped, has counted every day since Buffy died)", "Spike").standing).toBeUndefined();
    expect(readStanding("She is an android built in her maker's image.", "Ada").standing).toBe("construct");
    expect(readStanding("Warren builds robots in his garage.", "Warren Mears").standing).toBeUndefined();
    expect(readStanding("Angelus breaks her neck. She has been dead since 1998.", "Jenny Calendar").standing).toBe("dead");
  });

  test("someone on the page whose lore says they're dead hears no news", () => {
    const st = world([...base, "cast: Jenny Calendar@left", "know Joss: The chandlery burned down in the storm | saw it · knows", "bond Joss>Jenny Calendar: affection 3 — old friends"]);
    const roster = buildRoster({ state: st, profiles: {}, lore: [{ name: "Jenny Calendar", text: "Jenny Calendar teaches computers. She has been dead since 1998." }], userName: "Alex" });
    const jenny = roster.byName("Jenny Calendar")!;
    expect(jenny.ring).toBe("offstage");
    expect(jenny.dead).toBe(true);
    const { ops } = spreadNews({ state: st, roster, hours: 500, rand: () => 0, tech: "modern", now: 0 });
    expect(ops.some((o) => o.subject === "Jenny Calendar")).toBe(false);
  });

  test("a name is a capitalised whole word, possessive or not", () => {
    expect(mentions("Gabriel's organization in LA", "Gabriel Winters")).toBe(true);
    expect(mentions("Buffy Summers' house burned", "Buffy Summers")).toBe(true);
    expect(mentions("He will be back", "Will")).toBe(false);
    expect(mentions("A dozen vampires attacked", "Oz")).toBe(false);
    expect(mentions("Oz left town", "Oz")).toBe(true);
    expect(mentions("Tara's girlfriend", "Tara Maclay")).toBe(true);
    expect(mentions("Gabriel's house", "Gabriel's mom (name unknown")).toBe(false);
  });

  test("facts know who they're about: your name, the cast, and people who turn up later", () => {
    const st = world([...base, "know Joss: Alex's boat sank in the harbour | saw it · knows", "know Joss: Kit's shop burned down | heard it · knows"]);
    const boat = Object.values(st.facts).find((f) => f.statement.startsWith("Alex's"))!;
    expect(boat.about).toEqual(["user"]);
    const shop = Object.values(st.facts).find((f) => f.statement.startsWith("Kit's"))!;
    expect(shop.about).toEqual([]);
    const later = world([...base, "know Joss: Kit's shop burned down | heard it · knows", "cast: Kit@left"]);
    expect(Object.values(later.facts).find((f) => f.statement.startsWith("Kit's"))!.about).toEqual(["kit"]);
  });

  test("a short name inside another word isn't news about them", () => {
    // "dozen" isn't Oz: he hears it. News that names him isn't passed to him.
    const st = world([...base, "know Joss: A dozen vampires attacked the docks | saw it · knows", "know Joss: Oz was attacked at the docks | saw it · knows", "bond Joss>Oz: affection 3 — old friends", "cast: Oz@left"]);
    const roster = buildRoster({ state: st, profiles: {}, lore: [], userName: "Alex" });
    const toOz = spreadNews({ state: st, roster, hours: 500, rand: () => 0, tech: "modern", now: 0, max: 10 }).ops.filter((o) => o.subject === "Oz").map((o) => o.args.fact);
    expect(toOz).toEqual(["A dozen vampires attacked the docks"]);
  });

  test("news says why it travelled, and someone you took out hears none", () => {
    const st = world([...base, "know Joss: The chandlery burned down in the storm | saw it · knows", "bond Joss>Kit: affection 3 — old friends", "cast: Kit@left"]);
    const roster = buildRoster({ state: st, profiles: {}, lore: [], userName: "Alex" });
    const { ops } = spreadNews({ state: st, roster, hours: 500, rand: () => 0, tech: "modern", now: 0 });
    const kit = ops.find((o) => o.subject === "Kit")!;
    expect(kit.why).toContain("tie: friend, in touch: a bond on the page (Joss → Kit)");
    expect(kit.why?.some((w) => w.startsWith("place: ") && w.includes("Kit's place not known, assumed"))).toBe(true);
    const out = buildRoster({ state: st, profiles: { kit: { name: "Kit", out: true } }, lore: [], userName: "Alex" });
    expect(spreadNews({ state: st, roster: out, hours: 500, rand: () => 0, tech: "modern", now: 0 }).ops.some((o) => o.subject === "Kit")).toBe(false);
  });

  test("news about your character stays on the page, even in the possessive", () => {
    const st = world([...base, "know Joss: Alex's shop burned down last night | Alex told him · knows", "bond Joss>Kit: affection 3 — old friends", "cast: Kit@left"]);
    const roster = buildRoster({ state: st, profiles: {}, lore: [], userName: "Alex" });
    const { ops } = spreadNews({ state: st, roster, hours: 500, rand: () => 0, tech: "modern", now: 0 });
    expect(ops).toEqual([]);
  });

  test("a passing mention in someone's lore carries no news", () => {
    const st = world([...base, "know Joss: The chandlery burned down in the storm | saw it · knows"]);
    const roster = buildRoster({
      state: st,
      profiles: {},
      lore: [
        { name: "Dru", text: "Dru is a seer and former lover of Joss. [ status(left him; last seen in Los Angeles in early 2001) ]" },
        { name: "Hallie", text: "Hallie is a demon. [ history(once loved by Joss in 1880 London) ] She still visits Anya." },
      ],
      userName: "Alex",
    });
    expect(roster.byName("Dru")!.standing).toBe("away");
    expect(roster.byName("Dru")!.where).toEqual(["Los Angeles"]);
    expect(roster.byName("Hallie")!.ties.has("joss")).toBe(false);
    const { ops } = spreadNews({ state: st, roster, hours: 500, rand: () => 0, tech: "modern", now: 0 });
    expect(ops.map((o) => o.subject)).not.toContain("Dru");
    expect(ops.map((o) => o.subject)).not.toContain("Hallie");
    // Someone who's been on the page, with nowhere set by the story, is where their lore says.
    const met = buildRoster({ state: world([...base, "cast: Dru@left"]), profiles: {}, lore: [{ name: "Dru", text: "Dru is a seer. [ status(last seen in Los Angeles in early 2001) ]" }], userName: "Alex" });
    expect(met.byName("Dru")!.standing).toBe("away");
    expect(met.byName("Dru")!.reach).toBe("far");
  });
});

describe("storyteller", () => {
  test("a subplot or proposal about nobody drops", () => {
    const st = world(base);
    st.sim.arcs["decline:upcoming:1"] = { id: "decline:upcoming:1", kind: "decline", lead: "upcoming", leadName: "Upcoming", cast: [], premise: "Upcoming: Willow may be drawn deeper.", want: "to stay in control", fear: "they hit bottom", grounds: ["lore:upcoming"], secrecy: "private", clock: { cur: 0, max: 6 }, tally: { win: 0, cost: 0, loss: 0 }, heat: 1, stage: "hook", beats: [], nextAt: 0, status: "running", by: "engine", createdAt: 0, seq: 0 };
    st.sim.proposals["p:x"] = { id: "p:x", key: "upcoming|life|lore:upcoming", kind: "life", lead: "upcoming", leadName: "Upcoming", cast: [], premise: "", want: "", fear: "", grounds: [], secrecy: "private", why: "", at: st.time!.minutes };
    const res = tick(input(st));
    expect(res.sim).toContainEqual({ type: "arc.set", id: "decline:upcoming:1", patch: { status: "dropped" } });
    expect(res.sim).toContainEqual({ type: "proposal.done", id: "p:x", accepted: false });
  });

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
    const st = world([...base, "bond Joss>Edda: trust 3; affection 3 — old friends", "know Joss: The chandlery burned down in the storm | heard it · knows"]);
    let hops = 0;
    for (let i = 0; i < 30; i++) {
      const r = spreadNews({ state: st, roster: input(st).roster, hours: 24, rand: Math.random, tech: "modern", now: 0 });
      hops += r.hops.length;
      expect(r.hops.every((h) => h.fact !== "joss-debt")).toBe(true);
    }
    expect(hops).toBeGreaterThan(0);
  });

  test("news of the leads stays on the page; news of someone reaches only people who know them", () => {
    const st = world([
      ...base,
      "cast: Bob@left · Wren@left",
      "bond Joss>Edda: trust 3; affection 3 — old friends",
      "bond Joss>Bob: trust 3 — workmates",
      "bond Joss>Wren: trust 3 — cousins",
      "bond Wren>Edda: trust 2 — neighbours",
      "know Joss: Mira is pregnant | saw it · knows",
      "know Joss: Edda got engaged | heard it · knows",
    ]);
    const roster = input(st).roster;
    const { ops } = spreadNews({ state: st, roster, hours: 500, rand: () => 0, tech: "modern", now: 0, max: 20 });
    expect(ops.some((o) => o.raw?.includes("#mira-is-pregnant"))).toBe(false);
    const told = ops.filter((o) => o.raw?.includes("#edda-got-engaged")).map((o) => o.subject);
    expect(told).toContain("Wren");
    expect(told).not.toContain("Bob");
  });

  test("the main character tells nobody off the page, even out of the scene", () => {
    const st = world([...base, "cast: Mira@left", "bond Mira>Edda: trust 3; affection 3 — sisters", "know Mira: The chandlery burned down in the storm | saw it · knows"]);
    const roster = input(st).roster;
    expect(roster.byName("Mira")!.ring).toBe("offstage");
    const { ops } = spreadNews({ state: st, roster, hours: 500, rand: () => 0, tech: "modern", now: 0, max: 20 });
    expect(ops.some((o) => o.raw?.includes("told by Mira"))).toBe(false);
  });

  test("a death in passing isn't news", () => {
    const st = world([...base, "bond Joss>Edda: trust 3; affection 3 — old friends", "know Joss: the thermostat hasn't been touched since Old Tom died | saw it · knows"]);
    const { ops } = spreadNews({ state: st, roster: input(st).roster, hours: 500, rand: () => 0, tech: "modern", now: 0, max: 20 });
    expect(ops).toHaveLength(0);
  });

  test("a death told anywhere in the lore keeps them from hearing news", () => {
    expect(diedInLore("Kendra Young", ["In 1997-98 Spike and Drusilla came to town, Kendra was Called and later killed by Drusilla."], ["Spike", "Drusilla"])).toBe(true);
    expect(diedInLore("Jenny Calendar", ["Angel became Angelus, murdering Jenny Calendar."], ["Angel"])).toBe(true);
    expect(diedInLore("Willow", ["Willow saw Tara die and nearly ended the world."], ["Tara"])).toBe(false);
    expect(diedInLore("Willow", ["Willow's mother died young."], [])).toBe(false);
    expect(diedInLore("Kendra Young", ["Kendra Young lent it to Buffy and died before it was returned."], ["Buffy Summers"])).toBe(false);
    expect(diedInLore("Buffy", ["Buffy died in 2001 and came back."], [])).toBe(false);
    expect(diedInLore("Tara", ["Warren tried to kill Tara."], ["Warren"])).toBe(false);

    const st = world([...base, "cast: Kendra Young@left", "know Joss: The chandlery burned down in the storm | saw it · knows", "bond Joss>Kendra Young: affection 3 — old friends"]);
    const roster = buildRoster({ state: st, profiles: {}, lore: [{ name: "Kendra Young", text: "Kendra Young is a Slayer raised by her Watcher." }], notes: ["Kendra was Called and later killed by Drusilla."], userName: "Alex" });
    expect(roster.byName("Kendra Young")!.dead).toBe(true);
    const { ops } = spreadNews({ state: st, roster, hours: 500, rand: () => 0, tech: "modern", now: 0 });
    expect(ops.some((o) => o.subject === "Kendra Young")).toBe(false);
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

describe("who a thread names", () => {
  test("a whole, capitalised first name, not part of another word", () => {
    expect(threadNames("the Nordstrom-rack gesture, the green-blouse memory", "Rack")).toBe(false);
    expect(threadNames("Willow could lead her to Rack.", "Rack")).toBe(true);
    expect(threadNames("the photo Joyce caught laughing at something Dawn's friend said", "Dawn")).toBe(true);
    expect(threadNames("at dawn the house was quiet", "Dawn")).toBe(false);
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
  test("lets the model name what the card already says", () => {
    const giles = { ...card, lead: "Rupert Giles", cast: [], where: "England", premise: "Rupert Giles is thinking of coming back to Sunnydale.", result: "cost" as const };
    expect(validateTelling("In England, Giles booked a flight back to Sunnydale. The ticket cost more than he had.", giles, { userName: "Alex", places: [] })).toBeNull();
    expect(validateTelling("Giles called the Watchers Council. They stalled him.", giles, { userName: "Alex", places: [], known: ["Watchers Council"] })).toBeNull();
  });
  test("only story-changing problems keep the engine's words", () => {
    expect(softProblem(validateTelling("Edda met Gregor at the station.", card, { userName: "Alex", places: [] })!)).toBe(true);
    expect(softProblem(validateTelling("Edda called and Alex decided to meet her.", card, { userName: "Alex", places: [] })!)).toBe(false);
    expect(softProblem(validateTelling("Edda managed to get on the train after all.", card, { userName: "Alex", places: [] })!)).toBe(false);
  });
  test("a second try says what went wrong", () => {
    const misses = new Map([["c", { text: "Edda met Gregor.", problem: 'named someone or somewhere not on the card ("Gregor")' }]]);
    const { user } = retellPrompt([card, { ...card, id: "d" }], misses, { userName: "Alex", truths: [], genres: [] });
    expect(user).toContain('CARD c: your telling "Edda met Gregor." was turned back');
    expect(user).toContain("CARD d: you left it out");
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

describe("what the lore says is happening now", () => {
  const situations = [
    { key: "hellions raid port ellis", title: "Hellions Raid Port Ellis", text: "The Hellions are raiding Port Ellis. Fires burn in the streets." },
    { key: "edda protects joss", title: "Edda Protects Joss", text: "Edda keeps Joss out of sight." },
    { key: "mira believes the storm is over", title: "Mira Believes the Storm Is Over", text: "Mira thinks the worst has passed." },
  ];
  test("a CURRENT situation starts at once, led by whoever its title names", () => {
    const st = world(base);
    const inp = input(st, { seeding: "ask", situations });
    const cands = situationCands(inp);
    const raid = cands.find((c) => c.grounds[0] === "current:hellions raid port ellis")!;
    expect(raid.kind).toBe("threat");
    expect(raid.lead).toBe("faction:hellions");
    const guard = cands.find((c) => c.grounds[0] === "current:edda protects joss")!;
    expect(guard.kind).toBe("protect");
    expect(guard.leadName).toBe("Edda");
    expect(guard.target).toBe(inp.roster.byName("Joss")!.id);
    // Mira is in the scene: that one is the scene's to play.
    expect(cands.some((c) => c.leadName === "Mira")).toBe(false);

    const res = tick(inp);
    const started = res.sim.filter((o) => o.type === "arc.new").map((o) => (o as { arc: { grounds: string[]; status: string } }).arc);
    expect(started.some((a) => a.grounds.includes("current:hellions raid port ellis") && a.status === "running")).toBe(true);
    // Once it's running it doesn't start again.
    advance(st, res);
    expect(situationCands(input(st, { situations })).some((c) => c.grounds[0] === "current:hellions raid port ellis")).toBe(false);
  });
});

describe("names, places and climate", () => {
  test("the story's short name and the lore's full name are one person", () => {
    expect(samePerson("Willow", "Willow Rosenberg")).toBe(true);
    expect(samePerson("Willow Rosenberg", "willow")).toBe(true);
    expect(samePerson("Willow", "Tara Maclay")).toBe(false);
    expect(samePerson("Rosenberg", "Willow Rosenberg")).toBe(false);
    const st = world(base);
    const r = buildRoster({ state: st, profiles: {}, lore: [{ name: "Joss Harlan", text: "Joss Harlan is a dockhand. He wants to buy his own boat." }], userName: "Alex" });
    expect([...r.actors.values()].filter((a) => a.name.startsWith("Joss"))).toHaveLength(1);
    expect(r.byName("Joss")!.text).toContain("dockhand");
  });

  test("far places in someone's past don't send them away", () => {
    expect(readStanding("arc(killed Slayers in China in 1900 and New York in 1977; chipped in 1999)", "Spike").standing).toBeUndefined();
    expect(readStanding("nickname(Ripper - his wild London youth)", "Rupert Giles").standing).toBeUndefined();
    expect(readStanding("Quentin Travers is the head of the Watchers Council in London.", "Quentin Travers").standing).toBe("away");
    expect(readStanding("location(abroad in Spain)", "Hank Summers").standing).toBe("away");
  });

  test("a year isn't a latitude; a named place sets the climate", () => {
    expect(latitudeFrom("a Valley-girl flip, circa 2001")).toBe(45);
    expect(latitudeFrom("at latitude 34 N")).toBe(34);
    expect(latitudeFrom("51.5° N")).toBe(51.5);
    expect(latitudeFrom("34", { typed: true })).toBe(34);
    expect(placeClimate("The story begins in Sunnydale in October 2001. Giles has flown back to England. Sunnydale burns.")).toEqual({ climate: "mediterranean", latitude: 34 });
    expect(placeClimate("A ship somewhere at sea.")).toBeNull();
  });
});
