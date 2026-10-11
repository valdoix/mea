import type { Op, WorldState } from "../trackers/types";
import { chanceIn, d6, pick, rng, weighted } from "./dice";
import { type DirectorLean, escalationTarget, lean, measureTension, type Personality, targetTension } from "./director";
import { routeFor } from "./crossings";
import { beatTemplate, endTemplate, GENRE_LEAN, kindFromText, SPECS, stageOf } from "./grammar";
import { spreadNews } from "./news";
import { awakeAt, awakeSet, canAct, type RActor, type Roster } from "./roster";
import type { Arc, ArcKind, Beat, EndResult, Proposal, Result, Route, SimOp, Twist } from "./types";
import { type ArcEvent, bearingsOn, conditionsFor, eventsOf, meanwhileLines, peopleOf, standsLines, tied, touches, webMod } from "./web";

/**
 * One tick of the world off the page (after ALMANAC 09 §6). Deterministic for a chat and a
 * stretch of story time. The engine decides who moves, how the dice fall, what twists and what
 * ends; a model may tell the result afterwards (telling.ts), and templates tell it otherwise.
 */
export type SimMode = "quiet" | "living" | "restless";

export const MODES: Record<SimMode, { awake: number; arcs: number; perTick: number; factor: number; twist: number; seeds: number; incidentsPerDay: number; arrivals: number; chain: number }> = {
  quiet: { awake: 6, arcs: 3, perTick: 2, factor: 0.5, twist: 1 / 12, seeds: 1, incidentsPerDay: 0.3, arrivals: 0.5, chain: 1 / 6 },
  living: { awake: 10, arcs: 6, perTick: 4, factor: 1, twist: 1 / 6, seeds: 2, incidentsPerDay: 0.7, arrivals: 0.75, chain: 1 / 3 },
  restless: { awake: 16, arcs: 10, perTick: 6, factor: 2, twist: 1 / 4, seeds: 3, incidentsPerDay: 1.4, arrivals: 0.9, chain: 1 / 2 },
};

const STAGE_RATE = { hook: 0.8, rising: 1, reversal: 1.1, crisis: 1.4, climax: 1.5, aftermath: 0 } as const;

export interface TickInput {
  chatId: string;
  state: WorldState;
  roster: Roster;
  mode: SimMode;
  director: Personality;
  seeding: "auto" | "ask" | "off";
  fates: "page" | "ask" | "allow";
  genres: string[];
  tech: string;
  /** Story minutes: the previous tick and now. */
  from: number | null;
  now: number;
  /** Names mentioned in recent messages (who has been on people's minds). */
  recent: Set<string>;
  /** The player moved the world a step: something moves if anything can. */
  forced?: boolean;
  /** The sky at this hour (for twists and incidents). */
  weather?: string;
  /** A named day today (a festival, a birthday). */
  namedDay?: string | null;
}

export interface BeatCard {
  id: string;
  arc: string;
  kind: ArcKind;
  stage: string;
  result: Result | EndResult;
  lead: string;
  cast: string[];
  where: string;
  premise: string;
  want: string;
  fear: string;
  soFar: string[];
  template: string;
  twist?: string;
  ending?: boolean;
  at: number;
  /** What the subplots tied to this one did last (subplots bear on each other). */
  meanwhile?: string[];
  /** What is settled about its people, which this step can't undo by itself. */
  stands?: string[];
  /** Names the telling may use beyond the lead and cast: the people in MEANWHILE and STANDS. */
  names?: string[];
}

/** What a tick has done so far: the steps taken (so later steps and every card see them) and who moved. */
interface TickWeb {
  events: ArcEvent[];
  moved: Set<string>;
}

export interface TickResult {
  sim: SimOp[];
  ledger: Op[];
  cards: BeatCard[];
  tension: number;
  target: number;
  summary: string[];
}

const HOUR = 60;

function arcReach(arc: Arc, r: Roster): number {
  const lead = r.actors.get(arc.lead);
  const user = [...r.actors.values()].find((a) => a.isUser);
  const toUser = user ? (lead?.ties.get(user.id) ?? 0) : 0;
  const onstageTie = Math.max(0, ...[...r.actors.values()].filter((a) => a.ring === "onstage").map((a) => lead?.ties.get(a.id) ?? 0));
  return toUser + onstageTie + (lead ? { here: 3, building: 2.5, district: 2, town: 1.5, region: 0.7, far: 0.3, none: 0 }[lead.reach] : 0.5);
}

