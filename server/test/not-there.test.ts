import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { STARTER_TEMPLATES } from "../src/trackers/schema";
import { notThereReminder } from "../src/trackers/service";
import { currentFold, markNotThere, notThereNames, writeEvents } from "../src/trackers/store";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { freshDb } from "./helpers";

/** docs/31 Part 1: "{Name} wasn't there" takes one person off a know line; the others keep it. */

const cfg = (over: Partial<FoldConfig> = {}): FoldConfig => ({
  userName: "Gabriel Winters",
  mainName: "Buffy Summers",
  sealedPersona: true,
  romance: "slow",
  strictness: "lenient",
  limits: true,
  templates: STARTER_TEMPLATES,
  factions: [{ name: "Scoobies", members: ["Willow", "Xander", "Anya", "Tara"], source: "you" }],
  ...over,
});
let n = 0;
const ev = (line: string, seq: number, args: Record<string, unknown> = {}): TrackerEvent => {
  const op = parseLine(line)!;
  return { id: `n${++n}`, messageId: `m${seq}`, seq, source: "model", op: { ...op, args: { ...op.args, ...args } } };
};
const opening = ev("cast: Buffy Summers@spot · Walter@spot · Spike@spot · Willow@spot", 1);
const holders = (r: ReturnType<typeof foldEvents>, text: string) => {
  const f = Object.values(r.state.facts).find((x) => x.statement.includes(text))!;
  return Object.keys(f?.stances ?? {}).sort();
};

describe("wasn't there, in the fold", () => {
  test("a list line: the one you named is off it, the rest keep it", () => {
    const r = foldEvents([opening, ev("know Walter, Spike, Willow: Spike watches Passions | at lunch · knows", 2, { notThere: ["Willow"] })], cfg());
    expect(holders(r, "Passions")).toEqual(["spike", "walter"]);
  });

  test("a group line and 'everyone' honour it too, and a group fact isn't recorded", () => {
    const r = foldEvents(
      [opening, ev("know Scoobies: the Bronze is closed | Willow texted them · knows", 2, { notThere: ["Xander"] }), ev("know everyone: film Fridays | Buffy ruled it · knows", 3, { notThere: ["Spike"] })],
      cfg(),
    );
    expect(holders(r, "Bronze")).toEqual(["anya", "tara", "willow"]);
    expect(r.state.groups!.scoobies!.facts.some((x) => x.text.includes("Bronze"))).toBe(false);
    expect(holders(r, "film Fridays")).not.toContain("spike");
    expect(holders(r, "film Fridays")).toContain("walter");
  });

  test("a one-person line with them off it teaches nobody, and says why", () => {
    const r = foldEvents([opening, ev("know Willow: the locket is hidden | overheard · knows", 2, { notThere: ["Willow"] })], cfg());
    expect(holders(r, "locket")).toEqual([]);
    expect(Object.values(r.verdicts).at(-1)).toMatchObject({ ok: false, reason: "you said Willow wasn't there" });
  });

  test("the chip carries its line", () => {
    const r = foldEvents([opening, ev("know Walter: Spike watches Passions | at lunch · knows", 2)], cfg());
    const chip = r.changes.m2!.find((c) => c.kind === "knowledge")!;
    expect(chip.lineId).toBe(`n${n}`);
  });
});

describe("wasn't there, stored", () => {
  let chatId = "";
  let msg = "";
  beforeAll(() => {
    freshDb();
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy Summers", description: "The Slayer.", first_mes: "Hey." } });
    chatId = createChat({ characterId: createCharacter(data) }).id;
    msg = addMessage(chatId, "assistant", "Walter set down his taco.", { name: "Buffy Summers" });
  });

  test("marks the line, keeps it through a refold, and the tracker hears about it from the second name", () => {
    const [cast, line] = writeEvents(chatId, { messageId: msg, swipeIdx: 0 }, [parseLine("cast: Walter@spot · Spike@spot")!, parseLine("know Walter, Spike, Willow: Spike watches Passions | at lunch · knows")!], "model");
    expect(cast).toBeTruthy();
    expect(markNotThere(chatId, line!, "Willow")).toBe(true);
    expect(markNotThere(chatId, cast!, "Willow")).toBe(false);
    const st = currentFold(chatId).result.state;
    const f = Object.values(st.facts).find((x) => x.statement.includes("Passions"))!;
    expect(Object.keys(f.stances).sort()).toEqual(["spike", "walter"]);
    expect(notThereReminder(chatId)).toBeUndefined();
    markNotThere(chatId, line!, "Spike");
    expect(notThereNames(chatId).sort()).toEqual(["Spike", "Willow"]);
    expect(notThereReminder(chatId)).toContain("weren't there (");
  });
});
