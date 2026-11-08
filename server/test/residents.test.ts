import { describe, expect, test } from "bun:test";
import { belongingsOf } from "../src/trackers/belongings";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { STARTER_TEMPLATES } from "../src/trackers/schema";

/**
 * docs/30 2.4: owners and residents. Who lives at a home, and "household" as whoever lives there now.
 * Lines are this story's (Filed Under Forever) or written the way its tracker writes them.
 */

const cfg = (over: Partial<FoldConfig> = {}): FoldConfig => ({
  userName: "Gabriel Winters",
  mainName: "Buffy Summers",
  sealedPersona: true,
  romance: "slow",
  strictness: "lenient",
  limits: true,
  templates: STARTER_TEMPLATES,
  ...over,
});

let n = 0;
function events(messages: string[][]): TrackerEvent[] {
  return messages.flatMap((lines, i) => lines.map((l) => ({ id: `r${++n}`, messageId: `m${i + 1}`, seq: i + 1, source: "model" as const, op: parseLine(l)! })));
}
const fold = (messages: string[][], over: Partial<FoldConfig> = {}) => foldEvents(events(messages), cfg(over));
const id = (r: ReturnType<typeof foldEvents>, name: string) => Object.values(r.state.chars).find((c) => c.name === name)?.id;
const home = (r: ReturnType<typeof foldEvents>, name: string) => Object.values(r.state.places).find((p) => p.name === name);
const residents = (r: ReturnType<typeof foldEvents>, name: string) => (home(r, name)?.residents ?? []).map((x) => r.state.chars[x]?.name);
const knows = (r: ReturnType<typeof foldEvents>, who: string, text: string) => {
  const c = id(r, who);
  const f = Object.values(r.state.facts).find((x) => x.statement.includes(text));
  return c && f ? f.stances[c] : undefined;
};

const opening = ["at: Sunnydale › Winters Residence › Kitchen", "cast: Buffy Summers@spot · Dawn Summers@spot · Gabriel Winters@spot"];

describe("lives lines (docs/30 2.4)", () => {
  test("parses, with a move out", () => {
    expect(parseLine("lives Dawn Summers: Sunnydale › Winters Residence — moved in after the funeral")).toMatchObject({ op: "lives", subject: "Dawn Summers", args: { path: ["Sunnydale", "Winters Residence"], leave: false } });
    expect(parseLine("lives Anya: - Xander's apartment — left after the wedding")).toMatchObject({ op: "lives", args: { path: ["Xander's apartment"], leave: true } });
  });

  test("someone lives at the home, one home at a time, and can move out", () => {
    const r = fold([
      opening,
      ["lives Buffy Summers, Dawn Summers: Sunnydale › Winters Residence — moved in"],
      ["lives Dawn Summers: Sunnydale › Revello Drive › Summers Residence — back home"],
    ]);
    expect(residents(r, "Winters Residence")).toContain("Buffy Summers");
    expect(residents(r, "Winters Residence")).not.toContain("Dawn Summers");
    expect(residents(r, "Summers Residence")).toEqual(["Dawn Summers"]);
    const out = fold([opening, ["lives Buffy Summers: Sunnydale › Winters Residence"], ["lives Buffy Summers: - Winters Residence — she left"]]);
    expect(residents(out, "Winters Residence")).not.toContain("Buffy Summers");
  });

  test("a bedroom in a home: theirs, and they live in the home", () => {
    const r = fold([opening, ["lives Dawn Summers: Sunnydale › Winters Residence › Dawn's Bedroom"]]);
    expect(residents(r, "Winters Residence")).toEqual(["Dawn Summers"]);
    expect(home(r, "Dawn's Bedroom")?.owner).toBe(id(r, "Dawn Summers"));
  });

  test("evidence: a home named for someone, a room of their own in it, the lore's family Home", () => {
    const r = fold([
      ["at: Sunnydale › Gabriel's House › Kitchen", "cast: Gabriel Winters@spot · Buffy Summers@spot"],
      ["room Buffy Summers: Sunnydale › Gabriel's House › Buffy's Bedroom | bedroom"],
    ]);
    expect(residents(r, "Gabriel's House").sort()).toEqual(["Buffy Summers", "Gabriel Winters"]);
    const lore = fold([["at: Sunnydale › Winters Residence", "cast: Gabriel Winters@spot · Eleanor Winters@peri"]], {
      factions: [{ name: "The Winters Family", members: ["Gabriel Winters", "Eleanor Winters"], kind: "family", source: "lore", home: "Winters Residence" }],
    });
    expect(residents(lore, "Winters Residence").sort()).toEqual(["Eleanor Winters", "Gabriel Winters"]);
  });

  test("a lives line wins over evidence", () => {
    const r = fold([
      ["lives Gabriel Winters: Sunnydale › Winters Residence"],
      ["at: Sunnydale › Gabriel's Old Flat", "cast: Gabriel Winters@spot"],
    ]);
    expect(residents(r, "Winters Residence")).toEqual(["Gabriel Winters"]);
    expect(residents(r, "Gabriel's Old Flat")).toEqual([]);
  });
});