export function tick(inp: TickInput): TickResult {
  const out: TickResult = { sim: [], ledger: [], cards: [], tension: 0, target: 0, summary: [] };
  const st = inp.state;
  const sim = st.sim;
  const M = MODES[inp.mode];
  const window = Math.floor(inp.now / 60);
  // The tick count joins the seed: a step forced twice in the same story hour rolls fresh dice.
  const R = (salt: string) => rng(`${inp.chatId}:${salt}:${window}:${sim.ticks}`);
  const hours = inp.from == null ? 0 : Math.max(0, (inp.now - inp.from) / HOUR);
  const mod = inp.now % 1440;

  // The director reads the story.
  const tension = measureTension(st, sim);
  const target = targetTension(inp.director, sim, inp.now, inp.chatId);
  const L = lean(inp.director, tension, target);
  out.tension = tension;
  out.target = target;

  // News travels first: it wakes people and unlocks subplots.
  if (hours > 0) {
    const news = spreadNews({ state: st, roster: inp.roster, hours, rand: R("news"), tech: inp.tech, now: inp.now });
    for (const h of news.hops) {
      out.sim.push({ type: "news", hop: h });
      out.summary.push(`${h.to} heard from ${h.from}: ${h.statement}`);
    }
    out.ledger.push(...news.ops);
  }

  const arcs = Object.values(sim.arcs);
  const running = arcs.filter((a) => a.status === "running");
  const leads = new Set(running.map((a) => a.lead));
  const awake = awakeSet(inp.roster, { cap: M.awake, leads, now: inp.now, seed: R("awake"), recent: inp.recent });
  const awakeIds = new Set(awake.map((a) => a.id));
  const recentRoutes: Route[] = Object.values(sim.arrivals).sort((a, b) => a.at - b.at).slice(-6).map((a) => a.route);

  // ---------- beats ----------
  const W: TickWeb = { events: [], moved: new Set() };
  let beats = 0;
  const moved: Arc[] = [];
  const order = [...running].sort((a, b) => Number(b.push) - Number(a.push) || arcReach(b, inp.roster) - arcReach(a, inp.roster));
  for (const arc of order) {
    if (beats >= M.perTick && !arc.push) break;
    // It already moved this tick: another subplot ran into it.
    if (W.moved.has(arc.id)) continue;
    const lead = inp.roster.actors.get(arc.lead);
    const isFaction = arc.lead.startsWith("faction:");
    if (!isFaction && (!lead || !canAct(lead))) {
      if (lead?.dead) {
        out.sim.push({ type: "arc.set", id: arc.id, patch: { status: "dropped" } });
        out.summary.push(`${arc.leadName}'s ${SPECS[arc.kind].label.toLowerCase()} ended: they can no longer act`);
      }
      continue;
    }
    if (lead?.flag === "hold") continue;
    // Someone on the page acts on the page: their subplot waits until they leave the scene.
    if (lead?.ring === "onstage") continue;
    if (!arc.push && inp.now < arc.nextAt) continue;
    if (!isFaction && lead && !awakeIds.has(lead.id) && !arc.push && !inp.forced) continue;
    const r = R(`arc:${arc.id}`);
    const since = Math.max(inp.from ?? arc.createdAt, arc.beats.at(-1)?.at ?? arc.createdAt);
    const spec = SPECS[arc.kind];
    const rate = spec.base * (1 + arc.heat / 2) * STAGE_RATE[stageOf(arc.clock.cur, arc.clock.max)] * M.factor * L.rate;
    const happens = arc.push || (inp.forced && beats === 0) || r() < chanceIn(rate, (inp.now - since) / HOUR);
    if (!happens) continue;
    // The gate (MKAMT): time of day, and knowledge for subplots that rest on a fact.
    if (!arc.push && lead && !awakeAt(lead, mod)) {
      out.sim.push({ type: "arc.set", id: arc.id, patch: { nextAt: inp.now + 6 * HOUR } });
      continue;
    }
    const factGround = arc.grounds.find((g) => g.startsWith("fact:"))?.slice(5);
    if (factGround && lead && !arc.force && !["knows", "believes", "suspects"].includes(lead.knows.get(factGround) ?? "")) {
      out.sim.push({ type: "arc.set", id: arc.id, patch: { nextAt: inp.now + 4 * HOUR } });
      continue;
    }
    beats++;
    moved.push(arc);
    stepArc(arc, lead, inp, r, L, arcs, recentRoutes, out, W);
  }

  // A forced step with nothing moved: the most overdue subplot moves anyway.
  if (inp.forced && !moved.length) {
    const overdue = running.filter((a) => !W.moved.has(a.id)).filter((a) => a.lead.startsWith("faction:") || ((l) => !!l && canAct(l) && l.ring !== "onstage")(inp.roster.actors.get(a.lead))).sort((a, b) => a.nextAt - b.nextAt)[0];
    if (overdue) {
      const r = R(`force:${overdue.id}`);
      const lead = inp.roster.actors.get(overdue.lead);
      const b = rollBeat(overdue, lead, inp, r, L, arcs, W);
      W.moved.add(overdue.id);
      W.events.push(eventOf(overdue, b.beat));
      out.sim.push({ type: "arc.beat", id: overdue.id, beat: b.beat, nextAt: inp.now + Math.round((1 / SPECS[overdue.kind].base) * HOUR) });
      out.cards.push(cardFor(overdue, b.beat, inp, false, undefined, W));
      if (overdue.clock.cur + 1 >= overdue.clock.max) endArc({ ...overdue, clock: { ...overdue.clock, cur: overdue.clock.cur + 1 } }, lead, inp, r, out, W);
    }
  }

  // The director turns up the heat when the story needs more.
  if (L.hostileMod > 0 && target - tension > 1.5) {
    const hot = escalationTarget(running, (a) => arcReach(a, inp.roster));
    if (hot) {
      out.sim.push({ type: "arc.set", id: hot.id, patch: { heat: hot.heat + 1, nextAt: Math.min(hot.nextAt, inp.now + 2 * HOUR) } });
      out.summary.push(`director: ${hot.leadName}'s ${SPECS[hot.kind].label.toLowerCase()} heats up`);
    }
  }

  // ---------- new subplots ----------
  const live = running.length - moved.filter((a) => a.clock.cur + 1 >= a.clock.max).length + Object.keys(sim.proposals).length;
  if (inp.seeding !== "off" && live < M.arcs && (hours > 0 || inp.from == null || inp.forced)) {
    const r = R("seed");
    const cands = seedCandidates(inp, awake);
    let seeded = 0;
    while (seeded < M.seeds && live + seeded < M.arcs && cands.length) {
      const c = weighted(r, cands.map((x) => ({ item: x, w: x.score })));
      if (!c) break;
      cands.splice(cands.indexOf(c), 1);
      if (cands.some((x) => x.lead === c.lead)) for (let i = cands.length - 1; i >= 0; i--) if (cands[i]!.lead === c.lead) cands.splice(i, 1);
      const chance = Math.min(0.95, chanceIn(0.12 * M.factor * L.seed, Math.max(1, hours)) + (inp.from == null ? 0.3 : 0) + (inp.forced ? 0.5 : 0));
      if (r() >= chance) continue;
      seeded++;
      const arc = newArc(c, inp);
      if (inp.seeding === "ask") {
        const p: Proposal = { id: `p:${arc.id}`, key: c.key, kind: c.kind, lead: c.lead, leadName: c.leadName, cast: c.cast, premise: arc.premise, want: arc.want, fear: arc.fear, grounds: c.grounds, secrecy: arc.secrecy, why: c.why, at: inp.now };
        out.sim.push({ type: "proposal.new", proposal: p });
        out.summary.push(`proposed: ${c.leadName} · ${SPECS[c.kind].label} (${c.why})`);
      } else {
        out.sim.push({ type: "arc.new", arc });
        out.summary.push(`new subplot: ${c.leadName} · ${SPECS[c.kind].label} (${c.why})`);
      }
    }
  }

  // ---------- incidents ----------
  if (hours > 0) {
    const r = R("incident");
    if (r() < chanceIn((M.incidentsPerDay * L.rate) / 24, hours)) {
      const text = incident(inp, r);
      if (text) {
        out.sim.push({ type: "incident", at: inp.now, text, place: [inp.roster.town] });
        out.sim.push({ type: "arrival.new", arrival: { id: `incident:${inp.now}`, route: "ambient", text, place: [inp.roster.town], at: inp.now, until: inp.now + 8 * HOUR, status: "pending", offers: 0, maxOffers: 1, seq: 0 } });
        out.summary.push(`incident: ${text}`);
      }
    }
  }

  // Subplots that can't move for three story days drop; proposals go stale.
  for (const a of running) {
    const last = a.beats.at(-1)?.at ?? a.createdAt;
    if (inp.now - last > 3 * 1440 && !moved.includes(a) && a.by !== "player") out.sim.push({ type: "arc.set", id: a.id, patch: { status: "dropped" } });
  }
  for (const p of Object.values(sim.proposals)) if (inp.now - p.at > 3 * 1440) out.sim.push({ type: "proposal.done", id: p.id, accepted: false });

  out.sim.push({ type: "tick", at: inp.now, tension, target });
  return out;
}

