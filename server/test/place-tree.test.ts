import { describe, expect, test } from "bun:test";
import { placeLine } from "../src/trackers/belongings";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { cleanSegment, featureOf, kindOf, PlaceBook } from "../src/trackers/places";
import { STARTER_TEMPLATES } from "../src/trackers/schema";

/**
 * docs/30 Part 2 (2.1–2.3): one place, many names. The paths are the ones Filed Under Forever wrote
 * for the Winters and Summers houses (42 paths for the Winters house alone, before).
 */

const cfg = (over: Partial<FoldConfig> = {}): FoldConfig => ({
  userName: "Buffy Summers",
  mainName: "Gabriel Winters",
  sealedPersona: true,
  romance: "slow",
  strictness: "lenient",
  limits: true,
  templates: STARTER_TEMPLATES,
  ...over,
});
let n = 0;
function events(messages: string[][], source: TrackerEvent["source"] = "model"): TrackerEvent[] {
  return messages.flatMap((lines, i) => lines.map((l) => ({ id: `e${++n}`, messageId: `m${i + 1}`, seq: i + 1, source, op: parseLine(l)! })));
}
const fold = (msgs: string[][], over: Partial<FoldConfig> = {}) => foldEvents(events([["cast: Gabriel Winters@spot · Dawn@spot"], ...msgs]), cfg(over));
const named = (st: ReturnType<typeof fold>["state"], name: string) => Object.values(st.places).filter((p) => p.name.toLowerCase() === name.toLowerCase());

