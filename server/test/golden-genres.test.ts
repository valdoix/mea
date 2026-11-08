import { describe, expect, test } from "bun:test";
import { notPeopleNow, placesWithSeveralNames } from "../src/accuracy/casthealth";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { currentMembers } from "../src/trackers/groups";
import { STARTER_TEMPLATES } from "../src/trackers/schema";
import { passingFace } from "../src/trackers/whois";

/**
 * docs/30 4.1: golden scenarios written from scratch for other genres (a guild, a ship's crew, a royal
 * household), so the rules for people, groups and places aren't fitted to one story. No model calls.
 */

let n = 0;
const fold = (messages: string[][], over: Partial<FoldConfig> = {}) =>
  foldEvents(
    messages.flatMap((lines, i) => lines.map((l): TrackerEvent => ({ id: `g${++n}`, messageId: `m${i + 1}`, seq: i + 1, source: "model", op: parseLine(l)! }))),
    { userName: "Wren", mainName: "Joss", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: STARTER_TEMPLATES, ...over },
  );
type R = ReturnType<typeof fold>;
const names = (r: R) => Object.values(r.state.chars).map((c) => c.name);
const knows = (r: R, who: string, text: string) => {
  const c = Object.values(r.state.chars).find((x) => x.name === who);
  const f = Object.values(r.state.facts).find((x) => x.statement.includes(text));
  return c && f ? f.stances[c.id] : undefined;
};
const places = (r: R, name: string) => Object.values(r.state.places).filter((p) => p.name.toLowerCase() === name.toLowerCase());

describe("a merchant guild", () => {
  const r = fold(
    [
      ["at: Port Ellis › Guildhall › Counting Room", "cast: Joss@spot · Wren@spot · Mistress Hale@spot"],
      ["know Harbour Guild: the tithe doubles at midsummer | Hale read the charter · knows · true — at the meeting"],
      ["room Guildhall: ledger table buried in wax seals and tally sticks"],
      ["cast: the guild's apprentices (Pell, Moss)@peri", "know the guild's apprentices (Pell, Moss): Hale is selling the charter | overheard · suspects — through the door"],
      ["at: Guildhall › counting room", "cast: a dock clerk@peri"],
    ],
    { factions: [{ name: "Harbour Guild", members: ["Joss", "Mistress Hale"], source: "you" }] },
  );
  test("the guild's name stands for its members; no person called Harbour Guild or Guildhall", () => {
    expect(knows(r, "Mistress Hale", "tithe doubles")).toBeTruthy();
    expect(knows(r, "Joss", "tithe doubles")?.route).toContain("via the Harbour Guild");
    expect(names(r)).not.toContain("Harbour Guild");
    expect(names(r)).not.toContain("Guildhall");
  });
  test("a group named with its people: the people, and the group", () => {
    expect(names(r)).toEqual(expect.arrayContaining(["Pell", "Moss"]));
    expect(knows(r, "Pell", "selling the charter")).toBeTruthy();
    expect(names(r)).not.toContain("the guild's apprentices");
  });
  test("the hall's look is a place note, and its counting room one room", () => {
    expect(places(r, "Guildhall")[0]!.notes?.at(-1)?.text).toContain("ledger table");
    expect(places(r, "Counting Room")).toHaveLength(1);
  });
  test("the clerk is a passing face; the health rows are clean", () => {
    expect(passingFace(Object.values(r.state.chars).find((c) => c.name === "a dock clerk")!)).toBe(true);
    expect(notPeopleNow(r.state, { factions: ["Harbour Guild"] })).toEqual([]);
  });
});

