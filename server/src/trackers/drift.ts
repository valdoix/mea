import type { Character, Condition, Injury } from "./types";

/**
 * Clock-driven drift (after ALMANAC §6.3): bodies change with story time, not only with events.
 * Hunger, thirst and fatigue build while awake; sleep and meals off the page reset them;
 * wounds heal by severity; illnesses run their course; drink wears off.
 * All of it is deterministic, so a swipe or a rebuild sees the same bodies.
 */

const DAY = 1440;

/** Speeds against an ordinary person (1): 0.5 builds at half speed, 0 never. */
export interface Stamina {
  label: string;
  hunger: number;
  thirst: number;
  fatigue: number;
  sleep: number;
  heal: number;
  /** Illnesses can't touch them. */
  immune?: boolean;
  note?: string;
}

export const STAMINA: Record<string, Stamina> = {
  ordinary: { label: "Ordinary", hunger: 1, thirst: 1, fatigue: 1, sleep: 1, heal: 1 },
  hardy: { label: "Hardy (soldier, athlete)", hunger: 1, thirst: 1, fatigue: 0.7, sleep: 1.25, heal: 1.25 },
  frail: { label: "Frail (elderly, ill, a child)", hunger: 1, thirst: 1, fatigue: 1.4, sleep: 0.8, heal: 0.6 },
  superhuman: { label: "Superhuman", hunger: 0.6, thirst: 0.6, fatigue: 0.3, sleep: 2, heal: 3 },
  shifter: { label: "Werewolf / shifter", hunger: 1.5, thirst: 1, fatigue: 0.7, sleep: 1.25, heal: 3, immune: true },
  vampire: { label: "Vampire", hunger: 0.4, thirst: 0, fatigue: 0.5, sleep: 1, heal: 5, immune: true, note: "hungers for blood, not food; sleeps by day" },
  immortal: { label: "Immortal / divine", hunger: 0, thirst: 0, fatigue: 0.25, sleep: 2, heal: 5, immune: true },
  construct: { label: "Construct / android / ghost", hunger: 0, thirst: 0, fatigue: 0, sleep: 1, heal: 0, immune: true, note: "needs nothing living bodies need" },
};

/** Reads a stamina kind from a description (card, persona, trait lines). */
export function detectStamina(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(android|robot|automaton|golem|cyborg|ghost|spectre|specter|wraith|undead construct)\b/.test(t)) return "construct";
  if (/\b(angel|archangel|deity|god|goddess|immortal|celestial)\b/.test(t)) return "immortal";
  if (/\b(vampire|vampyre|nosferatu)\b(?!\s+(?:hunter|slayer|killer))/.test(t)) return "vampire";
  if (/\b(werewolf|lycanthrope|shape-?shifter|skinwalker)\b/.test(t)) return "shifter";
  if (/\b(superhuman|super-?soldier|demigod|mutant|meta-?human|kryptonian)\b/.test(t)) return "superhuman";
  if (/\b(soldier|knight|warrior|athlete|ranger|mercenary|marine|gladiator)\b/.test(t)) return "hardy";
  return null;
}

/** Illnesses and states with a course (ALMANAC core/conditions). span in minutes; null: until the story ends it. */
export const COURSES: Record<string, { label: string; re: RegExp; span: number | null; ill?: boolean; drink?: boolean }> = {
  hangover: { label: "hangover", re: /\bhung\s?over\b|\bhangover\b/i, span: 10 * 60, drink: true },
  flu: { label: "flu", re: /\bflu\b|\binfluenza\b/i, span: 7 * DAY, ill: true },
  cold: { label: "a cold", re: /\b(?:a|the|her|his|their|head|chest|common|streaming|bad|nasty)\s+cold\b(?!\s+(?:air|water|wind|night|stone|floor|shoulder|sweat|fury|hands?|eyes|voice|light))|\bsniffl\w*|\brunny nose\b/i, span: 6 * DAY, ill: true },
  fever: { label: "a fever", re: /\bfever\w*|\bfebrile\b|\bburning up\b/i, span: 2 * DAY, ill: true },
  stomach: { label: "a stomach bug", re: /\bfood poisoning\b|\bstomach (?:bug|flu)\b|\bvomiting\b|\bthrowing up\b/i, span: DAY, ill: true },
  migraine: { label: "a migraine", re: /\bmigraine\b|\bsplitting headache\b/i, span: 8 * 60 },
  concussion: { label: "a concussion", re: /\bconcuss\w*/i, span: 7 * DAY },
  sick: { label: "sick", re: /\b(?:sick|ill|unwell|poorly|bedridden)\b(?!\s+(?:of|with (?:worry|fear|guilt|grief)))/i, span: 3 * DAY, ill: true },
  curse: { label: "a curse", re: /\bcursed\b|\bhexed\b|\bunder a (?:curse|spell|hex)\b|\bspellbound\b/i, span: null },
  poison: { label: "poisoned", re: /\bpoison(?:ed|ing)\b|\benvenom\w*/i, span: null },
};
const ENDS = /\b(?:recovered|cured|lifted|broke|broken|gone|cleared|better now|shook off|antidote|healed of|no longer)\b/i;

