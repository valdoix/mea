import { SPECS } from "./grammar";
import type { RActor, Roster } from "./roster";
import type { Arc, ArcKind } from "./types";

/**
 * How subplots bear on each other (after ALMANAC 09 §20). Two subplots are tied when one of them is
 * about a person the other has in it: the lead of one is in the other. Two subplots aimed at the same
 * person bear on each other too, when this one's lead could know of the other. Everything is read from
 * the subplots' own beats and endings; nothing new is stored. (What spreads at once is ripples.ts.)
 * - Meanwhile: what a tied subplot did last, so the telling continues in step with it.
 * - Pulls: a subplot out to help someone, or to work against them, turns the dice of that person's
 *   own subplot by how its latest step went (and the other way round).
 * - What stands: something a step took from a person ("Mira's sight is gone") holds for every
 *   subplot with that person until a later step gives it back.
 */

/** One step of a subplot (a beat or its ending), as the others see it. */
export interface ArcEvent {
  arc: string;
  lead: string;
  leadName: string;
  kind: ArcKind;
  result: string;
  text: string;
  at: number;
  ending?: boolean;
}

export interface Bearing {
  arc: string;
  leadName: string;
  kind: ArcKind;
  /** The person both subplots are about (a name). */
  person: string;
  /** Which way one of the two pulls on the other's lead, or neither. */
  stance: "for" | "against" | "shared";
  /** Whose pull: the other subplot on this one's lead ("theirs"), this one on the other's lead ("mine"), or both on the same person ("target"). */
  dir?: "theirs" | "mine" | "target";
  /** "target": the other subplot's step went well for that person. */
  helped?: boolean;
  text: string;
  at: number;
  ending: boolean;
  /** It came after this subplot's own last step: this step answers it. */
  fresh: boolean;
  /** What it does to this subplot's next roll. */
  mod: number;
}

