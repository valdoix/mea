import { describe, expect, test } from "bun:test";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { knownPlaces } from "../src/trackers/places";
import { STARTER_TEMPLATES } from "../src/trackers/schema";

/** docs/30 2.6: what the Places section's actions do to the tree (Move under…, Pin, Not a place). */

const cfg = (over: Partial<FoldConfig> = {}): FoldConfig => ({ userName: "Buffy Summers", mainName: "Gabriel Winters", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: STARTER_TEMPLATES, ...over });
let n = 0;
const fold = (msgs: string[][], over: Partial<FoldConfig> = {}) =>
  foldEvents(
    [["cast: Gabriel Winters@spot · Dawn@spot"], ...msgs].flatMap((lines, i) => lines.map((l): TrackerEvent => ({ id: `p${++n}`, messageId: `m${i + 1}`, seq: i + 1, source: "model", op: parseLine(l)! }))),
    cfg(over),
  );
const named = (st: ReturnType<typeof fold>["state"], name: string) => Object.values(st.places).filter((p) => p.name === name);

const story = [["at: Sunnydale › Winters Residence › Kitchen"], ["at: Sunnydale › Gym"], ["at: Sunnydale › Winters Residence › Kitchen"], ["at: Sunnydale › Gym"]];

describe("the Places section's actions (docs/30 2.6)", () => {
  test("Move under: the place goes under another, and the path written for it still finds it", () => {
    const before = fold(story).state;
    const gym = named(before, "Gym")[0]!;
    const home = named(before, "Winters Residence")[0]!;
    const st = fold(story, { placeProfiles: { [gym.id]: { parent: home.id } } }).state;
    expect(named(st, "Gym")).toHaveLength(1);
    expect(named(st, "Gym")[0]!.path).toEqual(["Sunnydale", "Winters Residence", "Gym"]);
    expect(named(st, "Gym")[0]!.visits).toBe(2);
    expect(st.place).toEqual(["Sunnydale", "Winters Residence", "Gym"]);
  });

  test("Pin: always in the tracker's known places", () => {
    const before = fold([...story, ["at: Sunnydale › The Bronze"], ["at: Sunnydale › Restfield Cemetery"]]).state;
    const bronze = named(before, "The Bronze")[0]!;
    const st = fold([...story, ["at: Sunnydale › The Bronze"], ["at: Sunnydale › Restfield Cemetery"]], { placeProfiles: { [bronze.id]: { pinned: true } } }).state;
    expect(named(st, "The Bronze")[0]!.pinned).toBe(true);
    expect(knownPlaces(st, { usual: 1 }).usual).toContain("Sunnydale › The Bronze");
  });

  test("Not a place: the phrase is skipped, and the path goes on without it", () => {
    const msgs = [["at: Sunnydale › Gabriel's BMW (pulling out) › front seats"]];
    const before = fold(msgs).state;
    const bmw = named(before, "Gabriel's BMW")[0]!;
    const st = fold(msgs, { placeProfiles: { [bmw.id]: { notPlace: true, name: "Gabriel's BMW" } } }).state;
    expect(named(st, "Gabriel's BMW")).toHaveLength(0);
    expect(st.place).toEqual(["Sunnydale", "front seats"]);
  });
});
