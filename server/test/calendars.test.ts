import { beforeAll, describe, expect, test } from "bun:test";
import { normalizeCard } from "../src/cards/card";
import { skyLine } from "../src/sim/sky";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, updateChat } from "../src/services/chats";
import { applySetup, setupView } from "../src/services/setup";
import { asCalendar, CALENDARS, calendarHint, describeWhen, noteTime } from "../src/trackers/calendars";
import { type CustomCalendar, customCalendarSchema, customDate, customDay, deleteCustomCalendar, listCustomCalendars, parseCustomDate, saveCustomCalendar, yearLength } from "../src/trackers/customcal";
import { buildNote } from "../src/trackers/note";
import { currentFold, linesToOps, writeEvents } from "../src/trackers/store";
import { freshDb } from "./helpers";

/** A small built calendar: three months, a festival after the first, a leap day every 4th year, two moons. */
const SMALL: CustomCalendar = customCalendarSchema.parse({
  name: "The Reach Reckoning",
  months: [
    { name: "Frostmoot", days: 30 },
    { name: "Thaw", days: 30 },
    { name: "Harvest", days: 30 },
  ],
  festivals: [{ name: "Midwinter", after: 1, days: 1 }],
  weekdays: ["Oneday", "Twoday", "Threeday", "Fourday", "Fiveday"],
  era: { name: "RR", firstYear: 100 },
  leap: { every: 4, month: 3, days: 1 },
  moons: [
    { name: "Selune", cycle: 30, offset: 0 },
    { name: "the Red Eye", cycle: 7, offset: 3 },
  ],
  holidays: [{ name: "First Sowing", month: 2, day: 1 }],
  storySeasons: false,
  seasons: [
    { name: "winter", fromMonth: 1 },
    { name: "spring", fromMonth: 2 },
    { name: "autumn", fromMonth: 3 },
  ],
});

beforeAll(() => freshDb());

describe("calendars you build (G1)", () => {
  test("built-in calendars stay Gregorian and Westeros only", () => {
    expect(CALENDARS.map((c) => c.id)).toEqual(["gregorian", "westeros"]);
  });

  test("days map onto months, festival days and leap days", () => {
    expect(yearLength(SMALL, 0)).toBe(91);
    expect(yearLength(SMALL, 3)).toBe(92);
    expect(customDate(SMALL, 0)).toMatchObject({ year: 100, month: 1, monthName: "Frostmoot", day: 1, weekday: "Oneday", season: "winter" });
    expect(customDate(SMALL, 30)).toMatchObject({ festival: "Midwinter", month: null, holiday: "Midwinter" });
    expect(customDate(SMALL, 31)).toMatchObject({ month: 2, day: 1, holiday: "First Sowing", season: "spring" });
    // The 4th year (index 3) has Harvest 31.
    const y4 = 91 * 3;
    expect(customDate(SMALL, y4 + 61 + 30)).toMatchObject({ year: 103, month: 3, day: 31 });
    expect(customDate(SMALL, y4 + 92)).toMatchObject({ year: 104, month: 1, day: 1 });
    expect(customDate(SMALL, -1)).toMatchObject({ year: 99, month: 3, day: 31 });
    // There and back again, far out.
    for (const d of [0, 45, 1000, 12345, -500]) {
      const c = customDate(SMALL, d);
      if (c.month) expect(customDay(SMALL, c.year, c.month, c.day)).toBe(d);
    }
  });

  test("moons turn on their own cycles", () => {
    expect(customDate(SMALL, 0).moons[0]).toMatchObject({ name: "Selune", phase: "new" });
    expect(customDate(SMALL, 15).moons[0]).toMatchObject({ phase: "full", illumination: 100 });
    expect(customDate(SMALL, 0).moons[1]!.name).toBe("the Red Eye");
  });

  test("a start date written in the calendar", () => {
    expect(parseCustomDate(SMALL, "14 Thaw 101 21:30")).toBe(customDay(SMALL, 101, 2, 14) * 1440 + 21 * 60 + 30);
    expect(parseCustomDate(SMALL, "the 3rd of Harvest")).toBe(customDay(SMALL, 100, 3, 3) * 1440 + 9 * 60);
    expect(parseCustomDate(SMALL, "14 March 101")).toBeNull();
  });

  test("stored, listed, and read by the story's clock, note and tracker prompt", () => {
    const saved = saveCustomCalendar(SMALL);
    expect(listCustomCalendars().map((c) => c.name)).toEqual(["The Reach Reckoning"]);
    const id = `custom:${saved.id}` as const;
    expect(asCalendar(id)).toBe(id);
    const t = { minutes: customDay(SMALL, 101, 2, 1) * 1440 + 20 * 60, form: "date" as const };
    const w = describeWhen(t, id);
    expect(w.label).toMatch(/^\w+day, The 1st of Thaw, 101 RR · 20:00$/);
    expect(w).toMatchObject({ monthName: "Thaw", day: 1, year: 101, season: "spring" });
    expect(noteTime(t, id)).toContain("today: First Sowing");
    expect(noteTime(t, id)).toContain("Selune:");
    expect(calendarHint(id)).toContain("never write a date");
    deleteCustomCalendar(saved.id);
    expect(asCalendar(id)).toBe("gregorian");
  });

  test("the sky shows a built calendar's moons", () => {
    const night = { seed: "x", minutes: 15 * 1440 + 23 * 60, form: "date" as const, climate: "temperate", latitude: 45, moons: SMALL.moons };
    expect(skyLine(night, "clear").moon).toContain("Selune: full moon");
    expect(skyLine(night, "clear").line).toContain("Selune full");
  });

  test("Session Zero: pick a built calendar and start on its date; the note says it its way", () => {
    const saved = saveCustomCalendar(SMALL);
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Garlan", first_mes: "The fields are gold." } });
    const chatId = createChat({ characterId: createCharacter(data) }).id;
    const first = addMessage(chatId, "assistant", "The fields are gold.", { name: "Garlan" });
    writeEvents(chatId, { messageId: first, swipeIdx: -1 }, linesToOps(["cast: Garlan@spot"]).ops, "model");
    expect(setupView(chatId).options.calendars.map((c) => c.label)).toContain("The Reach Reckoning");
    const a = setupView(chatId).answers;
    applySetup(chatId, { ...a, world: { ...a.world, calendar: `custom:${saved.id}`, start: "1 Thaw 101 20:00" } });
    const st = currentFold(chatId).result.state;
    expect(st.time?.minutes).toBe(customDay(SMALL, 101, 2, 1) * 1440 + 20 * 60);
    const note = buildNote(st, { userName: "You", seq: 2, calendar: `custom:${saved.id}` })?.text ?? "";
    expect(note).toContain("the 1st of Thaw, 101 RR");
    updateChat(chatId, { settings: {} });
  });
});