describe("one house, one place (docs/30 2.2)", () => {
  const winters = [
    ["at: Sunnydale › Winters Residence › upstairs bedroom › walk-in closet"],
    ["at: Sunnydale › Winters Residence › upstairs bedroom › walk-in closet → downstairs kitchen"],
    ["at: downstairs kitchen › table"],
    ["at: Sunnydale › Hills › Winters Residence › living room"],
    ["at: Sunnydale › Winters House › kitchen"],
    ["at: Gabriel's House › Upstairs › Gabriel's bedroom"],
    ["at: Sunnydale › Hills › Gabriel's warded house › front porch"],
    ["at: Sunnydale › Winters Residence › kitchen"],
  ];

  test("every way of writing the Winters house is the Winters Residence", () => {
    const st = fold(winters).state;
    const homes = Object.values(st.places).filter((p) => p.kind === "home");
    expect(homes.map((p) => p.name)).toEqual(["Winters Residence"]);
    const home = homes[0]!;
    expect(home.aliases).toEqual(expect.arrayContaining(["Winters House", "Gabriel's House", "Gabriel's warded house"]));
    // One kitchen, which "downstairs kitchen" is another name for.
    const kitchens = named(st, "kitchen").concat(named(st, "downstairs kitchen"));
    expect(kitchens).toHaveLength(1);
    expect(kitchens[0]!.parent).toBe(home.id);
    // Its name is the one written most ("downstairs kitchen"), and the scene is in it.
    expect(st.place).toEqual(["Sunnydale", "Winters Residence", kitchens[0]!.name]);
  });

  test("a guess is said in a change chip", () => {
    const r = fold(winters);
    const chips = Object.values(r.changes).flat().filter((c) => c.kind === "place" && / is /.test(c.text));
    expect(chips.map((c) => c.text)).toEqual(expect.arrayContaining(["Gabriel's House is Winters Residence", "Winters House is Winters Residence"]));
  });

  test("a house written before it had a name joins it when it's named", () => {
    const st = fold([["at: Gabriel's House › Kitchen"], ["at: Gabriel's House › Driveway"], ["at: Sunnydale › Winters Residence › living room"], ["at: Sunnydale › Winters Residence › kitchen"]]).state;
    const homes = Object.values(st.places).filter((p) => p.kind === "home");
    expect(homes).toHaveLength(1);
    expect(homes[0]!.aliases).toContain("Gabriel's House");
    expect(named(st, "kitchen")).toHaveLength(1);
    expect(named(st, "Driveway")[0]!.parent).toBe(homes[0]!.id);
  });

  test("a street before a home is its address, and a room after the street is in that home", () => {
    const st = fold([["at: Sunnydale › Summers Residence › hallway"], ["at: Revello Drive › Summers Residence › kitchen"], ["at: Revello Drive › Buffy's Bedroom"]]).state;
    const home = named(st, "Summers Residence")[0]!;
    expect(home.address).toBe("Revello Drive");
    expect(named(st, "Buffy's Bedroom")[0]!.parent).toBe(home.id);
    expect(named(st, "kitchen")[0]!.parent).toBe(home.id);
  });

  test("a typo of a town is the town, and the name written most wins", () => {
    const st = fold([["at: Sunnyvale › Restfield Cemetery › service road"], ["at: Sunnydale › Summers Residence › front porch"], ["at: Sunnydale › Summers Residence › hallway"]]).state;
    const tops = Object.values(st.places).filter((p) => !p.parent);
    expect(tops.map((p) => p.name)).toEqual(["Sunnydale"]);
    expect(tops[0]!.aliases).toContain("Sunnyvale");
    expect(named(st, "Restfield Cemetery")[0]!.path).toEqual(["Sunnydale", "Restfield Cemetery"]);
  });

  test("a trip in a path is where it ends", () => {
    expect(cleanSegment("Gabriel's BMW (pulling out of the drop-off lane)")).toBe("Gabriel's BMW");
    expect(cleanSegment("driving to Revello Drive")).toBe("Revello Drive");
    expect(cleanSegment("moving toward chain-link fence")).toBe("chain-link fence");
    expect(cleanSegment("road to Winters House")).toBe("Winters House");
    expect(cleanSegment("hills toward flats")).toBe("flats");
    expect(cleanSegment("stairs → Buffy's Bedroom")).toBe("Buffy's Bedroom");
    expect(cleanSegment("kitchen table, center, shrinking")).toBe("kitchen table");
    expect(cleanSegment("at the counter")).toBe("the counter");
  });

  test("a move within the same house isn't a new scene; another house is", () => {
    const r = fold([["at: Sunnydale › Winters Residence › kitchen"], ["at: downstairs kitchen"], ["at: Sunnydale › Winters House › living room"], ["at: Sunnydale › Summers Residence › kitchen"]]);
    const scenes = Object.values(r.changes).flat().filter((c) => c.kind === "place" && c.newScene);
    expect(scenes).toHaveLength(1);
  });

  test("a bare room goes in the house the scene is in; a name with no place word is its own place", () => {
    const st = fold([["at: Sunnydale › Winters Residence › living room"], ["at: basement pool"], ["at: Riverrun"]]).state;
    expect(named(st, "basement pool")[0]!.path).toEqual(["Sunnydale", "Winters Residence", "basement pool"]);
    expect(named(st, "Riverrun")[0]!.parent).toBeUndefined();
  });

  test("a path written from its top stays where it says", () => {
    const st = foldEvents(events([["at: Harrenhal › the Great Hall"], ["at: The Crossroads Inn › the common room"]]), cfg()).state;
    expect(st.place).toEqual(["The Crossroads Inn", "the common room"]);
  });

  test("numbered rooms are never a typo of each other", () => {
    const st = fold([["at: Sunnydale › Motel › Room 12"], ["at: Sunnydale › Motel › Room 13"]]).state;
    expect(named(st, "Room 12")).toHaveLength(1);
    expect(named(st, "Room 13")).toHaveLength(1);
  });

  test("kinds", () => {
    expect(kindOf("Winters Residence")).toBe("home");
    expect(kindOf("Gabriel's warded house")).toBe("home");
    expect(kindOf("downstairs kitchen")).toBe("room");
    expect(kindOf("fridge door")).toBe("spot");
    expect(kindOf("Gabriel's BMW")).toBe("vehicle");
    expect(kindOf("Revello Drive")).toBe("street");
    expect(kindOf("Sunnydale Mall")).toBe("building");
    expect(kindOf("Restfield Cemetery")).toBe("outdoors");
  });
});

