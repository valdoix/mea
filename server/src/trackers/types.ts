import { emptySim, type SimState } from "../sim/types";

/**
 * The story world the trackers keep (TRK-16…22), modelled on ALMANAC's ledger state.
 * It is rebuilt by folding events in message order, so any message's state can be recomputed
 * and swipes, edits and deletes never corrupt it (TRK-04).
 */

export type OpName =
  | "clock" | "wx" | "at" | "scene" | "mode" | "cast" | "mood" | "body" | "look" | "trait" | "drive" | "mask" | "think" | "journal" | "dead"
  | "bond" | "ladder" | "know" | "secret" | "reveal" | "item" | "thread" | "owe" | "promise" | "deadline" | "plant" | "payoff" | "clue"
  | "gauge" | "clockf" | "rep" | "event" | "plan" | "motif" | "milestone" | "beat" | "loop" | "set" | "lock" | "unset" | "rename" | "merge" | "edit"
  // B2: a secret's exposure clock (written by the engine and by you, never by the model)
  | "expose"
  // E1: a character's hidden pressure (the engine and you, never the model)
  | "pressure"
  // E2: whose room a place is, and what they keep where
  | "room" | "keeps"
  // engine-only: the world off the page (sim/types.ts)
  | "sim";

export type EventSource = "model" | "inline" | "user" | "init" | "timeskip" | "engine" | "memory";

/** One parsed ledger line. */
export interface Op {
  op: OpName;
  subject?: string;
  object?: string;
  args: Record<string, any>;
  cause?: string;
  /** The world off the page: the evidence the rules acted on ("tie: …", "place: …"), for the chip. */
  why?: string[];
  raw: string;
}

/** "Day 3 21:40" or a calendar date, as minutes (see clock.ts). */
export interface Moment {
  minutes: number;
  form: "date" | "day";
}

export type Tier = "spot" | "peri" | "off";
export const METERS = ["health", "fatigue", "hunger", "thirst", "pain", "intox", "composure", "arousal", "stress"] as const;
export type Meter = (typeof METERS)[number];

export interface Injury {
  where: string;
  /** 1 scratch · 2 wound · 3 serious · 4 critical */
  severity: 1 | 2 | 3 | 4;
  treated: boolean;
  /** Minutes on the clock when it happened or last stepped down. */
  since: number | null;
  worst: 1 | 2 | 3 | 4;
  note?: string;
}

export interface Condition {
  kind: string;
  text: string;
  since: number | null;
  /** When it should be over (minutes); null: only the story ends it. */
  until: number | null;
}

export type TraitKind = "eyes" | "hair" | "height" | "build" | "skin" | "face" | "scar" | "mark" | "voice" | "age" | "other";
export interface Trait {
  kind: TraitKind;
  text: string;
  by: "user" | "model" | "card";
  seq: number;
}

export interface Character {
  id: string;
  name: string;
  aliases: string[];
  isUser: boolean;
  isMain: boolean;
  firstSeq: number;
  lastSeq: number;
  tier?: Tier;
  activity?: string;
  place?: string;
  mood?: { name: string; v?: number; a?: number; d?: number; prev?: string; seq: number };
  meters: Partial<Record<Meter, number>>;
  flags: string[];
  injuries: Injury[];
  conditions: Condition[];
  look?: string;
  traits: Trait[];
  drives: { want?: string; fear?: string; need?: string; tactic?: string };
  mask?: { shown?: string; felt?: string; tell?: string };
  thoughts?: { text: string; seq: number };
  journal: { text: string; seq: number; at: string | null }[];
  dead?: boolean;
  /** How fast needs build and recover (stamina.ts). */
  stamina: string;
  /** Last clock reading drift was applied at. */
  driftAt?: number | null;
  /** E1: what they carry and haven't told anyone. */
  pressure?: Pressure;
}

/** E1: a hidden pressure: drawn (from the deck or from what the story says), yours, or locked. */
export interface Pressure {
  text: string;
  /** hidden → growing → cracking (it nearly shows) → resolved; "head": the next scene tests it. */
  stage: "hidden" | "growing" | "cracking" | "head" | "resolved";
  by: "deck" | "grounded" | "you";
  locked?: boolean;
  /** The scene it last moved in (it grows over scenes, not replies). */
  scene: number;
  seq: number;
  /** How many times it was drawn (Redraw rolls the next one). */
  draws: number;
  history: { stage: string; text?: string; seq: number }[];
}

export const BIPOLAR_AXES = ["trust", "affection", "respect", "comfort"] as const;
export const UNIPOLAR_AXES = ["familiarity", "attraction", "fear", "worry", "resentment", "obligation", "rivalry"] as const;
export const AXES = [...BIPOLAR_AXES, ...UNIPOLAR_AXES] as const;
export type Axis = (typeof AXES)[number];
/** How an axis reads in words where its name alone is ambiguous: fear OF them (a threat) vs fear FOR them (they might come to harm). */
export const AXIS_WORDS: Partial<Record<Axis, string>> = { fear: "fear of them", worry: "worry for them" };

