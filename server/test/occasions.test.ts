import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, getMessageRow, updateChat } from "../src/services/chats";
import { pauseJobs, registerJob } from "../src/services/jobs";
import { scenePlates } from "../src/trackers/plates";
import { stateForModel } from "../src/trackers/prompts";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { OCCASIONS, placeUnder, readOccasion, sceneOccasion } from "../../web/src/lib/occasions";
import { readPlace } from "../../web/src/lib/places";
import { freshDb } from "./helpers";

/** docs/25 §4: what makes a scene an occasion. */
describe("reading an occasion", () => {
  test.each([
    ["the birthday party", "birthday"],
    ["Mira's birthday", "birthday"],
    ["a name day feast", "birthday"],
    ["the wedding", "wedding"],
    ["Tyrion's wedding", "wedding"],
    ["a handfasting", "wedding"],
    ["the wedding feast", "reception"],
    ["the wedding reception", "reception"],
    ["a royal wedding feast", "reception"],
    ["the funeral", "funeral"],
    ["the wake", "funeral"],
    ["a memorial service", "funeral"],
    ["the bachelorette", "party"],
    ["a house party", "party"],
    ["the revels", "party"],
    ["the feast", "dinnerparty"],
    ["a dinner party", "dinnerparty"],
    ["the banquet", "dinnerparty"],
    ["their wedding anniversary", "anniversary"],
    ["date night", "anniversary"],
    ["the ball", "ball"],
    ["the masquerade", "ball"],
    ["prom", "ball"],
    ["the gala", "ball"],
    ["the harvest festival", "festival"],
    ["the fair", "festival"],
    ["Maiden's Day", "festival"],
    ["the coronation", "coronation"],
    ["the crowning", "coronation"],
    ["the inauguration", "coronation"],
    ["the Tourney of the Hand", "contest"],
    ["the joust", "contest"],
    ["the big game", "contest"],
    ["the championship", "contest"],
    ["Ned's execution", "execution"],
    ["the beheading", "execution"],
    ["a public hanging", "execution"],
  ] as const)("%s is %s", (text, id) => {
    expect(readOccasion(text, "place")).toBe(id);
    expect(readOccasion(text.toUpperCase(), "tracker")).toBe(id);
  });

  test.each(["the reception", "the shower", "in the wake of it", "the hanging", "the bedding", "a clinical trial", "the ball game", "the Queen's Ballroom", "the ball pit", "a fair fight", "the kitchen", "", null])("%p is no occasion", (text) => {
    expect(readOccasion(text, "place")).toBeNull();
  });

  test("a party is only a party where it's plainly one", () => {
    expect(readOccasion("the party", "place")).toBe("party");
    expect(readOccasion("the party", "tracker")).toBe("party");
    expect(readOccasion("The party rides north", "title")).toBeNull();
    expect(readOccasion("The house party", "title")).toBe("party");
  });

  test.each(["After the wedding", "The night before the funeral", "Planning the birthday party", "News of the wedding"])("a title about the time around one isn't one: %s", (title) => {
    expect(readOccasion(title, "title")).toBeNull();
  });

  test("every occasion's own label reads back as it", () => {
    for (const o of OCCASIONS) expect(readOccasion(o.label, "tracker")).toBe(o.id);
  });
});

