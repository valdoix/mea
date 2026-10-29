import { categoryOf } from "../lore/format";
import type { CastProfile } from "../trackers/store";
import type { WorldState } from "../trackers/types";
import type { Actor, Standing } from "./types";

/**
 * Everyone the world knows (ALMANAC 09 §4), with what the simulation needs: where they are,
 * whether they can act, how far their doings are from the player, and who they're tied to.
 */
export type Ring = "onstage" | "offstage" | "unmet";
export type Reach = "here" | "building" | "district" | "town" | "region" | "far" | "none";

export const TRAVEL: Record<Reach, number> = { here: 0, building: 5, district: 20, town: 45, region: 240, far: 960, none: Infinity };
const REACH_WEIGHT: Record<Reach, number> = { here: 1, building: 1, district: 0.9, town: 0.8, region: 0.5, far: 0.3, none: 0 };

export interface RActor extends Actor {
  ring: Ring;
  isUser: boolean;
  isMain: boolean;
  reach: Reach;
  travel: number;
  ties: Map<string, number>;
  text: string;
  want?: string;
  fear?: string;
  /** Fact keys → status (what they know, for the gate and news). */
  knows: Map<string, string>;
  lastSeq: number;
  dead: boolean;
}

export interface Roster {
  actors: Map<string, RActor>;
  byName(name: string): RActor | undefined;
  /** The town the story is in (the top of the scene's place). */
  town: string;
  scene: string[];
}

const CLOSE = "mother|father|mum|mom|dad|sister|brother|son|daughter|wife|husband|girlfriend|boyfriend|fianc[eé]e?|lover|partner|mentor|best friend|twin|guardian|ward";
const EXTENDED = "uncle|aunt|cousin|nephew|niece|grandmother|grandfather|grandson|granddaughter|ex|heir|stepmother|stepfather|stepsister|stepbrother|godmother|godfather";
const WORK = "boss|employer|employee|servant|maid|squire|liege|knight|master|apprentice|assistant|friend|ally|confidant|colleague|partner|rival|enemy|neighbou?r|landlord|tenant|teacher|student|captain|commander|handler";
const FAR = /\b(abroad|overseas|another country|across the sea|far away|the capital|the north|the south|europe|england|london|paris|tokyo|new york|america)\b/i;

const DEAD = /\b(?:died|was killed|is dead|(?:has|had) been dead|deceased|passed away|was murdered)\b/gi;
const CONSTRUCT = /\b(?:android|robot|golem|automaton|construct)\b/gi;
const CAPTIVE = /\b(?:imprisoned|in prison|in jail|captive|held prisoner|locked up|kidnapped)\b/gi;
/** What may stand before the phrase in a clause about the person themself ("She has", "who was", "is a"). */
const LEAD_IN = /^(?:(?:she|he|they|it|who|and|but|then|sadly|tragically|later|eventually|finally|recently|has|had|have|was|is|were|been|now|also|status|a|an|herself|himself|themselves)\s*)*$/i;

/**
 * Whether a phrase is said of the person the text is about: nothing but their name or a pronoun
 * before it in its clause. "She died" and "status(deceased" are; "since Joyce died", "her mother
 * died" and "Jenny Calendar - murdered" are about someone else.
 */
function saidOf(text: string, re: RegExp, name?: string): boolean {
  const own = new Set((name ?? "").toLowerCase().split(/\s+/).filter(Boolean));
  for (const m of text.matchAll(re)) {
    const clause = text.slice(0, m.index).split(/[.;:!?()[\]{}\n,]/).pop() ?? "";
    const rest = clause.split(/\s+/).filter((w) => w && !own.has(w.toLowerCase()));
    if (LEAD_IN.test(rest.join(" "))) return true;
  }
  return false;
}

const DIES = /\b(?:killed by|murdered by|slain by|was killed|was murdered|was slain|died|is dead|passed away)\b/i;
/** Between a name and its death: words that make the clause about someone or something else, or undo it. */
const NOT_THEIR_DEATH = /'s\b|’s\b|\b(?:that|when|while|whose|who|whom|saw|watched|learned|heard|told|after|before|since|because|as|if|until|her|his|their|him|them|nearly|almost|never|not|faked|thought|believed|presumed)\b|n't\b/i;
const UNDONE = /\b(?:came back|brought back|back from the dead|resurrected|revived|raised|returned|rose again)\b/i;

