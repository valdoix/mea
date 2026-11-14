import { describe, expect, test } from "bun:test";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { knowledgeOf, whoKnows } from "../src/trackers/knowledge";
import { STARTER_TEMPLATES } from "../src/trackers/schema";
import { checkPlan } from "../src/steer/plancheck";

/** docs/35 Part 2: one answer to "does this person know this?", with "nothing recorded" as its own answer. */

const cfg = (): FoldConfig => ({ userName: "Gabriel Winters", mainName: "Buffy Summers", sealedPersona: false, romance: "slow", strictness: "lenient", limits: true, templates: STARTER_TEMPLATES });
let n = 0;
function events(messages: string[][], source: TrackerEvent["source"] = "model"): TrackerEvent[] {
  return messages.flatMap((lines, i) => lines.map((l) => ({ id: `k${++n}`, messageId: `m${i + 1}`, seq: i + 1, source, op: parseLine(l)! })));
}

const st = foldEvents(
  [
    ...events([
      ["cast: Buffy Summers@spot · Gabriel Winters@spot · Spike@spot · Walter@off · Dawn Summers@off · Giles@off · Ruth@off · Tara@off"],
      ["secret #ledger: Spike stole the harbor ledger | kept by Spike · from Walter, Giles", "secret #grave: Buffy clawed out of her own grave | kept by Buffy Summers · from everyone"],
      ["reveal #ledger: to Giles — Spike told him", "know Tara: #grave Buffy clawed out of her own grave | she guessed · suspects", "know Ruth: #ledger Spike stole the harbor ledger | wrong idea · wrong"],
    ]),
    ...events([[], [], [], ["know Dawn Summers: #ledger Spike stole the harbor ledger | you said so · knows"]], "user"),
  ],
  cfg(),
).state;
const id = (name: string) => Object.values(st.chars).find((c) => c.name === name)!.id;
const k = (key: string, name: string) => knowledgeOf(st.facts[key]!, id(name));

describe("knowledgeOf (2.1)", () => {
  test.each([
    ["ledger", "Spike", "knows", "keeps it"],
    ["ledger", "Giles", "knows", "told at #3: Spike told him"],
    ["ledger", "Walter", "unaware", "kept from them"],
    ["ledger", "Dawn Summers", "knows", "you said so"],
    ["ledger", "Ruth", "unaware", "wrong idea"],
    ["ledger", "Buffy Summers", "unsaid", "nothing recorded"],
    ["grave", "Tara", "suspects", "she guessed"],
    ["grave", "Walter", "unaware", "kept from them"],
    ["grave", "Buffy Summers", "knows", "keeps it"],
  ])("#%s, %s: %s (%s)", (key, name, status, why) => {
    expect(k(key, name).status).toBe(status as never);
    expect(k(key, name).why).toBe(why);
  });
  test("a keeper is a keeper, a kept-from is kept, what you set says so", () => {
    expect(k("ledger", "Spike").keeper).toBe(true);
    expect(k("ledger", "Walter").kept).toBe(true);
    expect(k("ledger", "Dawn Summers").set).toBe(true);
    expect(k("ledger", "Ruth").detail).toBe("wrong");
  });
  test("whoKnows sorts them", () => {
    const w = whoKnows(st.facts.ledger!, ["spike", "walter", "buffy-summers"].map((x) => Object.values(st.chars).find((c) => c.id.startsWith(x))?.id ?? x));
    expect(w.knows.length).toBe(1);
    expect(w.unaware.length).toBe(1);
  });
});

describe("callers agree (2.2)", () => {
  test("the plan check: nothing recorded clashes with neither 'knows' nor 'doesn't know'", () => {
    expect(checkPlan(st, "Buffy doesn't know Spike stole the harbor ledger.").length).toBe(0);
    expect(checkPlan(st, "Buffy knows Spike stole the harbor ledger.").length).toBe(0);
    expect(checkPlan(st, "Walter knows Spike stole the harbor ledger.").length).toBe(1);
  });
});
