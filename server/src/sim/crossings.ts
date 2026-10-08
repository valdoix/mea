import type { WorldState } from "../trackers/types";
import { pick } from "./dice";
import { SPECS } from "./grammar";
import { canAct, type RActor, type Roster, TRAVEL } from "./roster";
import type { Arc, Arrival, Route, SimOp } from "./types";

/**
 * How the world off the page reaches the scene (ALMANAC 09 §10, plus omens): carriers, signals,
 * things heard, traces, entrances, and omens that foreshadow a subplot before it crosses.
 * An arrival is offered in the note; it counts as delivered only when the reply uses it.
 */
const MAX_OFFERS: Record<Route, number> = { carrier: 3, signal: 2, ambient: 1, trace: 2, entrance: 2, omen: 1 };
const LIFE: Record<Route, number | null> = { carrier: 3 * 1440, signal: null, ambient: 12 * 60, trace: 5 * 1440, entrance: 1440, omen: 1440 };

export function medium(tech: string, close: boolean): string {
  if (tech === "modern") return close ? "call" : "text";
  if (tech === "future") return "message";
  if (tech === "fantasy") return close ? "messenger" : "letter";
  return close ? "note" : "letter";
}

const OMENS: Partial<Record<Arc["kind"], string[]>> = {
  threat: ["Dogs bark at nothing, all along the street.", "A smell of smoke on the wind, from somewhere you can't see.", "Strangers watch the road and look away too quickly."],
  scheme: ["A sealed letter changes hands in a doorway and vanishes.", "Someone asks a little too casually where you'll be tomorrow."],
  revenge: ["A car idles across the street, then drives off when you look.", "Fresh scratches on the lock, though nothing was taken.", "Someone has been asking about you."],
  secret: ["A conversation stops when you walk in.", "A drawer that was always open is locked now."],
  return: ["An old photograph turns up, face down, as if someone had been looking at it.", "The phone rings once and stops."],
  decline: ["An empty bottle hidden badly behind the bins.", "A friend's laugh that comes a beat too late."],
  faction: ["New posters on the walls overnight.", "Prices went up at the market, and nobody will say why."],
};

