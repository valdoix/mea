import { describe, expect, test } from "bun:test";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { namesLine, stateForModel } from "../src/trackers/prompts";
import { STARTER_TEMPLATES } from "../src/trackers/schema";

/** docs/32 Part 2: the tracker is shown the names it must use, and a subplot keeps up with its lead's name. */

const cfg: FoldConfig = { userName: "Gabriel Winters", mainName: "Buffy Summers", sealedPersona: false, romance: "slow", strictness: "lenient", limits: true, templates: STARTER_TEMPLATES };
let n = 0;
const ev = (line: string, seq: number, source: TrackerEvent["source"] = "model"): TrackerEvent => ({ id: `x${++n}`, messageId: `m${seq}`, seq, source, op: parseLine(line)! });
const proposal = (lead: string, leadName: string, seq: number): TrackerEvent => ({
  id: `x${++n}`,
  messageId: `m${seq}`,
  seq,
  source: "engine",
  op: { op: "sim", args: { type: "proposal.new", proposal: { id: `p:${lead}`, key: `${lead}|pursuit|t`, kind: "pursuit", lead, leadName, cast: ["buffy-summers"], premise: "", want: "", fear: "", grounds: [], secrecy: "open", why: "", at: 0 } }, raw: "" } as never,
});

describe("the names line (docs/32 2.1)", () => {
  const r = foldEvents(
    [
      ev("cast: Buffy Summers@spot · Gabriel Winters@spot", 1),
      ...["Dawn", "Spike", "Walter Clark", "Eleanor Winters", "Willow", "Xander", "Tara", "Anya", "Giles", "Chloe", "Marco"].map((p, i) => ev(`cast: ${p}@left`, 2 + i)),
      ev("cast: the bartender@peri", 20),
      ev("dead Marco — the fall", 21),
    ],
    cfg,
  );

  test("everyone living by their exact name: you and the main character first, then the most recently seen", () => {
    const line = namesLine(r.state, "Gabriel Winters");
    expect(line.startsWith("names (write each person exactly as here): Gabriel Winters, Buffy Summers, Chloe, Giles, Anya")).toBe(true);
    // More people than "known, not here" lists (its last eight).
    for (const p of ["Dawn", "Spike", "Walter Clark", "Eleanor Winters"]) expect(line).toContain(p);
    expect(line).not.toContain("bartender");
    expect(line).not.toContain("Marco");
  });

  test("it's in what the tracker and the inline ledger are shown, and stays short in a big cast", () => {
    expect(stateForModel(r.state, { userName: "Gabriel Winters", templates: [], sealed: true })).toContain("names (write each person exactly as here): Gabriel Winters, Buffy Summers");
    const crowd = foldEvents([ev("cast: Buffy Summers@spot", 1), ...Array.from({ length: 80 }, (_, i) => ev(`cast: Person${String.fromCharCode(65 + (i % 26))}${"x".repeat(i % 7)} Number${i}@left`, 2 + i))], cfg);
    expect(namesLine(crowd.state, "Gabriel Winters").length).toBeLessThan(430);
  });

  test("two people or fewer need no list", () => {
    expect(namesLine(foldEvents([ev("clock: +2m", 1)], { ...cfg, mainName: "" }).state, "Gabriel Winters")).toBe("");
  });
});

describe("a subplot keeps its lead's name (docs/32 2.3)", () => {
  test("after a merge, it's the kept person's, and they aren't in their own cast", () => {
    const r = foldEvents(
      [ev("cast: Buffy Summers@spot · Gabriel Winters@spot · Gabe Summers@peri", 1), proposal("gabe-summers", "Gabe Summers", 2), ev("merge Gabe Summers → Gabriel Winters", 3, "user")],
      { ...cfg, people: ["Gabe Summers"] },
    );
    const p = Object.values(r.state.sim.proposals)[0]!;
    expect([p.lead, p.leadName]).toEqual(["user", "Gabriel Winters"]);
    expect(Object.keys(r.state.chars)).not.toContain("gabe-summers");
  });

  test("after a rename, it's told under the new name", () => {
    const r = foldEvents([ev("cast: Buffy Summers@spot · Dawn@peri", 1), proposal("dawn", "Dawn", 2), ev("rename Dawn: Dawn → Dawn Summers", 3)], cfg);
    expect(Object.values(r.state.sim.proposals)[0]!.leadName).toBe("Dawn Summers");
  });
});