/** One subplot takes its step: the beat, how it could reach the scene, and its ending if the clock fills. */
function stepArc(arc: Arc, lead: RActor | undefined, inp: TickInput, r: () => number, L: DirectorLean, arcs: Arc[], recentRoutes: Route[], out: TickResult, W: TickWeb) {
  const spec = SPECS[arc.kind];
  const M = MODES[inp.mode];
  W.moved.add(arc.id);
  const b = rollBeat(arc, lead, inp, r, L, arcs, W);
  W.events.push(eventOf(arc, b.beat));
  out.sim.push({ type: "arc.beat", id: arc.id, beat: b.beat, nextAt: inp.now + Math.round((1 / spec.base) * HOUR * (0.6 + r() * 0.8)), ...(b.heat != null ? { heat: b.heat } : {}) });
  out.cards.push(cardFor(arc, b.beat, inp, false, undefined, W));
  out.summary.push(`${arc.leadName} · ${spec.label} · ${b.beat.stage}: ${b.beat.result}${b.beat.twist ? ` (twist: ${b.beat.twist})` : ""}${b.beat.forced ? " (your call)" : ""}`);
  // How it could reach the scene. A beat you called always tries: you want to see it land.
  if (r() < M.arrivals * (arcReach(arc, inp.roster) >= 2 ? 1 : 0.5) || arc.bringIn || arc.force) {
    const a = routeFor({ arc, lead, beatText: b.beat.text, roster: inp.roster, state: inp.state, now: inp.now, tech: inp.tech, rand: r, stage: b.beat.stage, result: b.beat.result, recentRoutes });
    if (a) {
      out.sim.push({ type: "arrival.new", arrival: a });
      recentRoutes.push(a.route);
      if (a.route === "omen") out.sim.push({ type: "arc.set", id: arc.id, patch: { foreshadowed: true } });
      if (arc.bringIn) out.sim.push({ type: "arc.set", id: arc.id, patch: { bringIn: false } });
    }
  }
  // The clock fills: the subplot ends.
  if (arc.clock.cur + 1 >= arc.clock.max) endArc({ ...arc, clock: { ...arc.clock, cur: arc.clock.cur + 1 }, tally: { ...arc.tally, [b.beat.result]: arc.tally[b.beat.result] + 1 } }, lead, inp, r, out, W);
  // Two subplots collided: the other one takes its step too, in the same moment.
  if (b.collide && !W.moved.has(b.collide.id) && canStep(b.collide, inp.roster)) collideStep(b.collide, arc, inp, r, L, arcs, out, W);
}

/** The subplot another one ran into takes a step of its own: the collision is its twist. */
function collideStep(arc: Arc, by: Arc, inp: TickInput, r: () => number, L: DirectorLean, arcs: Arc[], out: TickResult, W: TickWeb) {
  const spec = SPECS[arc.kind];
  const lead = inp.roster.actors.get(arc.lead);
  W.moved.add(arc.id);
  const b = rollBeat(arc, lead, inp, r, L, arcs, W, by);
  W.events.push(eventOf(arc, b.beat));
  out.sim.push({ type: "arc.beat", id: arc.id, beat: b.beat, nextAt: inp.now + Math.round((1 / spec.base) * HOUR * (0.6 + r() * 0.8)), heat: Math.min(3, arc.heat + 1) });
  out.cards.push(cardFor(arc, b.beat, inp, false, undefined, W));
  out.summary.push(`${arc.leadName} · ${spec.label} · ${b.beat.stage}: ${b.beat.result} (collided with ${by.leadName}'s ${SPECS[by.kind].label.toLowerCase()})`);
  if (arc.clock.cur + 1 >= arc.clock.max) endArc({ ...arc, clock: { ...arc.clock, cur: arc.clock.cur + 1 }, tally: { ...arc.tally, [b.beat.result]: arc.tally[b.beat.result] + 1 } }, lead, inp, r, out, W);
}