/** Chooses how a beat could reach the scene, and writes the arrival. */
export function routeFor(o: {
  arc: Arc;
  lead: RActor | undefined;
  beatText: string;
  roster: Roster;
  state: WorldState;
  now: number;
  tech: string;
  rand: () => number;
  stage: Arc["stage"];
  result: "win" | "cost" | "loss";
  recentRoutes: Route[];
}): Arrival | null {
  const { arc, lead, roster } = o;
  const spec = SPECS[arc.kind];
  const onstage = [...roster.actors.values()].filter((a) => a.ring === "onstage" && !a.isUser);
  const user = [...roster.actors.values()].find((a) => a.isUser);
  const ties = lead?.ties ?? new Map<string, number>();
  const target = arc.target ? roster.actors.get(arc.target) : undefined;
  const options: Route[] = [];
  for (const r of spec.routes) {
    if (o.recentRoutes.at(-1) === r && spec.routes.length > 1) continue;
    if (r === "omen" && (arc.foreshadowed || !OMENS[arc.kind] || (o.stage !== "crisis" && o.stage !== "reversal"))) continue;
    if (r === "entrance" && (!lead || !canAct(lead) || lead.travel > 60 || !(o.stage === "crisis" || o.stage === "climax" || arc.bringIn) || o.result === "loss")) continue;
    if (r === "ambient" && (!lead || lead.travel > TRAVEL.town) && arc.kind !== "faction") continue;
    options.push(r);
  }
  if (arc.bringIn && options.includes("entrance")) options.unshift("entrance");
  const route = options[0] && o.rand() < 0.65 ? options[0] : options.length ? pick(o.rand, options) : null;
  if (!route) return null;
  const id = `${arc.id}:${o.now}:${route}`;
  const base = { id, arc: arc.id, route, at: o.now, status: "pending" as const, offers: 0, maxOffers: MAX_OFFERS[route], seq: 0 };
  const until = (r: Route) => (LIFE[r] == null ? null : o.now + LIFE[r]!);
  const short = o.beatText.split(/(?<=[.!?])\s/)[0] ?? o.beatText;
  switch (route) {
    case "carrier": {
      // Someone close to the lead, never the one the subplot is about; onstage people first.
      const candidates = [...ties.entries()]
        .filter(([id, s]) => s >= 2 && id !== arc.target && id !== user?.id)
        .map(([id]) => roster.actors.get(id))
        .filter((a): a is RActor => Boolean(a && !a.dead && !a.isUser));
      const carrier = candidates.find((a) => a.ring === "onstage") ?? candidates[0];
      if (!carrier) return null;
      return { ...base, carrier: carrier.name, text: `${carrier.name} knows something about ${arc.leadName}: ${short}`, until: until(route) };
    }
    case "signal": {
      const toUser = user && (ties.get(user.id) ?? 0) >= 2;
      const callee = toUser ? user : onstage.find((a) => (ties.get(a.id) ?? 0) >= 2 && a.id !== arc.target);
      if (!callee) return null;
      const m = medium(o.tech, (ties.get(callee.id) ?? 0) >= 3);
      return { ...base, carrier: arc.leadName, to: callee.isUser ? "user" : callee.name, medium: m, text: `A ${m} from ${arc.leadName} for ${callee.isUser ? "the user's character" : callee.name}: ${short}`, until: m === "call" ? o.now + 6 * 60 : until(route) };
    }
    case "ambient":
      return { ...base, place: [roster.town], text: `Heard around ${roster.town}: ${short}`, until: until(route) };
    case "trace": {
      const place = arc.place ?? lead?.where ?? lead?.base;
      if (!place?.length) return null;
      return { ...base, place, text: `At ${place.at(-1)}, signs of what happened: ${short}`, until: until(route) };
    }
    case "entrance":
      return { ...base, carrier: arc.leadName, at: o.now + (lead?.travel ?? 0), text: `${arc.leadName} could turn up${target ? ` (about ${target.name})` : ""}: ${short}`, until: until(route) };
    case "omen": {
      const text = pick(o.rand, OMENS[arc.kind]!);
      return { ...base, place: [roster.town], text, until: until(route) };
    }
  }
}

function placeMatch(arrival: string[] | undefined, scene: string[]) {
  if (!arrival?.length || !scene.length) return false;
  const deepest = arrival.at(-1)!.toLowerCase();
  return scene.some((s) => s.toLowerCase() === deepest) || (arrival.length === 1 && scene[0]!.toLowerCase() === deepest);
}

const CHARGED = /crisis|conflict|intimacy/;

