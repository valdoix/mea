/**
 * Story-clock arithmetic in the browser (mirrors server/src/trackers/clock.ts): minutes since
 * 0001-01-01 in "date" form. Westeros shares the same days; only the names differ.
 */
import { calendarDef, customDate, customDateText } from "./customcal.svelte";

const YEAR1 = (() => {
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCFullYear(1);
  return d.getTime();
})();

export interface Ymd {
  year: number;
  month: number;
  day: number;
}

export function ymdOf(minutes: number): Ymd {
  const d = new Date(YEAR1 + minutes * 60_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function utc(year: number, month: number, day: number) {
  const d = new Date(Date.UTC(2000, month - 1, day));
  d.setUTCFullYear(year);
  return d;
}

export function daysIn(year: number, month: number): number {
  return utc(year, month + 1, 0).getUTCDate();
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(year: number, month: number, day: number): number {
  return (utc(year, month, day).getUTCDay() + 6) % 7;
}

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A stored clock string ("0299-10-14 23:10", "Day 3 21:40") as the chat's calendar reads it. */
export function readClock(s: string | null | undefined, calendar: string = "gregorian"): string {
  if (!s) return "";
  const m = s.match(/^(\d{1,4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?$/);
  if (!m) return s;
  const [y, mo, d, t] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4]];
  // G1: a calendar you built names the same day its own way.
  const custom = calendarDef(calendar);
  if (custom) {
    const day = Math.round((utc(y, mo, d).getTime() - YEAR1) / 86_400_000);
    const text = customDateText(custom, customDate(custom, day));
    return t ? `${text} · ${t}` : text;
  }
  const date = calendar === "westeros" ? `${ordinal(d)} of the ${ordinal(mo)} moon, ${y} AC` : `${d} ${MONTH_NAMES[mo - 1]?.slice(0, 3)} ${y}`;
  return t ? `${date} · ${t}` : date;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}
