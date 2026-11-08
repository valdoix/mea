import { describe, expect, test } from "bun:test";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { knownPlaces, knownPlacesLine } from "../src/trackers/places";
import { stateForModel } from "../src/trackers/prompts";
import { STARTER_TEMPLATES } from "../src/trackers/schema";

/** docs/30 2.5: the tracker is told the places around the scene by their tree names. */

const cfg: FoldConfig = { userName: "Gabriel Winters", mainName: "Buffy Summers", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: STARTER_TEMPLATES };
let n = 0;
const fold = (messages: string[][]) =>
  foldEvents(
    messages.flatMap((lines, i) => lines.map((l): TrackerEvent => ({ id: `k${++n}`, messageId: `m${i + 1}`, seq: i + 1, source: "model", op: parseLine(l)! }))),
    cfg,
  );

const story = [
  ["at: Sunnydale › Winters Residence › Kitchen", "cast: Buffy Summers@spot · Gabriel Winters@spot"],
  ["at: Sunnydale › Winters Residence › Living room"],
  ["at: Sunnydale › The Bronze"],
  ["at: Sunnydale › Revello Drive › Summers Residence › Kitchen"],
  ["at: Sunnydale › Sunnydale Mall › Food Court"],
  ["at: downstairs kitchen"],
  ["at: Sunnydale › Winters Residence › Kitchen"],
];

describe("known places (docs/30 2.5)", () => {
  test("the building's rooms, the town's usual places, and the latest ones, by the tree's names", () => {
    const r = fold(story);
    const k = knownPlaces(r.state);
    expect(k.here).toBe("Sunnydale › Winters Residence");
    expect(k.rooms).toContain("Kitchen");
    expect(k.rooms).toContain("Living room");
    // "downstairs kitchen" was the same kitchen: no second one.
    expect(k.rooms.filter((x) => /kitchen/i.test(x))).toEqual(["Kitchen"]);
    expect(k.town).toBe("Sunnydale");
    expect(k.usual).toEqual(expect.arrayContaining(["The Bronze", "Sunnydale Mall"]));
    expect(k.recent[0]).toBe("Sunnydale › Sunnydale Mall › Food Court");
    expect(k.recent.some((x) => x.startsWith("Sunnydale › Winters Residence"))).toBe(false);
  });

  test("it's a line in the tracker's state, with what to do with it", () => {
    const r = fold(story);
    const line = knownPlacesLine(r.state)!;
    expect(line).toStartWith("known places (write places by these names; add a new part only for a new place): Sunnydale › Winters Residence: Kitchen");
    expect(stateForModel(r.state, { userName: "Gabriel Winters", templates: [], sealed: true })).toContain(line);
  });

  test("a story with no places yet has no line", () => {
    expect(knownPlacesLine(fold([["cast: Buffy Summers@spot"]]).state)).toBeNull();
  });
});