describe("a ship's crew", () => {
  const r = fold([
    ["at: The Gull › galley", "cast: Joss@spot · Captain Ines@spot · Tamsin@spot · a deckhand@peri"],
    ["member Crew of the Gull: + Captain Ines | captain", "member Crew of the Gull: + Tamsin | bosun", "member Crew of the Gull: + Joss | cook"],
    ["know Crew of the Gull: the hold is shipping water | Tamsin sounded it · knows · true — at the pumps"],
    ["know the crew: we sail at dawn | the captain said · knows — on deck"],
    ["at: Gull › Galley"],
    ["member Crew of the Gull: - Tamsin — paid off at Saltpans", "know @Crew of the Gull: the captain owes the harbourmaster | rumour · suspects — below decks"],
  ]);
  test("members join and leave; the group's name stands for whoever is in it then", () => {
    const g = Object.values(r.state.groups ?? {}).find((x) => x.name === "Crew of the Gull")!;
    expect(currentMembers(g).map((m) => m.name).sort()).toEqual(["Captain Ines", "Joss"]);
    expect(knows(r, "Tamsin", "shipping water")).toBeTruthy();
    expect(knows(r, "Tamsin", "owes the harbourmaster")).toBeFalsy();
    expect(knows(r, "Captain Ines", "owes the harbourmaster")).toBeTruthy();
  });
  test("a bare group word with nobody named is nobody, not a person", () => {
    expect(names(r)).not.toContain("the crew");
    expect(names(r)).not.toContain("Crew of the Gull");
  });
  test("one galley however it's written; Captain Ines is a name, a deckhand isn't", () => {
    expect(places(r, "galley")).toHaveLength(1);
    const c = (name: string) => Object.values(r.state.chars).find((x) => x.name === name)!;
    expect(passingFace(c("Captain Ines"))).toBe(false);
    expect(passingFace(c("a deckhand"))).toBe(true);
  });
});

describe("a royal household", () => {
  const r = fold([
    ["at: Varn › Castle Varn › Great Hall", "cast: Queen Maren@spot · Prince Aldo@spot · Joss@spot"],
    ["lives Queen Maren, Prince Aldo, Lady Sefa: Varn › Castle Varn"],
    ["know household: the king's ship is overdue | a rider came at dusk · knows — in the hall"],
    ["at: Varn › Castel Varn › Library"],
    ["at: Varn › Castle Varn › East Wing › Library"],
    ["at: Varn › Castle Varn › Kitchen"],
    ["at: Varn › Castle Varn › Cellar › Kitchen"],
  ]);
  test("household is whoever lives in the castle, and the household isn't a person", () => {
    for (const who of ["Queen Maren", "Prince Aldo", "Lady Sefa"]) expect(knows(r, who, "ship is overdue")).toBeTruthy();
    expect(knows(r, "Joss", "ship is overdue")).toBeFalsy();
    expect(names(r)).not.toContain("household");
  });
  test("a one-letter typo is the same castle", () => {
    expect(places(r, "Castle Varn")).toHaveLength(1);
    expect(places(r, "Castel Varn")).toHaveLength(0);
  });
  test("a library is one library however it's reached, and a room inside a castle is a room", () => {
    expect(places(r, "Library")).toHaveLength(1);
    expect(places(r, "Library")[0]!.kind).toBe("room");
  });
  test("a kitchen made twice inside the castle shows in Places with several names", () => {
    const d = placesWithSeveralNames(r.state);
    expect(d.map((x) => x.building)).toEqual(["Castle Varn"]);
    expect(d[0]!.names[0]).toMatchObject({ name: "Kitchen", count: 2, paths: ["Kitchen", "Cellar › Kitchen"] });
  });
});

describe("not people (docs/30 4.2)", () => {
  test("a cast entry the routing would send elsewhere is counted, unless you said it's a person", () => {
    const r = fold([["at: Sunnydale › Winters Residence › Kitchen", "cast: Buffy@spot"]]);
    const st = structuredClone(r.state);
    const base = Object.values(st.chars).find((c) => c.name === "Buffy")!;
    for (const name of ["Downstairs Kitchen", "household", "traits", "Scoobies"]) st.chars[name] = { ...structuredClone(base), id: name, name };
    const rows = notPeopleNow(st, { factions: ["Scoobies"] });
    expect(rows.map((x) => `${x.name}:${x.as}`).sort()).toEqual(["Downstairs Kitchen:place", "Scoobies:faction", "household:group", "traits:field"]);
    expect(notPeopleNow(st, { factions: ["Scoobies"], people: ["Scoobies"] }).map((x) => x.name)).not.toContain("Scoobies");
  });
});