export function conditionsIn(text: string): string[] {
  const hits = Object.entries(COURSES).filter(([, c]) => c.re.test(text)).map(([k]) => k);
  return hits.includes("sick") && hits.some((k) => k !== "sick" && COURSES[k]!.ill) ? hits.filter((k) => k !== "sick") : hits;
}
export const endsCondition = (text: string) => ENDS.test(text);

export function addCondition(c: Character, kind: string, text: string, now: number | null) {
  const course = COURSES[kind];
  if (!course) return false;
  const st = STAMINA[c.stamina] ?? STAMINA.ordinary!;
  if (course.ill && st.immune) return false;
  if (c.conditions.some((x) => x.kind === kind)) return false;
  const speed = course.drink ? (st.immune ? 0.3 : 1) : Math.max(0.2, st.heal || 1);
  const until = course.span == null || now == null ? null : now + Math.round(course.span / speed);
  c.conditions.push({ kind, text, since: now, until });
  return true;
}

/** Minutes for a wound to mend one step at normal healing: a scratch goes in two days, a wound in a week (treated), a serious one becomes a wound in two. */
const MEND: Record<number, { treated: number; untreated: number }> = {
  1: { treated: 2 * DAY, untreated: 3 * DAY },
  2: { treated: 6 * DAY, untreated: 12 * DAY },
  3: { treated: 14 * DAY, untreated: 30 * DAY },
  4: { treated: 21 * DAY, untreated: Infinity },
};

export const SEVERITY = ["", "scratch", "wound", "serious", "critical"];
export function severityOf(word: string | undefined): 1 | 2 | 3 | 4 {
  const w = (word ?? "").toLowerCase();
  if (/critical|grave|mortal|life-threatening/.test(w)) return 4;
  if (/serious|deep|broken|fracture|stab|gunshot|burn/.test(w)) return 3;
  if (/scratch|bruise|graze|minor|scrape/.test(w)) return 1;
  return 2;
}

/** Minutes of (from, to] in the night, 23:00–07:00. */
export function nightMinutes(from: number, to: number) {
  let n = 0;
  const step = 15;
  for (let t = from; t < to; t += step) {
    const m = ((t % DAY) + DAY) % DAY;
    if (m >= 23 * 60 || m < 7 * 60) n += Math.min(step, to - t);
  }
  return n;
}

const MEALS = [8 * 60, 13 * 60, 19 * 60];
function crossesMeal(from: number, to: number) {
  for (let d = Math.floor(from / DAY); d <= Math.floor(to / DAY); d++) for (const m of MEALS) if (d * DAY + m > from && d * DAY + m <= to) return true;
  return false;
}

/** A clock jump this long is time off the page, where ordinary meals and sleep happen. */
const OFFPAGE = 120;

export interface DriftNote {
  who: string;
  text: string;
}

/**
 * Moves one character's body from `from` to `to` (story minutes). Only meters the story has
 * started tracking drift, so nobody grows hungry who was never given a body.
 */
