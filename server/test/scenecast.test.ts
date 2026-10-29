import { describe, expect, test } from "bun:test";
import { arrivesAgainRule, notHereRule } from "../src/accuracy/moreslips";
import { describes, genderIn, sentences } from "../src/accuracy/rules";
import { turnKey } from "../src/steer/advisor";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { STARTER_TEMPLATES } from "../src/trackers/schema";

const cfg: FoldConfig = { userName: "James", mainName: "Jackie", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: STARTER_TEMPLATES };
let n = 0;
const events = (messages: string[][]): TrackerEvent[] => messages.flatMap((lines, i) => lines.map((l) => ({ id: `e${++n}`, messageId: `m${i + 1}`, seq: i + 1, source: "model" as const, op: parseLine(l)! })));
const camp = ["at: wilderness › fuselage", "cast: James@spot · Jackie@spot · Nat@spot · Shauna@spot · Misty@spot"];

describe("who comes along on a move", () => {
  test("people the cast line leaves out stay behind", () => {
    const st = foldEvents(events([camp, ["at: clearing › cabin", "cast: James@spot · Jackie@spot · Nat@arrive"]]), cfg).state;
    const tier = (name: string) => Object.values(st.chars).find((c) => c.name === name)!;
    expect(tier("Jackie").tier).toBe("spot");
    expect(tier("Nat").tier).toBe("spot");
    expect(tier("Shauna").tier).toBe("off");
    expect(tier("Shauna").place).toBe("wilderness › fuselage");
    expect(tier("Misty").tier).toBe("off");
  });

  test("the cast line before the move works the same", () => {
    const st = foldEvents(events([camp, ["cast: Jackie@spot · Nat@spot", "at: clearing › cabin"]]), cfg).state;
    expect(Object.values(st.chars).find((c) => c.name === "Shauna")!.tier).toBe("off");
  });

  test("a cast line that only notes a change keeps everyone together", () => {
    const st = foldEvents(events([camp, ["at: clearing › cabin", "cast: Tom@arrive"]]), cfg).state;
    expect(Object.values(st.chars).find((c) => c.name === "Shauna")!.tier).toBe("spot");
  });

  test("someone who leaves for where the scene goes is in it", () => {
    const home = [["at: Revello Drive › Bedroom", "cast: James@spot · Jackie@spot"]];
    const tier = (st: ReturnType<typeof foldEvents>["state"], name: string) => Object.values(st.chars).find((c) => c.name === name)!.tier;
    expect(tier(foldEvents(events([...home, ["cast: Jackie@left(→ kitchen)", "at: Revello Drive › Kitchen"]]), cfg).state, "Jackie")).toBe("spot");
    expect(tier(foldEvents(events([...home, ["at: Revello Drive › Kitchen", "cast: Jackie@left(→ the kitchen)"]]), cfg).state, "Jackie")).toBe("spot");
    expect(tier(foldEvents(events([...home, ["cast: Jackie@left(→ the porch)", "at: Revello Drive › Kitchen"]]), cfg).state, "Jackie")).toBe("off");
  });

  test("a thought for someone away brings them in", () => {
    const st = foldEvents(events([camp, ["cast: Nat@left(→ the lake)"], ['think Nat: "Back already. Nobody noticed."']]), cfg).state;
    expect(Object.values(st.chars).find((c) => c.name === "Nat")!.tier).toBe("spot");
    const same = foldEvents(events([camp, ["cast: Nat@left(→ the lake)", 'think Nat: "Finally, some quiet."']]), cfg).state;
    expect(Object.values(same.chars).find((c) => c.name === "Nat")!.tier).toBe("off");
  });

  test("a move without a cast line takes everyone along", () => {
    const st = foldEvents(events([camp, ["at: clearing › cabin"]]), cfg).state;
    expect(Object.values(st.chars).find((c) => c.name === "Shauna")!.place).toBe("clearing › cabin");
  });
});