const eventOf = (arc: Arc, b: Beat): ArcEvent => ({ arc: arc.id, lead: arc.lead, leadName: arc.leadName, kind: arc.kind, result: b.result, text: b.text, at: b.at });

/** Can this subplot take a step off the page right now? (Its lead acts, and isn't in the scene.) */
export function canStep(arc: Arc, roster: Roster): boolean {
  if (arc.status !== "running") return false;
  if (arc.lead.startsWith("faction:")) return true;
  const lead = roster.actors.get(arc.lead);
  return !!lead && canAct(lead) && lead.flag !== "hold" && lead.ring !== "onstage";
}

/**
 * The player called a subplot's next beat (arc.force): it lands now, with the outcome they chose,
 * without moving anything else in the world. The caller checks canStep first.
 */
export function forcedStep(inp: TickInput, arcId: string): TickResult {
  const out: TickResult = { sim: [], ledger: [], cards: [], tension: 0, target: 0, summary: [] };
  const sim = inp.state.sim;
  const arc = sim.arcs[arcId];
  if (!arc) return out;
  const tension = measureTension(inp.state, sim);
  const target = targetTension(inp.director, sim, inp.now, inp.chatId);
  const L = lean(inp.director, tension, target);
  out.tension = tension;
  out.target = target;
  // Fresh dice for every call, even within the same story minute.
  const r = rng(`${inp.chatId}:called:${arc.id}:${inp.now}:${sim.ticks}:${arc.beats.length}:${arc.clock.cur}`);
  const recentRoutes: Route[] = Object.values(sim.arrivals).sort((a, b) => a.at - b.at).slice(-6).map((a) => a.route);
  stepArc(arc, inp.roster.actors.get(arc.lead), inp, r, L, Object.values(sim.arcs), recentRoutes, out, { events: [], moved: new Set() });
  return out;
}

// ---------- one beat ----------

/** One beat's dice and words. `collidedWith`: another subplot ran into this one, and that is its twist. */
function rollBeat(arc: Arc, lead: RActor | undefined, inp: TickInput, r: () => number, L: DirectorLean, all: Arc[], W: TickWeb, collidedWith?: Arc): { beat: Beat; heat?: number; collide?: Arc } {
  const spec = SPECS[arc.kind];
  const stage = stageOf(arc.clock.cur, arc.clock.max);
  const why: string[] = [];
  let m = 0;
  if (lead && (lead.means ?? 0) >= 1) {
    m++;
    why.push("means");
  }
  if (lead && (lead.means ?? 0) <= -1) {
    m--;
    why.push("few means");
  }
  const target = arc.target ? inp.roster.actors.get(arc.target) : undefined;
  if (target && (target.means ?? 0) > (lead?.means ?? 0) && spec.hostile) {
    m--;
    why.push("a stronger opponent");
  }
  if (lead && arc.cast.some((c) => c !== arc.target && (lead.ties.get(c) ?? 0) >= 2)) {
    m++;
    why.push("an ally in it");
  }
  const factGround = arc.grounds.find((g) => g.startsWith("fact:"))?.slice(5);
  if (factGround && lead && lead.knows.get(factGround) !== "knows") {
    m--;
    why.push("acting on a belief");
  }
  // Subplots bear on each other: a tied subplot out to help or hurt this lead pulls the roll by how its latest step went.
  const pull = webMod(bearingsOn(arc, all, inp.roster, inp.now, W.events));
  if (pull.mod) {
    m += pull.mod;
    why.push(...pull.why);
  }
  const dm = spec.hostile ? L.hostileMod : L.kindMod;
  if (dm) {
    m += dm;
    if (L.why) why.push(L.why);
  }
  m = Math.max(-2, Math.min(2, m));
  const roll: [number, number] = [d6(r), d6(r)];
  const total = roll[0] + roll[1] + m;
  let result: Result = total >= 10 ? "win" : total >= 7 ? "cost" : "loss";
  let twist: Twist | undefined;
  let twistText: string | undefined;
  let collide: Arc | undefined;
  const force = arc.force ?? undefined;
  const turn = () => {
    // Against how it's been going: a lopsided tally flips; an even one turns from its last step.
    const lastGood = arc.beats.at(-1)?.result !== "loss";
    result = arc.tally.win > arc.tally.loss ? "loss" : arc.tally.loss > arc.tally.win ? "win" : lastGood ? "loss" : "win";
    twist = "reversal";
    twistText = result === "win" ? "Then, against the odds, it turned their way" : "Then everything turned";
  };
  const draw = () => {
    const t = drawTwist(arc, inp, r, W);
    if (t) [twist, twistText, collide] = t;
    return !!t;
  };
  if (collidedWith) {
    twist = "collide";
    twistText = `It ran into ${collidedWith.leadName}'s own business`;
  }
  if (force === "win" || force === "cost" || force === "loss") {
    result = force;
  } else if (force === "reversal") {
    turn();
  } else if (force === "twist") {
    if (!collidedWith && !draw()) turn();
  } else if (collidedWith) {
    // The collision is this beat's twist; nothing else draws.
  } else if (stage === "reversal" && Math.abs(arc.tally.win - arc.tally.loss) >= 1 && r() < 0.4) {
    // The midpoint reversal: a lopsided subplot can turn on its head.
    turn();
  } else if (r() < MODES[inp.mode].twist + L.twist) {
    draw();
  }
  if (result === "loss" && !force && L.soften && r() < 0.5) result = "cost";
  const price = pick(r, spec.prices);
  const worse = pick(r, spec.worse);
  const castName = target?.name ?? (arc.cast[0] ? (inp.roster.actors.get(arc.cast[0])?.name ?? arc.cast[0]) : undefined);
  let text = beatTemplate({ kind: arc.kind, lead: arc.leadName, want: arc.want, stage, result, price, worse, cast: castName, town: inp.roster.town, place: arc.place?.join(" › "), premise: arc.premise, twist: twistText, group: arc.lead.startsWith("faction:") });
  // Something another subplot took from someone in this one, that this one is about: the step starts from it.
  const gone = conditionsFor(peopleOf(arc, inp.roster), [...all.flatMap(eventsOf), ...W.events], inp.now).find((c) => touches(arc, c.thing));
  if (gone) text = `With ${gone.person}'s ${gone.thing} gone, ${text.replace(/^At /, "at ")}`;
  const heat = twist === "collide" || twist === "slip" ? Math.min(3, arc.heat + 1) : undefined;
  return { beat: { at: inp.now, roll, mod: m, why, result, stage, ...(twist ? { twist } : {}), ...(force ? { forced: force } : {}), text, told: "template", seq: 0 }, heat, collide };
}

