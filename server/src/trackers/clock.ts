/**
 * The code-owned story clock (TRK-10). Story time is either a calendar date ("2026-03-14 21:40")
 * or a relative day when the story never names one ("Day 3 21:40"). Both map to minutes so the
 * clock can only move forward.
 */
export interface StoryTime {
  minutes: number;
  /** "date": minutes since 0001-01-01 (UTC math, no time zones); "day": minutes since Day 1 00:00. */
  form: "date" | "day";
}

const DAY = 1440;

export function parseStoryTime(s: unknown): StoryTime | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  let m = t.match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (m) return ymd(m[1]!, m[2]!, m[3]!, m[4], m[5]);
  // Westeros (calendars.ts): "the 14th day of the 10th moon of 299 AC 21:40" or "299 AC, 10th moon, day 14 21:40".
  m = t.match(/^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\s+moon,?\s+(?:of\s+)?(\d{1,4})\s*AC(?:[\s,·]+(\d{1,2}):(\d{2}))?$/i);
  if (m) return ymd(m[3]!, m[2]!, m[1]!, m[4], m[5]);
  m = t.match(/^(\d{1,4})\s*AC,?\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+moon,?\s+(?:day\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:[\s,·]+(\d{1,2}):(\d{2}))?$/i);
  if (m) return ymd(m[1]!, m[2]!, m[3]!, m[4], m[5]);
  m = t.match(/^day\s*(\d{1,5})(?:[ ,]+(\d{1,2}):(\d{2}))?$/i);
  if (m) return { minutes: (Number(m[1]) - 1) * DAY + Number(m[2] ?? 12) * 60 + Number(m[3] ?? 0), form: "day" };
  return null;
}

function ymd(y: string, mo: string, d: string, h?: string, mi?: string): StoryTime | null {
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  const date = new Date(Date.UTC(2000, Number(mo) - 1, Number(d), Number(h ?? 12), Number(mi ?? 0)));
  date.setUTCFullYear(Number(y));
  if (Number.isNaN(date.getTime())) return null;
  // M26: no February 30th (the date would roll over into March).
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
  return { minutes: Math.round((date.getTime() - YEAR1) / 60_000), form: "date" };
}

const YEAR1 = (() => {
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCFullYear(1);
  return d.getTime();
})();

const pad = (n: number) => String(n).padStart(2, "0");

export function formatStoryTime(t: StoryTime): string {
  if (t.form === "day") {
    const day = Math.floor(t.minutes / DAY) + 1;
    const rest = ((t.minutes % DAY) + DAY) % DAY;
    return `Day ${day} ${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`;
  }
  const d = new Date(YEAR1 + t.minutes * 60_000);
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "Thu 23:10" or "Day 3 · 23:10", for chips, the HUD and timestamps. */
export function shortStoryTime(s: unknown): string {
  const t = parseStoryTime(s);
  if (!t) return typeof s === "string" ? s : "";
  if (t.form === "day") return formatStoryTime(t).replace(/ (\d{1,2}:\d{2})$/, " · $1");
  const d = new Date(YEAR1 + t.minutes * 60_000);
  return `${d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function addMinutes(s: string, minutes: number): string | null {
  const t = parseStoryTime(s);
  return t ? formatStoryTime({ ...t, minutes: t.minutes + Math.round(minutes) }) : null;
}

export function timeOfDay(s: unknown): string | null {
  const t = parseStoryTime(s);
  if (!t) return null;
  const h = Math.floor((((t.minutes % DAY) + DAY) % DAY) / 60);
  return h < 5 ? "late night" : h < 7 ? "dawn" : h < 11 ? "morning" : h < 14 ? "midday" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
}

const DURATION_PART = /^\s*(?:,\s*|and\s+)?(\d+(?:\.\d+)?)\s*(months?|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w|years?|y)(?![a-z])/i;

/**
 * A duration at the start of the text, in one part or several: "90m", "1h30m", "1h 30m",
 * "2 hours 15 minutes", "1 day, 4 hours". Minutes summed, and the text after it.
 */
export function leadingDuration(s: string): { minutes: number; rest: string } | null {
  let rest = s.toLowerCase().replace(/\ban hour and a half\b/g, "90m").replace(/\bhalf an hour\b/g, "30m").replace(/\ban? (?=(?:minute|hour|day|week|month|year)\b)/g, "1 ");
  let total = 0;
  let parts = 0;
  for (let m = DURATION_PART.exec(rest); m; m = DURATION_PART.exec(rest)) {
    const u = m[2]!.toLowerCase();
    total += Number(m[1]) * (u.startsWith("mo") ? DAY * 30 : u[0] === "m" ? 1 : u[0] === "h" ? 60 : u[0] === "d" ? DAY : u[0] === "w" ? DAY * 7 : DAY * 365);
    rest = rest.slice(m[0].length);
    parts++;
  }
  return parts ? { minutes: Math.round(total), rest } : null;
}

/** "3 days", "2h", "90 minutes", "a week", "1h30m", "an hour and a half" → minutes, for /timeskip. */
export function parseDuration(s: string): number | null {
  const whole = leadingDuration(s.trim());
  if (whole && !whole.rest.trim()) return whole.minutes;
  const t = s.trim().toLowerCase().replace(/^an? /, "1 ");
  const units: [RegExp, number][] = [
    [/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes)$/, 1],
    [/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)$/, 60],
    [/^(\d+(?:\.\d+)?)\s*(d|day|days)$/, DAY],
    [/^(\d+(?:\.\d+)?)\s*(w|wk|week|weeks)$/, DAY * 7],
    [/^(\d+(?:\.\d+)?)\s*(month|months)$/, DAY * 30],
    [/^(\d+(?:\.\d+)?)\s*(y|year|years)$/, DAY * 365],
  ];
  for (const [re, mult] of units) {
    const m = t.match(re);
    if (m) return Math.round(Number(m[1]) * mult);
  }
  return null;
}

export function describeMinutes(m: number): string {
  if (m >= DAY * 2 && m % DAY === 0) return `${m / DAY} days`;
  if (m >= DAY) return `${Math.round((m / DAY) * 10) / 10} days`;
  if (m >= 120) return `${Math.round((m / 60) * 10) / 10} hours`;
  return `${m} minutes`;
}
