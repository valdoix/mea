import { describe, expect, test } from "bun:test";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { updatePrompt } from "../src/trackers/prompts";
import { STARTER_TEMPLATES } from "../src/trackers/schema";

/**
 * docs/32 Part 0: "Gabriel Summers". In Clawed Out Into October the tracker wrote your character's
 * first name with Buffy's surname three times (seq 858, 866, 918), and the fold made a new person of it.
 */

const cfg = (over: Partial<FoldConfig> = {}): FoldConfig => ({
  userName: "Gabriel Winters",
  mainName: "Buffy Summers",
  sealedPersona: false,
  romance: "slow",
  strictness: "lenient",
  limits: true,
  templates: STARTER_TEMPLATES,
  ...over,
});

let n = 0;
function events(messages: string[][], source: TrackerEvent["source"] = "model"): TrackerEvent[] {
  return messages.flatMap((lines, i) => lines.map((l) => ({ id: `b${++n}`, messageId: `m${i + 1}`, seq: i + 1, source, op: parseLine(l)! })));
}
const opening = ["cast: Buffy Summers@spot · Gabriel Winters@spot · Dawn Summers@off · Eleanor Winters@off"];
const names = (r: ReturnType<typeof foldEvents>) => Object.values(r.state.chars).map((c) => c.name);
const warns = (r: ReturnType<typeof foldEvents>) => Object.values(r.verdicts).map((v) => v.warn).filter(Boolean);

describe("blended names (docs/32 Part 0)", () => {
  test("the story's three lines land on Gabriel Winters, and each says how it was read", () => {
    const r = foldEvents(
      events([
        opening,
        ["know Gabriel Summers: Walter keeps the spare key under the planter · handed it · true"],
        ["body Gabriel Summers: arousal 4 — her hand on his knee"],
        ["bond Buffy Summers>Gabriel Summers: trust +3 — he waited"],
        ["cast: Gabriel Summers@spot · Buffy Summers@spot"],
      ]),
      cfg(),
    );
    expect(names(r)).not.toContain("Gabriel Summers");
    expect(names(r).filter((x) => x.startsWith("Gabriel"))).toEqual(["Gabriel Winters"]);
    const fact = Object.values(r.state.facts).find((f) => f.statement.includes("spare key"))!;
    expect(fact.stances.user?.status).toMatch(/knows/);
    expect(r.state.chars.user!.meters.arousal).toBeDefined();
    expect(warns(r).filter((w) => w!.includes("nobody is called Gabriel Summers: read as Gabriel Winters")).length).toBe(4);
  });

  test("a married name is the same person, either way round", () => {
    const r = foldEvents(events([opening, ["mood Buffy Winters: giddy — the ring"]]), cfg());
    expect(names(r)).not.toContain("Buffy Winters");
  });

  test("new relatives, new first names and people you added are still new people", () => {
    const r = foldEvents(events([opening, ["cast: Hank Summers@spot · Jonathan Winters@peri · Gabriel Reyes@peri"]]), cfg());
    expect(names(r)).toEqual(expect.arrayContaining(["Hank Summers", "Jonathan Winters", "Gabriel Reyes"]));
    expect(warns(r)).toEqual([]);
    const yours = foldEvents(events([opening, ["cast: Gabriel Summers@spot"]]), cfg({ people: ["Gabriel Summers"] }));
    expect(names(yours)).toContain("Gabriel Summers");
  });

  test("a first name two people share decides nothing", () => {
    const r = foldEvents(events([[...opening, "cast: Dawn Harris@off"], ["cast: Dawn Winters@spot"]]), cfg());
    expect(names(r)).toContain("Dawn Winters");
  });

  test("the tracker is told to keep the names the state has", () => {
    const p = updatePrompt({ state: "", messages: "", userName: "Gabriel Winters", charName: "Buffy Summers", sealed: false, romance: "slow" });
    expect(JSON.stringify(p)).toContain("never pair one person's first name with another's surname");
  });
});
