import { describe, expect, test } from "bun:test";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { STARTER_TEMPLATES } from "../src/trackers/schema";

/**
 * docs/32 Part 1: a new person needs the story to have named them. The story here is a list of
 * messages; `inStory` answers from the ones up to the line's own.
 */

const story = [
  "Buffy sets the plates out. Gabriel is still at the stove.",
  "Chloe from the shoe store waves through the window. Her brother Hank is with her.",
  "The woman at the counter rings them up. Coach Martinez nods from the door.",
  "Nothing new here.",
];

const cfg = (over: Partial<FoldConfig> = {}): FoldConfig => ({
  userName: "Gabriel Winters",
  mainName: "Buffy Summers",
  sealedPersona: false,
  romance: "slow",
  strictness: "lenient",
  limits: true,
  templates: STARTER_TEMPLATES,
  inStory: (phrase, seq) => story.slice(0, seq).join("\n").toLowerCase().includes(phrase.toLowerCase()),
  ...over,
});

let n = 0;
function events(messages: string[][], source: TrackerEvent["source"] = "model"): TrackerEvent[] {
  return messages.flatMap((lines, i) => lines.map((l) => ({ id: `s${++n}`, messageId: `m${i + 1}`, seq: i + 1, source, op: parseLine(l)! })));
}
const names = (r: ReturnType<typeof foldEvents>) => Object.values(r.state.chars).map((c) => c.name);
const warns = (r: ReturnType<typeof foldEvents>) => Object.values(r.verdicts).flatMap((v) => (v.warn ? [v.warn] : v.ok ? [] : [v.reason ?? ""]));

describe("named by the story (docs/32 Part 1)", () => {
  test("a name only the ledger has makes nobody, and the line says so", () => {
    const r = foldEvents(events([["cast: Buffy Summers@spot · Gabriel Winters@spot", "mood Marguerite: wary — watching", "cast: Tobias Reed@peri"]]), cfg());
    expect(names(r).sort()).toEqual(["Buffy Summers", "Gabriel Winters"]);
    expect(warns(r)).toEqual(["the story never says Marguerite: nobody was added", "the story never says Tobias Reed: nobody was added"]);
  });

  test("a misnamed lead goes to the lead: a surname nobody has, on a first name one person has", () => {
    const r = foldEvents(events([["cast: Buffy Summers@spot", "mood Gabriel Sommers: content — the smell of garlic"]]), cfg());
    expect(names(r).sort()).toEqual(["Buffy Summers", "Gabriel Winters"]);
    expect(r.state.chars.user!.mood?.name ?? "").toContain("content");
    expect(warns(r)).toEqual(["the story never says Gabriel Sommers: read as Gabriel Winters"]);
  });

  test("people the messages name appear at once: by first name, with a surname the ledger added, or with a title", () => {
    const r = foldEvents(events([["cast: Buffy Summers@spot"], ["cast: Chloe@peri · Hank Summers@peri"], ["cast: Coach Martinez@peri"]]), cfg());
    expect(names(r)).toEqual(expect.arrayContaining(["Chloe", "Hank Summers", "Coach Martinez"]));
    expect(warns(r)).toEqual([]);
  });

  test("a name the story has later doesn't count yet", () => {
    const r = foldEvents(events([["cast: Buffy Summers@spot · Chloe@peri"]]), cfg());
    expect(names(r)).not.toContain("Chloe");
    const later = foldEvents(events([["cast: Buffy Summers@spot"], ["cast: Chloe@peri"]]), cfg());
    expect(names(later)).toContain("Chloe");
  });

  test("a title in the story isn't the person", () => {
    const r = foldEvents(events([[], [], ["cast: Coach Ramirez@peri"]]), cfg());
    expect(names(r)).not.toContain("Coach Ramirez");
  });

  test("descriptions, your own lines and people you added pass", () => {
    const r = foldEvents(events([["cast: Woman in brown cardigan@peri · the bartender@peri"]]), cfg());
    expect(names(r)).toEqual(expect.arrayContaining(["Woman in brown cardigan", "the bartender"]));
    const yours = foldEvents(events([["cast: Marguerite@spot"]], "user"), cfg());
    expect(names(yours)).toContain("Marguerite");
    const added = foldEvents(events([["cast: Marguerite@spot"]]), cfg({ people: ["Marguerite"] }));
    expect(names(added)).toContain("Marguerite");
  });

  test("without the story to ask, any name is a person, as before", () => {
    const r = foldEvents(events([["cast: Marguerite@spot"]]), cfg({ inStory: undefined }));
    expect(names(r)).toContain("Marguerite");
  });
});

describe("a misspelling the story never has (docs/32 Part 1)", () => {
  test("goes to the one person it's a letter or two from", () => {
    const r = foldEvents(
      [...events([["cast: Buffy Summers@spot · Ruth@spot · Rupert Giles@off"]], "init"), ...events([["mood Guth: content — fur warm from the sill", "mood Gupert Jiles: stiff — the letters"]])],
      cfg(),
    );
    expect(names(r).sort()).toEqual(["Buffy Summers", "Gabriel Winters", "Rupert Giles", "Ruth"]);
    expect(warns(r)).toEqual(["the story never says Guth: read as Ruth", "the story never says Gupert Jiles: read as Rupert Giles"]);
  });
});
