import { all, parseJson } from "../db/db";
import { resolver } from "../memory/entities";
import { cleanText } from "../memory/text";
import { mustChat } from "../services/chats";
import { dayOfYear, outOfClimate, sun } from "../sim/sky";
import { worldConfig } from "../sim/service";
import type { WorldState } from "../trackers/types";
import { sentences } from "./rules";
import { type Found, SLIPS } from "./slips";

/**
 * Reply checks against the world itself (docs/33 Parts 7 and 13), each one entry in the slip
 * registry and none calling a model: weather the climate can't have.
 */

/** Not the weather now: a memory, a wish, a comparison, a picture. */
const NOT_NOW = /\b(?:remember\w*|recall\w*|years ago|back (?:then|home|in|when)|used to|last (?:winter|year|christmas)|as if|as though|like (?:a|an|the|fresh|new)|would|could|might|if|wish\w*|dream\w*|imagin\w*|photo\w*|picture\w*|painting|postcard|globe|movie|film|tv|television|song|story|stories|once|never|someday|christmas)\b/i;
const FREEZE = /\b(?:frost(?:ed|y)?|snow(?:s|ing|fall|ed|flakes?|drifts?)?|sleet|blizzard|black ice|icy (?:roads?|wind|pavements?|sidewalks?)|ice on the (?:windshield|windscreen|car|road|puddles?))\b/i;
const FREEZE_NOT = /\bfrost(?:ed|ing)? (?:glass|tips?|flakes|cake|cupcakes?)|\bfrosting\b|\bfrost-\w+|\bsnow ?(?:cone|globe|white)\b|\b(?:freezer|fridge|frozen|on[- ]screen|screen|parmesan|cheese|sugar|flour|powdered|icing|in a snowfall|snowfall of)\b/i;
const HEAT = /\b(?:sweltering|scorching|blistering|heat ?wave)\b/i;

/** A reply writing weather this place can't have at this time of year ("frost on the car" in a mediterranean October). */
export function weatherRule(text: string, st: WorldState, cfg: { climate: string; latitude: number }): Found[] {
  if (!st.time) return [];
  const doy = dayOfYear(st.time.minutes, st.time.form);
  for (const s of sentences(cleanText(text))) {
    if (NOT_NOW.test(s) || FREEZE_NOT.test(s)) continue;
    const word = FREEZE.exec(s)?.[0] ?? HEAT.exec(s)?.[0];
    if (!word) continue;
    const why = outOfClimate(word, cfg.climate, doy, cfg.latitude);
    if (!why) continue;
    return [
      {
        kind: "weather",
        severity: "minor",
        claim: s.trim(),
        conflict: `"${word}" doesn't fit where and when this is: ${why}.`,
        citations: [{ ref: "T", type: "tracker", label: "the story's climate and date" }],
        fix: `Keep the weather to what this place has at this time of year (${why}).`,
        by: "rules",
      },
    ];
  }
  return [];
}

SLIPS.push({
  id: "weather",
  label: "Weather",
  description: "Weather the story's climate can't have at this time of year (frost in a warm autumn).",
  phase: "reply",
  on: (c) => c.role === "assistant" && c.continuity && Boolean(c.state?.time),
  run: (text, st, c) => (st ? weatherRule(text, st, worldConfig(c.chatId)) : []),
});

// ---------- docs/33 Part 7: checks the story's own world settles, with no model ----------

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const found = (kind: string, claim: string, conflict: string, fix: string, label: string): Found => ({ kind, severity: "minor", claim: claim.trim(), conflict, citations: [{ ref: "T", type: "tracker", label }], fix, by: "rules" });
const truthsOf = (chatId: string) => parseJson<{ truths?: string[] }>(mustChat(chatId).settings, {}).truths ?? [];

// ----- a vampire out in daylight -----