describe("your edits to places (docs/30 2.1)", () => {
  test("a name you gave, another name, a merge and 'not the same place' all hold through a refold", () => {
    const msgs = [["at: Sunnydale › Summers Residence › kitchen"], ["at: Sunnydale › The Bronze › bar"], ["at: Sunnydale › Bronze Club › stage"]];
    const first = fold(msgs).state;
    const bronze = named(first, "The Bronze")[0]!;
    const club = named(first, "Bronze Club")[0]!;
    const home = named(first, "Summers Residence")[0]!;
    const st = fold(msgs, { placeProfiles: { [home.id]: { name: "1630 Revello Drive" }, [club.id]: { into: bronze.id } } }).state;
    expect(st.places[home.id]!.name).toBe("1630 Revello Drive");
    expect(named(st, "Bronze Club")).toHaveLength(0);
    expect(named(st, "stage")[0]!.parent).toBe(bronze.id);
  });

  test("'Not the same place' keeps two apart", () => {
    const msgs = [["at: Sunnydale › Winters Residence › kitchen"], ["at: Sunnydale › Winters House › kitchen"]];
    const home = named(fold(msgs).state, "Winters Residence")[0]!;
    const st = fold(msgs, { placeProfiles: { [home.id]: { notSame: ["Winters House"] } } }).state;
    expect(Object.values(st.places).filter((p) => p.kind === "home")).toHaveLength(2);
  });
});

describe("what a place looks like (docs/30 2.3)", () => {
  test("a newer note about the same thing replaces the older; the older is history", () => {
    const st = fold([
      ["at: Sunnydale › Winters Residence › kitchen"],
      ["place kitchen: fridge bears league standings in marker, BRONGEL 5 · THE FIELD 0"],
      ["place kitchen: fridge archive now standings + target + steak photo + Spike photo"],
      ["place kitchen: counter has the caviar jar, declared communal"],
    ]).state;
    const k = named(st, "kitchen")[0]!;
    expect(k.notes!.filter((x) => !x.past).map((x) => x.feature)).toEqual(["fridge", "counter"]);
    expect(k.notes!.find((x) => x.past)!.text).toContain("BRONGEL 5");
    expect(placeLine(st)).toBe("HERE: kitchen: counter has the caviar jar, declared communal; fridge archive now standings + target + steak photo + Spike photo");
  });

  test("a note that names another room of the house is that room's", () => {
    const st = fold([["at: Sunnydale › Winters Residence › living room"], ["at: Sunnydale › Winters Residence › kitchen"], ["room downstairs kitchen: living room dartboard wall now bears a permanent dart nick in the paint, kept by Buffy"]]).state;
    expect(named(st, "living room")[0]!.notes!.map((x) => x.text)).toEqual(["dartboard wall now bears a permanent dart nick in the paint, kept by Buffy"]);
    expect(named(st, "kitchen")[0]!.notes ?? []).toHaveLength(0);
  });

  test("what changed while the scene was away is marked", () => {
    const st = fold([["at: Sunnydale › Winters Residence › kitchen"], ["at: Sunnydale › Winters Residence › living room"], ["place Sunnydale › Winters Residence › kitchen: fridge has a new photo under the lemon magnet"], ["at: Sunnydale › Winters Residence › kitchen"]]).state;
    expect(placeLine(st)).toContain("(new since you were last here)");
  });

  test("things put down are at the place in the tree, however the path was written", () => {
    const st = fold([
      ["at: Sunnydale › Winters Residence › kitchen"],
      ["item photo (pool group, timer): at downstairs kitchen › fridge door — hung tonight"],
      ["item caviar jar: at Sunnydale › Winters House › kitchen › fridge — communal"],
      ["item Dawn's scarf: at Buffy's arm — borrowed"],
    ]).state;
    const door = named(st, "fridge door")[0]!;
    expect(st.items[Object.keys(st.items).find((k) => k.startsWith("photo"))!]!.placeId).toBe(door.id);
    expect(door.path).toEqual(["Sunnydale", "Winters Residence", "kitchen", "fridge door"]);
    // An arm isn't a place: things never start a new tree.
    expect(named(st, "Buffy's arm")).toHaveLength(0);
    expect(Object.values(st.places).filter((p) => !p.parent).map((p) => p.name)).toEqual(["Sunnydale"]);
  });

  test("features", () => {
    expect(featureOf("fridge bears league standings")).toBe("fridge");
    expect(featureOf("the fridge archive now…")).toBe("fridge");
    expect(featureOf("a new rug by the door")).toBe("rug");
  });

  test("the book reads a path without making anything", () => {
    const st = fold([["at: Sunnydale › Winters Residence › kitchen"]]).state;
    const before = Object.keys(st.places).length;
    expect(new PlaceBook(st).resolve("Sunnydale › Winters Residence › kitchen", { create: false })?.place.name).toBe("kitchen");
    expect(new PlaceBook(st).resolve("Sunnydale › Mall", { create: false })).toBeUndefined();
    expect(Object.keys(st.places)).toHaveLength(before);
  });
});