describe("whose eyes", () => {
  const re = (n: string) => new RegExp(`\\b(${n})\\b`, "i");
  const jackie = { nameRe: re("Jackie"), others: [re("James"), re("Shauna")], gender: "f" as const, isSpeaker: true };
  const at = (s: string, w: string) => s.indexOf(w);

  test("a colour after his face is his, not hers", () => {
    const s = "The first time her eyes have gone to his face instead of the safe, impersonal surfaces that don't have blue eyes and a crooked grin.";
    expect(describes(s, at(s, "blue eyes"), jackie)).toBe(false);
    expect(describes(s, at(s, "blue eyes"), { ...jackie, gender: null })).toBe(false);
  });

  test("her own eyes, a name's possessive, and someone else's", () => {
    const own = "Jackie blinks, and her blue eyes sting.";
    expect(describes(own, at(own, "blue eyes"), jackie)).toBe(true);
    const named = "Jackie's blue eyes find the fire.";
    expect(describes(named, at(named, "blue eyes"), jackie)).toBe(true);
    const his = "Jackie looks at James's blue eyes.";
    expect(describes(his, at(his, "blue eyes"), jackie)).toBe(false);
  });

  test("the reply's pronouns tell who is who", () => {
    const sents = sentences("Jackie presses the gauze. She doesn't look up. Jackie feels her hands shake and her breath catch.");
    expect(genderIn(sents, re("Jackie"), [re("James")])).toBe("f");
  });
});

describe("who is in the scene", () => {
  const st = foldEvents(events([camp, ["at: clearing › cabin", "cast: James@spot · Jackie@spot"]]), cfg).state;

  test("someone left at camp acting in the cabin is flagged", () => {
    expect(notHereRule("No one except Shauna. Shauna's hand moves inside her jacket.", st).map((i) => i.kind)).toEqual(["nothere"]);
    expect(notHereRule("She thinks of Shauna. If Shauna sat here, she'd know.", st)).toEqual([]);
  });

  test("arriving first makes it fine", () => {
    expect(notHereRule("The door bangs open. Shauna comes in, soaked. Shauna sits by the stove.", st)).toEqual([]);
  });

  test("someone already here can't arrive again", () => {
    const here = foldEvents(events([camp]), cfg).state;
    expect(arrivesAgainRule("The door opens and Shauna walks in with the others.", here).map((i) => i.claim)).toEqual(["The door opens and Shauna walks in with the others."]);
    expect(arrivesAgainRule("Shauna steps outside. Minutes pass. Shauna comes in again.", here)).toEqual([]);
    expect(arrivesAgainRule("Hours later, Shauna arrives with wood.", here)).toEqual([]);
  });
});

describe("a regenerate with notes", () => {
  test("gets a plan of its own", () => {
    const history = [{ id: "m9", role: "assistant", content: "…" }] as Parameters<typeof turnKey>[0];
    expect(turnKey(history, undefined, "only James and Jackie are in the cabin")).not.toBe(turnKey(history));
    expect(turnKey(history, undefined, "  ")).toBe(turnKey(history));
  });
});

describe("fields written into a cast line", () => {
  const line = "cast: Shannon@spot · traits: college-aged, lip ring, lanyard SHANNON, crossword, wordless";

  test("are not people", () => {
    const st = foldEvents(events([camp, [line]]), cfg).state;
    const names = Object.values(st.chars).map((c) => c.name);
    expect(names).toContain("Shannon");
    for (const bad of ["traits: college-aged", "lip ring", "lanyard SHANNON", "crossword", "wordless"]) expect(names).not.toContain(bad);
  });

  test("events stored before the parser dropped them fold the same", () => {
    const ev = events([camp, [line]]);
    const cast = ev.at(-1)!;
    cast.op = { ...cast.op, args: { list: [{ name: "Shannon", tier: "spot" }, { name: "traits: college-aged, lip ring, crossword", tier: "spot" }] } };
    const names = Object.values(foldEvents(ev, cfg).state.chars).map((c) => c.name);
    expect(names).toContain("Shannon");
    expect(names).not.toContain("lip ring");
    expect(names).not.toContain("crossword");
  });
});