function drawTwist(arc: Arc, inp: TickInput, r: () => number, W: TickWeb): [Twist, string, Arc?] | null {
  const lead = inp.roster.actors.get(arc.lead);
  const options: [Twist, string, Arc?][] = [];
  const tie = lead ? [...lead.ties.entries()].filter(([id, s]) => s >= 2 && id !== arc.target && !arc.cast.includes(id)).map(([id]) => inp.roster.actors.get(id)).find((a) => a && !a.isUser && !a.dead) : undefined;
  if (tie) options.push(["tie", `${tie.name} got pulled into it`]);
  if (inp.weather && /storm|heavy|snow|fog/.test(inp.weather)) options.push(["weather", `The ${inp.weather.split(",")[0]} got in the way`]);
  if (inp.namedDay) options.push(["calendar", `${inp.namedDay} changed the plan`]);
  const item = Object.values(inp.state.items).find((i) => !i.gone && i.holder && (i.holder === arc.lead || arc.cast.includes(i.holder)));
  if (item) options.push(["object", `${item.name} turned out to matter`]);
  if (arc.secrecy !== "public") options.push(["slip", "Word of it slipped out"]);
  // Another subplot it's tied to (or one at the same place) that hasn't moved yet: they collide, and it takes a step too.
  const others = Object.values(inp.state.sim.arcs).filter((o) => o.id !== arc.id && o.status === "running" && !W.moved.has(o.id) && o.clock.cur < o.clock.max);
  const other = others.find((o) => tied(arc, o, inp.roster).length) ?? others.find((o) => o.lead === arc.target || o.cast.includes(arc.lead) || (o.place && arc.place && o.place.at(-1) === arc.place.at(-1)));
  if (other) options.push(["collide", `It ran into ${other.leadName}'s own business`, other]);
  return options.length ? pick(r, options) : null;
}

// ---------- endings ----------

function endArc(arc: Arc, lead: RActor | undefined, inp: TickInput, r: () => number, out: TickResult, W: TickWeb) {
  const spec = SPECS[arc.kind];
  const final = d6(r) + d6(r) + Math.max(-2, Math.min(2, arc.tally.win - arc.tally.loss));
  let result: EndResult = final >= 10 ? "met" : final >= 7 ? "price" : "lost";
  if (inp.director === "gentle" && result === "lost") result = "softened";
  const target = arc.target ? inp.roster.actors.get(arc.target) : undefined;
  const text = endTemplate({ kind: arc.kind, lead: arc.leadName, want: arc.want, fear: arc.fear, result, price: pick(r, spec.prices), cast: target?.name });
  // Irreversible endings wait on the player (fates), or on the page.
  const irreversible = spec.irreversible && ((arc.kind === "revenge" && result === "met") || (arc.kind !== "revenge" && result === "lost"));
  if (irreversible && inp.fates !== "allow") {
    if (inp.fates === "ask") {
      out.sim.push({ type: "arc.fate", id: arc.id, result, text, at: inp.now });
      out.summary.push(`${arc.leadName}: an ending that can't be undone waits for your word`);
    } else {
      out.sim.push({ type: "arc.set", id: arc.id, patch: { bringIn: true, heat: 3 } });
      out.summary.push(`${arc.leadName}: the ending waits for a scene on the page`);
    }
    return;
  }
  out.sim.push({ type: "arc.end", id: arc.id, result, text, at: inp.now });
  out.cards.push(cardFor(arc, { at: inp.now, result: "win", stage: "climax", text, roll: [0, 0], mod: 0, why: [], told: "template", seq: 0 }, inp, true, result, W));
  out.ledger.push(...consequences(arc, result, text, inp));
  out.summary.push(`${arc.leadName}'s ${spec.label.toLowerCase()} ended: ${result}`);
  W.events.push({ arc: arc.id, lead: arc.lead, leadName: arc.leadName, kind: arc.kind, result, text, at: inp.now, ending: true });
  // An ending shakes the subplots tied to it: they raise their stakes and answer it soon.
  for (const o of Object.values(inp.state.sim.arcs)) {
    if (o.id === arc.id || o.status !== "running" || W.moved.has(o.id) || o.clock.cur >= o.clock.max || !tied(arc, o, inp.roster).length) continue;
    const soon = inp.now + 30 + Math.round(r() * 90);
    out.sim.push({ type: "arc.set", id: o.id, patch: { nextAt: Math.min(o.nextAt, soon), heat: Math.min(3, o.heat + 1) } });
    out.summary.push(`${o.leadName}'s ${SPECS[o.kind].label.toLowerCase()} is shaken by how ${arc.leadName}'s ended`);
  }
  // Aftermath: one subplot grows out of another.
  if (r() < MODES[inp.mode].chain) {
    const follow = followOn(arc, result, inp);
    if (follow) {
      out.sim.push({ type: "arc.new", arc: follow });
      out.summary.push(`follow-on: ${follow.leadName} · ${SPECS[follow.kind].label}`);
    }
  }
}