const OUTSIDE = /\b(?:(?:walks?|walked|steps?|stepped|strolls?|strolled|heads?|headed|goes|went|strides?|strode|saunters?|sauntered|slips?|slipped|ducks?|ducked|jogs?|jogged|runs?|ran|leads?|led)\s+(?:(?:back|right|straight)\s+)?(?:out(?:side)?|into the (?:sun(?:light|shine)?|street|yard|garden|driveway|daylight|light|road|lot)|down the (?:drive(?:way)?|street|road|sidewalk)|across the (?:lawn|street|yard|lot|road))|out the (?:front |back )?door|out(?:side)? (?:onto|on) the (?:porch|lawn|drive(?:way)?|street|sidewalk)|leaves? the house|left the house|exits? the house|in the (?:full|bright|morning|afternoon|midday) sun)\b/i;
const COVERED = /\b(?:blanket|smok(?:e|es|ing|ed)|sizzl\w+|tinted|shade|shaded|shadow\w*|umbrella|tarp|coat over (?:his|her|their) head|sewer|tunnel|basement|garage|overcast|cloud\w*|dusk|sunset|sundown|after dark|covered|ring of amara|gem of amara|hood up|under cover|doorway|threshold|inside)\b/i;

/** Sunlight would burn them: a trait, or what their Codex page says. */
export function isVampire(chatId: string, c: { name: string; traits?: { text: string }[] }): boolean {
  if ((c.traits ?? []).some((t) => /\bvampires?\b/i.test(t.text))) return true;
  try {
    const page = resolver(chatId).find(c.name);
    return Boolean(page && /\bvampires?\b/i.test(`${page.description} ${page.facts ?? ""}`) && !/\b(?:hunts?|slays?|kills?|fights?|stakes?) vampires?\b/i.test(page.description));
  } catch {
    return false;
  }
}

/**
 * A vampire walking out of doors while the story's clock is in daylight, with nothing covering them.
 * Off when a truth of yours says vampires here can be out by day.
 */
export function daylightRule(text: string, st: WorldState, o: { vampires: { name: string; aliases: string[] }[]; latitude: number; truths?: string[] }): Found[] {
  if (!st.time || !o.vampires.length) return [];
  if ((o.truths ?? []).some((t) => /\b(?:daylight|sunlight|by day|in the sun|day ?walk\w*)\b/i.test(t))) return [];
  const s = sun(dayOfYear(st.time.minutes, st.time.form), o.latitude);
  const mod = ((st.time.minutes % 1440) + 1440) % 1440;
  if (s.rise == null || s.set == null || mod < s.rise + 30 || mod > s.set - 30) return [];
  const hhmm = `${String(Math.floor(mod / 60)).padStart(2, "0")}:${String(mod % 60).padStart(2, "0")}`;
  for (const sentence of sentences(cleanText(text))) {
    if (!OUTSIDE.test(sentence) || COVERED.test(sentence) || NOT_NOW.test(sentence)) continue;
    const v = o.vampires.find((c) => new RegExp(`(?<![\\p{L}])(?:${[c.name, c.name.split(/\s+/)[0]!, ...c.aliases].filter((n) => n.length >= 3).map(esc).join("|")})(?![\\p{L}])`, "iu").test(sentence));
    if (!v) continue;
    return [found("daylight", sentence, `${v.name} is a vampire, and it's ${hhmm}, in daylight (sunset is at ${String(Math.floor(s.set / 60)).padStart(2, "0")}:${String(s.set % 60).padStart(2, "0")}).`, `${v.name} can't walk out in daylight: keep them indoors, under cover, or wait for dark. (If vampires can be out by day in this story, add it as a truth.)`, `story time ${hhmm}`)];
  }
  return [];
}

// ----- the weekday and the part of the month, against the date -----

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const PART = "morning|afternoon|evening|night|dawn|noon";
/** Today named outright: "it's Thursday", "a Thursday morning", "the morning light of a Saturday". Never "a Tuesday problem" or "a Monday-morning sound". */
const DAY_NOW = new RegExp(
  String.raw`\b(?:it(?:['’]s| is| was)|today(?:['’]s| is| was)) (?:(?:only|still|already|just) )?(${WEEKDAYS.join("|")})\b(?![- ]?(?:${PART})?[- ](?:sound|feeling|mood|problem|thing|kind|sort))|\b(?:a|an|this) (${WEEKDAYS.join("|")}) (?:${PART})\b(?! (?:sound|feeling|mood|problem|thing|kind|sort))|\b(?:${PART})(?: \w+)? of (?:a|this) (${WEEKDAYS.join("|")})\b`,
  "i",
);
const NOT_TODAY = /\b(?:next|last|every|each|until|by|since|tomorrow|yesterday|on (?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:mon|tues|wednes|thurs|fri|satur|sun)days|feels? like|felt like|sounds? like|kind of|sort of|as if|supposed to be)\b/i;
const MONTH_PART = new RegExp(String.raw`\b(early|mid|late|the (?:wrong |tail |very )?end of|the (?:start|beginning) of)[- ]+(${MONTHS.join("|")})\b`, "i");

