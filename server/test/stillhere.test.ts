import { beforeEach, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { parseLine } from "../src/trackers/dsl";
import { foldEvents, groupReach, type FoldConfig, type TrackerEvent } from "../src/trackers/fold";
import { stateForModel } from "../src/trackers/prompts";
import { ASK_REPLIES, QUIET_REPLIES, quietPeople, stillHere } from "../src/trackers/stillhere";
import { STARTER_TEMPLATES } from "../src/trackers/schema";
import { currentFold, writeEvents } from "../src/trackers/store";
import { userEdit } from "../src/trackers/service";
import { freshDb } from "./helpers";

/** docs/31 Part 3: "everyone" against a stale scene. */

let chatId = "";
let first = "";
beforeEach(() => {
  freshDb();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy Summers", description: "The Slayer.", first_mes: "Hey." } });
  chatId = createChat({ characterId: createCharacter(data) }).id;
  first = addMessage(chatId, "assistant", "Xander and Buffy argue about the last donut.", { name: "Buffy Summers" });
  writeEvents(chatId, { messageId: first, swipeIdx: 0 }, [parseLine("cast: Buffy Summers@spot · Xander@spot")!], "model");
});
/** Replies that name Buffy and never Xander. */
const talk = (n: number) => {
  for (let i = 0; i < n; i++) {
    addMessage(chatId, "user", `I ask about patrol ${i}.`, { name: "Gabriel Winters" });
    addMessage(chatId, "assistant", `Buffy shrugs and checks her stakes (${i}).`, { name: "Buffy Summers" });
  }
};
const st = () => currentFold(chatId).result.state;

describe("quiet people", () => {
  test(`present but not named in ${QUIET_REPLIES} replies`, () => {
    talk(QUIET_REPLIES - 1);
    expect(quietPeople(chatId, st())).toEqual([]);
    talk(1);
    expect(quietPeople(chatId, st()).map((q) => q.name)).toEqual(["Xander"]);
  });

  test("named again, or said by you to be here, isn't quiet", () => {
    talk(QUIET_REPLIES);
    addMessage(chatId, "assistant", "Xander drops a stake.", { name: "Buffy Summers" });
    expect(quietPeople(chatId, st())).toEqual([]);
    talk(QUIET_REPLIES);
    expect(quietPeople(chatId, st()).map((q) => q.name)).toEqual(["Xander"]);
    userEdit(chatId, [parseLine("cast: Xander@spot")!]);
    expect(quietPeople(chatId, st())).toEqual([]);
  });

  test(`the Cast tab asks after ${ASK_REPLIES}, with when they were last named`, () => {
    talk(ASK_REPLIES - 1);
    expect(stillHere(chatId, st())).toEqual([]);
    talk(1);
    const [x] = stillHere(chatId, st());
    expect(x).toMatchObject({ name: "Xander", replies: ASK_REPLIES });
    expect(x!.lastNamed).toBeGreaterThan(0);
  });

  test("the tracker's state marks them (quiet)", () => {
    const s = stateForModel(st(), { userName: "Gabriel Winters", templates: STARTER_TEMPLATES, sealed: true, quiet: ["Xander"] });
    expect(s).toContain("Xander@spot (quiet)");
    expect(s).not.toContain("Buffy Summers@spot (quiet)");
  });
});

describe("'everyone' skips them (3.1)", () => {
  const cfg: FoldConfig = { userName: "Gabriel Winters", mainName: "Buffy Summers", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: STARTER_TEMPLATES };
  const opening: TrackerEvent = { id: "q0", messageId: "m1", seq: 1, source: "model", op: parseLine("cast: Buffy Summers@spot · Xander@spot · Spike@spot")! };
  const file = (text: string) => {
    const before = foldEvents([opening], cfg).state;
    const ops = groupReach([parseLine("know everyone: patrol is at nine | Buffy said · knows")!], before, cfg, text, ["Xander"]);
    const r = foldEvents([opening, { id: "q1", messageId: "m2", seq: 2, source: "model", op: ops[0]! }], cfg);
    const f = Object.values(r.state.facts).find((x) => x.statement.includes("patrol"))!;
    return Object.keys(f.stances).sort();
  };
  test("a quiet person doesn't hear what's said to everyone", () => {
    expect(file("Buffy says patrol is at nine. Spike groans.")).toEqual(["buffy-summers", "spike"]);
  });
  test("unless this reply names them", () => {
    expect(file("Buffy says patrol is at nine. Xander groans.")).toEqual(["buffy-summers", "spike", "xander"]);
  });
});