export function consequences(arc: Arc, result: EndResult, text: string, inp: TickInput): Op[] {
  const ops: Op[] = [];
  const spec = SPECS[arc.kind];
  const target = arc.target ? inp.roster.actors.get(arc.target) : undefined;
  const lead = inp.roster.actors.get(arc.lead);
  if (spec.bond && target && lead && !lead.isUser) {
    const d = result === "met" ? spec.bond.met : result === "price" ? Math.round(spec.bond.met / 2) || Math.sign(spec.bond.met) : result === "lost" ? spec.bond.lost : 0;
    if (d) ops.push({ op: "bond", subject: lead.name, object: target.name, args: { moves: [{ axis: spec.bond.axis, delta: d }], tagsAdd: [], tagsRemove: [] }, cause: text, raw: `bond ${lead.name}>${target.name}: ${spec.bond.axis} ${d > 0 ? "+" : ""}${d} — ${text}` });
  }
  // What happened is now a fact its people know (and news that can travel).
  const key = `arc-${arc.id.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`;
  const statement = text.replace(/^In the end, /, "");
  const holders = [lead?.name ?? arc.leadName, ...(target ? [target.name] : [])];
  for (const h of holders) ops.push({ op: "know", subject: h, args: { fact: statement, key, status: "knows", truth: "true", route: "lived it" }, cause: "off the page", raw: `know ${h}: #${key} | lived it · knows` });
  if (arc.secrecy === "secret" && target && (result === "met" || result === "price"))
    ops.push({ op: "secret", subject: `#${key}`, args: { key, fact: statement, keepers: [arc.leadName], from: [target.name] }, raw: `secret #${key}: ${statement} | kept by ${arc.leadName} · from ${target.name}` });
  // Faction subplots move their clock.
  if (arc.kind === "faction") {
    const name = arc.leadName;
    const project = arc.want.replace(/^to\s+/, "");
    ops.push({ op: "clockf", subject: name, args: { project, cur: result === "lost" ? 0 : undefined, delta: result === "lost" ? undefined : 2 }, cause: text, raw: `clockf ${name}: ${project} ${result === "lost" ? "0" : "+2"}` });
  }
  return ops;
}

function followOn(arc: Arc, result: EndResult, inp: TickInput): Arc | null {
  const target = arc.target ? inp.roster.actors.get(arc.target) : undefined;
  const lead = inp.roster.actors.get(arc.lead);
  const mk = (kind: ArcKind, l: RActor, cast: string[], premise: string, t?: string): Arc =>
    newArc({ kind, lead: l.id, leadName: l.name, cast, target: t, premise, grounds: [`arc:${arc.id}`], score: 1, why: "grew out of another subplot", key: `${l.id}|${kind}|arc:${arc.id}` }, inp);
  if (arc.kind === "revenge" && result === "met" && target && canAct(target) && lead) return mk("revenge", target, [lead.id], `${target.name} wants to answer what ${lead.name} did.`, lead.id);
  if (arc.kind === "rift" && result === "lost" && lead && target) return mk("reconcile", lead, [target.id], `${lead.name} regrets how things ended with ${target.name}.`, target.id);
  if ((arc.kind === "decline" || arc.kind === "loss") && result !== "lost" && lead) return mk("recovery", lead, [], `${lead.name} is trying to put themselves back together.`);
  if (arc.kind === "courtship" && result === "lost" && lead && target) return mk("rift", lead, [target.id], `Things are awkward now between ${lead.name} and ${target.name}.`, target.id);
  if (arc.kind === "scheme" && result === "met" && target && canAct(target) && lead) return mk("investigation", target, [lead.id], `${target.name} suspects someone moved against them.`, lead.id);
  return null;
}

// ---------- seeding ----------

interface Cand {
  kind: ArcKind;
  lead: string;
  leadName: string;
  cast: string[];
  target?: string;
  premise: string;
  want?: string;
  fear?: string;
  grounds: string[];
  score: number;
  why: string;
  key: string;
}