describe("household (docs/30 1.4 / 2.4)", () => {
  test("household in a line is whoever lives at the home in the scene", () => {
    const r = fold([
      opening,
      ["lives Gabriel Winters, Buffy Summers, Dawn Summers: Sunnydale › Winters Residence"],
      ["know household: Gabriel invests in Sturgeon AquaFarms | over breakfast · knows · true — he told them"],
    ]);
    for (const who of ["Buffy Summers", "Dawn Summers"]) expect(knows(r, who, "Sturgeon AquaFarms")).toBeTruthy();
    const names = Object.values(r.state.chars).map((c) => c.name);
    expect(names).not.toContain("household");
    const g = Object.values(r.state.groups ?? {}).find((x) => x.kind === "household")!;
    expect(g.name).toBe("Winters Residence household");
    expect(g.home).toBe(home(r, "Winters Residence")!.id);
    expect(g.adopted).toBe(true);
    expect(g.members).toEqual([]);
  });

  test("a household is a view: someone who moves in later is in it, someone who moved out isn't", () => {
    const r = fold([
      opening,
      ["lives Gabriel Winters, Buffy Summers: Sunnydale › Winters Residence"],
      ["know household: the wards are up | Gabriel told them · knows"],
      ["lives Dawn Summers: Sunnydale › Winters Residence", "lives Buffy Summers: - Winters Residence"],
      ["know the household: dinner is at seven | a note on the fridge · knows"],
    ]);
    expect(knows(r, "Dawn Summers", "dinner is at seven")).toBeTruthy();
    expect(knows(r, "Buffy Summers", "dinner is at seven")).toBeFalsy();
    expect(knows(r, "Buffy Summers", "wards are up")).toBeTruthy();
  });

  test("away from home it's the player's household; a named one is that home's", () => {
    const r = fold([
      ["at: Sunnydale › Revello Drive › Summers Residence › Kitchen", "cast: Buffy Summers@spot · Dawn Summers@spot · Gabriel Winters@spot"],
      ["lives Gabriel Winters, Eleanor Winters: Sunnydale › Winters Residence", "lives Dawn Summers: Sunnydale › Revello Drive › Summers Residence"],
      ["at: Sunnydale › The Bronze", "know household: the alarm code changed | Gabriel texted · knows"],
      ["know the Summers household: the roof leaks | Dawn said · knows"],
    ]);
    expect(knows(r, "Eleanor Winters", "alarm code")).toBeTruthy();
    expect(knows(r, "Dawn Summers", "alarm code")).toBeFalsy();
    expect(knows(r, "Dawn Summers", "roof leaks")).toBeTruthy();
  });

  test("nobody known to live there: the line says so, and nobody is made", () => {
    const r = fold([opening, ["know household: Gabriel invests in Sturgeon AquaFarms | at breakfast · knows"]]);
    expect(Object.values(r.state.chars).map((c) => c.name)).not.toContain("household");
  });
});

describe("the person sheet (docs/30 2.4)", () => {
  test("rooms and belongings lists what they own or live in, by the tree's names", () => {
    const r = fold([
      ["at: Sunnydale › Gabriel's House › Kitchen", "cast: Gabriel Winters@spot · Buffy Summers@spot"],
      ["at: Sunnydale › Winters Residence › Living room", "room Buffy Summers: Sunnydale › Winters Residence › Buffy's Bedroom | bedroom"],
    ]);
    const buffy = r.state.chars[id(r, "Buffy Summers")!]!;
    const rooms = belongingsOf(r.state, buffy).rooms;
    expect(rooms.map((x) => x.name).sort()).toEqual(["Buffy's Bedroom", "Winters Residence"]);
    expect(rooms.find((x) => x.name === "Winters Residence")).toMatchObject({ lives: true, mine: false });
  });
});
