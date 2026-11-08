import { describe, expect, test } from "bun:test";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { STARTER_TEMPLATES } from "../src/trackers/schema";
import { passingFace, passingName } from "../src/trackers/whois";

/** docs/30 Part 3: passing faces. The names are this story's (Filed Under Forever) and a few more. */

describe("a description for a name (docs/30 3.1)", () => {
  test("extras", () => {
    for (const n of ["Zapatos Dorothea worker", "woman in brown cardigan", "Woman in brown cardigan", "Man with the umbrella", "the bartender", "a security guard", "Sunnydale Mall cashier", "two vampires"]) expect(passingName(n)).toBe(true);
  });
  test("names, and names with a title", () => {
    for (const n of ["Buffy Summers", "Dawn", "Coach Martinez", "Officer Dan", "Mr. Trick", "Jacqueline 'Jackie' Taylor", "Kara"]) expect(passingName(n)).toBe(false);
  });
});

const cfg: FoldConfig = { userName: "Gabriel Winters", mainName: "Buffy Summers", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: STARTER_TEMPLATES };
let n = 0;
const fold = (messages: string[][]) =>
  foldEvents(
    messages.flatMap((lines, i) => lines.map((l): TrackerEvent => ({ id: `f${++n}`, messageId: `m${i + 1}`, seq: i + 1, source: "model", op: parseLine(l)! }))),
    cfg,
  );
const who = (r: ReturnType<typeof fold>, name: string) => Object.values(r.state.chars).find((c) => c.name === name)!;

describe("passing faces in the fold (docs/30 3.1)", () => {
  test("a passing face until a third scene", () => {
    const shop = ["at: Sunnydale › Sunnydale Mall › Shoe Store", "cast: Buffy Summers@spot · Zapatos Dorothea worker@spot"];
    const away = ["at: Sunnydale › Winters Residence › Kitchen", "cast: Zapatos Dorothea worker@left"];
    const once = fold([shop]);
    expect(who(once, "Zapatos Dorothea worker").scenes).toBe(1);
    expect(passingFace(who(once, "Zapatos Dorothea worker"))).toBe(true);
    const thrice = fold([shop, away, shop, away, shop]);
    expect(who(thrice, "Zapatos Dorothea worker").scenes).toBe(3);
    expect(passingFace(who(thrice, "Zapatos Dorothea worker"))).toBe(false);
  });
  test("a scene is counted once, however many lines name them", () => {
    const r = fold([["at: Sunnydale › The Bronze", "cast: the bartender@peri"], ["cast: the bartender@spot"], ["cast: the bartender@peri"]]);
    expect(who(r, "the bartender").scenes).toBe(1);
  });
  test("pinned, the main character or you: never a passing face", () => {
    const r = fold([["at: Sunnydale › The Bronze", "cast: the bartender@peri"]]);
    expect(passingFace(who(r, "the bartender"), true)).toBe(false);
    expect(passingFace({ name: "the girl", isUser: false, isMain: true })).toBe(false);
  });
});
