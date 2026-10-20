import { rng } from "./dice";

/**
 * The world's sky (after ALMANAC's engines): weather that evolves hour by hour from a climate,
 * a season and passing fronts; sunrise and sunset by latitude and day of year; the moon's
 * phase. All seeded by the chat and the hour, so swipes never reroll the sky. A weather line
 * the story writes is truth: the walk continues from it.
 */
export const LADDER = ["clear", "fair", "broken cloud", "overcast", "drizzle", "rain", "heavy rain", "storm"] as const;
type Level = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface Season {
  tmin: number;
  tmax: number;
  wet: number;
  storm: number;
  fog: number;
  wind: number;
}
const P = (tmin: number, tmax: number, wet: number, storm: number, fog: number, wind: number): Season => ({ tmin, tmax, wet, storm, fog, wind });

export const CLIMATES: Record<string, { label: string; diurnal: number; seasons: Record<"spring" | "summer" | "autumn" | "winter", Season> }> = {
  maritime: { label: "temperate maritime", diurnal: 0.8, seasons: { spring: P(5, 13, 0.45, 0.08, 0.3, 0.5), summer: P(12, 21, 0.35, 0.12, 0.15, 0.35), autumn: P(7, 14, 0.55, 0.15, 0.45, 0.6), winter: P(1, 7, 0.55, 0.12, 0.4, 0.65) } },
  continental: { label: "continental", diurnal: 1.2, seasons: { spring: P(2, 15, 0.35, 0.15, 0.2, 0.45), summer: P(15, 28, 0.3, 0.3, 0.1, 0.3), autumn: P(3, 13, 0.35, 0.08, 0.35, 0.45), winter: P(-12, -2, 0.35, 0.05, 0.2, 0.5) } },
  mediterranean: { label: "mediterranean", diurnal: 1, seasons: { spring: P(10, 20, 0.25, 0.1, 0.1, 0.35), summer: P(19, 31, 0.05, 0.2, 0.05, 0.3), autumn: P(14, 23, 0.3, 0.2, 0.15, 0.35), winter: P(6, 14, 0.4, 0.12, 0.2, 0.45) } },
  desert: { label: "desert", diurnal: 1.8, seasons: { spring: P(14, 30, 0.04, 0.3, 0.02, 0.5), summer: P(24, 42, 0.03, 0.4, 0.01, 0.45), autumn: P(15, 31, 0.04, 0.3, 0.02, 0.45), winter: P(4, 19, 0.06, 0.2, 0.05, 0.4) } },
  tropical: { label: "tropical", diurnal: 0.6, seasons: { spring: P(23, 31, 0.5, 0.4, 0.2, 0.3), summer: P(24, 32, 0.6, 0.45, 0.15, 0.3), autumn: P(23, 31, 0.55, 0.45, 0.2, 0.35), winter: P(22, 30, 0.4, 0.3, 0.2, 0.3) } },
  subarctic: { label: "subarctic", diurnal: 0.9, seasons: { spring: P(-6, 4, 0.35, 0.05, 0.2, 0.5), summer: P(8, 18, 0.4, 0.12, 0.2, 0.4), autumn: P(-2, 6, 0.45, 0.08, 0.3, 0.55), winter: P(-24, -12, 0.35, 0.05, 0.15, 0.55) } },
  alpine: { label: "alpine", diurnal: 1.4, seasons: { spring: P(-3, 8, 0.45, 0.15, 0.3, 0.6), summer: P(5, 17, 0.45, 0.35, 0.3, 0.5), autumn: P(-2, 8, 0.4, 0.1, 0.4, 0.6), winter: P(-14, -4, 0.45, 0.1, 0.25, 0.7) } },
};

export function climateFrom(text: string | undefined): string {
  const t = (text ?? "").toLowerCase();
  const rules: [RegExp, string][] = [
    [/tropic|jungle|rainforest|humid|island paradise/, "tropical"],
    [/desert|arid|dune|sahara|wasteland/, "desert"],
    [/mediterran|dry summer|olive|vineyard/, "mediterranean"],
    [/subarctic|arctic|tundra|taiga|frozen north/, "subarctic"],
    [/alpine|mountain|highland|peak/, "alpine"],
    [/continental|steppe|prairie|plains|midwest/, "continental"],
  ];
  for (const [re, id] of rules) if (re.test(t)) return id;
  return "maritime";
}