export interface Condition {
  person: string;
  thing: string;
  /** "Mira's sight is gone". */
  text: string;
  arc: string;
  leadName: string;
  kind: ArcKind;
  at: number;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const low = (s: string) => s.toLowerCase();
/** How far back another subplot's step still counts as "meanwhile". */
const WINDOW = 2 * 1440;
/** Kinds that are on their target's side. */
const FOR_KINDS = new Set<ArcKind>(["protect", "reconcile", "courtship"]);

/** The people (not factions) in a subplot: its lead, cast and target. */
export function peopleOf(arc: Arc, r: Roster): RActor[] {
  const out: RActor[] = [];
  for (const id of [arc.lead, ...arc.cast, ...(arc.target ? [arc.target] : [])]) {
    const a = r.actors.get(id);
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

/** People two subplots share where one of them is about that person (its lead). Mira in two casts isn't a tie. */
export function tied(a: Arc, b: Arc, r: Roster): RActor[] {
  const pb = peopleOf(b, r);
  return peopleOf(a, r).filter((x) => pb.includes(x) && (x.id === a.lead || x.id === b.lead));
}

/** Every step a subplot has taken, oldest first: its beats, then its ending. */
export function eventsOf(arc: Arc): ArcEvent[] {
  const base = { arc: arc.id, lead: arc.lead, leadName: arc.leadName, kind: arc.kind };
  const ev: ArcEvent[] = arc.beats.map((b) => ({ ...base, result: b.result, text: b.text, at: b.at }));
  if (arc.ending && (arc.status === "resolved" || arc.status === "dropped")) ev.push({ ...base, result: arc.ending.result, text: arc.ending.text, at: arc.ending.at, ending: true });
  return ev;
}

const AGAINST = "take(?:s|n)? away|takes?|took|strip(?:s|ped)?|bind(?:s)?|bound|stop(?:s|ped)?|expose(?:s|d)?|punish(?:es|ed)?|kill(?:s|ed)?|destroy(?:s|ed)?|defeat(?:s|ed)?|ruin(?:s|ed)?|hunt(?:s|ed)?(?: down)?|capture(?:s|d)?|arrest(?:s|ed)?|banish(?:es|ed)?|curse(?:s|d)?|betray(?:s|ed)?|undermine(?:s|d)?|discredit(?:s|ed)?|make (?:\\w+ )?pay|get rid of|be rid of|drive out|turn (?:\\w+ )?against";
const FOR = "help(?:s|ed)?|protect(?:s|ed)?|save(?:s|d)?|rescue(?:s|d)?|steer(?:s|ed)?|support(?:s|ed)?|heal(?:s|ed)?|guard(?:s|ed)?|shield(?:s|ed)?|warn(?:s|ed)?|comfort(?:s|ed)?|free(?:s|d)?|look after|stand by|keep (?:\\w+ )?safe|bring (?:\\w+ )?back|reach(?:es)?|win (?:\\w+ )?back";

const namesOf = (a: RActor) => [...new Set([a.name, a.name.split(/\s+/)[0]!])].filter((n) => n.length >= 3).map(esc).join("|");

/** Which way a subplot pulls on someone in it who isn't its lead. */
export function aimAt(arc: Arc, person: RActor): "for" | "against" | "shared" {
  if (person.id === arc.lead) return "shared";
  if (arc.target === person.id) {
    if (SPECS[arc.kind].hostile) return "against";
    if (FOR_KINDS.has(arc.kind)) return "for";
  }
  const names = namesOf(person);
  if (!names) return "shared";
  // The want first: what the lead is after is what they do to the other.
  for (const text of [arc.want, arc.premise]) {
    const near = (verbs: string) => new RegExp(`\\b(?:${verbs})\\b(?:\\s+[\\w'’-]+){0,4}?\\s+(?:${names})\\b`, "i").test(text);
    if (near(AGAINST)) return "against";
    if (near(FOR)) return "for";
  }
  return "shared";
}

/** How a step went for its lead: +1 their way, −1 against them, 0 neither. */
export const swing = (result: string) => (["win", "cost", "met", "price"].includes(result) ? 1 : ["loss", "lost"].includes(result) ? -1 : 0);

const THING = "dark magic|magic|magick|powers?|abilities|strength|memor(?:y|ies)|soul|sight|voice|wings|immortality|freedom|title|fortune|ship|boat|house|home|job|name";
/** Things of a kind: a subplot about dark magic is about the magic that was taken. */
const KIN: string[][] = [["magic", "magick", "dark magic", "power", "powers", "abilities", "spell", "spells", "witchcraft"], ["memory", "memories"], ["sight", "eyes"], ["home", "house"], ["ship", "boat"]];
const kin = (thing: string) => KIN.find((k) => k.includes(low(thing))) ?? [low(thing)];
/** Words that make a sentence say what someone means or tries to do, not what happened. */
const NOT_DONE = /\b(?:to|would|will|could|might|n't|not|never|almost|nearly|about to|set to|means? to|plans? to|going to|tried to|try to|before|until|if|whether)\s+$/i;

/** What a step settles about the people in it: something taken from them, or given back. */
export function settled(text: string, people: RActor[]): { person: RActor; thing: string; gone: boolean }[] {
  const out: { person: RActor; thing: string; gone: boolean }[] = [];
  for (const s of text.split(/(?<=[.!?;])\s+|\s+[—–]\s+/)) {
    if (/\b(?:stopped short|not yet|isn't|wasn't|didn't|did not|hasn't|failed to)\b/i.test(s)) continue;
    for (const a of people) {
      const names = namesOf(a);
      if (!names) continue;
      const N = `(?:${names})`;
      const T = `(?:\\w+\\s+)?(${THING})`;
      const POSS = `(?:her|his|their|its)`;
      const tests: [RegExp, boolean][] = [
        [new RegExp(`\\b(?:took|taken|stripped|stole|stolen|drained|bound|sealed|removed|ripped (?:out|away)|burned out|burned down|sank|seized|cut off)\\s+(?:away\\s+)?${N}['’]s\\s+${T}`, "i"), true],
        [new RegExp(`\\b${N}['’]s\\s+${T}\\s+(?:is|was|were|are|has been|had been|now)?\\s*(?:now\\s+|all\\s+)?(?:gone|taken|stripped|bound|drained|sealed|removed|lost|sold|seized)\\b`, "i"), true],
        [new RegExp(`\\b(?:stripped|drained|robbed|emptied)\\s+${N}\\s+of\\s+(?:${POSS}\\s+)?${T}`, "i"), true],
        [new RegExp(`\\b${N}\\s+(?:is|was)\\s+(?:now\\s+)?(?:left\\s+)?without\\s+(?:${POSS}\\s+)?${T}`, "i"), true],
        [new RegExp(`\\b${N}\\s+(?:has\\s+)?(?:lost|no longer has)\\s+${POSS}\\s+${T}`, "i"), true],
        [new RegExp(`\\b${N}['’]s\\s+${T}\\s+(?:is|was|were|are|has|have|came|come)\\s+(?:now\\s+)?(?:back|restored|returned|come back)\\b`, "i"), false],
        [new RegExp(`\\b${N}\\s+(?:got|gets|won|has|took)\\s+${POSS}\\s+${T}\\s+back\\b`, "i"), false],
        [new RegExp(`\\b${N}\\s+(?:regained|recovered|bought back)\\s+${POSS}\\s+${T}`, "i"), false],
        [new RegExp(`\\b(?:restored|returned|gave back)\\s+${N}['’]s\\s+${T}`, "i"), false],
      ];
      for (const [re, gone] of tests) {
        const m = re.exec(s);
        if (!m || NOT_DONE.test(s.slice(0, m.index))) continue;
        const thing = low(m[1]!);
        if (!out.some((x) => x.person === a && kin(x.thing).includes(thing))) out.push({ person: a, thing, gone });
        break;
      }
    }
  }
  return out;
}

/** What stands about these people now: the latest word on each thing taken from them. */
export function conditionsFor(people: RActor[], all: ArcEvent[], before: number): Condition[] {
  const latest = new Map<string, Condition | null>();
  for (const ev of all.filter((e) => e.at <= before).sort((a, b) => a.at - b.at)) {
    for (const s of settled(ev.text, people)) {
      const k = `${s.person.id}|${kin(s.thing)[0]}`;
      latest.set(k, s.gone ? { person: s.person.name, thing: s.thing, text: `${s.person.name}'s ${s.thing} ${/s$/.test(s.thing) ? "are" : "is"} gone`, arc: ev.arc, leadName: ev.leadName, kind: ev.kind, at: ev.at } : null);
    }
  }
  return [...latest.values()].filter((c): c is Condition => !!c);
}

/** Whether a subplot's own words are about this thing ("dark magic" is about the magic). */
export function touches(arc: Arc, thing: string): boolean {
  const text = low(`${arc.premise} ${arc.want} ${arc.fear} ${arc.beats.at(-1)?.text ?? ""}`);
  return kin(thing).some((w) => new RegExp(`\\b${esc(w)}\\b`).test(text));
}

/**
 * How the other subplots bear on this one at `at`: one bearing per tied subplot, its latest step
 * before then (within two story days, or its ending). `extra` adds steps taken earlier in this tick.
 */
export function bearingsOn(arc: Arc, arcs: Arc[], r: Roster, at: number, extra: ArcEvent[] = []): Bearing[] {
  const lead = r.actors.get(arc.lead);
  const hasEarlier = arc.beats.some((b) => b.at < at);
  const since = arc.beats.filter((b) => b.at < at).at(-1)?.at ?? arc.createdAt;
  const out: Bearing[] = [];
  for (const o of arcs) {
    // A dropped subplot stopped: what it last did no longer moves anyone.
    if (o.id === arc.id || o.status === "dropped") continue;
    const both = tied(arc, o, r);
    const same = !both.length && !!arc.target && arc.target === o.target ? r.actors.get(arc.target) : undefined;
    if (!both.length && !(same && knowsOf(o, arc.lead, r))) continue;
    const ev = [...eventsOf(o), ...extra.filter((e) => e.arc === o.id)].filter((e) => e.at <= at).sort((a, b) => a.at - b.at).at(-1);
    if (!ev || (at - ev.at > WINDOW && !ev.ending) || at - ev.at > 3 * WINDOW) continue;
    const fresh = hasEarlier ? ev.at > since : ev.at >= since;
    const oLead = r.actors.get(o.lead);
    let stance: Bearing["stance"] = "shared";
    let dir: Bearing["dir"];
    let person = both[0] ?? same!;
    let mod = 0;
    let helped: boolean | undefined;
    const g = swing(ev.result);
    // Target: both aimed at the same person. What the other's step did to them is this one's headway or setback.
    if (same) {
      const so = side(aimAt(o, same));
      const sa = side(aimAt(arc, same));
      if (so && sa) {
        [stance, dir, helped, mod] = [so > 0 ? "for" : "against", "target", so * g > 0, so * g * sa];
        if (!g) helped = undefined;
      }
    }
    // Theirs: helping this lead turns the dice their way when it goes well; working against them, by how it went.
    if (lead && both.includes(lead)) {
      const s = aimAt(o, lead);
      if (s !== "shared") [stance, dir, person, mod] = [s, "theirs", lead, s === "for" ? Math.max(0, g) : -g];
    }
    // Mine: the one this subplot helps doing well (or badly) is its own headway (or setback); the one it works against, the reverse.
    if (stance === "shared" && oLead && both.includes(oLead)) {
      const s = aimAt(arc, oLead);
      if (s !== "shared") [stance, dir, person, mod] = [s, "mine", oLead, s === "for" ? g : -g];
    }
    out.push({ arc: o.id, leadName: o.leadName, kind: o.kind, person: person.name, stance, dir, ...(helped != null ? { helped } : {}), text: ev.text, at: ev.at, ending: !!ev.ending, fresh, mod: fresh ? mod : 0 });
  }
  return out.sort((a, b) => Number(b.fresh) - Number(a.fresh) || b.at - a.at);
}

const side = (s: "for" | "against" | "shared") => (s === "for" ? 1 : s === "against" ? -1 : 0);

/** Could this person know of a subplot? Its own people do; others unless it's secret, and only if close to it when private. */
function knowsOf(o: Arc, id: string, r: Roster): boolean {
  const a = r.actors.get(id);
  if (!a) return false;
  if (peopleOf(o, r).includes(a) || o.secrecy === "public") return true;
  return o.secrecy === "private" && [o.lead, o.target].some((p) => !!p && (a.ties.get(p) ?? 0) >= 2);
}

/** What the ties do to this subplot's next roll: the fresh pulls, at most one step either way. */
export function webMod(bs: Bearing[]): { mod: number; why: string[] } {
  const pulls = bs.filter((b) => b.mod);
  const mod = Math.max(-1, Math.min(1, pulls.reduce((s, b) => s + b.mod, 0)));
  return { mod, why: mod ? pulls.filter((b) => Math.sign(b.mod) === Math.sign(mod)).map(pullWords) : [] };
}

/** A pull in words: "Joss's revenge went against Mira", "Mira's own recovery went badly". */
export function pullWords(b: Bearing): string {
  const label = SPECS[b.kind].label.toLowerCase();
  if (b.dir === "target") return `tied: ${b.leadName}'s ${label} ${b.helped ? "helped" : "hurt"} ${b.person}`;
  if (b.dir === "theirs") return `tied: ${b.leadName}'s ${label} ${b.stance === "for" ? `helped ${b.person}` : `went against ${b.person}`}`;
  return `tied: ${b.person}'s own ${label} went ${(b.mod > 0) === (b.stance === "for") ? "well" : "badly"}`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s);

/** A card's MEANWHILE lines: what the tied subplots did, newest that this step answers first. */
export function meanwhileLines(bs: Bearing[]): string[] {
  const label = (b: Bearing) => (b.dir === "theirs" ? (b.stance === "for" ? ` (on ${b.person}'s side)` : ` (against ${b.person})`) : b.dir === "mine" ? ` (${b.person}'s own story; this subplot is ${b.stance === "for" ? `on ${b.person}'s side` : `against ${b.person}`})` : b.dir === "target" ? ` (${b.stance === "for" ? `on ${b.person}'s side` : `against ${b.person}`}; this subplot is about ${b.person} too)` : "");
  return bs.slice(0, 3).map((b) => `${b.leadName}'s ${SPECS[b.kind].label.toLowerCase()}${label(b)}${b.ending ? ", ended" : ""}: ${clip(b.text, 220)}${b.fresh ? " [since this subplot's last step]" : ""}`);
}

/** A card's STANDS lines: what is settled about its people, which this step may not undo by itself. */
export function standsLines(cs: Condition[], since: number, first = false): string[] {
  return cs.slice(0, 3).map((c) => `${c.text} (from ${c.leadName}'s ${SPECS[c.kind].label.toLowerCase()})${c.at > since || (first && c.at >= since) ? " [new since this subplot's last step: this step follows from it]" : ""}`);
}
