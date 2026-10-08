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

export function readStanding(text: string): { standing?: Standing; where?: string } {
  const t = text.toLowerCase();
  if (/\b(died|was killed|is dead|deceased|the late\b|passed away|murdered)\b/.test(t)) return { standing: "dead" };
  if (/\b(android|robot|golem|automaton|construct)\b/.test(t)) return { standing: "construct" };
  if (/\b(imprisoned|in prison|in jail|captive|held prisoner|locked up|kidnapped)\b/.test(t)) return { standing: "captive" };
  if (/\b(pet|familiar|her (?:dog|cat|horse)|his (?:dog|cat|horse)|steed|dragon of)\b/.test(t)) return { standing: "companion" };
  const away = text.match(/\b(?:lives in|moved to|left for|works in|stationed in|studying in|now in)\s+([A-Z][\w'’ -]{2,40})/);
  if (away) return { standing: "away", where: away[1]!.trim() };
  if (FAR.test(t)) return { standing: "away" };
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

export interface RosterInput {
  state: WorldState;
  profiles: Record<string, CastProfile>;
  /** People from lorebooks (and the card's world): name + description. */
  lore: { name: string; text: string }[];
  userName: string;
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
    const read = readStanding(text);
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
    if ([...actors.values()].some((a) => a.name.toLowerCase() === u.name.toLowerCase() || a.id === id)) continue;
    if (u.name.toLowerCase() === inp.userName.toLowerCase()) continue;
    const simActor = st.sim.actors[id];
    const read = readStanding(u.text);
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