/**
 * Latitude from text. A setting the author typed may be a bare number ("34", "34N"); story text
 * needs a degree sign or the word, so "circa 2001" isn't 70° north.
 */
export function latitudeFrom(text: string | undefined, opts: { typed?: boolean } = {}): number {
  const t = (text ?? "").toLowerCase();
  const n = opts.typed
    ? /(-?\d+(?:\.\d+)?)\s*°?\s*([ns])?/.exec(t)
    : /(-?\d+(?:\.\d+)?)\s*°\s*([ns])?/.exec(t) ?? /latitude\s*(?:of\s*)?(-?\d+(?:\.\d+)?)\s*°?\s*([ns])?/.exec(t);
  if (n) return Math.max(-70, Math.min(70, Number(n[1]) * (n[2] === "s" ? -1 : 1)));
  if (/tropic|equator/.test(t)) return 10;
  if (/arctic|polar|subarctic/.test(t)) return 64;
  return /south/.test(t) ? -45 : 45;
}

/** Real places (and a few famous fictional towns) a story names: their climate and latitude. */
const PLACES: [RegExp, string, number][] = [
  [/\b(california|los angeles|san francisco|san diego|hollywood|sunnydale)\b/gi, "mediterranean", 34],
  [/\b(seattle|portland|vancouver|forks)\b/gi, "maritime", 47],
  [/\b(new york|manhattan|brooklyn|boston|chicago|toronto|detroit|hawkins|indiana|ohio)\b/gi, "continental", 41],
  [/\b(texas|arizona|nevada|las vegas|phoenix|new mexico|albuquerque)\b/gi, "desert", 33],
  [/\b(florida|miami|hawaii|honolulu|caribbean|jamaica|bali)\b/gi, "tropical", 22],
  [/\b(london|england|scotland|ireland|wales|dublin|edinburgh|paris|amsterdam|hogwarts)\b/gi, "maritime", 52],
  [/\b(rome|italy|greece|athens|spain|madrid|barcelona|lisbon|provence)\b/gi, "mediterranean", 40],
  [/\b(tokyo|japan|seoul|korea|beijing|moscow|berlin|vienna|prague)\b/gi, "continental", 40],
  [/\b(alaska|anchorage|iceland|reykjavik|norway|siberia)\b/gi, "subarctic", 62],
  [/\b(sydney|melbourne|new zealand|auckland)\b/gi, "maritime", -36],
];

/** The place a story names most, as climate and latitude (null when it names none). */
export function placeClimate(text: string | undefined): { climate: string; latitude: number } | null {
  let best: { climate: string; latitude: number; n: number } | null = null;
  for (const [re, climate, latitude] of PLACES) {
    const n = (text ?? "").match(re)?.length ?? 0;
    if (n && (!best || n > best.n)) best = { climate, latitude, n };
  }
  return best && { climate: best.climate, latitude: best.latitude };
}

/** Day of the year (1–366) for a story moment; "Day N" stories start in spring. */
export function dayOfYear(minutes: number, form: "date" | "day"): number {
  if (form === "day") return ((Math.floor(minutes / 1440) + 80) % 365) + 1;
  const YEAR1 = (() => {
    const d = new Date(Date.UTC(2000, 0, 1));
    d.setUTCFullYear(1);
    return d.getTime();
  })();
  const d = new Date(YEAR1 + minutes * 60_000);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const startD = new Date(start);
  startD.setUTCFullYear(d.getUTCFullYear());
  return Math.floor((d.getTime() - startD.getTime()) / 86_400_000) + 1;
}

export function seasonAt(doy: number, latitude: number): "spring" | "summer" | "autumn" | "winter" {
  const north = latitude >= 0;
  const s = doy < 80 || doy >= 355 ? "winter" : doy < 172 ? "spring" : doy < 266 ? "summer" : "autumn";
  if (north) return s;
  return ({ winter: "summer", spring: "autumn", summer: "winter", autumn: "spring" } as const)[s];
}