/** The calendar date of a story minute (a dated clock only). */
export function storyDate(minutes: number) {
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCFullYear(1);
  const at = new Date(d.getTime() + minutes * 60_000);
  return { year: at.getUTCFullYear(), month: at.getUTCMonth(), day: at.getUTCDate(), weekday: at.getUTCDay() };
}

/** "A Thursday morning" on a Wednesday; "the wrong end of October" on the 10th. */
export function dateRule(text: string, st: WorldState): Found[] {
  if (!st.time || st.time.form !== "date") return [];
  const now = storyDate(st.time.minutes);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const today = `${cap(WEEKDAYS[now.weekday]!)} ${now.day} ${cap(MONTHS[now.month]!)}`;
  for (const s of sentences(cleanText(text))) {
    if (NOT_NOW.test(s)) continue;
    const hit = NOT_TODAY.test(s) ? null : DAY_NOW.exec(s);
    const d = hit && [hit[0], hit[1] ?? hit[2] ?? hit[3]];
    if (d && WEEKDAYS.indexOf(d[1]!.toLowerCase()) !== now.weekday) return [found("weekday", s, `The story clock says today is ${today}; this calls it a ${cap(d[1]!.toLowerCase())}.`, `Today is ${cap(WEEKDAYS[now.weekday]!)}.`, today)];
    const m = MONTH_PART.exec(s);
    if (m && MONTHS.indexOf(m[2]!.toLowerCase()) === now.month) {
      const part = /early|start|beginning/i.test(m[1]!) ? "early" : /mid/i.test(m[1]!) ? "mid" : "late";
      const wrong = part === "early" ? now.day > 13 : part === "late" ? now.day < 18 : now.day < 8 || now.day > 23;
      if (wrong) return [found("weekday", s, `The story clock says it's the ${now.day}${now.day === 1 ? "st" : now.day === 2 ? "nd" : now.day === 3 ? "rd" : "th"} of ${cap(MONTHS[now.month]!)}; "${m[0]}" doesn't fit.`, `It's ${today}.`, today)];
    }
  }
  return [];
}

// ----- things that didn't exist yet -----

