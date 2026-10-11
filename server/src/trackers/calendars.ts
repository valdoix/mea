import type { StoryTime } from "./clock";
import { customDate, customDateText, customOf } from "./customcal";

/**
 * Story calendars (TRK-10): how the story clock reads to people. The clock itself stays one
 * number of minutes in ISO form ("0299-10-14 23:10"), so every calendar shares the same date math
 * and the ledger never changes shape; a calendar only names the days.
 *
 * Westeros counts years After the Conquest (AC) and months as moons. Its seasons run for years
 * at a time and can't be computed, so a chat states its season instead.
 */
export type CalendarId = "gregorian" | "westeros" | `custom:${string}`;
export const CALENDAR_IDS: CalendarId[] = ["gregorian", "westeros"];

export interface CalendarInfo {
  id: CalendarId;
  name: string;
  hint: string;
}
export const CALENDARS: CalendarInfo[] = [
  { id: "gregorian", name: "Gregorian", hint: "Weekdays, months and years as we know them" },
  { id: "westeros", name: "Westeros", hint: "Years After the Conquest, months as moons, seasons that last for years" },
];

/** A story moment as people read it: what the HUD, the window and the note show. */
export interface When {
  calendar: CalendarId;
  form: "date" | "day";
  /** "Tuesday, 14 October 2026 · 23:10" / "The 14th day of the 10th moon, 299 AC · 23:10". */
  label: string;
  /** "Tue 14 Oct" / "14th of the 10th moon". */
  date: string;
  time: string;
  /** "Tue 23:10" / "10th moon, 14th · 23:10": for chips. */
  short: string;
  /** Hours as a fraction (23.17), for the sky. */
  hour: number;
  /** The time of day in the calendar's own words: "night", "the hour of the wolf". */
  period: string;
  weekday: string | null;
  day: number | null;
  month: number | null;
  monthName: string | null;
  year: number | null;
  season: string | null;
}

const DAY = 1440;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

export function asCalendar(v: unknown): CalendarId {
  if (typeof v === "string" && /^custom:[\w-]{1,40}$/.test(v) && customOf(v)) return v as CalendarId;
  return v === "westeros" ? "westeros" : "gregorian";
}

const YEAR1 = (() => {
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCFullYear(1);
  return d.getTime();
})();

/** Plain time-of-day words (every calendar's fallback). */
function plainPeriod(h: number): string {
  return h < 5 ? "late night" : h < 7 ? "dawn" : h < 11 ? "morning" : h < 14 ? "midday" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
}

/** Westeros names its night hours after animals; the day keeps plain words. */
function westerosPeriod(h: number): string {
  if (h >= 18.5 && h < 21) return "the hour of the bat";
  if (h >= 21 || h < 1) return "the hour of the owl";
  if (h < 3) return "the hour of the nightingale";
  if (h < 5) return "the hour of the wolf";
  if (h < 7) return "dawn";
  if (h < 11) return "morning";
  if (h < 13.5) return "midday";
  return "afternoon";
}

