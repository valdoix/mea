import { describe, expect, test } from "bun:test";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { placeLine } from "../src/trackers/belongings";
import { STARTER_TEMPLATES } from "../src/trackers/schema";
import { bracketGroup, familySurname, isGroupShape, looksLikePlace } from "../src/trackers/whois";

/**
 * docs/30 Part 0: only people become people. The lines are this story's own (Filed Under Forever,
 * The Word in Her Throat), as the tracker and the engine wrote them.
 */

const cfg = (over: Partial<FoldConfig> = {}): FoldConfig => ({
  userName: "Gabriel Winters",
  mainName: "Buffy Summers",
  sealedPersona: true,
  romance: "slow",
  strictness: "lenient",
  limits: true,
  templates: STARTER_TEMPLATES,
  factions: [
    { name: "Scoobies", members: ["Willow", "Xander", "Anya", "Tara"] },
    { name: "Winters Family", members: ["Gabriel Winters", "Eleanor Winters"] },
    { name: "The Hellions", members: [] },
  ],
  ...over,
});

let n = 0;
function events(messages: string[][], source: TrackerEvent["source"] = "model"): TrackerEvent[] {
  return messages.flatMap((lines, i) => lines.map((l) => ({ id: `e${++n}`, messageId: `m${i + 1}`, seq: i + 1, source, op: parseLine(l)! })));
}
const names = (r: ReturnType<typeof foldEvents>) => Object.values(r.state.chars).map((c) => c.name).sort();
const opening = ["cast: Buffy Summers@spot · Dawn@spot · Spike@spot", "cast: Willow@off · Xander@off · Anya@off · Tara@off"];