/** What a reply shouldn't have before its year: the term, and the year it could first turn up in ordinary talk. */
const PERIOD: [RegExp, number, string][] = [
  [/\bemojis?\b/i, 2010, "emoji"],
  [/\bsmart ?phones?\b|\biphones?\b/i, 2007, "smartphones"],
  [/\bipods?\b/i, 2002, "the iPod"],
  [/\bselfies?\b/i, 2012, "selfies"],
  [/\b(?:youtube|you ?tubers?)\b/i, 2005, "YouTube"],
  [/\bfacebook\b/i, 2005, "Facebook"],
  [/\b(?:twitter|tweet(?:s|ed|ing)?)\b(?! of (?:a )?bird)/i, 2007, "Twitter"],
  [/\binstagram\w*\b/i, 2011, "Instagram"],
  [/\btiktok\b/i, 2018, "TikTok"],
  [/\bnetflix and chill\b|\bbinge[- ]watch\w*\b|\bstreaming (?:service|show|series)\b/i, 2010, "streaming TV"],
  [/\bspotify\b/i, 2009, "Spotify"],
  [/\bpodcasts?\b/i, 2005, "podcasts"],
  [/\bwikipedia\b/i, 2002, "Wikipedia"],
  [/\bhashtags?\b/i, 2008, "hashtags"],
  [/\b(?:an|the|her|his|your|my) apps?\b|\bapp store\b/i, 2008, "phone apps"],
  [/\buber(?:ed|s)?\b(?=.*\b(?:ride|driver|car|call|order)\b)/i, 2011, "Uber"],
  [/\bdecision fatigue\b/i, 2011, "\"decision fatigue\""],
  [/\bsteve jobs(?:['’]s?)? (?:black )?turtlenecks?\b/i, 2005, "Steve Jobs's turtlenecks as a byword"],
  [/\b(?:fomo|yolo)\b/i, 2011, "that slang"],
  [/\bhumblebrag\w*\b|\bphotobomb\w*\b|\bmansplain\w*\b|\badulting\b|\bunfriend(?:ed|ing)?\b/i, 2009, "that slang"],
  [/\bgo(?:es|ing|ne)? viral\b|\bwent viral\b/i, 2006, "\"going viral\""],
  [/\bblu-?ray\b/i, 2006, "Blu-ray"],
  [/\bkindles?\b|\be-?readers?\b/i, 2007, "e-readers"],
  [/\bvap(?:e|es|ed|ing)\b/i, 2010, "vaping"],
  [/\bbitcoin|\bcrypto(?:currency)?\b/i, 2011, "cryptocurrency"],
  [/\bbucket list\b/i, 2007, "\"bucket list\""],
  [/\bgoogl(?:e|ed|ing) (?:it|that|him|her|them)\b/i, 2001, "\"googling\""],
  [/\bwi-?fi\b/i, 2003, "Wi-Fi"],
  [/\btext(?:ed|ing)? (?:me|him|her|them|you) (?:a |an )?(?:gif|meme|link)\b|\bmemes?\b/i, 2009, "internet memes"],
];

/**
 * Something the story's year can't have yet (an emoji on a 2001 Nokia). Only for a dated clock in
 * 1900–2025, and never for a thing your own turns brought in: that one is yours.
 */
export function periodRule(text: string, st: WorldState, yours: (term: RegExp) => boolean = () => false): Found[] {
  if (!st.time || st.time.form !== "date") return [];
  const { year } = storyDate(st.time.minutes);
  if (year < 1900 || year > 2025) return [];
  for (const s of sentences(cleanText(text))) {
    for (const [re, from, what] of PERIOD) {
      if (year >= from || !re.test(s) || yours(re)) continue;
      return [found("period", s, `It's ${year} in the story; ${what} ${/s$/.test(what) && !/"/.test(what) ? "weren't" : "wasn't"} around before about ${from}.`, `Keep to what ${year} has.`, `the story's year, ${year}`)];
    }
  }
  return [];
}

// ----- one value per person -----

const BLOOD = /\b(AB|A|B|O)(?:\s+|-)?(negative|positive|neg|pos)\b|\b(AB|A|B|O)\s?([+−-])(?![\p{L}\p{N}])/u;
const bloodOf = (s: string) => {
  const m = BLOOD.exec(s);
  if (!m) return null;
  const type = (m[1] ?? m[3])!.toUpperCase();
  const sign = /^(?:neg|−|-)/i.test(m[2] ?? m[4] ?? "") ? "negative" : "positive";
  return `${type} ${sign}`;
};
const SURGEON = /\b(neuro|heart|cardiac|cardiothoracic|plastic|orthopa?edic|trauma|brain|pediatric|paediatric|vascular|general)[- ]?surgeon\b/i;
const surgeonOf = (s: string) => {
  const m = SURGEON.exec(s);
  if (!m) return null;
  const k = m[1]!.toLowerCase();
  return k === "brain" ? "neurosurgeon" : k === "cardiac" || k === "cardiothoracic" ? "heart surgeon" : k === "neuro" ? "neurosurgeon" : `${k} surgeon`;
};
const KIN = /\b((?:great[- ])*)grand(father|mother|pa|ma|dad|mum|mom)\b/i;
const kinOf = (s: string) => {
  const m = KIN.exec(s);
  if (!m) return null;
  const greats = (m[1]!.match(/great/gi) ?? []).length;
  return `${"great-".repeat(greats)}grand${/father|pa|dad/i.test(m[2]!) ? "father" : "mother"}`;
};
const SLOTS: { slot: string; of: (s: string) => string | null; words: string }[] = [
  { slot: "blood type", of: bloodOf, words: "negative OR positive OR blood" },
  { slot: "specialty", of: surgeonOf, words: "surgeon OR neurosurgeon" },
  { slot: "place in the family", of: kinOf, words: "grandfather OR grandmother OR great" },
];

/**
 * A fact that has one value per person, said two ways: Spike's blood type, Eleanor's specialty, how
 * many "greats" George Winters is. The reply is held against your truths first, then the memories:
 * a slip only when every record that gives the person a value gives the same one, and it isn't the reply's.
 */
export function oneValueRule(text: string, o: { people: string[]; truths?: string[]; records: (name: string, words: string) => string[] }): Found[] {
  for (const s of sentences(cleanText(text))) {
    if (NOT_NOW.test(s)) continue;
    for (const { slot, of, words } of SLOTS) {
      const got = of(s);
      if (!got) continue;
      const names = o.people.filter((n) => n.length >= 3 && new RegExp(`(?<![\\p{L}])${esc(n)}(?![\\p{L}])`, "u").test(s));
      // The fullest name of each person the sentence names.
      for (const name of names.filter((n) => !names.some((x) => x !== n && x.includes(n)))) {
        const first = name.split(/\s+/)[0]!;
        const said = (lines: string[]) => [...new Set(lines.flatMap((l) => sentences(l)).filter((l) => new RegExp(`(?<![\\p{L}])${esc(first)}(?![\\p{L}])`, "u").test(l)).map(of).filter((v): v is string => Boolean(v)))];
        const yours = said(o.truths ?? []);
        const recorded = yours.length ? yours : said(o.records(first, words));
        if (recorded.length !== 1 || recorded[0] === got) continue;
        return [found("fact", s, `${name}'s ${slot} is ${recorded[0]} ${yours.length ? "(a truth of this story)" : "in every record that gives one"}; this says ${got}.`, `${name}'s ${slot}: ${recorded[0]}.`, `${name}: ${recorded[0]}`)];
      }
    }
  }
  return [];
}

function memoryLines(chatId: string, name: string, words: string): string[] {
  try {
    return all<{ content: string }>(
      `SELECT m.content FROM memories_fts f JOIN memories m ON m.id = f.id
       WHERE memories_fts MATCH ? AND f.chat_id = ? AND m.deleted_at IS NULL AND m.status = 'active' LIMIT 40`,
      `"${name.replaceAll('"', "")}" AND (${words})`,
      chatId,
    ).map((r) => r.content);
  } catch {
    return [];
  }
}

function saidByPlayer(chatId: string, seq: number): (term: RegExp) => boolean {
  let mine: string | null = null;
  return (term) => {
    mine ??= all<{ content: string }>(
      `SELECT s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
       WHERE m.chat_id = ? AND m.seq < ? AND m.role = 'user' AND m.deleted_at IS NULL ORDER BY m.seq DESC LIMIT 400`,
      chatId,
      seq,
    )
      .map((r) => r.content)
      .join("\n");
    return term.test(mine);
  };
}

SLIPS.push(
  {
    id: "daylight",
    label: "Daylight",
    description: "A vampire walking out of doors while the story's clock is in daylight (off when a truth of yours says they can).",
    phase: "reply",
    on: (c) => c.role === "assistant" && c.continuity && Boolean(c.state?.time),
    run: (text, st, c) => {
      if (!st) return [];
      const vampires = Object.values(st.chars).filter((x) => !x.isUser && !x.dead && isVampire(c.chatId, x));
      return vampires.length ? daylightRule(text, st, { vampires, latitude: worldConfig(c.chatId).latitude, truths: truthsOf(c.chatId) }) : [];
    },
  },
  {
    id: "weekday",
    label: "The date",
    description: "A weekday or a part of the month that the story's own date contradicts (\"a Thursday morning\" on a Wednesday).",
    phase: "reply",
    on: (c) => c.role === "assistant" && c.continuity && c.state?.time?.form === "date",
    run: (text, st) => (st ? dateRule(text, st) : []),
  },
  {
    id: "period",
    label: "The year",
    description: "Things the story's year didn't have yet (emoji in 2001), unless your own turns brought them in.",
    phase: "reply",
    on: (c) => c.role === "assistant" && c.continuity && c.state?.time?.form === "date",
    run: (text, st, c) => (st ? periodRule(text, st, saidByPlayer(c.chatId, c.seq)) : []),
  },
  {
    id: "onevalue",
    label: "One value per person",
    description: "A blood type, a surgeon's specialty or a place in the family tree said differently from your truths or from every memory that gives one.",
    phase: "reply",
    on: (c) => c.role === "assistant" && c.continuity && Boolean(c.state),
    run: (text, st, c) =>
      st
        ? oneValueRule(text, {
            people: [...new Set([...Object.values(st.chars).flatMap((x) => [x.name, x.name.split(/\s+/)[0]!]), ...resolver(c.chatId).rows.filter((r) => r.kind === "person").flatMap((r) => [r.name, r.name.split(/\s+/)[0]!])])],
            truths: truthsOf(c.chatId),
            records: (name, words) => memoryLines(c.chatId, name, words),
          })
        : [],
  },
);