/**
 * Whether any lore says this person died ("Kendra was Called and later killed by Drusilla"):
 * their name, then a death in the same sentence with nothing between that makes it someone
 * else's ("Willow saw Tara die", "Joyce's mother died", "Kendra lent it to Buffy and died")
 * or takes it back ("died and came back").
 */
export function diedInLore(name: string, texts: string[], others: string[]): boolean {
  const names = [name, ...(name.includes(" ") ? [name.split(/\s+/)[0]!] : [])].filter((w) => w.length >= 3).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!names.length) return false;
  const at = new RegExp(`\\b(?:${names.join("|")})\\b`, "gi");
  // "Angelus, murdering Jenny Calendar", "Drusilla killed Kendra".
  const killedThem = new RegExp(`\\b(?:killed|killing|murdered|murdering|slew|slaying|slays)\\s+(?:${names.join("|")})\\b`, "i");
  const otherWords = new Set(others.flatMap((o) => o.toLowerCase().split(/\s+/)).filter((w) => w.length >= 3 && !name.toLowerCase().split(/\s+/).includes(w)));
  for (const text of texts)
    for (const sentence of text.split(/[.;!?\n]/)) {
      if (UNDONE.test(sentence)) continue;
      if (killedThem.test(sentence) && !/\b(?:nearly|almost|tried to|trying to|wants? to|plans? to)\s+(?:killed|killing|murdered|murdering|slew|slaying|slays)\b/i.test(sentence)) return true;
      for (const m of sentence.matchAll(at)) {
        const after = sentence.slice(m.index + m[0].length);
        const d = after.match(DIES);
        if (!d || d.index! > 60) continue;
        const between = after.slice(0, d.index);
        if (NOT_THEIR_DEATH.test(between)) continue;
        if ((between.toLowerCase().match(/[\p{L}'’-]+/gu) ?? []).some((w) => otherWords.has(w))) continue;
        return true;
      }
    }
  return false;
}

const FAR_ALL = new RegExp(FAR.source, "gi");
const PAST_LABEL = /^(?:history|past|origin|backstory|nickname|arc|youth|childhood|born)$/i;
const PAST_WORDS = /\b(?:1\d{3}|20\d{2}|youth|born|childhood|grew up|once|used to|years ago|formerly)\b/i;

/**
 * A far-off place said of where they are now ("the Watchers Council in London", "abroad in
 * Spain"), not of their past ("killed Slayers in New York in 1977", "his wild London youth").
 */
function farNow(text: string): boolean {
  for (const m of text.matchAll(FAR_ALL)) {
    const before = text.slice(0, m.index);
    const start = Math.max(...[".", ";", "(", ")", "[", "]", "\n"].map((c) => before.lastIndexOf(c)));
    const end = text.slice(m.index).search(/[.;()[\]\n]/);
    const clause = text.slice(start + 1, end < 0 ? undefined : m.index + end);
    if (PAST_WORDS.test(clause)) continue;
    if (before[start] === "(" && PAST_LABEL.test(before.slice(0, start).match(/(\w+)\s*$/)?.[1] ?? "")) continue;
    return true;
  }
  return false;
}

export function readStanding(text: string, name?: string): { standing?: Standing; where?: string } {
  const t = text.toLowerCase();
  if (saidOf(text, DEAD, name)) return { standing: "dead" };
  if (saidOf(text, CONSTRUCT, name)) return { standing: "construct" };
  if (saidOf(text, CAPTIVE, name)) return { standing: "captive" };
  if (/\b(pet|familiar|her (?:dog|cat|horse)|his (?:dog|cat|horse)|steed|dragon of)\b/.test(t)) return { standing: "companion" };
  const away = text.match(/\b(?:lives in|moved to|left for|works in|stationed in|studying in|now in|last seen in)\s+([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+){0,3})/);
  if (away) return { standing: "away", where: away[1]!.trim() };
  if (farNow(text)) return { standing: "away" };
  return {};
}

function reachOf(where: string[] | undefined, scene: string[], standing: Standing): Reach {
  if (standing === "dead") return "none";
  if (!where?.length) return standing === "away" ? "far" : "town";
  const w = where.map((s) => s.toLowerCase());
  const sc = scene.map((s) => s.toLowerCase());
  if (!sc.length) return "town";
  let common = 0;
  while (common < w.length && common < sc.length && w[common] === sc[common]) common++;
  if (common === 0) {
    // The scene's top place named anywhere in theirs: same town, deeper path.
    if (w.includes(sc[0]!) || sc.includes(w[0]!)) return "district";
    return FAR.test(where.join(" ")) || standing === "away" ? "far" : "region";
  }
  if (common === w.length && common === sc.length) return "here";
  if (common >= Math.max(w.length, sc.length) - 1) return "building";
  if (common >= 2) return "district";
  return "town";
}

const tieWords = (strength: number) => new RegExp(`\\b(${strength === 3 ? CLOSE : strength === 2 ? EXTENDED : WORK})\\b`, "i");

/** How strongly A's description ties them to B (0 when it doesn't name B). */
function textTie(text: string, other: string): number {
  if (!other || other.length < 3) return 0;
  // Who they were to someone long ago ("history(… the woman William, later Spike, loved in 1880)") isn't a tie now.
  text = text.replace(/\b(\w+)\s*\(([^()]*)\)/g, (m, label: string) => (PAST_LABEL.test(label) ? "" : m));
  const esc = other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`.{0,40}\\b${esc}\\b.{0,40}`, "gi");
  let best = 0;
  for (const m of text.matchAll(re)) {
    const around = m[0];
    if (/\b(estranged|former|ex-|drifted|used to be)\b/i.test(around)) best = Math.max(best, 1);
    else if (tieWords(3).test(around)) best = Math.max(best, 3);
    else if (tieWords(2).test(around)) best = Math.max(best, 2);
    else if (tieWords(1).test(around)) best = Math.max(best, 2);
    else best = Math.max(best, 1);
  }
  return best;
}

/** Title tags that say what kind of entry it is ("Faction: …", "History: …"); only a person tag names someone. */
const PERSON_TAG = /^(?:characters?|npcs?|person|people|cast)$/i;
const OTHER_TAG =
  /^(?:timeline|rules?|ooc|relationships?|voice|style|speech|current|beliefs?|secrets?|factions?|upcoming|items?|locations?|history|customs?|scenes?|culture|region|city|town|place|places|setting|world|lore|events?|organi[sz]ations?|groups?|species|races?|creatures?|monsters?|concepts?|era|period|calendar|magic|atmosphere|slang|themes?|tone|notes?|misc|info|background|areas?|buildings?|country|nation|realm|artifacts?|objects?|reactions?|triggers?|moments?|memor(?:y|ies)|family|families|household|powers?|abilit(?:y|ies)|faith|religion|gods?|lexicon|glossary|money|trade|economy|currency|climate|weather|seasons?|hooks?|quests?|myster(?:y|ies)|routines?|schedule)$/i;
const NOT_A_PERSON = new Set(["location", "item", "faction", "concept", "event", "rule"]);

/** The person a lore entry is about ("Name", "Name - role", "Character: Name"), or null when it's about something else. */
export function lorePersonName(e: { comment: string; keys: string[]; content: string; extra?: Record<string, unknown> }): string | null {
  let title = (e.comment || e.keys[0] || "").trim();
  const tag = title.match(/^([A-Za-z]+(?:\s+[A-Za-z]+)?)\s*:\s*(.+)$/);
  if (tag && PERSON_TAG.test(tag[1]!)) title = tag[2]!.trim();
  else if (tag && OTHER_TAG.test(tag[1]!)) return null;
  else {
    const cat = categoryOf(e);
    if (cat && cat !== "character") return null;
    const type = (e.extra as { type?: unknown } | undefined)?.type;
    if (typeof type === "string" && NOT_A_PERSON.has(type)) return null;
  }
  const m = title.match(/^([A-Z][a-z'’-]+(?:\s+(?:of\s+)?[A-Z][a-z'’-]+){0,2})(?:\s*[-–—:|(].*)?$/);
  if (!m) return null;
  if (/\b(house|street|city|town|village|inn|tavern|castle|forest|river|guild|council|order|church|kingdom|empire|school|academy|lighthouse|harbou?r|isle|island|mountain|valley)\b/i.test(m[1]!)) return null;
  if (!/\b(he|she|they|his|her|their|him)\b/i.test(e.content)) return null;
  return m[1]!;
}

export interface RosterInput {
  state: WorldState;
  profiles: Record<string, CastProfile>;
  /** People from lorebooks (and the card's world): name + description. */
  lore: { name: string; text: string }[];
  userName: string;
  /** docs/17, 5.2: the lore's Routine schedules, a line each ("dawn: Mira Vell, at the tower"). */
  schedules?: string[];
  /** The rest of the lore (history, items, events), where a death is often told. */
  notes?: string[];
}

/** "Willow" and "Willow Rosenberg" are the same person: one name is the other's first words. */
export function samePerson(a: string, b: string): boolean {
  const x = a.trim().toLowerCase().split(/\s+/);
  const y = b.trim().toLowerCase().split(/\s+/);
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length > 0 && short.every((w, i) => w === long[i]);
}

export function buildRoster(inp: RosterInput): Roster {
  const st = inp.state;
  const scene = st.place;
  const actors = new Map<string, RActor>();
  const keyOf = (name: string) => name.trim().toLowerCase();
  const add = (a: RActor) => actors.set(a.id, a);

  for (const c of Object.values(st.chars)) {
    const prof = inp.profiles[keyOf(c.name)];
    const simActor = st.sim.actors[c.id];
    const text = [prof?.description, prof?.role, c.drives.want && `wants ${c.drives.want}`].filter(Boolean).join(". ");
    const read = readStanding(text, c.name);
    const standing: Standing = c.dead ? "dead" : ((prof?.standing as Standing) ?? simActor?.standing ?? read.standing ?? "here");
    const onstage = c.tier === "spot" || c.tier === "peri";
    const where = simActor?.where ?? (prof?.where ? prof.where.split(/\s*›\s*/) : c.place ? c.place.split(/\s*›\s*/) : undefined);
    const reach = onstage ? "here" : reachOf(where, scene, standing);
    add({
      id: c.id,
      name: c.isUser ? inp.userName : c.name,
      ring: onstage ? "onstage" : "offstage",
      isUser: c.isUser,
      isMain: c.isMain,
      standing,
      where,
      base: prof?.base ? prof.base.split(/\s*›\s*/) : simActor?.base,
      routine: parseRoutine(prof?.routine) ?? simActor?.routine,
      nocturnal: c.stamina === "vampire" || /\b(nocturnal|night shift|by night)\b/i.test(text),
      means: meansOf(`${text} ${prof?.role ?? ""}`),
      guarded: /\b(guarded|secretive|reserved|taciturn|discreet|spymaster)\b/i.test(text),
      role: prof?.role,
      flag: prof?.out ? "out" : simActor?.flag,
      lastBeatAt: simActor?.lastBeatAt ?? null,
      reach,
      travel: TRAVEL[reach],
      ties: new Map(),
      text,
      want: c.drives.want,
      fear: c.drives.fear,
      knows: new Map(),
      lastSeq: c.lastSeq,
      dead: standing === "dead",
    });
  }
  // People you added on the Cast page and people from the lore who haven't been on the page.
  const unmet = [
    ...Object.values(inp.profiles).map((p) => ({ name: p.name, text: [p.description, p.role].filter(Boolean).join(". "), prof: p })),
    ...inp.lore.map((l) => ({ name: l.name, text: l.text, prof: undefined as CastProfile | undefined })),
  ];
  for (const u of unmet) {
    const id = keyOf(u.name).replace(/[^a-z0-9]+/g, "-");
    const twin = [...actors.values()].find((a) => samePerson(a.name, u.name) || a.id === id);
    if (twin) {
      // The story calls them "Willow", the lore "Willow Rosenberg": one person, who keeps what the lore says.
      if (!twin.isUser && u.text && !twin.text.includes(u.text.slice(0, 60))) twin.text = [twin.text, u.text].filter(Boolean).join(". ");
      // The lore says they're dead ("She has been dead since 1998"): nobody off the page tells them news.
      if (twin.ring === "offstage" && !twin.isUser && !twin.isMain && twin.standing === "here" && !inp.profiles[keyOf(twin.name)]?.standing) {
        const read = readStanding(u.text, u.name);
        if (read.standing === "dead") {
          twin.standing = "dead";
          twin.dead = true;
          twin.reach = "none";
          twin.travel = TRAVEL.none;
        } else if (read.standing === "away" && !twin.where) {
          // "Last seen in Los Angeles": the story hasn't put them anywhere, so the lore's word stands.
          twin.standing = "away";
          if (read.where) twin.where = [read.where];
          twin.reach = reachOf(twin.where, scene, "away");
          twin.travel = TRAVEL[twin.reach];
        }
      }
      continue;
    }
    if (u.name.toLowerCase() === inp.userName.toLowerCase()) continue;
    const simActor = st.sim.actors[id];
    const read = readStanding(u.text, u.name);
    const standing: Standing = (u.prof?.standing as Standing) ?? simActor?.standing ?? read.standing ?? "here";
    const where = simActor?.where ?? (u.prof?.where ? u.prof.where.split(/\s*›\s*/) : read.where ? [read.where] : undefined);
    const reach = reachOf(where, scene, standing);
    add({
      id,
      name: u.name,
      ring: "unmet",
      isUser: false,
      isMain: false,
      standing,
      where,
      base: u.prof?.base?.split(/\s*›\s*/) ?? simActor?.base,
      routine: parseRoutine(u.prof?.routine) ?? simActor?.routine,
      nocturnal: /\b(vampire|nocturnal|creature of the night)\b/i.test(u.text),
      means: meansOf(u.text),
      guarded: /\b(guarded|secretive|reserved|taciturn|discreet|spymaster)\b/i.test(u.text),
      role: u.prof?.role,
      flag: u.prof?.out ? "out" : simActor?.flag,
      lastBeatAt: simActor?.lastBeatAt ?? null,
      reach,
      travel: TRAVEL[reach],
      ties: new Map(),
      text: u.text,
      want: u.text.match(/\bwants? (?:to )?([^.;]{4,80})/i)?.[1],
      fear: u.text.match(/\bfears? ([^.;]{4,80})/i)?.[1],
      knows: new Map(),
      lastSeq: 0,
      dead: standing === "dead",
    });
  }

  // Ties: bonds both ways, then what descriptions say about each other.
  const all = [...actors.values()];

  // A death told anywhere in the lore ("Kendra was Called and later killed by Drusilla"): nobody off the page tells them news.
  const loreTexts = [...inp.lore.map((l) => l.text), ...(inp.notes ?? [])];
  const everyone = all.map((a) => a.name);
  for (const a of all) {
    if (a.dead || a.ring === "onstage" || a.isUser || a.isMain || inp.profiles[keyOf(a.name)]?.standing) continue;
    if (!diedInLore(a.name, loreTexts, everyone)) continue;
    a.standing = "dead";
    a.dead = true;
    a.reach = "none";
    a.travel = TRAVEL.none;
  }
  const tie = (a: string, b: string, s: number) => {
    if (a === b) return;
    const A = actors.get(a);
    const B = actors.get(b);
    if (!A || !B) return;
    A.ties.set(b, Math.max(A.ties.get(b) ?? 0, s));
    B.ties.set(a, Math.max(B.ties.get(a) ?? 0, Math.min(s, 2)));
  };
  for (const b of Object.values(st.bonds)) {
    const ax = b.axes;
    const s = Math.min(3, 1 + Math.round((Math.abs(ax.trust ?? 0) + Math.abs(ax.affection ?? 0) + (ax.familiarity ?? 0) + (ax.attraction ?? 0) + (ax.rivalry ?? 0) + (ax.resentment ?? 0)) / 4));
    tie(b.from, b.to, s);
  }
  for (const a of all) for (const b of all) if (a !== b && a.text) {
    const s = textTie(a.text, b.name.split(" ")[0]!.length > 3 ? b.name : b.name);
    if (s) tie(a.id, b.id, s);
  }
  // The main character and the user are always tied.
  const main = all.find((a) => a.isMain);
  const user = all.find((a) => a.isUser);
  if (main && user) tie(main.id, user.id, 3);

  // Knowledge stances.
  for (const f of Object.values(st.facts)) for (const [id, s] of Object.entries(f.stances)) actors.get(id)?.knows.set(f.key, s.status);

  // docs/17, 5.2: a Routine entry's schedule gives people their routine, and puts the ones out of the scene where it says, now.
  if (inp.schedules?.length) {
    for (const [id, routine] of routinesFrom(inp.schedules, all.filter((a) => !a.isUser))) {
      const a = actors.get(id)!;
      if (!a.routine?.length) a.routine = routine;
    }
    const mod = st.time ? ((st.time.minutes % 1440) + 1440) % 1440 : null;
    for (const a of all) {
      if (mod == null || a.ring === "onstage" || st.sim.actors[a.id]?.where) continue;
      const place = routinePlace(a, mod);
      if (!place) continue;
      a.where = place.split(/\s*›\s*/);
      a.reach = reachOf(a.where, scene, a.standing);
      a.travel = TRAVEL[a.reach];
    }
  }

  const byName = (name: string) => {
    const n = name.trim().toLowerCase();
    return all.find((a) => a.name.toLowerCase() === n || a.id === n) ?? all.find((a) => a.name.toLowerCase().split(" ")[0] === n);
  };
  return { actors, byName, town: scene[0] ?? "town", scene };
}

function meansOf(text: string): number {
  if (/\b(rich|wealthy|heir|lord|lady|king|queen|prince|princess|powerful|council|leader|boss|witch|wizard|mage|sorcer\w*|billionaire|ceo|general|captain)\b/i.test(text)) return 1;
  if (/\b(child|little girl|little boy|toddler|powerless|penniless|destitute|homeless|prisoner)\b/i.test(text)) return -1;
  return 0;
}

/** "9-17 Old Town › Bakery; 18-23 home" → routine. */
export function parseRoutine(text: string | undefined): Actor["routine"] | undefined {
  if (!text?.trim()) return undefined;
  const out: NonNullable<Actor["routine"]> = [];
  for (const part of text.split(/\s*[;\n]\s*/)) {
    const m = part.match(/^(\d{1,2})(?::\d{2})?\s*[-–]\s*(\d{1,2})(?::\d{2})?\s*(?:h\s*)?[:,]?\s*(.+)$/);
    if (m) out.push({ from: Number(m[1]), to: Number(m[2]), place: m[3]!.trim() });
  }
  return out.length ? out : undefined;
}

/** Times of day as hours, from and to (night runs past midnight). */
const TIMES_OF_DAY: Record<string, [number, number]> = { dawn: [5, 8], sunrise: [5, 8], morning: [8, 12], noon: [12, 14], midday: [12, 14], afternoon: [14, 18], dusk: [18, 21], sunset: [18, 21], evening: [18, 22], night: [22, 5], midnight: [0, 3] };
const HOUR_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/** An hour from "6", "6am", "6 pm", "18:00" or "six", or null. */
function hourOf(t: string): number | null {
  const m = t.trim().toLowerCase().match(/^(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?:\s*o'?clock)?$/);
  if (!m) return null;
  let h = HOUR_WORDS[m[1]!] ?? Number(m[1]);
  if (m[3]?.startsWith("p") && h < 12) h += 12;
  if (m[3]?.startsWith("a") && h === 12) h = 0;
  return h >= 0 && h < 24 ? h : null;
}

/** A schedule line's time: "dawn", "6–9", "9am-5pm", "six" (to: null means until the next line). */
function timeSpan(t: string): { from: number; to: number | null } | null {
  const w = t.trim().toLowerCase().replace(/^(?:at|from|by|in the|the)\s+/, "");
  if (TIMES_OF_DAY[w]) return { from: TIMES_OF_DAY[w][0], to: TIMES_OF_DAY[w][1] };
  const range = w.split(/\s*(?:-|–|—|to|until|till)\s*/);
  if (range.length === 2) {
    const a = hourOf(range[0]!);
    const b = hourOf(range[1]!);
    if (a != null && b != null) return { from: a, to: b };
  }
  const h = hourOf(w);
  return h == null ? null : { from: h, to: null };
}

/**
 * Routines from Routine schedule lines ("time: who, where" or "time — who — where"), for the
 * people the roster knows by name. A single hour runs until the next line's (else three hours).
 */
export function routinesFrom(lines: string[], people: { id: string; name: string }[]): Map<string, NonNullable<Actor["routine"]>> {
  const parsed: { from: number; to: number | null; rest: string }[] = [];
  for (const line of lines) {
    // "6–9: who, where" (the colon first, so a range's dash stays in the time), else "dawn — who — where".
    const l = line.trim().replace(/^[-•]\s*/, "");
    const m = l.match(/^(\d{1,2}:\d{2}(?:\s*(?:-|–|to)\s*\d{1,2}:\d{2})?)\s*(?::|—|–|-|,)\s*(.+)$/) ?? l.match(/^([^:]{1,24}):\s*(.+)$/) ?? l.match(/^(.{1,24}?)\s+(?:—|–|-)\s+(.+)$/);
    const span = m && timeSpan(m[1]!);
    if (span) parsed.push({ ...span, rest: m![2]! });
  }
  const starts = [...new Set(parsed.map((p) => p.from))].sort((a, b) => a - b);
  const out = new Map<string, NonNullable<Actor["routine"]>>();
  for (const p of parsed) {
    const to = p.to ?? starts.find((h) => h > p.from) ?? (p.from + 3) % 24;
    for (const a of people) {
      // Their full name, else their first one ("Mira" for Mira Vell).
      const words = [a.name, ...(a.name.includes(" ") ? [a.name.split(/\s+/)[0]!] : [])].filter((w) => w.length >= 3);
      const re = words.map((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")).find((r) => r.test(p.rest));
      if (!re) continue;
      const place = p.rest.replace(re, "").replace(/^[\s,—–-]+|[\s,.;]+$/g, "").replace(/^(?:at|in|on|by)\s+/i, "").trim();
      if (!place) continue;
      out.set(a.id, [...(out.get(a.id) ?? []), { from: p.from, to, place }]);
    }
  }
  return out;
}

/** Where an actor's routine puts them at an hour, if anywhere. */
export function routinePlace(a: Actor, minuteOfDay: number): string | undefined {
  const h = Math.floor(minuteOfDay / 60);
  return a.routine?.find((r) => (r.from <= r.to ? h >= r.from && h < r.to : h >= r.from || h < r.to))?.place;
}

/** Awake 07–23 (nocturnal: the other way round), unless their routine says they're about. */
export function awakeAt(a: RActor, minuteOfDay: number): boolean {
  const h = minuteOfDay / 60;
  const day = h >= 7 && h < 23;
  return a.nocturnal ? !day || h >= 19 || h < 7 : day || Boolean(routinePlace(a, minuteOfDay));
}

export function canAct(a: RActor): boolean {
  return !a.isUser && !a.dead && a.standing !== "changed" && a.standing !== "companion" && a.flag !== "out";
}

/** The people simulated this tick (ALMANAC 09 §4.3): ranked; room kept for the unmet. */
export function awakeSet(r: Roster, o: { cap: number; leads: Set<string>; now: number; seed: () => number; recent: Set<string> }): RActor[] {
  const scored = [...r.actors.values()]
    .filter((a) => canAct(a) && a.ring !== "onstage")
    .map((a) => {
      const tieTop = Math.max(0, ...a.ties.values());
      const neglect = a.lastBeatAt == null ? 1 : Math.min(1, (o.now - a.lastBeatAt) / (24 * 60));
      const s = 3 * Number(o.leads.has(a.id)) + tieTop + REACH_WEIGHT[a.reach] + 0.5 * Number(o.recent.has(a.name.toLowerCase())) + neglect + (a.flag === "wake" ? 5 : 0) + o.seed() * 0.6;
      return { a, s };
    })
    .sort((x, y) => y.s - x.s);
  const out: RActor[] = [];
  const seenCap = Math.ceil(o.cap * 0.6);
  let seen = 0;
  for (const { a } of scored) {
    if (out.length >= o.cap) break;
    if (a.ring === "offstage" && seen >= seenCap && scored.some((x) => x.a.ring === "unmet" && !out.includes(x.a))) continue;
    if (a.ring === "offstage") seen++;
    out.push(a);
  }
  return out;
}
