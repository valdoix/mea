import { describe, expect, test } from "bun:test";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { STARTER_TEMPLATES } from "../src/trackers/schema";
import { secretShape, subjectName } from "../src/trackers/secretwords";

/**
 * docs/35 Part 1: the tracker wrote "secret #alive: Buffy asks Gabriel not to tell Walter she is alive,
 * not yet | kept by Gabriel Winters · from Walter". The secret is Buffy is alive, and Buffy is in on it.
 */

const cfg = (): FoldConfig => ({ userName: "Gabriel Winters", mainName: "Buffy Summers", sealedPersona: false, romance: "slow", strictness: "lenient", limits: true, templates: STARTER_TEMPLATES });
let n = 0;
function events(messages: string[][], source: TrackerEvent["source"] = "model"): TrackerEvent[] {
  return messages.flatMap((lines, i) => lines.map((l) => ({ id: `p${++n}`, messageId: `m${i + 1}`, seq: i + 1, source, op: parseLine(l)! })));
}
const opening = ["cast: Buffy Summers@spot · Gabriel Winters@spot · Walter@off · Dawn Summers@off · Mira@off · Joss@off"];
const id = (st: ReturnType<typeof foldEvents>["state"], name: string) => Object.values(st.chars).find((c) => c.name === name)!.id;

describe("the shape of a secret (1.2)", () => {
  test.each([
    ["Buffy asks Gabriel not to tell Walter she is alive, not yet", "Buffy is alive", ["Buffy", "Gabriel"], ["Walter"]],
    ["Buffy doesn't want Walter to know she is alive", "Buffy is alive", ["Buffy"], ["Walter"]],
    ["Buffy hasn't told Dawn she was in heaven", "Buffy was in heaven", ["Buffy"], ["Dawn"]],
    ["Buffy is keeping it from Dawn and Willow that she was in heaven", "Buffy was in heaven", ["Buffy"], ["Dawn", "Willow"]],
    ["Mira hides the harbour ledger from Joss", "Mira is hiding the harbour ledger", ["Mira"], ["Joss"]],
  ])("%s", (said, statement, keepers, from) => {
    expect(secretShape(said)).toEqual({ statement, keepers, from, said });
  });
  test.each([
    "Buffy clawed out of her own grave with bare hands",
    "Joss stole the harbor ledger from the customs office",
    "Gabriel asks Dawn to tell Walter about the soup",
    // Whose sister? Stored as written.
    "Buffy makes Gabriel promise never to tell Dawn that her sister died twice",
    "Buffy won't let Dawn know about the heaven thing",
  ])("left as written: %s", (said) => expect(secretShape(said)).toBeNull());
});

describe("the fold reads it that way (1.2, 1.3, 1.4)", () => {
  test("the real line folds to the secret it is", () => {
    const r = foldEvents(events([opening, ["secret #alive: Buffy asks Gabriel not to tell Walter she is alive, not yet | kept by Gabriel Winters · from Walter"]]), cfg());
    const f = r.state.facts.alive!;
    expect(f.statement).toBe("Buffy is alive");
    expect(f.secret?.keepers).toEqual(expect.arrayContaining([id(r.state, "Gabriel Winters"), id(r.state, "Buffy Summers")]));
    expect(f.secret?.from).toEqual([id(r.state, "Walter")]);
    expect(f.stances[id(r.state, "Buffy Summers")]?.status).toBe("knows");
    expect(Object.values(r.verdicts).some((v) => v.warn?.startsWith("read as: Buffy is alive"))).toBe(true);
  });
  test("a know line in the secret's own words now finds it", () => {
    const st = foldEvents(events([opening, ["secret #alive: Buffy asks Gabriel not to tell Walter she is alive | kept by Gabriel Winters · from Walter"], ["know Dawn Summers: Buffy is alive | heard her voice · knows"]]), cfg()).state;
    expect(st.facts.alive?.stances[id(st, "Dawn Summers")]?.status).toBe("knows");
  });
  test("a secret already in the right shape is unchanged", () => {
    const r = foldEvents(events([opening, ["secret #alive: Buffy is alive | kept by Buffy Summers, Gabriel Winters · from Walter"]]), cfg());
    expect(r.state.facts.alive?.statement).toBe("Buffy is alive");
    expect(Object.values(r.verdicts).some((v) => v.warn?.startsWith("read as"))).toBe(false);
  });
  test("whoever it's said of is in on it, unless it's kept from them; never 'Buffy's mother'", () => {
    const st = foldEvents(events([opening, ["secret #ledger: Joss stole the harbor ledger | kept by Mira · from Walter", "secret #adopted: Dawn was made from the Key | kept by Buffy Summers · from Dawn Summers", "secret #mom: Buffy's mother kept a diary | kept by Gabriel Winters · from Walter"]]), cfg()).state;
    expect(st.facts.ledger?.stances[id(st, "Joss")]?.route).toBe("it's about them");
    expect(st.facts.adopted?.stances[id(st, "Dawn Summers")]?.status).toBe("unaware");
    expect(st.facts.mom?.stances[id(st, "Buffy Summers")]).toBeUndefined();
  });
  test("what you set yourself is never overwritten", () => {
    const evs = [...events([opening]), ...events([[], ["know Buffy Summers: #alive Buffy is alive | you said so · unaware"]], "user"), ...events([[], [], ["secret #alive: Buffy asks Gabriel not to tell Walter she is alive | kept by Gabriel Winters · from Walter"]])];
    const st = foldEvents(evs.sort((a, b) => a.seq - b.seq), cfg()).state;
    expect(st.facts.alive?.stances[id(st, "Buffy Summers")]?.status).toBe("unaware");
  });
  test("subjectName takes the longest name, and not a possessive", () => {
    expect(subjectName("Buffy Summers is alive", ["Buffy", "Buffy Summers"])).toBe("Buffy Summers");
    expect(subjectName("Buffy's mother kept a diary", ["Buffy"])).toBeUndefined();
  });
});
