import { trackerConfig } from "../trackers/store";
import { asCalendar, describeWhen, type When } from "../trackers/calendars";
import type { StoryTime } from "../trackers/clock";
import type { ScanEntry } from "./activate";
import { factsNowFor, type LoreFact } from "./facts";

/**
 * Anniversaries (docs/15, 5.1). Event facts with a story date fire again on that date ("a year since
 * the wedding"), and birthdays from the detail sheet on theirs ("Wren's birthday"), named by the
 * chat's calendar. They fire on the day itself, not the day before.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** A birthday as month and day: "19 January", "January 19th", "the 14th of the 10th moon". */
export function monthDay(text: string): { month: number; day: number } | null {
  const t = text.toLowerCase();
  const name = MONTHS.findIndex((m) => new RegExp(`\\b${m.slice(0, 3)}[a-z]*\\b`).test(t));
  const day = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/)?.[1];
  if (name >= 0 && day) return { month: name + 1, day: Number(day) };
  const moon = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+)?of\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\s+moon\b/);
  if (moon) return { month: Number(moon[2]), day: Number(moon[1]) };
  return null;
}

const years = (n: number) => (n === 1 ? "a year" : `${n} years`);

/**
 * The entries whose dates come round today, with the line to say about it. `now` is the story's
 * clock; `calendar` names the day.
 */
export function datesToday(chatId: string, entries: ScanEntry[], now: StoryTime | null, calendarId: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!now || now.form !== "date" || !entries.length) return out;
  const calendar = asCalendar(calendarId);
  const today = describeWhen(now, calendar);
  if (today.month == null || today.day == null) return out;
  const facts = factsNowFor(entries.map((e) => e.id), chatId);
  const say = (id: string, line: string) => out.set(id, out.has(id) ? `${out.get(id)}; ${line}` : line);
  for (const e of entries) {
    for (const f of facts.get(e.id) ?? []) {
      const line = anniversary(f, today, calendar, e.comment || e.keys[0] || "");
      if (line) say(e.id, line);
    }
  }
  return out;
}

function anniversary(f: LoreFact, today: When, calendar: ReturnType<typeof asCalendar>, name: string): string | null {
  if (f.slot === "birthday") {
    const md = monthDay(f.value);
    return md && md.month === today.month && md.day === today.day ? `Today, ${today.date}, is ${name ? `${name}'s` : "their"} birthday` : null;
  }
  if (f.kind !== "event" || f.sinceTime == null) return null;
  const then = describeWhen({ minutes: f.sinceTime, form: "date" }, calendar);
  if (then.month !== today.month || then.day !== today.day || then.year == null || today.year == null || today.year <= then.year) return null;
  const what = f.value.replace(/\s*\([^)]*\)\s*$/, "");
  return `Today, ${today.date}: ${years(today.year - then.year)} since ${what.charAt(0).toLowerCase()}${what.slice(1)}`;
}

/** The chat's story calendar (TRK-10). */
export const chatCalendar = (chatId: string) => trackerConfig(chatId).calendar;
