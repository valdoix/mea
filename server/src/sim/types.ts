/**
 * The world off the page: subplots, the people who carry them, news, and how it all reaches
 * the scene. After ALMANAC's Elsewhere (design/09), extended with dramatic structure, a drama
 * director, foreshadowing, places with travel times, routines and faction relations.
 * Everything here is folded from engine events anchored to messages, so it branches with swipes.
 */

export const ARC_KINDS = [
  "pursuit", "scheme", "rivalry", "revenge", "courtship", "rift", "reconcile", "debt", "secret", "decline", "recovery",
  "investigation", "threat", "return", "duty", "ambition", "protect", "life", "loss", "faction",
] as const;
export type ArcKind = (typeof ARC_KINDS)[number];

/** Dramatic structure: where in its shape a subplot is. */
export type Stage = "hook" | "rising" | "reversal" | "crisis" | "climax" | "aftermath";
export type Result = "win" | "cost" | "loss";
export type EndResult = "met" | "price" | "lost" | "softened";
export type Secrecy = "public" | "private" | "secret";
export type Route = "carrier" | "signal" | "ambient" | "trace" | "entrance" | "omen";
export type Twist = "tie" | "weather" | "calendar" | "object" | "slip" | "collide" | "reversal";
/** The player's call on a subplot's next beat: a result, a twist, or a turn against how it's been going. */
export const FORCES = ["win", "cost", "loss", "twist", "reversal"] as const;
export type Force = (typeof FORCES)[number];

export interface Beat {
  at: number;
  roll: [number, number];
  mod: number;
  /** Why the modifier: "ally in the cast", "director: easing", "tied: Willow's setback". */
  why: string[];
  result: Result;
  stage: Stage;
  twist?: Twist;
  text: string;
  told: "template" | "model";
  /** The player called this outcome; the dice didn't. */
  forced?: Force;
  seq: number;
}

export interface Arc {
  id: string;
  kind: ArcKind;
  /** Lead's character id (or a faction name for faction/threat arcs). */
  lead: string;
  leadName: string;
  cast: string[];
  /** Who the subplot is about or aimed at, if anyone. */
  target?: string;
  premise: string;
  want: string;
  fear: string;
  /** What it rests on: "thread:lost-locket", "bond:mira>alex", "fact:key", "drive:mira", "faction:Harbor Guild", "player". */
  grounds: string[];
  secrecy: Secrecy;
  clock: { cur: number; max: number };
  tally: { win: number; cost: number; loss: number };
  /** How hard it pushes, 0–3; the director raises and lowers it. */
  heat: number;
  stage: Stage;
  beats: Beat[];
  /** Earliest next beat, in story minutes. */
  nextAt: number;
  status: "running" | "held" | "crossed" | "resolved" | "dropped" | "fate";
  by: "engine" | "player";
  /** The player's words; the engine never rewrites them. */
  locked?: boolean;
  /** Next beat comes at once, even out of hours. */
  push?: boolean;
  /** Offer a crossing on the next turn. */
  bringIn?: boolean;
  /** The player's call on the next beat; cleared once that beat lands. */
  force?: Force | null;
  /** A foreshadowing omen has been offered before its crossing. */
  foreshadowed?: boolean;
  /** Where it's happening (a place path). */
  place?: string[];
  /** The thread it became once it crossed into the story. */
  thread?: string;
  ending?: { result: EndResult; text: string; at: number; seq: number };
  /** An irreversible ending waiting on the player (fates: ask). */
  fate?: { result: EndResult; text: string; at: number };
  createdAt: number;
  seq: number;
}

export interface Arrival {
  id: string;
  arc?: string;
  route: Route;
  text: string;
  /** Who brings it (carrier), or who calls (signal). */
  carrier?: string;
  /** Whom a signal is for. */
  to?: string;
  /** Where it waits (trace) or can be heard (ambient). */
  place?: string[];
  medium?: string;
  at: number;
  until: number | null;
  status: "pending" | "offered" | "used" | "expired";
  offers: number;
  maxOffers: number;
  seq: number;
}

export type Standing = "here" | "away" | "captive" | "changed" | "dead" | "companion" | "construct";

/** What the simulation knows about a person beyond the tracked state. */
export interface Actor {
  id: string;
  name: string;
  standing: Standing;
  /** Where they are now off the page, and where they live or work. */
  where?: string[];
  base?: string[];
  /** Hours and places: [{ from: 9, to: 17, place: "Old Town › Bakery" }]. */
  routine?: { from: number; to: number; place: string }[];
  nocturnal?: boolean;
  /** −1 (powerless) … 2 (rich, powerful, magical). */
  means?: number;
  guarded?: boolean;
  role?: string;
  /** out: never simulated · hold: no new beats · wake: keep awake. */
  flag?: "out" | "hold" | "wake";
  lastBeatAt?: number | null;
  lastPageSeq?: number;
}

export interface Proposal {
  id: string;
  key: string;
  kind: ArcKind;
  lead: string;
  leadName: string;
  cast: string[];
  premise: string;
  want: string;
  fear: string;
  grounds: string[];
  secrecy: Secrecy;
  why: string;
  at: number;
}

export interface NewsHop {
  at: number;
  fact: string;
  statement: string;
  from: string;
  to: string;
  medium: string;
  distorted?: string;
}

export interface SimState {
  lastTickAt: number | null;
  /** The drama director's reading of story tension over time (0–10). */
  tension: { at: number; value: number; target: number }[];
  arcs: Record<string, Arc>;
  arrivals: Record<string, Arrival>;
  actors: Record<string, Actor>;
  /** Faction stances, −3 (war) … +3 (allied), keyed "a|b" (sorted). */
  factionRel: Record<string, number>;
  news: NewsHop[];
  incidents: { at: number; text: string; place?: string[]; seq: number }[];
  proposals: Record<string, Proposal>;
  declined: string[];
  ticks: number;
}

export function emptySim(): SimState {
  return { lastTickAt: null, tension: [], arcs: {}, arrivals: {}, actors: {}, factionRel: {}, news: [], incidents: [], proposals: {}, declined: [], ticks: 0 };
}

/** One engine-written change to the off-page world (stored as an op "sim"). */
export type SimOp =
  | { type: "arc.new"; arc: Arc }
  | { type: "arc.beat"; id: string; beat: Beat; heat?: number; nextAt: number; place?: string[] }
  | { type: "arc.tell"; id: string; at: number; text: string }
  | { type: "arc.end"; id: string; result: EndResult; text: string; at: number }
  | { type: "arc.fate"; id: string; result: EndResult; text: string; at: number }
  | { type: "arc.set"; id: string; patch: Partial<Pick<Arc, "status" | "premise" | "want" | "fear" | "push" | "bringIn" | "heat" | "locked" | "nextAt" | "foreshadowed" | "thread" | "cast" | "force">> }
  | { type: "arrival.new"; arrival: Arrival }
  | { type: "arrival.set"; id: string; status: Arrival["status"]; text?: string; offers?: number }
  | { type: "actor.set"; actor: Partial<Actor> & { id: string; name: string } }
  | { type: "news"; hop: NewsHop }
  | { type: "incident"; at: number; text: string; place?: string[] }
  | { type: "faction.rel"; a: string; b: string; value: number }
  | { type: "proposal.new"; proposal: Proposal }
  | { type: "proposal.done"; id: string; accepted: boolean }
  | { type: "tick"; at: number; tension: number; target: number };
