import { describe, expect, test } from "bun:test";
import { buildRoster } from "../src/sim/roster";
import { reactionsTo, sparkFrom, threadPulls } from "../src/sim/ripples";
import { forcedStep, tick, type TickInput } from "../src/sim/storyteller";
import { tellingPrompt } from "../src/sim/telling";
import type { Arc, Beat } from "../src/sim/types";
import { bearingsOn, webMod } from "../src/sim/web";
import { parseLine } from "../src/trackers/dsl";
import { foldEvents, type FoldConfig } from "../src/trackers/fold";
import type { WorldState } from "../src/trackers/types";

const cfg: FoldConfig = { userName: "Alex", mainName: "Mira", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: [] };

function world(): WorldState {
  const lines = [
    "clock: Day 1 20:00",
    "at: Port Ellis › Lighthouse › Lamp room",
    "cast: Mira@spot · Alex@spot",
    "cast: Joss@left(→ Port Ellis › Harbour)",
    "cast: Edda@left(→ Port Ellis › Infirmary)",
    "cast: Kai@left(→ Port Ellis › Docks)",
    "thread Lost locket: new — Mira lost her mother's locket",
  ];
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

/** Joss's revenge on Edda is near its crisis; Kai protects Edda; Edda has her own story. */
function setup() {
  const st = world();
  const now = st.time!.minutes;
  const r = input(st).roster;
  const [joss, edda, kai] = ["Joss", "Edda", "Kai"].map((n) => r.byName(n)!);
  st.sim.arcs.revenge = arc({ id: "revenge", kind: "revenge", lead: joss!.id, leadName: "Joss", cast: [edda!.id], target: edda!.id, want: "to make Edda pay", secrecy: "public", clock: { cur: 4, max: 6 }, beats: [beat(now - 60, "win", "Joss asked about Edda at the infirmary.")] });
  st.sim.arcs.guard = arc({ id: "guard", kind: "protect", lead: kai!.id, leadName: "Kai", cast: [edda!.id], target: edda!.id, want: "to keep Edda safe", beats: [beat(now - 600, "cost", "Kai walked Edda home.")] });
  st.sim.arcs.hers = arc({ id: "hers", kind: "pursuit", lead: edda!.id, leadName: "Edda", want: "to keep her post at the infirmary", beats: [beat(now - 600, "cost", "Edda worked a double shift.")] });
  return { st, now, joss: joss!, edda: edda!, kai: kai! };
}

describe("subplots ripple into each other", () => {
  test("two subplots aimed at the same person pull on each other's dice", () => {
    const { st, now } = setup();
    const r = input(st).roster;
    const bs = bearingsOn(st.sim.arcs.guard!, Object.values(st.sim.arcs), r, now);
    expect(bs[0]).toMatchObject({ arc: "revenge", dir: "target", stance: "against", person: "Edda", helped: false, mod: -1 });
    expect(webMod(bs).why).toEqual(["tied: Joss's revenge hurt Edda"]);
    // A secret revenge reaches no one outside it.
    st.sim.arcs.revenge!.secrecy = "secret";
    expect(bearingsOn(st.sim.arcs.guard!, Object.values(st.sim.arcs), r, now).filter((b) => b.arc === "revenge")).toEqual([]);
  });

  test("an outcome can settle another subplot outright", () => {
    const { st, now } = setup();
    const r = input(st).roster;
    const from = st.sim.arcs.revenge!;
    const ev = { arc: from.id, lead: from.lead, leadName: "Joss", kind: from.kind, result: "met", text: "In the end, Joss made Edda pay.", at: now, ending: true };
    const res = reactionsTo({ from, ev, stage: "climax", depth: 0 }, Object.values(st.sim.arcs), r, new Set());
    expect(res.find((x) => x.arc.id === "guard")).toMatchObject({ act: "end", result: "lost" });
    expect(res.find((x) => x.arc.id === "hers")).toMatchObject({ act: "answer", why: "answering Joss's revenge" });
    // A step that isn't decisive doesn't spread (the dice pulls still carry it).
    expect(reactionsTo({ from, ev: { ...ev, result: "cost", ending: false }, stage: "rising", depth: 0 }, Object.values(st.sim.arcs), r, new Set())).toEqual([]);
  });

  test("a decisive step makes a linked subplot answer it at once, and its card says so", () => {
    let answered = false;
    for (let i = 0; i < 40 && !answered; i++) {
      const { st } = setup();
      st.time = { minutes: st.time!.minutes + i, form: "day" };
      delete st.sim.arcs.guard;
      st.sim.arcs.revenge!.force = "win";
      const res = forcedStep(input(st), "revenge");
      const theirs = res.sim.find((o) => o.type === "arc.beat" && o.id === "hers");
      if (theirs?.type !== "arc.beat") {
        // Not at once: soon.
        const soon = res.sim.find((o) => o.type === "arc.set" && o.id === "hers");
        expect(soon?.type === "arc.set" && soon.patch.nextAt! <= st.time.minutes + 120).toBe(true);
        continue;
      }
      answered = true;
      expect(theirs.beat.answers).toBe("Joss's revenge");
      expect(theirs.beat.text).toStartWith("In the wake of Joss's revenge");
      const card = res.cards.find((c) => c.arc === "hers")!;
      expect(card.answers).toStartWith("Joss's revenge: ");
      expect(card.names).toContain("Joss");
      expect(tellingPrompt([card], { userName: "Alex", truths: [], genres: [] }).user).toContain("ANSWERS Joss's revenge");
      expect(res.summary.some((s) => s.includes("answering Joss's revenge"))).toBe(true);
    }
    expect(answered).toBe(true);
  });

  test("harm done to someone starts a subplot in someone close to them", () => {
    const { st, now, edda, kai } = setup();
    delete st.sim.arcs.guard;
    const r = input(st).roster;
    r.actors.get(kai.id)!.ties.set(edda.id, 3);
    r.actors.get(kai.id)!.tieKind.set(edda.id, { type: "close", inTouch: true, by: "story", why: "test" });
    const from = st.sim.arcs.revenge!;
    const ev = { arc: from.id, lead: from.lead, leadName: "Joss", kind: from.kind, result: "win", text: "Joss struck at Edda.", at: now };
    const c = sparkFrom({ from, ev, stage: "crisis", depth: 0 }, Object.values(st.sim.arcs), r, new Set());
    expect(c).toMatchObject({ kind: "protect", lead: kai.id, target: edda.id, grounds: ["arc:revenge"] });
    // When it ends, they want it answered.
    const end = sparkFrom({ from, ev: { ...ev, result: "met", ending: true }, stage: "climax", depth: 0 }, Object.values(st.sim.arcs), r, new Set());
    expect(end).toMatchObject({ kind: "revenge", lead: kai.id, target: from.lead });
    // Not if they turned it down before.
    expect(sparkFrom({ from, ev, stage: "crisis", depth: 0 }, Object.values(st.sim.arcs), r, new Set([`${kai.id}|protect|arc:revenge`]))).toBeNull();
  });
});

describe("plot threads and subplots move each other", () => {
  test("a subplot's decisive step advances or complicates its thread", () => {
    const { st } = setup();
    const tid = Object.keys(st.threads)[0]!;
    st.sim.arcs.revenge!.grounds = [`thread:${tid}`];
    st.sim.arcs.revenge!.force = "loss";
    const res = forcedStep(input(st), "revenge");
    const op = res.ledger.find((o) => o.op === "thread");
    expect(op?.subject).toBe("Lost locket");
    expect(op?.args.action).toBe("complicate");
    expect(String(op?.args.detail)).toStartWith("Off the page (Joss's revenge): ");
  });

  test("a thread moving on the page turns the subplots about it, and they answer now", () => {
    const { st, now } = setup();
    const tid = Object.keys(st.threads)[0]!;
    const t = st.threads[tid]!;
    st.sim.arcs.hers = { ...st.sim.arcs.hers!, grounds: [`thread:${tid}`], nextAt: now + 5000 };
    delete st.sim.arcs.revenge;
    delete st.sim.arcs.guard;
    // Its own words on the thread don't count; someone else's do.
    t.history.push({ op: "advance", detail: "Off the page (Edda's pursuit): Edda found a clue.", seq: 5 });
    t.lastSeq = 5;
    expect(threadPulls([st.sim.arcs.hers], st)).toEqual([{ arc: st.sim.arcs.hers, mod: 0, due: false, why: "", seen: 5 }]);
    t.history.push({ op: "complicate", detail: "The locket was seen at the pawnshop.", seq: 6 });
    t.lastSeq = 6;
    expect(threadPulls([st.sim.arcs.hers], st)[0]).toMatchObject({ mod: -1, due: true, why: 'the thread "Lost locket" got harder' });
    const inp = input(st, { from: now - 60 });
    inp.recent = new Set(["Edda"]);
    const res = tick(inp);
    const b = res.sim.find((o) => o.type === "arc.beat" && o.id === "hers");
    expect(b?.type === "arc.beat" && b.beat.why).toContain('the thread "Lost locket" got harder');
    expect(b?.type === "arc.beat" && b.beat.answers).toBe('the thread "Lost locket"');
    expect(res.cards.find((c) => c.arc === "hers")?.answers).toContain("pawnshop");
    const seen = res.sim.find((o) => o.type === "arc.set" && o.id === "hers" && o.patch.threadSeen != null);
    expect(seen?.type === "arc.set" && seen.patch.threadSeen).toBe(6);
  });

  test("a thread settled on the page ends an engine subplot that had barely begun", () => {
    const { st } = setup();
    const tid = Object.keys(st.threads)[0]!;
    const t = st.threads[tid]!;
    const a = { ...st.sim.arcs.hers!, grounds: [`thread:${tid}`], by: "engine" as const, stage: "hook" as const };
    t.history.push({ op: "resolve", detail: "Mira got it back.", seq: 6 });
    t.lastSeq = 6;
    t.status = "resolved";
    expect(threadPulls([a], st)[0]).toMatchObject({ drop: true });
  });
});