describe("only people become people (docs/30 0.2)", () => {
  test("a room line about a place is a note on the place, and nobody owns it", () => {
    const r = foldEvents(
      events([
        [...opening, "at: Sunnydale › Winters Residence › downstairs kitchen"],
        ["room downstairs kitchen: fridge bears league standings in marker (BRONGEL 5 · THE FIELD 0, SPIKE 0, DAWN 0, target drawn)"],
        ["room downstairs kitchen: fridge archive now standings + target + steak photo + Spike photo (lemon magnet) | room"],
      ]),
      cfg(),
    );
    expect(names(r)).not.toContain("downstairs kitchen");
    expect(names(r)).not.toContain("Downstairs Kitchen");
    const kitchen = Object.values(r.state.places).find((p) => p.name === "downstairs kitchen")!;
    expect(kitchen.owner).toBeUndefined();
    expect(kitchen.notes!.map((x) => x.text)).toEqual([
      "fridge bears league standings in marker (BRONGEL 5 · THE FIELD 0, SPIKE 0, DAWN 0, target drawn)",
      "fridge archive now standings + target + steak photo + Spike photo (lemon magnet)",
    ]);
    expect(r.state.notPeople!["downstairs kitchen"]!.as).toBe("place");
    expect(placeLine(r.state)).toStartWith("HERE: downstairs kitchen: fridge archive now standings");
  });

  test("a room line about a place before the story has been there", () => {
    const r = foldEvents(events([[...opening, "room Downstairs Kitchen: living room dartboard wall now bears a permanent dart nick in the paint, kept by Buffy"]]), cfg());
    expect(names(r)).not.toContain("Downstairs Kitchen");
    expect(Object.values(r.state.places).find((p) => p.name === "Downstairs Kitchen")!.notes).toHaveLength(1);
  });

  test("a room line with a path and what it's like describes the place at the path", () => {
    const r = foldEvents(
      events([
        ["cast: Riley@spot", "at: Canadian wilderness › clearing › cabin"],
        ["room Cabin: Canadian wilderness › clearing › cabin (abandoned, single-room, log walls, corrugated metal roof, intact)"],
        ["room Cabin: Canadian wilderness › clearing › cabin — woodstove lit, fire going, warming"],
      ]),
      cfg({ factions: [] }),
    );
    expect(names(r)).not.toContain("Cabin");
    const cabin = Object.values(r.state.places).find((p) => p.name === "cabin")!;
    expect(cabin.notes!.map((x) => x.text)).toEqual(["abandoned, single-room, log walls, corrugated metal roof, intact", "woodstove lit, fire going, warming"]);
  });

  test("a room line that says whose room it is still works", () => {
    const r = foldEvents(events([[...opening, "room Dawn: Sunnydale › Summers Residence › Dawn's bedroom | room"]]), cfg());
    expect(Object.values(r.state.places).find((p) => p.name === "Dawn's bedroom")!.owner).toBe("dawn");
  });

  test("a faction's line is each member's, heard via the faction; the faction is nobody", () => {
    const r = foldEvents(events([opening, ["know Scoobies: #arc-loss-faction-scoobies-1 Buffy came back wrong | lived it · knows"]], "engine"), cfg());
    expect(names(r)).not.toContain("Scoobies");
    const f = Object.values(r.state.facts).find((x) => x.statement.includes("Buffy came back wrong"))!;
    expect(Object.keys(f.stances).sort()).toEqual(["anya", "tara", "willow", "xander"]);
    expect(f.stances.willow!.route).toContain("via the Scoobies");
    expect(r.state.notPeople!.scoobies!.members).toEqual(["Willow", "Xander", "Anya", "Tara"]);
  });

  test("a faction with no members known takes the line nowhere, and says so", () => {
    const r = foldEvents(events([opening, ["know Hellions: #arc-threat-faction-hellions-1 the Hellions are hunting Spike | lived it · knows"]], "user"), cfg());
    expect(names(r)).not.toContain("Hellions");
    expect(r.state.notPeople!["the hellions"]!.as).toBe("faction");
  });

  test("a group with its people in brackets is those people", () => {
    const r = foldEvents(events([opening, ["know Dawn's friends (Melissa, Kara, Jamie): Buffy Summers is alive and with the tall blond — saw her at pickup · true"]]), cfg());
    expect(names(r)).not.toContain("Dawn's friends");
    expect(names(r)).toEqual(expect.arrayContaining(["Melissa", "Kara", "Jamie"]));
    const f = Object.values(r.state.facts).find((x) => x.statement.includes("Buffy Summers is alive"))!;
    expect(Object.keys(f.stances).sort()).toEqual(["jamie", "kara", "melissa"]);
    expect(r.state.notPeople!["dawn's friends"]).toMatchObject({ as: "group", members: ["Melissa", "Kara", "Jamie"] });
  });

  test("a group with no one named is nobody", () => {
    const r = foldEvents(events([opening, ["know household: Gabriel invests in Sturgeon AquaFarms, Florida, five free jars a month | he said so at lunch · knows · true"]]), cfg());
    expect(names(r)).not.toContain("household");
    expect(r.verdicts[Object.keys(r.verdicts).at(-1)!]!.reason).toContain("household is a group");
  });

  test("'the Summerses' is everyone with that surname", () => {
    const r = foldEvents(events([["cast: Buffy Summers@spot · Dawn Summers@spot · Spike@spot"], ["know the Summerses: the house on Revello is paid off — mom's will · knows"]]), cfg());
    const f = Object.values(r.state.facts).find((x) => x.statement.includes("Revello"))!;
    expect(Object.keys(f.stances).sort()).toEqual(["buffy-summers", "dawn-summers"]);
  });

  test("'everyone in scene' is the people present", () => {
    const r = foldEvents(events([["cast: Buffy Summers@spot · Dawn@spot"], ["know everyone in scene: Walter (the Council) must not learn Buffy is alive — Buffy's order"]]), cfg());
    expect(names(r)).not.toContain("everyone in scene");
    const f = Object.values(r.state.facts).find((x) => x.statement.includes("Walter"))!;
    expect(Object.keys(f.stances)).toContain("dawn");
  });

  test("a list with middots is each of them (docs/30 0.3)", () => {
    const r = foldEvents(events([opening, ["know Xander Harris · Willow Rosenberg · Tara Maclay · Anya Jenkins: Buffy is back | saw her · knows"]]), cfg());
    expect(names(r).some((x) => x.includes("·"))).toBe(false);
    const f = Object.values(r.state.facts).find((x) => x.statement === "Buffy is back")!;
    expect(Object.keys(f.stances)).toHaveLength(4);
  });

  test("'traits' is never a person, and 'cast X: traits — …' is X's trait", () => {
    const r = foldEvents(events([["cast: Gabriel Winters@spot · Buffy Summers@spot · Dawn@spot · traits@spot · Ruth@arrive"], ["cast Dawn Summers: traits — walks fast when eager; armor comes up fast over unguarded moments"]]), cfg());
    expect(names(r)).not.toContain("traits");
    expect(r.state.chars.dawn!.traits.map((t) => t.text)).toEqual(expect.arrayContaining(["walks fast when eager", "armor comes up fast over unguarded moments"]));
  });

  test("a faction's name in a cast line brings in its members", () => {
    const r = foldEvents(events([["cast: Buffy Summers@spot · Scoobies@spot"]]), cfg());
    expect(names(r)).not.toContain("Scoobies");
    expect(r.state.chars.willow!.tier).toBe("spot");
  });

  test("a name you said is a person stays one", () => {
    const r = foldEvents(events([opening, ["mood Household: wary — the new guy"]]), cfg({ people: ["Household"] }));
    expect(names(r)).toContain("Household");
  });

  test("someone already in the cast is never taken for a group or a place", () => {
    const r = foldEvents(events([["cast: Team@spot"], ["mood Team: proud — won"]]), cfg({ people: ["Team"] }));
    expect(r.state.chars.team!.mood!.name).toBe("proud");
  });
});