export function sun(doy: number, latitude: number): { rise: number | null; set: number | null } {
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10));
  const lat = (latitude * Math.PI) / 180;
  const d = (decl * Math.PI) / 180;
  const cosH = (Math.sin((-0.83 * Math.PI) / 180) - Math.sin(lat) * Math.sin(d)) / (Math.cos(lat) * Math.cos(d));
  if (cosH > 1) return { rise: null, set: null };
  if (cosH < -1) return { rise: 0, set: 1440 };
  const h = (Math.acos(cosH) * 180) / Math.PI / 15;
  return { rise: Math.round((12 - h) * 60), set: Math.round((12 + h) * 60) };
}

const MOON = ["new moon", "waxing crescent", "first quarter", "waxing gibbous", "full moon", "waning gibbous", "last quarter", "waning crescent"];
export function moon(minutes: number, seed: string): { phase: string; illumination: number } {
  const offset = rng(`${seed}:moon`)() * 29.53;
  const age = (minutes / 1440 + offset) % 29.53;
  const i = Math.floor((age / 29.53) * 8 + 0.5) % 8;
  return { phase: MOON[i]!, illumination: Math.round(((1 - Math.cos((2 * Math.PI * age) / 29.53)) / 2) * 100) };
}

export function levelOf(condition: string): Level {
  const c = condition.toLowerCase();
  if (/storm|thunder|lightning|tempest|blizzard|hurricane|gale/.test(c)) return 7;
  if (/heavy|downpour|torrential|pouring|driving/.test(c) && /rain|snow|sleet/.test(c)) return 6;
  if (/rain|snow|sleet|shower|hail/.test(c)) return /light|shower|patchy/.test(c) ? 4 : 5;
  if (/drizzle|spit|flurr/.test(c)) return 4;
  if (/overcast|grey|gray|cloudy|leaden/.test(c)) return /partly|broken|scattered/.test(c) ? 2 : 3;
  if (/broken|scattered|partly/.test(c)) return 2;
  if (/fair|wisps|hazy/.test(c)) return 1;
  if (/clear|sunny|cloudless|bright|starry|starlit/.test(c)) return 0;
  if (/fog|mist/.test(c)) return 3;
  return 1;
}

export interface SkyInput {
  seed: string;
  minutes: number;
  form: "date" | "day";
  climate: string;
  latitude: number;
  /** The story's own last weather line and when (minutes): the walk continues from it. */
  anchor?: { minutes: number; text: string } | null;
  /** G1: a built calendar's moons (name, cycle in days, offset), in place of our one moon. */
  moons?: { name: string; cycle: number; offset: number }[];
}

export interface SkyHour {
  minutes: number;
  level: number;
  text: string;
  tempC: number;
  fog: boolean;
  wind: boolean;
}