/** What reaches the scene now, for the story-state note's ELSEWHERE lane. */
export function elsewhereLane(o: { arrivals: Arrival[]; state: WorldState; roster: Roster; now: number; userName: string; arcs: Arc[] }): { text: string; offered: string[] } {
  const here = new Set([...o.roster.actors.values()].filter((a) => a.ring === "onstage").map((a) => a.name.toLowerCase()));
  const userHere = true;
  const charged = CHARGED.test(o.state.mode ?? "");
  const now: string[] = [];
  const maybe: string[] = [];
  const offered: string[] = [];
  for (const a of o.arrivals) {
    if (a.status === "used" || a.status === "expired" || a.at > o.now || (a.until != null && a.until < o.now)) continue;
    const arc = o.arcs.find((x) => x.id === a.arc);
    let line: string | null = null;
    let optional = false;
    switch (a.route) {
      case "carrier":
        if (a.carrier && here.has(a.carrier.toLowerCase())) line = `${a.text} (theirs to mention or keep to themselves)`;
        break;
      case "signal":
        if ((a.to === "user" && userHere) || (a.to && here.has(a.to.toLowerCase()))) line = a.text.replace("the user's character", o.userName);
        break;
      case "ambient":
        if (o.roster.scene[0] && a.place?.[0] && placeMatch(a.place, o.roster.scene)) line = a.text;
        else if (a.place?.[0]?.toLowerCase() === o.roster.town.toLowerCase()) line = a.text;
        break;
      case "trace":
        if (placeMatch(a.place, o.roster.scene)) line = a.text;
        break;
      case "omen":
        if (!charged) line = `${a.text} (an omen: show it, explain nothing)`;
        break;
      case "entrance":
        if (!charged || (arc && arc.clock.cur >= arc.clock.max)) {
          line = a.text;
          optional = true;
        }
        break;
    }
    if (!line) continue;
    offered.push(a.id);
    (optional ? maybe : now).push(line);
  }
  // Back on the page: what an onstage person did off it since they were last seen (theirs to tell or hide).
  const back: string[] = [];
  for (const arc of o.arcs) {
    if (!here.has(arc.leadName.toLowerCase()) || arc.secrecy === "secret" || !arc.beats.length) continue;
    const lead = o.roster.actors.get(arc.lead);
    const recent = arc.beats.filter((b) => b.seq > (lead?.lastSeq ?? 0) - 1).slice(-2);
    if (recent.length) back.push(`${arc.leadName}, since last seen: ${recent.map((b) => b.text).join(" ")} (theirs to tell or hide)`);
  }
  const parts: string[] = [];
  if (now.length) parts.push(`Reaches the scene now (render it; invent no other news): ${now.join(" | ")}`);
  if (maybe.length) parts.push(`Could come in if the scene opens (optional): ${maybe.join(" | ")}`);
  if (back.length) parts.push(back.slice(0, 2).join(" | "));
  return { text: parts.length ? `ELSEWHERE: ${parts.join("\n")}` : "", offered };
}

const STOP = new Set("the a an and or but of to in on at for with from by as is was were be been it its that this he she they them his her their you your there here then than so not no".split(" "));
export function coverage(text: string, prose: string): number {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z']{4,}/g)?.filter((w) => !STOP.has(w)) ?? []);
  const a = words(text);
  const b = words(prose);
  if (!a.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / a.size;
}

/** After a reply: arrivals it used are delivered; offered ones count down; old ones expire. */
export function confirmArrivals(o: { arrivals: Arrival[]; offered: string[]; prose: string; now: number; castNames: string[] }): SimOp[] {
  const ops: SimOp[] = [];
  const prose = o.prose.toLowerCase();
  for (const a of o.arrivals) {
    if (a.status === "used" || a.status === "expired") continue;
    if (a.until != null && a.until < o.now) {
      // A call nobody took becomes a missed call, offered once more.
      if (a.route === "signal" && a.medium === "call" && !/missed call/.test(a.text)) {
        ops.push({ type: "arrival.set", id: a.id, status: "pending", text: `A missed call from ${a.carrier}${a.to && a.to !== "user" ? ` for ${a.to}` : ""}.`, offers: a.maxOffers - 1 });
        continue;
      }
      ops.push({ type: "arrival.set", id: a.id, status: "expired" });
      continue;
    }
    if (!o.offered.includes(a.id)) continue;
    const named = a.carrier && prose.includes(a.carrier.toLowerCase().split(" ")[0]!);
    const used =
      a.route === "entrance" ? o.castNames.some((n) => n.toLowerCase() === a.carrier?.toLowerCase()) : a.route === "omen" ? coverage(a.text, o.prose) > 0.3 : coverage(a.text, o.prose) > 0.35 || (a.route !== "ambient" && named && coverage(a.text, o.prose) > 0.15);
    const offers = a.offers + 1;
    if (used) ops.push({ type: "arrival.set", id: a.id, status: "used", offers });
    else if (offers >= a.maxOffers) ops.push({ type: "arrival.set", id: a.id, status: "expired", offers });
    else ops.push({ type: "arrival.set", id: a.id, status: "offered", offers });
  }
  return ops;
}
