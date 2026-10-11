import { z } from "zod";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { badRequest, notFound } from "../lib/http";

/**
 * Calendars you build (Almanac plan G1). A built calendar only names the days: the story clock
 * stays one count of minutes, so the ledger never changes shape. Day 0 is the first day of the
 * era's first year; from there a year is its months, plus festival days that belong to no month,
 * plus a leap day on the years the rule says. Weekdays (or none) cycle from day 0; moons cycle
 * by their own lengths. Mirrored in the browser by web/src/lib/customcal.ts.
 *
 * Built-in fantasy calendars stay Westeros only (the user's call): this builder covers the rest.
 */

const name = z.string().trim().min(1).max(40);
export const customCalendarSchema = z.object({
  name: z.string().trim().min(1).max(60),
  months: z.array(z.object({ name, days: z.number().int().min(1).max(100) })).min(1).max(30),
  /** Days between months that belong to none ("Midwinter", after month 1). `after`: 0 = before the first month. */
  festivals: z.array(z.object({ name, after: z.number().int().min(0).max(30), days: z.number().int().min(1).max(10).default(1) })).max(20).default([]),
  /** Empty: the calendar has no weeks. */
  weekdays: z.array(name).max(14).default([]),
  era: z.object({ name: z.string().trim().max(20).default(""), firstYear: z.number().int().min(-100000).max(100000).default(1) }).default({ name: "", firstYear: 1 }),
  /** Every `every` years, `month` gets `days` more (null: no leap years). */
  leap: z.object({ every: z.number().int().min(2).max(1000), month: z.number().int().min(1).max(30), days: z.number().int().min(1).max(10).default(1) }).nullable().default(null),
  moons: z.array(z.object({ name, cycle: z.number().min(1).max(1000), offset: z.number().min(0).max(1000).default(0) })).max(6).default([]),
  holidays: z.array(z.object({ name, month: z.number().int().min(1).max(30), day: z.number().int().min(1).max(100) })).max(60).default([]),
  /** Story seasons: the season changes when the story says so (else by month). */
  storySeasons: z.boolean().default(true),
  /** By month: which season each month is in (optional; used when story seasons are off). */
  seasons: z.array(z.object({ name, fromMonth: z.number().int().min(1).max(30) })).max(8).default([]),
});
export type CustomCalendar = z.infer<typeof customCalendarSchema>;

export interface CustomDate {
  year: number;
  /** 1-based; null on a festival day. */
  month: number | null;
  monthName: string | null;
  day: number;
  festival: string | null;
  weekday: string | null;
  holiday: string | null;
  moons: { name: string; phase: string; illumination: number }[];
  season: string | null;
}

const PHASES = ["new", "waxing crescent", "first quarter", "waxing gibbous", "full", "waning gibbous", "last quarter", "waning crescent"];
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** The year's pieces in order: months (with their leap days) and festival days between them. */
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

/** Absolute day (0 = the first day of the era's first year) → the calendar's date. */
export function customDate(c: CustomCalendar, absDay: number): CustomDate {
  let yearIndex = 0;
  let d = absDay;
  // Whole cycles of leap years first, so far dates stay quick.
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
  const weekday = c.weekdays.length ? c.weekdays[mod(absDay, c.weekdays.length)]! : null;
  const holiday = month ? (c.holidays.find((h) => h.month === month && h.day === day)?.name ?? null) : festival;
  const moons = c.moons.map((m) => {
    const age = mod(absDay + m.offset, m.cycle) / m.cycle;
    return { name: m.name, phase: PHASES[Math.round(age * 8) % 8]!, illumination: Math.round(((1 - Math.cos(age * 2 * Math.PI)) / 2) * 100) };
  });
  const seasons = [...c.seasons].sort((a, b) => a.fromMonth - b.fromMonth);
  const season = month && seasons.length ? (seasons.filter((s) => s.fromMonth <= month!).at(-1) ?? seasons.at(-1)!).name : null;
  return { year: yearIndex + c.era.firstYear, month, monthName, day, festival, weekday, holiday, moons, season };
}