export function driftCharacter(c: Character, from: number, to: number, notes: DriftNote[] = []) {
  if (to <= from || c.dead) return;
  const st = STAMINA[c.stamina] ?? STAMINA.ordinary!;
  const span = to - from;
  const m = c.meters;
  const nocturnal = c.stamina === "vampire";
  const night = nocturnal ? span - nightMinutes(from, to) : nightMinutes(from, to);
  const slept = span >= 180 && night >= 180 && c.tier !== "spot";
  const awake = slept ? span - night : span;
  const bump = (k: "hunger" | "thirst" | "fatigue", per: number, speed: number, cap: number) => {
    if (m[k] == null || speed <= 0) return;
    const add = (awake / per) * speed;
    if (m[k]! < cap) m[k] = Math.min(cap, Math.round((m[k]! + add) * 10) / 10);
  };
  bump("hunger", 6 * 60, st.hunger, 3);
  bump("thirst", 5 * 60, st.thirst, 3);
  bump("fatigue", 5 * 60, st.fatigue, 4);
  if (slept && m.fatigue != null) {
    const before = m.fatigue;
    m.fatigue = Math.max(0, Math.round((m.fatigue - (night / 90) * st.sleep) * 10) / 10);
    if (night < 5 * 60) m.fatigue = Math.max(m.fatigue, 2);
    if (before - m.fatigue >= 1) notes.push({ who: c.name, text: "slept" });
  }
  if (span >= OFFPAGE && crossesMeal(from, to)) {
    if (m.hunger != null && m.hunger > 1 && st.hunger > 0) m.hunger = 1;
    if (m.thirst != null && m.thirst > 1 && st.thirst > 0) m.thirst = 1;
  }
  if (m.intox != null && m.intox > 0) m.intox = Math.max(0, Math.round((m.intox - span / 90) * 10) / 10);
  if (m.stress != null && m.stress > 0 && span >= 6 * 60) m.stress = Math.max(0, m.stress - Math.floor(span / (6 * 60)));
  if (m.composure != null && m.composure < 3 && span >= 3 * 60) m.composure = Math.min(3, m.composure + 1);

  // Wounds mend a step at a time; a critical wound untreated doesn't mend.
  if (st.heal > 0) {
    const kept: Injury[] = [];
    for (const inj of c.injuries) {
      let t = inj.since ?? from;
      while (inj.severity > 0) {
        const need = (inj.treated ? MEND[inj.severity]!.treated : MEND[inj.severity]!.untreated) / st.heal;
        if (!Number.isFinite(need) || t + need > to) break;
        t += need;
        inj.severity = (inj.severity - 1) as Injury["severity"];
        inj.since = t;
      }
      if (inj.severity > 0) kept.push(inj);
      else notes.push({ who: c.name, text: `${inj.where} healed${inj.worst >= 3 ? " (leaving a scar)" : ""}` });
    }
    c.injuries = kept;
  }
  // Illnesses run their course.
  const left: Condition[] = [];
  for (const k of c.conditions) {
    if (k.until != null && k.until <= to) notes.push({ who: c.name, text: `over ${COURSES[k.kind]?.label ?? k.kind}` });
    else left.push(k);
  }
  c.conditions = left;
  // Pain follows untreated wounds.
  if (m.pain != null) {
    const worst = Math.max(0, ...c.injuries.filter((i) => !i.treated).map((i) => i.severity));
    if (m.pain > worst + 1) m.pain = Math.max(worst, m.pain - Math.floor(span / 240));
  }
  c.driftAt = to;
}

/**
 * Meters go to the model as plain words, not numbers: a number in the note gets copied
 * straight into the prose (ALMANAC note.ts). Index by the meter's value (0–5).
 */
export const METER_WORDS: Record<string, string[]> = {
  health: ["near death", "badly hurt", "hurt", "", "", ""],
  fatigue: ["", "", "", "tired", "exhausted", "dead on their feet"],
  hunger: ["", "", "", "hungry", "very hungry", "starving"],
  thirst: ["", "", "", "thirsty", "parched", "desperate for water"],
  pain: ["", "", "", "in pain", "in bad pain", "in agony"],
  intox: ["", "", "tipsy", "drunk", "very drunk", "blackout drunk"],
  composure: ["breaking down", "barely holding together", "rattled", "", "", ""],
  arousal: ["", "", "", "aroused", "very aroused", "overwhelmed with desire"],
  stress: ["", "", "", "stressed", "badly stressed", "at breaking point"],
};

export function meterWords(c: Character): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(c.meters)) {
    if (v == null) continue;
    const w = METER_WORDS[k]?.[Math.max(0, Math.min(5, Math.round(v)))];
    if (w) out.push(w);
  }
  return out;
}
