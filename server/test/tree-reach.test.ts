import { describe, expect, test } from "bun:test";
import { matchLore } from "../src/lore/placelore";
import { treeReach } from "../src/sim/roster";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { placeKey } from "../src/trackers/places";
import { STARTER_TEMPLATES } from "../src/trackers/schema";

/** docs/30 2.7: the engine and the lore read the place tree. */

const cfg: FoldConfig = { userName: "Gabriel Winters", mainName: "Buffy Summers", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: STARTER_TEMPLATES };
let n = 0;
const fold = (messages: string[][]) =>
  foldEvents(
    messages.flatMap((lines, i) => lines.map((l): TrackerEvent => ({ id: `t${++n}`, messageId: `m${i + 1}`, seq: i + 1, source: "model", op: parseLine(l)! }))),
    cfg,
  );

const story = [
  ["at: Sunnydale › hills › Winters Residence › Kitchen", "cast: Gabriel Winters@spot · Buffy Summers@spot"],
  ["at: Sunnydale › Gabriel's House › living room"],
  ["at: Sunnydale › Revello Drive › Summers Residence › Kitchen"],
  ["at: Sunnydale › hills › Winters Residence › Kitchen"],
];

describe("reach by the tree (docs/30 2.7)", () => {
  const st = fold(story).state;
  const reach = treeReach(st);
  test("the same room, the same house however it was written, the same town", () => {
    expect(reach(["Sunnydale", "hills", "Winters Residence", "Kitchen"], "here")).toBe("here");
    // "Gabriel's House" is the Winters Residence: the same building, not a district away.
    expect(reach(["Sunnydale", "Gabriel's House", "living room"], "here")).toBe("building");
    expect(reach(["Sunnydale", "Revello Drive", "Summers Residence", "Kitchen"], "here")).toBe("town");
  });
  test("a place the tree doesn't know is compared as written", () => {
    expect(reach(["Los Angeles"], "away")).toBe("far");
    expect(reach(undefined, "here")).toBe("town");
    expect(reach(["Sunnydale", "hills", "Winters Residence", "Kitchen"], "dead")).toBe("none");
  });
});

describe("location entries (docs/30 2.7)", () => {
  const st = fold(story).state;
  const entry = (title: string, keys: string[] = []) => ({ bookId: "b1", bookName: "Sunnydale", entryId: title, title, name: placeKey(title.replace(/^location:\s*/i, "")), keys: keys.map(placeKey) });
  const id = (name: string) => Object.values(st.places).find((p) => p.name === name)!.id;
  test("by title, or another name of the place", () => {
    const m = matchLore(st, [entry("Location: The Winters House"), entry("Location: Summers Residence")]);
    expect(m.get(id("Winters Residence"))?.title).toBe("Location: The Winters House");
    expect(m.get(id("Summers Residence"))?.title).toBe("Location: Summers Residence");
  });
  test("by a key only for a building, a town or an area: a kitchen key isn't every kitchen", () => {
    const m = matchLore(st, [entry("Sunnydale's houses", ["Sunnydale", "kitchen"])]);
    expect(m.has(id("Sunnydale"))).toBe(true);
    expect([...m.keys()].filter((k) => st.places[k]!.name === "Kitchen")).toEqual([]);
  });
});
