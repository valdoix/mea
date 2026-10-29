import { describe, expect, test } from "bun:test";
import { canLead, reach } from "../src/sim/reach";
import { buildRoster, type Tie } from "../src/sim/roster";
import { parseLine } from "../src/trackers/dsl";
import { foldEvents, type FoldConfig } from "../src/trackers/fold";
import type { Fact } from "../src/trackers/types";

/** docs/21 Part 4: one gate for who can act off the page and whom they can reach, with its reasons. */
const cfg: FoldConfig = { userName: "Alex", mainName: "Mira", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: [] };
const world = (lines: string[]) => foldEvents(lines.map((l, i) => ({ id: `e${i}`, messageId: "m1", seq: 1, source: "init" as const, op: parseLine(l)! })), cfg).state;
const base = ["clock: Day 1 20:00", "at: Port Ellis › Lighthouse › Lamp room", "cast: Mira@spot · Alex@spot", "cast: Joss@left(→ Port Ellis › Harbour) · Kit@left(→ Port Ellis › Market) · Dru@left · Bea@left"];

function setup() {
  const r = buildRoster({ state: world(base), profiles: {}, lore: [], userName: "Alex" });
  const p = (n: string) => r.byName(n)!;
  const tie = (a: string, b: string, t: Partial<Tie>) => {
    const full = { type: "friend", inTouch: true, by: "story", why: "test", ...t } as Tie;
    p(a).tieKind.set(p(b).id, full);
    p(b).tieKind.set(p(a).id, full);
  };
  return { r, p, tie };
}
const fact = (o: Partial<Fact> = {}): Fact => ({ key: "k", statement: "The chandlery burned down", truth: "true", stances: {}, revealed: [], firstSeq: 1, lastSeq: 1, ...o });

describe("canLead", () => {
  test("only someone who can act, off the page, and not on hold leads", () => {
    const { p } = setup();
    expect(canLead(p("Joss")).ok).toBe(true);
    expect(canLead(p("Mira")).why).toEqual(["Mira is in the scene"]);
    expect(canLead(p("Alex")).why).toEqual(["you act on the page"]);
    p("Kit").flag = "hold";
    expect(canLead(p("Kit")).ok).toBe(false);
    p("Dru").dead = true;
    expect(canLead(p("Dru")).why).toEqual(["Dru is dead"]);
    expect(canLead(undefined).ok).toBe(false);
  });
});

describe("reach: news", () => {
  test("in person only when both are placed near; by phone otherwise, and never without a way", () => {
    const { p, tie } = setup();
    tie("Joss", "Kit", {});
    expect(reach(p("Joss"), p("Kit"), "news", { tech: "modern" })).toMatchObject({ ok: true, medium: "in person", c: 0.6 });
    tie("Joss", "Bea", {});
    expect(reach(p("Joss"), p("Bea"), "news", { tech: "modern" })).toMatchObject({ ok: true, medium: "by phone" });
    const none = reach(p("Joss"), p("Bea"), "news", { tech: "fantasy" });
    expect(none.ok).toBe(false);
    expect(none.why[0]).toContain("not known where Bea is");
    // Joss's place is known, so a letter can reach him.
    expect(reach(p("Bea"), p("Joss"), "news", { tech: "fantasy" })).toMatchObject({ ok: true, medium: "by letter" });
  });

  test("ties that don't talk, or aren't in touch, carry nothing", () => {
    const { p, tie } = setup();
    tie("Joss", "Dru", { type: "past", inTouch: false });
    expect(reach(p("Joss"), p("Dru"), "news", { tech: "modern" }).ok).toBe(false);
    tie("Joss", "Kit", { type: "close", inTouch: false });
    expect(reach(p("Joss"), p("Kit"), "news", { tech: "modern" }).why[0]).toContain("not in touch");
    tie("Joss", "Bea", { type: "knowsOf", inTouch: false });
    expect(reach(p("Joss"), p("Bea"), "news", { tech: "modern" }).why[0]).toContain("doesn't pass news on");
  });

  test("the leads, the scene, secrets, and news about strangers", () => {
    const { p, tie } = setup();
    tie("Joss", "Kit", {});
    tie("Joss", "Mira", {});
    expect(reach(p("Joss"), p("Mira"), "news", { tech: "modern" }).why[0]).toContain("main character");
    expect(reach(p("Joss"), p("Kit"), "news", { tech: "modern", fact: fact({ secret: { keepers: [p("Joss").id], from: [] } }) }).why).toEqual(["Joss keeps it secret"]);
    expect(reach(p("Joss"), p("Kit"), "news", { tech: "modern", fact: fact(), about: [p("Alex")] }).ok).toBe(false);
    expect(reach(p("Joss"), p("Kit"), "news", { tech: "modern", fact: fact(), about: [p("Bea")] }).why).toEqual(["Kit doesn't know Bea"]);
  });
});

describe("reach: subplots", () => {
  test("pulled into a subplot: close, friend or enemy, not someone known of or long ago", () => {
    const { p, tie } = setup();
    tie("Joss", "Kit", { type: "enemy", inTouch: false });
    expect(reach(p("Joss"), p("Kit"), "meet").ok).toBe(true);
    tie("Joss", "Bea", { type: "past", inTouch: false });
    expect(reach(p("Joss"), p("Bea"), "meet").ok).toBe(false);
  });

  test("acting for someone: never for an enemy, never from the scene", () => {
    const { p, tie } = setup();
    tie("Kit", "Joss", { type: "enemy" });
    expect(reach(p("Kit"), p("Joss"), "ripple").why[0]).toContain("wouldn't act for them");
    tie("Kit", "Joss", { type: "close" });
    expect(reach(p("Kit"), p("Joss"), "ripple").ok).toBe(true);
    tie("Mira", "Joss", { type: "close" });
    expect(reach(p("Mira"), p("Joss"), "ripple").ok).toBe(false);
  });
});