export function seedCandidates(inp: TickInput, awake: RActor[]): Cand[] {
  const st = inp.state;
  const r = inp.roster;
  const out: Cand[] = [];
  const running = Object.values(st.sim.arcs).filter((a) => a.status === "running" || a.status === "fate");
  const busy = (id: string) => running.filter((a) => a.lead === id).length >= 2;
  const has = (id: string, kind: ArcKind) => running.some((a) => a.lead === id && a.kind === kind);
  const declined = new Set(st.sim.declined);
  const waiting = new Set(Object.values(st.sim.proposals).map((p) => p.lead));
  const lean = new Set(inp.genres.flatMap((g) => GENRE_LEAN[g.toLowerCase()] ?? []));
  const user = [...r.actors.values()].find((a) => a.isUser);
  const push = (c: Omit<Cand, "key" | "score"> & { score: number }) => {
    const key = `${c.lead}|${c.kind}|${[...c.grounds].sort().join(",")}`;
    if (declined.has(key) || waiting.has(c.lead) || busy(c.lead) || has(c.lead, c.kind)) return;
    const a = r.actors.get(c.lead);
    if (!c.lead.startsWith("faction:") && (!a || !canAct(a) || a.ring === "onstage")) return;
    const relevance = a ? Math.max(0, ...[...a.ties.entries()].filter(([id]) => id === user?.id || r.actors.get(id)?.ring === "onstage").map(([, s]) => s)) : 1;
    out.push({ ...c, key, score: c.score + (lean.has(c.kind) ? 1 : 0) + relevance * 0.5 + (awake.some((x) => x.id === c.lead) ? 0.5 : 0) });
  };
  const nameOf = (id: string) => r.actors.get(id)?.name ?? st.chars[id]?.name ?? id;

  // Open threads that involve someone off the page.
  for (const t of Object.values(st.threads)) {
    if (t.status === "resolved") continue;
    const text = `${t.title} ${t.latest ?? ""}`;
    for (const a of r.actors.values()) {
      if (a.ring === "onstage" || a.isUser || !text.toLowerCase().includes(a.name.toLowerCase().split(" ")[0]!)) continue;
      const kind = kindFromText(text) ?? "pursuit";
      push({ kind, lead: a.id, leadName: a.name, cast: [], premise: `${a.name} has their own stake in "${t.title}": ${t.latest ?? t.title}.`, grounds: [`thread:${t.id}`], score: 3, why: `the thread "${t.title}"` });
    }
  }
  // Debts and promises with someone off the page.
  for (const o of Object.values(st.obligations)) {
    if (o.status !== "open" && o.status !== "due") continue;
    const creditor = o.kind === "owe" ? o.whom : undefined;
    if (creditor && r.actors.get(creditor)?.ring !== "onstage")
      push({ kind: "debt", lead: creditor, leadName: nameOf(creditor), cast: [o.who], target: o.who, premise: `${nameOf(creditor)} wants what ${nameOf(o.who)} owes: ${o.what}.`, want: `to collect what ${nameOf(o.who)} owes`, grounds: [`obligation:${o.id}`], score: 3, why: `${nameOf(o.who)} owes ${nameOf(creditor)}` });
  }
  // Secrets kept by someone off the page.
  for (const f of Object.values(st.facts)) {
    for (const k of f.secret?.keepers ?? []) {
      if (!f.secret?.from.length) continue;
      push({ kind: "secret", lead: k, leadName: nameOf(k), cast: f.secret.from, target: f.secret.from[0], premise: `${nameOf(k)} is keeping a secret: ${f.statement}.`, grounds: [`fact:${f.key}`], score: 2.5, why: "a secret they keep" });
    }
  }
  // Strong feelings between people.
  for (const b of Object.values(st.bonds)) {
    const ax = b.axes;
    const from = b.from;
    const to = b.to;
    if ((ax.resentment ?? 0) >= 3 || (ax.trust ?? 0) <= -4)
      push({ kind: "revenge", lead: from, leadName: nameOf(from), cast: [to], target: to, premise: `${nameOf(from)} hasn't forgiven ${nameOf(to)}.`, want: `to make ${nameOf(to)} pay`, grounds: [`bond:${from}>${to}`], score: 3, why: `${nameOf(from)}'s resentment of ${nameOf(to)}` });
    else if ((ax.rivalry ?? 0) >= 3) push({ kind: "rivalry", lead: from, leadName: nameOf(from), cast: [to], target: to, premise: `${nameOf(from)} won't let ${nameOf(to)} win.`, grounds: [`bond:${from}>${to}`], score: 3, why: "a rivalry" });
    else if ((ax.attraction ?? 0) >= 3 && r.actors.get(to)?.ring !== "onstage" && !r.actors.get(to)?.isUser)
      push({ kind: "courtship", lead: from, leadName: nameOf(from), cast: [to], target: to, premise: `${nameOf(from)} can't stop thinking about ${nameOf(to)}.`, grounds: [`bond:${from}>${to}`], score: 2.5, why: "an attraction" });
    else if ((ax.trust ?? 0) <= -2 && (ax.affection ?? 0) >= 2) push({ kind: "rift", lead: from, leadName: nameOf(from), cast: [to], target: to, premise: `${nameOf(from)} and ${nameOf(to)} aren't speaking.`, grounds: [`bond:${from}>${to}`], score: 2.5, why: "a strained bond" });
    else if ((ax.trust ?? 0) >= 3 && (ax.affection ?? 0) >= 2 && r.actors.get(to)?.ring !== "onstage") {
      const danger = Object.values(st.sim.arcs).some((a) => a.status === "running" && a.target === to && SPECS[a.kind].hostile);
      if (danger) push({ kind: "protect", lead: from, leadName: nameOf(from), cast: [to], target: to, premise: `${nameOf(from)} means to keep ${nameOf(to)} safe.`, grounds: [`bond:${from}>${to}`], score: 2.5, why: `${nameOf(to)} is in danger` });
    }
  }
  // People away with a reason to come back.
  for (const a of r.actors.values()) {
    if (a.standing === "away" && user && Math.max(a.ties.get(user.id) ?? 0, ...[...a.ties.entries()].filter(([id]) => r.actors.get(id)?.ring === "onstage").map(([, s]) => s)) >= 2)
      push({ kind: "return", lead: a.id, leadName: a.name, cast: [], premise: `${a.name} is thinking of coming back.`, grounds: [`standing:${a.id}`], score: 2, why: "they're away, and tied to the people here" });
  }
  // Grief for the dead.
  for (const c of Object.values(st.chars)) {
    if (!c.dead) continue;
    const mourner = [...r.actors.values()].find((a) => (a.ties.get(c.id) ?? 0) >= 2 && canAct(a) && a.ring !== "onstage");
    if (mourner) push({ kind: "loss", lead: mourner.id, leadName: mourner.name, cast: [c.id], premise: `${mourner.name} is grieving ${c.name}.`, grounds: [`death:${c.id}`], score: 3, why: `${c.name}'s death` });
  }
  // Faction clocks.
  for (const k of Object.values(st.clocks)) {
    if (k.cur >= k.max) continue;
    push({ kind: "faction", lead: `faction:${k.faction.toLowerCase()}`, leadName: k.faction, cast: [], premise: `${k.faction} is working toward ${k.name} (${k.cur}/${k.max}).`, want: `to ${k.name}`, grounds: [`faction:${k.faction}`], score: 2.5, why: "a faction's project" });
  }
  // What people want, and what the lore says about them.
  for (const a of awake) {
    if (a.want) push({ kind: kindFromText(a.want) ?? "pursuit", lead: a.id, leadName: a.name, cast: [], premise: `${a.name} wants ${a.want.replace(/^to\s+/, "to ")}.`, want: a.want.startsWith("to ") ? a.want : `to ${a.want}`, fear: a.fear, grounds: [`drive:${a.id}`], score: 2, why: "what they want" });
    else if (a.text && a.ring === "unmet") {
      const kind = kindFromText(a.text, ["faction", "threat", "courtship", "revenge"]);
      if (kind && ["duty", "scheme", "decline", "investigation", "secret", "life", "ambition", "recovery"].includes(kind)) push({ kind, lead: a.id, leadName: a.name, cast: [], premise: `${a.name}: ${a.text.split(/(?<=[.!?])\s/)[0]}`, grounds: [`lore:${a.id}`], score: 1, why: "their own story in the lore" });
    }
    const injured = inp.state.chars[a.id]?.injuries.some((i) => i.severity >= 3);
    if (injured) push({ kind: "recovery", lead: a.id, leadName: a.name, cast: [], premise: `${a.name} is recovering from a bad injury.`, grounds: [`injury:${a.id}`], score: 2, why: "a serious injury" });
  }
  return out;
}