export interface BondMove {
  axis: Axis;
  from: number;
  to: number;
  delta: number;
  cause?: string;
  seq: number;
}

export interface Bond {
  from: string;
  to: string;
  axes: Partial<Record<Axis, number>>;
  label?: string;
  tags: string[];
  history: BondMove[];
}

export const LADDER = ["Strangers", "Aware", "Interested", "Charged", "Tested", "Spoken", "Together", "Established"];

export interface Ladder {
  from: string;
  to: string;
  tier: number;
  evidence?: string;
  seq: number;
  scene: number;
  history: { tier: number; evidence?: string; seq: number }[];
}

/** heard (docs/21 5.1): news that reached them off the page, not yet shown on it; a maybe, never a certainty. */
export type KnowStatus = "knows" | "believes" | "suspects" | "doubts" | "wrong" | "unaware" | "heard";
export type Truth = "true" | "false" | "partial" | "unknown";

export interface Fact {
  key: string;
  statement: string;
  truth: Truth;
  /** `everyone`: kept from all but the keepers, so whoever turns up later goes into `from` too. */
  secret?: { keepers: string[]; from: string[]; everyone?: boolean };
  stances: Record<string, { status: KnowStatus; route?: string; seq: number; set?: boolean }>;
  revealed: { to: string[]; seq: number; how?: string }[];
  /** docs/21 4.3: who it's about (character ids), read once with the cast in hand. */
  about?: string[];
  firstSeq: number;
  lastSeq: number;
}

/** B2: how close a secret is to coming out (0–6), and who is closest to finding out, and why. */
export interface Exposure {
  cur: number;
  max: number;
  history: { delta: number; v: number; why?: string; who?: string; seq: number }[];
  /** Per character id: how much has pointed them at it, and the reasons. */
  near: Record<string, { score: number; why: string[] }>;
}

export interface Item {
  id: string;
  name: string;
  holder?: string;
  owner?: string;
  where?: string;
  condition?: string;
  gone?: boolean;
  gift?: string;
  /** E2: the seq a gift was lost at (until it turns up again). */
  lostGift?: number;
  /** Who held it, and (E2) where the story was and when, for the object's history. */
  custody: { from?: string; to?: string; how?: string; seq: number; at?: string; time?: number }[];
  lastSeq: number;
}

export type ThreadStatus = "open" | "stalled" | "resolved";
export interface Thread {
  id: string;
  title: string;
  kind?: string;
  status: ThreadStatus;
  latest?: string;
  blocker?: string;
  openedSeq: number;
  lastSeq: number;
  history: { op: string; detail?: string; seq: number }[];
}

export interface Obligation {
  id: string;
  kind: "owe" | "promise";
  who: string;
  whom?: string;
  what: string;
  status: "open" | "due" | "kept" | "broken" | "paid" | "forgiven" | "lapsed" | "excused";
  due?: { minutes: number | null; text: string };
  seq: number;
  /** Story minutes when it was made: the clock never breaks it sooner than its window after that. */
  made?: number;
  /** Kept/broken already moved the bond. */
  felt?: boolean;
  /** E3: a meeting (both there, at this place, in the window). */
  meet?: string;
  /** E3: minutes either side of the time (a meeting) or after it (a promise) before it's broken. */
  window?: number;
  /** E3: 1 minor, 2 (default), 3 vital: how far keeping or breaking it moves the bond. */
  importance?: number;
  /** E3: Mea's own verdict (from presence and the clock), which you can override. */
  auto?: boolean;
  /** E3: what the verdict moved on the bond, so an override can take it back. */
  moves?: { axis: Axis; delta: number }[];
  /** The message its status last changed at. */
  settled?: number;
}

/** docs/22 1.1: something the story expects to happen. Closing it happens once, here. */
export interface Loop {
  /** "L1a2b3", from its first wording (loops.ts). */
  id: string;
  what: string;
  kind: "promise" | "plan" | "errand" | "question";
  status: "open" | "done" | "dropped" | "lapsed";
  opened: number;
  /** The message it really happened at. */
  closed?: number;
  /** The line that closes it. */
  how?: string;
  due?: { minutes: number | null; text: string };
  /** "Tacos every Friday": an instance closes, and the loop stays open. */
  repeats?: boolean;
  /** The last instance of one that repeats. */
  last?: number;
  /** The promise or calendar plan that is this loop. */
  obligation?: string;
  calendar?: string;
  /** Every wording that's known to be this loop. */
  from: string[];
}

export interface Deadline {
  id: string;
  title: string;
  at: number | null;
  text: string;
  done: boolean;
  seq: number;
}

export interface Plant {
  id: string;
  text: string;
  payoff?: string;
  seq: number;
  scene: number;
  paidSeq?: number;
}

