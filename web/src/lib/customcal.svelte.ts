import { get } from "./api";

/**
 * G1: calendars you build, in the browser (mirrors server/src/trackers/customcal.ts). The story
 * clock stays minutes; a built calendar only names the days: day 0 is the first day of the era's
 * first year, a year is its months plus festival days plus a leap day when the rule says.
 */
export interface CustomCalendar {
  id?: string;
  name: string;
  months: { name: string; days: number }[];
  festivals: { name: string; after: number; days: number }[];
  weekdays: string[];
  era: { name: string; firstYear: number };
  leap: { every: number; month: number; days: number } | null;
  moons: { name: string; cycle: number; offset: number }[];
  holidays: { name: string; month: number; day: number }[];
  storySeasons: boolean;
  seasons: { name: string; fromMonth: number }[];
}

export interface CustomDate {
  year: number;
  month: number | null;
  monthName: string | null;
  day: number;
  festival: string | null;
  weekday: string | null;
  moons: { name: string; phase: string }[];
}

const PHASES = ["new", "waxing crescent", "first quarter", "waxing gibbous", "full", "waning gibbous", "last quarter", "waning crescent"];
const mod = (a: number, n: number) => ((a % n) + n) % n;

function yearParts(c: CustomCalendar, yearIndex: number) {
  const leap = c.leap && mod(yearIndex + 1, c.leap.every) === 0 ? c.leap : null;
  const parts: { kind: "month" | "festival"; index: number; name: string; days: number }[] = [];
  const fest = (after: number) => c.festivals.filter((f) => f.after === after).forEach((f) => parts.push({ kind: "festival", index: after, name: f.name, days: f.days }));
  fest(0);
  c.months.forEach((m, i) => {
    parts.push({ kind: "month", index: i + 1, name: m.name, days: m.days + (leap && leap.month === i + 1 ? leap.days : 0) });
    fest(i + 1);
  });
  return parts;
}
export const yearLength = (c: CustomCalendar, yearIndex: number) => yearParts(c, yearIndex).reduce((n, p) => n + p.days, 0);
export const monthLength = (c: CustomCalendar, year: number, month: number) => yearParts(c, year - c.era.firstYear).find((p) => p.kind === "month" && p.index === month)?.days ?? 0;

export function customDate(c: CustomCalendar, absDay: number): CustomDate {
  let yearIndex = 0;
  let d = absDay;
  const cycle = c.leap?.every ?? 1;
  const cycleDays = Array.from({ length: cycle }, (_, i) => yearLength(c, i)).reduce((a, b) => a + b, 0);
  if (Math.abs(d) > cycleDays) {
    const k = Math.floor(d / cycleDays);
    yearIndex += k * cycle;
    d -= k * cycleDays;
  }
  while (d < 0) {
    yearIndex--;
    d += yearLength(c, yearIndex);
  }
  while (d >= yearLength(c, yearIndex)) {
    d -= yearLength(c, yearIndex);
    yearIndex++;
  }
  let month: number | null = null;
  let monthName: string | null = null;
  let festival: string | null = null;
  let day = 1;
  for (const p of yearParts(c, yearIndex)) {
    if (d < p.days) {
      if (p.kind === "month") {
        month = p.index;
        monthName = p.name;
      } else festival = p.name;
      day = d + 1;
      break;
    }
    d -= p.days;
  }
  return {
    year: yearIndex + c.era.firstYear,
    month,
    monthName,
    day,
    festival,
    weekday: c.weekdays.length ? c.weekdays[mod(absDay, c.weekdays.length)]! : null,
    moons: c.moons.map((m) => ({ name: m.name, phase: PHASES[Math.round((mod(absDay + m.offset, m.cycle) / m.cycle) * 8) % 8]! })),
  };
}

/** The absolute day of a date in the calendar. */
export function customDay(c: CustomCalendar, year: number, month: number, day: number): number {
  const yearIndex = year - c.era.firstYear;
  let abs = 0;
  if (yearIndex >= 0) for (let y = 0; y < yearIndex; y++) abs += yearLength(c, y);
  else for (let y = -1; y >= yearIndex; y--) abs -= yearLength(c, y);
  for (const p of yearParts(c, yearIndex)) {
    if (p.kind === "month" && p.index === month) return abs + Math.min(day, p.days) - 1;
    abs += p.days;
  }
  return abs;
}

const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
export function customDateText(c: CustomCalendar, d: CustomDate) {
  const era = c.era.name ? ` ${c.era.name}` : "";
  return d.festival ? `${d.festival}, ${d.year}${era}` : `${ord(d.day)} ${d.monthName}, ${d.year}${era}`;
}

/** The calendars you built, loaded once and refreshed when the builder saves. */
export const calendars = $state<{ list: (CustomCalendar & { id: string })[]; loaded: boolean }>({ list: [], loaded: false });
export async function loadCalendars(force = false) {
  if (calendars.loaded && !force) return calendars.list;
  try {
    calendars.list = (await get<{ calendars: (CustomCalendar & { id: string })[] }>("/api/calendars")).calendars;
    calendars.loaded = true;
  } catch {
    calendars.list = [];
  }
  return calendars.list;
}
export const calendarDef = (id: string | null | undefined) => (id?.startsWith("custom:") ? (calendars.list.find((c) => c.id === id.slice(7)) ?? null) : null);

export function blankCalendar(): CustomCalendar {
  return {
    name: "",
    months: [
      { name: "First Month", days: 30 },
      { name: "Second Month", days: 30 },
      { name: "Third Month", days: 30 },
    ],
    festivals: [],
    weekdays: ["Firstday", "Secondday", "Thirdday", "Fourthday", "Fifthday", "Sixthday", "Restday"],
    era: { name: "", firstYear: 1 },
    leap: null,
    moons: [],
    holidays: [],
    storySeasons: true,
    seasons: [],
  };
}