/** The weather at an hour: a Markov walk toward the current front's target, from the anchor. */
export function weatherAt(inp: SkyInput, minutes = inp.minutes): SkyHour {
  const cl = CLIMATES[inp.climate] ?? CLIMATES.maritime!;
  const hourAbs = Math.floor(minutes / 60);
  const startHour = inp.anchor && inp.anchor.minutes <= minutes ? Math.floor(inp.anchor.minutes / 60) : hourAbs - 48;
  let level: number = inp.anchor && inp.anchor.minutes <= minutes ? levelOf(inp.anchor.text) : 2;
  for (let h = startHour + 1; h <= hourAbs; h++) {
    const doy = dayOfYear(h * 60, inp.form);
    const season = cl.seasons[seasonAt(doy, inp.latitude)];
    // Fronts last 6–36 hours; each targets a level.
    const frontLen = 6 + Math.floor(rng(`${inp.seed}:front-len:${Math.floor(h / 24)}`)() * 30);
    const front = Math.floor(h / frontLen);
    const fr = rng(`${inp.seed}:front:${front}:${frontLen}`);
    const wet = fr() < season.wet;
    const target = wet ? (fr() < season.storm ? 7 : 4 + Math.floor(fr() * 3)) : Math.floor(fr() * 4);
    const r = rng(`${inp.seed}:wx:${h}`)();
    if (r < 0.35) level += Math.sign(target - level);
    else if (r > 0.93) level += r > 0.965 ? 1 : -1;
    level = Math.max(0, Math.min(7, level));
  }
  const doy = dayOfYear(minutes, inp.form);
  const season = cl.seasons[seasonAt(doy, inp.latitude)];
  const hourOfDay = (((minutes % 1440) + 1440) % 1440) / 60;
  const daily = (Math.sin(((hourOfDay - 9) / 24) * 2 * Math.PI) + 1) / 2;
  const jitter = (rng(`${inp.seed}:t:${Math.floor(minutes / 1440)}`)() - 0.5) * 4;
  const tempC = Math.round(season.tmin + (season.tmax - season.tmin) * (0.5 + (daily - 0.5) * cl.diurnal) + jitter - (level >= 4 ? 2 : 0));
  const fog = level <= 3 && hourOfDay >= 4 && hourOfDay <= 9 && rng(`${inp.seed}:fog:${Math.floor(minutes / 1440)}`)() < season.fog;
  const wind = rng(`${inp.seed}:wind:${Math.floor(minutes / 360)}`)() < season.wind * (level >= 6 ? 1.6 : 1);
  let text: string = LADDER[level]!;
  if (tempC <= 0 && level >= 4) text = level >= 6 ? "heavy snow" : level === 4 ? "light snow" : "snow";
  if (fog) text = level <= 1 ? "fog" : `${text}, fog`;
  if (wind && level < 7) text = `${text}, windy`;
  return { minutes, level, text, tempC, fog, wind };
}

export function forecast(inp: SkyInput, hours = 12): SkyHour[] {
  const out: SkyHour[] = [];
  for (let h = 1; h <= hours; h += 3) out.push(weatherAt(inp, inp.minutes + h * 60));
  return out;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

/** One line for the story-state note: the sky the scene sits under. */
export function skyLine(inp: SkyInput, storyWeather: string | null): { line: string; weather: SkyHour; season: string; sunrise: string | null; sunset: string | null; moon: string } {
  const doy = dayOfYear(inp.minutes, inp.form);
  const w = weatherAt(inp);
  const s = sun(doy, inp.latitude);
  const m = moon(inp.minutes, inp.seed);
  // G1: the moons of a calendar you built, each on its own cycle.
  const own = (inp.moons ?? []).map((x) => {
    const age = ((((inp.minutes / 1440 + x.offset) % x.cycle) + x.cycle) % x.cycle) / x.cycle;
    return { name: x.name, phase: MOON[Math.floor(age * 8 + 0.5) % 8]!, illumination: Math.round(((1 - Math.cos(2 * Math.PI * age)) / 2) * 100) };
  });
  const mod = (((inp.minutes % 1440) + 1440) % 1440);
  const bits: string[] = [];
  if (!storyWeather) bits.push(`${w.text}, ${w.tempC}°C`);
  else bits.push(`${w.tempC}°C`);
  if (s.rise != null && s.set != null) {
    if (mod < s.rise) bits.push(`sunrise ${hhmm(s.rise)}`);
    else if (mod < s.set) bits.push(s.set - mod <= 90 ? `sunset in ${s.set - mod} min` : `sunset ${hhmm(s.set)}`);
    else if (own.length) bits.push(`dark since ${hhmm(s.set)}${own.filter((x) => x.illumination > 60).map((x) => `, ${x.name} ${x.phase.replace(/ moon$/, "")}`).join("")}`);
    else bits.push(`dark since ${hhmm(s.set)}${m.illumination > 60 ? `, ${m.phase}` : ""}`);
  }
  const season = seasonAt(doy, inp.latitude);
  bits.push(season);
  return { line: `SKY: ${bits.join(" · ")}`, weather: w, season, sunrise: s.rise != null ? hhmm(s.rise) : null, sunset: s.set != null ? hhmm(s.set) : null, moon: own.length ? own.map((x) => `${x.name}: ${x.phase}`).join(", ") : m.phase };
}