describe("telling names apart (docs/30 0.2)", () => {
  test("group shapes", () => {
    for (const g of ["Dawn's friends", "the household", "household", "the Winters family", "her parents", "the whole crew", "Dawn’s friends"]) expect(isGroupShape(g)).toBe(true);
    for (const p of ["Dawn", "Gabriel Winters", "Kara", "Mister Pointy", "Spike"]) expect(isGroupShape(p)).toBe(false);
  });
  test("families by surname", () => {
    expect(familySurname("the Summerses")).toContain("summers");
    expect(familySurname("the Winters")).toContain("winters");
    expect(familySurname("Winters family")).toEqual(["winters"]);
    expect(familySurname("Spike")).toEqual([]);
  });
  test("brackets", () => {
    expect(bracketGroup("Dawn's friends (Melissa, Kara, Jamie)", isGroupShape)).toEqual({ group: "Dawn's friends", names: ["Melissa", "Kara", "Jamie"] });
    expect(bracketGroup("Gabriel (on the phone)", isGroupShape)).toBeNull();
  });
  test("places", () => {
    for (const p of ["Downstairs Kitchen", "Buffy's bedroom", "basement pool", "Sunnydale › Winters Residence"]) expect(looksLikePlace(p)).toBe(true);
    // Words that are also surnames aren't place words.
    for (const p of ["Gregory House", "Arsenio Hall", "Lois Lane", "Kitchen", "Dawn"]) expect(looksLikePlace(p)).toBe(false);
  });
  test("place lines parse; 'place: X' is still a move", () => {
    const p = parseLine("place Kitchen › Fridge door: league standings in marker — Buffy wrote it")!;
    expect(p).toMatchObject({ op: "place", args: { path: ["Kitchen", "Fridge door"], text: "league standings in marker" }, cause: "Buffy wrote it" });
    expect(parseLine("place: Sunnydale › Bronze")!.op).toBe("at");
  });
});