describe("an occasion in a scene", () => {
  const house = ["Jackie's house", "the living room"];

  test("the first signal found wins", () => {
    const all = { place: ["the wedding"], tracked: "a funeral", title: "A birthday party", dated: [{ title: "The banquet", at: 100 }], minutes: 100 };
    expect(sceneOccasion({ ...all, fix: "party" })?.id).toBe("party");
    expect(sceneOccasion(all)?.id).toBe("funeral");
    expect(sceneOccasion({ ...all, tracked: null })?.id).toBe("wedding");
    expect(sceneOccasion({ ...all, tracked: null, place: house })?.id).toBe("dinnerparty");
    expect(sceneOccasion({ ...all, tracked: null, place: house, dated: null })?.id).toBe("birthday");
    expect(sceneOccasion({ place: house })).toBeNull();
  });

  test("your 'none' beats everything, and a nonsense correction beats nothing", () => {
    expect(sceneOccasion({ place: ["the wedding"], tracked: "a funeral", fix: "none" })).toBeNull();
    expect(sceneOccasion({ place: ["the wedding"], fix: "nonsense" })?.id).toBe("wedding");
  });

  test("a calendar entry counts from an hour before to six hours after", () => {
    const dated = [{ title: "The wedding", at: 1000 }];
    expect(sceneOccasion({ place: house, dated, minutes: 930 })).toBeNull();
    expect(sceneOccasion({ place: house, dated, minutes: 940 })?.id).toBe("wedding");
    expect(sceneOccasion({ place: house, dated, minutes: 1360 })?.id).toBe("wedding");
    expect(sceneOccasion({ place: house, dated, minutes: 1361 })).toBeNull();
    expect(sceneOccasion({ place: house, dated: [{ title: "Dentist", at: 1000 }], minutes: 1000 })).toBeNull();
  });

  test.each([
    [["the wedding"], "a stage"],
    [["Jackie's birthday party"], "a stage"],
    [["Winterfell", "the wedding"], "a stage"],
    [["Somewhere"], "a stage"],
    [["Harrenhal"], "a stage"],
    [[], "a stage"],
    [["Jackie's house", "the kitchen"], "a dressing"],
    [["Jackie's house"], "a dressing"],
    [["King's Landing", "the Red Keep", "the Throne Room"], "a dressing"],
    [["the birthday party at Jackie's house"], "a dressing"],
  ] as const)("%p gets %s", (place, how) => {
    expect(sceneOccasion({ place: [...place], tracked: "a wedding" })?.stage).toBe(how === "a stage");
  });

  test("the place underneath an event's name is still read", () => {
    expect(placeUnder(["the birthday party at Jackie's house"])).toEqual(["at jackie's house"]);
    expect(readPlace(placeUnder(["the birthday party at Jackie's house"]))).toBe("living");
    expect(placeUnder(["Winterfell", "the wedding feast"])).toEqual(["Winterfell"]);
    expect(placeUnder(["Jackie's house", "the kitchen"])).toEqual(["Jackie's house", "the kitchen"]);
  });
});

describe("the occasion line", () => {
  let chatId = "";
  const say = (lines: string[]) => {
    const id = addMessage(chatId, "assistant", "…", { name: "Mira" });
    if (lines.length) writeEvents(chatId, { messageId: id, swipeIdx: 0 }, linesToOps(lines).ops, "model");
    return { id, seq: getMessageRow(id)!.seq };
  };

  beforeAll(() => {
    freshDb();
    pauseJobs(true);
    for (const kind of ["memory.segment", "memory.build", "memory.embed", "accuracy.check", "tracker.update"]) registerJob(kind, async () => {});
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "The lamp hums." } });
    chatId = createChat({ characterId: createCharacter(data) }).id;
    writeEvents(chatId, { messageId: null, swipeIdx: 0 }, linesToOps(["clock: Day 1 18:00", "at: Harrenhal › the Great Hall"]).ops, "init");
  });

  test("it parses, folds, reaches the plates and the tracker's next prompt", () => {
    expect(linesToOps(["occasion: a royal wedding feast"]).bad).toEqual([]);
    const m = say(["occasion: a royal wedding feast"]);
    const st = currentFold(chatId).result.state;
    expect(st.occasion).toMatchObject({ now: "a royal wedding feast", seq: m.seq, root: "harrenhal" });
    expect(scenePlates(chatId).states.at(-1)).toMatchObject({ seq: m.seq, occasion: "a royal wedding feast", minutes: 18 * 60 });
    expect(stateForModel(st, { userName: "Ash", templates: [], sealed: false })).toContain("occasion: a royal wedding feast");
  });

  test("a move within the place keeps it; off ends it", () => {
    say(["at: Harrenhal › the kitchens"]);
    expect(currentFold(chatId).result.state.occasion?.now).toBe("a royal wedding feast");
    say(["occasion: off"]);
    expect(currentFold(chatId).result.state.occasion).toBeNull();
    expect(scenePlates(chatId).states.at(-1)?.occasion).toBeNull();
  });

  test("leaving the place ends it", () => {
    say(["occasion: a funeral"]);
    say(["at: The Crossroads Inn › the common room"]);
    expect(currentFold(chatId).result.state.occasion).toBeNull();
  });

  test("twelve story hours end it", () => {
    say(["occasion: a feast"]);
    say(["clock: +11h"]);
    expect(currentFold(chatId).result.state.occasion?.now).toBe("a feast");
    say(["clock: +1h"]);
    expect(currentFold(chatId).result.state.occasion).toBeNull();
  });

  test("your corrections and the calendar ride along", () => {
    updateChat(chatId, { settings: { occasionFixes: { "4": "wedding" } } });
    say(["plan The wedding: Day 5 19:00 | who: Mira"]);
    const p = scenePlates(chatId);
    expect(p.occasions).toEqual({ "4": "wedding" });
    expect(p.dated.map((d) => d.title)).toContain("The wedding");
  });
});