export function newArc(c: Cand, inp: TickInput): Arc {
  const spec = SPECS[c.kind];
  const target = c.target ? inp.roster.actors.get(c.target) : undefined;
  const fill = (s: string) => s.replace(/\{cast\}/g, target?.name ?? spec.other ?? "someone");
  const id = `${c.kind}:${c.lead.replace(/[^a-z0-9]+/gi, "-")}:${inp.now}`;
  return {
    id,
    kind: c.kind,
    lead: c.lead,
    leadName: c.leadName,
    cast: c.cast,
    target: c.target,
    premise: c.premise,
    want: fill(c.want ?? spec.want),
    fear: fill(c.fear ?? spec.fear),
    grounds: c.grounds,
    secrecy: spec.secrecy,
    clock: { cur: 0, max: spec.clock },
    tally: { win: 0, cost: 0, loss: 0 },
    heat: 1,
    stage: "hook",
    beats: [],
    nextAt: inp.now + 30,
    status: "running",
    by: c.grounds.includes("player") ? "player" : "engine",
    place: inp.roster.actors.get(c.lead)?.where,
    createdAt: inp.now,
    seq: 0,
  };
}

function cardFor(arc: Arc, beat: Beat, inp: TickInput, ending: boolean, end?: EndResult, W?: TickWeb): BeatCard {
  // What the tied subplots did before this step (never this step itself), and what stands about its people.
  const before = (W?.events ?? []).filter((e) => e.arc !== arc.id && e.at <= beat.at);
  const all = Object.values(inp.state.sim.arcs);
  const bs = bearingsOn(arc, all, inp.roster, beat.at, before);
  const since = arc.beats.filter((b) => b.at < beat.at).at(-1)?.at ?? arc.createdAt;
  const evs = [...all.flatMap(eventsOf).filter((e) => !(e.arc === arc.id && e.at >= beat.at)), ...before];
  const cs = conditionsFor(peopleOf(arc, inp.roster), evs, beat.at);
  const names = [...new Set([...bs.slice(0, 3).flatMap((b) => [b.leadName, b.person]), ...cs.slice(0, 3).flatMap((c) => [c.person, c.leadName])])];
  return {
    id: `${arc.id}@${beat.at}`,
    arc: arc.id,
    kind: arc.kind,
    stage: ending ? "ending" : beat.stage,
    result: end ?? beat.result,
    lead: arc.leadName,
    cast: arc.cast.map((c) => inp.roster.actors.get(c)?.name ?? c),
    where: (arc.place ?? inp.roster.actors.get(arc.lead)?.where ?? [inp.roster.town]).join(" › "),
    premise: arc.premise,
    want: arc.want,
    fear: arc.fear,
    soFar: arc.beats.slice(-2).map((b) => b.text),
    template: beat.text,
    twist: beat.twist,
    ending,
    at: beat.at,
    ...(bs.length ? { meanwhile: meanwhileLines(bs) } : {}),
    ...(cs.length ? { stands: standsLines(cs, since, !arc.beats.some((b) => b.at < beat.at)) } : {}),
    ...(names.length ? { names } : {}),
  };
}

const INCIDENTS = {
  storm: ["The power went out across half of {town} for an hour.", "A tree came down across the main road in the wind.", "The harbour closed until the weather turned."],
  fog: ["Fog shut the roads out of {town} until noon.", "A ship sounded its horn all night somewhere in the fog."],
  night: ["Sirens went past in the small hours, then nothing.", "Someone's dog howled for an hour after midnight.", "A fight broke out outside a bar and spilled into the street."],
  day: ["The market was busier than usual; everyone was talking about prices.", "A delivery truck blocked the high street for most of the morning.", "Roadworks started on the main street without warning.", "A busker drew a crowd in the square."],
  holiday: ["{day} brought crowds into the centre of {town}.", "Bunting went up all over {town} for {day}."],
};

function incident(inp: TickInput, r: () => number): string | null {
  const town = inp.roster.town;
  const h = Math.floor((inp.now % 1440) / 60);
  const pool = inp.namedDay ? INCIDENTS.holiday : inp.weather && /storm|heavy|gale|windy/.test(inp.weather) ? INCIDENTS.storm : inp.weather && /fog/.test(inp.weather) ? INCIDENTS.fog : h < 6 || h >= 22 ? INCIDENTS.night : INCIDENTS.day;
  const recent = inp.state.sim.incidents.slice(-5).map((i) => i.text);
  const choices = pool.map((t) => t.replace(/\{town\}/g, town).replace(/\{day\}/g, inp.namedDay ?? "the holiday")).filter((t) => !recent.includes(t));
  return choices.length ? pick(r, choices) : null;
}

export { arcReach };