/** The calendar's date → absolute day (the inverse, for a start date you type). */
export function customDay(c: CustomCalendar, year: number, month: number, day: number): number {
  const yearIndex = year - c.era.firstYear;
  let abs = 0;
  if (yearIndex >= 0) for (let y = 0; y < yearIndex; y++) abs += yearLength(c, y);
  else for (let y = -1; y >= yearIndex; y--) abs -= yearLength(c, y);
  for (const p of yearParts(c, yearIndex)) {
    if (p.kind === "month" && p.index === month) return abs + Math.min(day, p.days) - 1;
    abs += p.days;
  }
  throw badRequest("No such month");
}

const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/** "14 Mirtul 1372 09:00", "the 3rd of Ches, 1372 DR" → minutes on the story clock. Null when it isn't this calendar's date. */
export function parseCustomDate(c: CustomCalendar, text: string): number | null {
  const t = text.trim();
  const time = t.match(/(\d{1,2}):(\d{2})\s*$/);
  const rest = time ? t.slice(0, time.index).trim() : t;
  const months = c.months.map((m, i) => ({ i: i + 1, re: new RegExp(`\\b${m.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") }));
  const hit = months.find((m) => m.re.test(rest));
  if (!hit) return null;
  const nums = [...rest.replace(hit.re, " ").matchAll(/-?\d+/g)].map((m) => Number(m[0]));
  const day = nums[0] ?? 1;
  const year = nums[1] ?? c.era.firstYear;
  return customDay(c, year, hit.i, day) * 1440 + (time ? Number(time[1]) * 60 + Number(time[2]) : 9 * 60);
}

/** "the 14th of Mirtul, 1372 DR" / "Midwinter, 1372 DR". */
export function customDateText(c: CustomCalendar, d: CustomDate) {
  const era = c.era.name ? ` ${c.era.name}` : "";
  return d.festival ? `${d.festival}${d.day > 1 ? ` (day ${d.day})` : ""}, ${d.year}${era}` : `the ${ord(d.day)} of ${d.monthName}, ${d.year}${era}`;
}

// ---------- storage ----------

interface Row {
  id: string;
  name: string;
  data: string;
  created_at: number;
  updated_at: number;
}
const view = (r: Row) => ({ id: r.id, ...customCalendarSchema.parse({ ...parseJson<object>(r.data, {}), name: r.name }), updatedAt: r.updated_at });
export type StoredCalendar = ReturnType<typeof view>;

const cache = new Map<string, StoredCalendar | null>();
export function getCustomCalendar(id: string): StoredCalendar | null {
  if (cache.has(id)) return cache.get(id)!;
  const r = one<Row>("SELECT * FROM calendars_custom WHERE id = ?", id);
  const v = r ? view(r) : null;
  cache.set(id, v);
  return v;
}
export const listCustomCalendars = () => all<Row>("SELECT * FROM calendars_custom ORDER BY name").map(view);

export function saveCustomCalendar(input: unknown, id?: string) {
  const c = customCalendarSchema.parse(input);
  const t = now();
  if (id) {
    if (!one("SELECT 1 FROM calendars_custom WHERE id = ?", id)) throw notFound("No such calendar");
    run("UPDATE calendars_custom SET name = ?, data = ?, updated_at = ? WHERE id = ?", c.name, JSON.stringify(c), t, id);
  } else {
    id = newId();
    run("INSERT INTO calendars_custom (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", id, c.name, JSON.stringify(c), t, t);
  }
  cache.delete(id);
  return getCustomCalendar(id)!;
}

export function deleteCustomCalendar(id: string) {
  run("DELETE FROM calendars_custom WHERE id = ?", id);
  cache.delete(id);
}

/** "custom:<id>" → the stored calendar (null when it was deleted). */
export function customOf(calendar: string | null | undefined): StoredCalendar | null {
  return calendar?.startsWith("custom:") ? getCustomCalendar(calendar.slice(7)) : null;
}