export interface Clue {
  id: string;
  text: string;
  pointsTo?: string;
  reliability?: string;
  seq: number;
}

export interface Gauge {
  name: string;
  cur: number;
  max: number;
  cause?: string;
  history: { v: number; seq: number }[];
}

export interface FactionClock {
  faction: string;
  name: string;
  cur: number;
  max: number;
  history: { v: number; seq: number }[];
}

export interface Reputation {
  who: string;
  group: string;
  score: number;
  tags: string[];
  history: { delta: number; deed?: string; seq: number }[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  kind: "birthday" | "anniversary" | "holiday" | "appointment" | "plan" | "recurring";
  when: string;
  /** For one-off events with a reading on the clock. */
  at: number | null;
  who: string[];
  done?: boolean;
  seq: number;
}

export interface Motif {
  id: string;
  text: string;
  who?: string;
  firstSeq: number;
  lastSeq: number;
  uses: number;
}

export interface Milestone {
  text: string;
  who: string[];
  seq: number;
  at: string | null;
}

export interface Place {
  id: string;
  name: string;
  path: string[];
  visits: number;
  lastSeq: number;
  /** E2: whose it is (a character id) and what kind of place (room, home, shop…). */
  owner?: string;
  kind?: string;
  /** E2: the item ids that were here when you last left, for "what's changed since". */
  seen?: string[];
}

export interface WorldState {
  time: Moment | null;
  /** When the clock was first set: the story's opening, the "tonight" a card's scenario speaks of. */
  start?: Moment;
  weather: { now: string; prev?: string; seq: number } | null;
  place: string[];
  sceneNo: number;
  sceneTitle?: string;
  sceneStartSeq: number;
  mode?: string;
  chars: Record<string, Character>;
  bonds: Record<string, Bond>;
  ladders: Record<string, Ladder>;
  facts: Record<string, Fact>;
  /** B2: exposure clocks, by fact key. */
  exposure: Record<string, Exposure>;
  items: Record<string, Item>;
  threads: Record<string, Thread>;
  obligations: Record<string, Obligation>;
  /** docs/22 1.1: what's open, by id. */
  loops: Record<string, Loop>;
  deadlines: Record<string, Deadline>;
  plants: Record<string, Plant>;
  clues: Clue[];
  gauges: Record<string, Gauge>;
  clocks: Record<string, FactionClock>;
  rep: Record<string, Reputation>;
  calendar: Record<string, CalendarEvent>;
  motifs: Record<string, Motif>;
  milestones: Milestone[];
  /** docs/20 1.1: what happened, one line per reply, stamped with the story time, place and who was there. */
  beats: Beat[];
  places: Record<string, Place>;
  /** Custom template values (TRK-01): { templateKey: { field: value } }. */
  custom: Record<string, Record<string, unknown>>;
  /** Paths the user locked (TRK-05). */
  locks: string[];
  /** The world off the page: subplots, arrivals, news (sim/). */
  sim: SimState;
  lastSeq: number;
}

/** One change, for the chips under a message (TRK-07) and the timeline (TRK-28). */
export interface Change {
  kind: string;
  /** Short text for the chip: "Trust +1", "21:40 → 23:10", "Harbor → Lighthouse". */
  text: string;
  /** Who or what it's about. */
  subject?: string;
  reason?: string;
  tone?: "up" | "down" | "due" | "warn";
  /** Stable path for locks, history and "when did X change?". */
  path: string;
  from?: unknown;
  to?: unknown;
  /** A note for the detail view: "capped from +3", "flashback". */
  flag?: string;
  /** This change opened a new scene (memory treats it as a scene break). */
  newScene?: boolean;
  memory?: boolean;
  source: EventSource;
  /** The world off the page: the event behind it (so you can undo it) and why the engine did it. */
  event?: string;
  why?: string[];
}

export interface Verdict {
  raw: string;
  ok: boolean;
  reason?: string;
  /** Accepted with a warning. */
  warn?: string;
}

export function emptyWorld(): WorldState {
  return {
    time: null,
    weather: null,
    place: [],
    sceneNo: 1,
    sceneStartSeq: 0,
    chars: {},
    bonds: {},
    ladders: {},
    facts: {},
    exposure: {},
    items: {},
    threads: {},
    obligations: {},
    loops: {},
    deadlines: {},
    plants: {},
    clues: [],
    gauges: {},
    clocks: {},
    rep: {},
    calendar: {},
    motifs: {},
    milestones: [],
    beats: [],
    places: {},
    custom: {},
    locks: [],
    sim: emptySim(),
    lastSeq: 0,
  };
}

/** docs/20 1.1: one reply's events in a line, where and when they happened. */
export interface Beat {
  text: string;
  seq: number;
  /** Story minutes after the reply (null before the clock is set). */
  minutes: number | null;
  form?: "date" | "day";
  place: string[];
  /** Who was in the scene (ids). */
  who: string[];
}