export function describeWhen(t: StoryTime, calendar: CalendarId, season?: string | null): When {
  const rest = ((t.minutes % DAY) + DAY) % DAY;
  const hh = Math.floor(rest / 60);
  const mm = rest % 60;
  const time = `${pad(hh)}:${pad(mm)}`;
  const hour = rest / 60;
  const custom = customOf(calendar);
  const period = calendar === "westeros" ? westerosPeriod(hour) : plainPeriod(hour);
  const seasonText = season?.trim() || null;
  if (t.form === "day") {
    const day = Math.floor(t.minutes / DAY) + 1;
    return { calendar, form: "day", label: `Day ${day} · ${time}`, date: `Day ${day}`, time, short: `Day ${day} · ${time}`, hour, period, weekday: null, day, month: null, monthName: null, year: null, season: seasonText };
  }
  if (custom) {
    // G1: a calendar you built names the same days its own way.
    const c = customDate(custom, Math.floor(t.minutes / DAY));
    const text = customDateText(custom, c);
    const short = c.festival ?? `${ordinal(c.day)} ${c.monthName}`;
    return {
      calendar, form: "date",
      label: `${c.weekday ? `${c.weekday}, ` : ""}${text[0]!.toUpperCase()}${text.slice(1)} · ${time}`,
      date: `${c.weekday ? `${c.weekday.slice(0, 3)} ` : ""}${short}`,
      time,
      short: `${short} · ${time}`,
      hour, period, weekday: c.weekday, day: c.day, month: c.month, monthName: c.monthName ?? c.festival, year: c.year,
      season: custom.storySeasons ? seasonText : (c.season ?? seasonText),
    };
  }
  const d = new Date(YEAR1 + t.minutes * 60_000);
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  if (calendar === "westeros") {
    const date = `the ${ordinal(day)} day of the ${ordinal(month)} moon`;
    return {
      calendar, form: "date",
      label: `${date[0]!.toUpperCase()}${date.slice(1)}, ${year} AC · ${time}`,
      date: `${ordinal(day)} of the ${ordinal(month)} moon`,
      time,
      short: `${ordinal(month)} moon, ${ordinal(day)} · ${time}`,
      hour, period, weekday: null, day, month, monthName: `${ordinal(month)} moon`, year, season: seasonText,
    };
  }
  const weekday = WEEKDAYS[d.getUTCDay()]!;
  const monthName = MONTHS[month - 1]!;
  return {
    calendar, form: "date",
    label: `${weekday}, ${day} ${monthName} ${year} · ${time}`,
    date: `${weekday.slice(0, 3)} ${day} ${monthName.slice(0, 3)}`,
    time,
    short: `${weekday.slice(0, 3)} ${time}`,
    hour, period, weekday, day, month, monthName, year,
    season: seasonText ?? northernSeason(month),
  };
}

function northernSeason(month: number): string {
  return month <= 2 || month === 12 ? "winter" : month <= 5 ? "spring" : month <= 8 ? "summer" : "autumn";
}

/** "Thu 21:40 → 23:10" when both ends fall on the same day; else both short labels. */
export function spanLabel(from: StoryTime | null, to: StoryTime, calendar: CalendarId): string {
  const b = describeWhen(to, calendar);
  if (!from) return b.short;
  const a = describeWhen(from, calendar);
  const sameDay = from.form === to.form && Math.floor(from.minutes / DAY) === Math.floor(to.minutes / DAY);
  return sameDay ? `${a.time} → ${b.time}` : `${a.short} → ${b.short}`;
}

/**
 * For the tracker model: how this chat writes dates in the ledger. The ledger keeps ISO dates;
 * in Westeros the year is the year AC and the month is the moon.
 */
export function calendarHint(calendar: CalendarId): string {
  const custom = customOf(calendar);
  if (custom) return `Calendar: ${custom.name}, a calendar of this story's own. Its dates can't be written in the ledger: move the clock only by how long passed ("clock: +2h", "clock: +1d"), and never write a date, a Gregorian weekday or a Gregorian month.`;
  if (calendar === "westeros") return 'Calendar: Westeros. Dates use the same form with the year After the Conquest and the moon as the month: the 14th day of the 10th moon of 299 AC is "0299-10-14 21:40". Never write Gregorian weekdays or month names.';
  return "";
}

/** For the story model's note: the date in the calendar's own words. */
export function noteTime(t: StoryTime, calendar: CalendarId, season?: string | null): string {
  const w = describeWhen(t, calendar, season);
  const custom = customOf(calendar);
  if (custom && w.form === "date") {
    const c = customDate(custom, Math.floor(t.minutes / DAY));
    const moons = c.moons.map((m) => `${m.name}: ${m.phase}`).join(", ");
    return `${w.weekday ? `${w.weekday}, ` : ""}${customDateText(custom, c)}, ${w.time} (${w.period})${c.holiday ? `; today: ${c.holiday}` : ""}${moons ? `; ${moons}` : ""}${w.season ? `; season: ${w.season}` : ""}`;
  }
  if (calendar === "westeros") return `${w.form === "date" ? `${w.date}, ${w.year} AC, ` : `${w.date}, `}${w.time} (${w.period})${w.season ? `; season: ${w.season}` : ""}`;
  return "";
}
