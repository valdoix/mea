import { beforeAll, describe, expect, test } from "bun:test";
import "../src/accuracy/moreslips";
import { onThePage } from "../src/accuracy/checker";
import { slipById } from "../src/accuracy/slips";
import { dateRule, daylightRule, oneValueRule, periodRule, storyDate } from "../src/accuracy/worldslips";
import { normalizeCard } from "../src/cards/card";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat } from "../src/services/chats";
import { parseLine } from "../src/trackers/dsl";
import { type FoldConfig, foldEvents, type TrackerEvent } from "../src/trackers/fold";
import { STARTER_TEMPLATES } from "../src/trackers/schema";
import { freshDb } from "./helpers";

/** docs/33 Part 7b: checks the story's own world settles. The sentences are one story's own. */
const cfg: FoldConfig = { userName: "Gabriel", mainName: "Buffy", sealedPersona: true, romance: "slow", strictness: "lenient", limits: true, templates: STARTER_TEMPLATES };
let n = 0;
const at = (clock: string) =>
  foldEvents(
    [`clock: ${clock}`, "cast: Buffy@spot · Spike@spot · Dawn@spot"].map((l): TrackerEvent => ({ id: `e${++n}`, messageId: "m1", seq: 1, source: "model", op: parseLine(l)! })),
    cfg,
  ).state;
const spike = { vampires: [{ name: "Spike", aliases: ["William"] }], latitude: 34 };

describe("a vampire in daylight", () => {
  test("walking out at midday is flagged; after dark, under a blanket or in a memory is not", () => {
    const noon = at("2001-10-15 12:06");
    expect(daylightRule("Spike collected the darts and walked out the door ahead of everyone.", noon, spike)[0]?.kind).toBe("daylight");
    expect(daylightRule("Dawn and Spike exit the house, arguing about the dishes.", noon, spike)).toHaveLength(1);
    expect(daylightRule("Spike walked out the door ahead of everyone.", at("2001-10-15 20:30"), spike)).toHaveLength(0);
    expect(daylightRule("Spike ran out the door under a smoking blanket.", noon, spike)).toHaveLength(0);
    expect(daylightRule("Buffy walked out the door while Spike watched from the hall.", noon, { ...spike, vampires: [{ name: "Angel", aliases: [] }] })).toHaveLength(0);
    expect(daylightRule("Spike remembered how he once walked out the door in Prague.", noon, spike)).toHaveLength(0);
  });
  test("a truth that they can be out by day turns it off", () => {
    expect(daylightRule("Spike walked out the door.", at("2001-10-15 12:06"), { ...spike, truths: ["Spike can go out in daylight here"] })).toHaveLength(0);
  });
});

describe("the weekday and the month against the date", () => {
  const wed = at("2001-10-10 08:00");
  test("10 October 2001 was a Wednesday", () => {
    expect(storyDate(wed.time!.minutes)).toMatchObject({ year: 2001, month: 9, day: 10, weekday: 3 });
  });
  test("the wrong day, said as today", () => {
    expect(dateRule("Just a Thursday morning settling into its own weight.", wed)[0]?.conflict).toContain("Wednesday 10 October");
    expect(dateRule("It's Thursday, and the house knows it.", wed)).toHaveLength(1);
    expect(dateRule("Just a Wednesday morning settling into its own weight.", wed)).toHaveLength(0);
  });
  test("a day as a figure of speech, a habit or a plan is left alone", () => {
    for (const s of ["A lawn mower starts two houses down — a Monday-morning sound on a Wednesday.", "That's a Tuesday problem.", "You just handed me a Saturday.", "Every Sunday she marks what's low.", "Next Thursday morning they fly in.", "It feels like a Sunday morning."])
      expect(dateRule(s, wed), s).toHaveLength(0);
  });
  test("the wrong end of the month", () => {
    expect(dateRule("The ordinary murk of a small town at the wrong end of October.", wed)).toHaveLength(1);
    expect(dateRule("The late October sun sat low and gold.", at("2001-10-12 15:00"))).toHaveLength(1);
    expect(dateRule("The late October sun sat low and gold.", at("2001-10-27 15:00"))).toHaveLength(0);
    expect(dateRule("She died in late May.", wed)).toHaveLength(0);
  });
});

describe("the story's year", () => {
  const y2001 = at("2001-10-14 10:00");
  test("emoji on a 2001 Nokia is flagged; the same reply in 2015 isn't", () => {
    expect(periodRule("The screen showed the text to Spike, complete with trophy and crown emoji.", y2001)[0]?.kind).toBe("period");
    expect(periodRule("The screen showed the text, complete with trophy and crown emoji.", at("2015-10-14 10:00"))).toHaveLength(0);
    expect(periodRule("She rented the DVD and watched it twice.", y2001)).toHaveLength(0);
  });
  test("what your own turns brought in is yours", () => {
    expect(periodRule("He queued the podcast for the drive.", y2001, (re) => re.test("Gabriel plays his favourite podcast."))).toHaveLength(0);
  });
  test("a day-count clock has no year to check", () => {
    expect(periodRule("With emojis.", at("Day 3 10:00"))).toHaveLength(0);
  });
});

describe("one value per person", () => {
  const people = ["Eleanor Winters", "Eleanor", "Spike", "George Winters", "George", "Gabriel"];
  const memories = ["Eleanor Winters grew up in an orphanage, is a neurosurgeon, and married Jonathan.", "Spike knew George Winters, Gabriel's great-great-grandfather, in 1880.", "Spike's blood preference is O positive.", "Spike said O negative tasted the closest."];
  const records = (name: string) => memories.filter((m) => m.includes(name));
  test("a specialty and a place in the family tree every record agrees on", () => {
    expect(oneValueRule("Eleanor is a heart surgeon, and she reads people like scans.", { people, records })[0]?.conflict).toContain("neurosurgeon");
    expect(oneValueRule("Eleanor is a neurosurgeon.", { people, records })).toHaveLength(0);
    expect(oneValueRule("George Winters was your great-grandfather, then.", { people, records })[0]?.conflict).toContain("great-great-grandfather");
  });
  test("records that disagree settle nothing, until a truth does", () => {
    expect(oneValueRule("Spike took the O negative without a word.", { people, records })).toHaveLength(0);
    expect(oneValueRule("Spike took the O negative without a word.", { people, records, truths: ["Spike's blood type of choice is O+"] })[0]?.conflict).toContain("O positive");
  });
});

describe("no record of something that is on the page (7.4)", () => {
  let chatId = "";
  beforeAll(() => {
    freshDb();
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Buffy", first_mes: "Hi." } });
    chatId = createChat({ characterId: createCharacter(data) }).id;
    addMessage(chatId, "user", "He leaves a card on the pillow: \"Use them. — M.\" in his mother's slanted handwriting.");
    addMessage(chatId, "assistant", "She turns the card over twice.", { name: "Buffy" });
  });
  test("the page is searched before the flag stands", () => {
    expect(onThePage(chatId, 99, "Gabriel's mother left a card on the pillow in slanted handwriting", ["Gabriel", "Buffy"])).toBe(2);
    expect(onThePage(chatId, 99, "Gabriel promised to teach her to drive a motorcycle", ["Gabriel", "Buffy"])).toBeNull();
    // Only what came before the reply counts.
    expect(onThePage(chatId, 2, "Gabriel's mother left a card on the pillow in slanted handwriting")).toBeNull();
  });
  test("the new checks are in the catalog", () => {
    for (const id of ["weather", "daylight", "weekday", "period", "onevalue"]) expect(slipById(id)?.phase, id).toBe("reply");
  });
});
