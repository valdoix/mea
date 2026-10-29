import { applySim } from "../sim/fold";
import { itemsAt } from "./belongings";
import type { SimOp } from "../sim/types";
import { formatStoryTime, leadingDuration, parseDuration, parseStoryTime, shortStoryTime } from "./clock";
import { addCondition, conditionsIn, detectStamina, driftCharacter, type DriftNote, endsCondition, SEVERITY, severityOf } from "./drift";
import { castLabel, parseLine } from "./dsl";
import { applyPatch, type Change as PatchChange } from "./patch";
import type { Template } from "./schema";
import {
  AXES,
  type Axis,
  BIPOLAR_AXES,
  type Beat,
  type Bond,
  type Change,
  type Character,
  emptyWorld,
  type EventSource,
  type KnowStatus,
  LADDER,
  type Ladder,
  METERS,
  type Meter,
  type Obligation,
  type Op,
  type Place,
  type Trait,
  type TraitKind,
  type Truth,
  type Verdict,
  type WorldState,
} from "./types";

/** One stored event: an op anchored to a message (and swipe), in order. */
export interface TrackerEvent {
  id: string;
  messageId: string | null;
  seq: number;
  source: EventSource;
  op: Op;
}

export type RomancePace = "off" | "slow" | "measured" | "fast" | "established";

export interface FoldConfig {
  userName: string;
  mainName: string;
  /** The model writes nothing about the user's inner life (ALMANAC: sealed persona). */
  sealedPersona: boolean;
  romance: RomancePace;
  /** strict: causeless bond/know/item/thread lines are rejected; lenient: accepted with a warning. */
  strictness: "strict" | "lenient";
  /** TRK-11: cap meter and bond moves per message. */
  limits: boolean;
  templates: Template[];
  /** Stamina kinds read from the card, persona and cast profiles (lower-case name → kind). */
  stamina?: Record<string, string>;
  /** Stable traits read from the card and persona (lower-case name → trait lines). */
  seedTraits?: Record<string, string[]>;
  /**
   * docs/19 2.3: leaks the checker flagged in a reply, still open. The reply's own ledger can't
   * teach that person that fact until the flag is dismissed or the sentence fixed.
   */
  held?: { messageId: string; who: string; text: string }[];
}

export interface FoldResult {
  state: WorldState;
  /** Changes per message id (TRK-07). */
  changes: Record<string, Change[]>;
  verdicts: Record<string, Verdict>;
}

/**
 * A look line without the clauses that wear or hold an item ("bare-chested under Natalie's
 * leather jacket, back bandaged" less "Natalie's leather jacket" is "back bandaged").
 */
export function lookWithout(look: string, item: string): string {
  const words = (item.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w.replace(/'s$/, "")).filter((w) => w.length > 2 && w !== "the");
  const head = words.at(-1);
  if (!head) return look;
  const rest = words.slice(0, -1);
  const clauses = look.split(/\s*[,;]\s*/);
  const kept = clauses.filter((c) => {
    const cw = new Set((c.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w.replace(/s$/, "")));
    if (!cw.has(head.replace(/s$/, ""))) return true;
    return rest.length > 0 && !rest.some((w) => cw.has(w.replace(/s$/, "")));
  });
  return kept.length === clauses.length ? look : kept.join(", ");
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/#\d+.*$/, "")
    .replace(/[“”"']/g, "")
    .replace(/['’]s$/, "")
    .replace(/\s+/g, " ")
    .trim();
export const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const clip = (s: string | undefined) => (s ?? "").trim();
const cut = (s: string, n: number) => (s.trim().length > n ? `${s.trim().slice(0, n - 1).trimEnd()}…` : s.trim());
/** Beats kept in the state: a few story days of replies. */
const MAX_BEATS = 400;
/** A name as the model wrote it, without a place or note: "Jackie Taylor@down-slope (finding James)" → "Jackie Taylor". */
export const personName = (s: string) => s.replace(/\s*@.*$/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();

function lev(a: string, b: string, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length]!;
}

/** Word overlap between two phrases (0–1), for matching threads and facts written differently. */
export function overlap(a: string, b: string) {
  const w = (s: string) => new Set(norm(s).split(/\W+/).filter((x) => x.length > 2 && !STOP.has(x)));
  const A = w(a);
  const B = w(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}
const STOP = new Set("the and for with from that this was were has have had her his their them she they you are not but into onto over about".split(" "));

/** Words that say when or how a promise is kept, not what it is. */
const PROMISE_STOP = new Set("tell make give take every tonight tomorrow today after before later then again soon right going will promise".split(" "));
const stems = (s: string) => new Set((norm(s).match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w) && !PROMISE_STOP.has(w)).map((w) => w.slice(0, 6)));

/**
 * A promise to one person said again to another: one names the other's listener ("tell Dawn about
 * the jealousy question" to Gabriel, "the jealousy story at dinner" to Dawn), and they share two
 * words besides. A shared listener is never enough: two promises to Gabriel both name Gabriel.
 */
export function restated(a: string, aTo: string, b: string, bTo: string) {
  const first = (n: string) => n.trim().split(/\s+/)[0]!.toLowerCase();
  if (!aTo || !bTo || first(aTo) === first(bTo)) return false;
  const names = (s: string) => new RegExp(`\\b${first(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (!names(bTo).test(a) && !names(aTo).test(b)) return false;
  const drop = new Set([first(aTo), first(bTo)].map((w) => w.slice(0, 6)));
  const A = [...stems(a)].filter((w) => !drop.has(w));
  const B = stems(b);
  return A.filter((w) => B.has(w)).length >= 2;
}

const TRAIT_KIND: [TraitKind, RegExp][] = [
  ["eyes", /\beyes?\b/i],
  ["hair", /\bhair\b|\bbald\b|\bbraid|\bcurls\b/i],
  ["height", /\b(tall|short|petite|towering|\d+\s*(?:cm|ft|foot|feet)|height)\b/i],
  ["build", /\b(build|slender|slim|stocky|muscular|lean|broad|curvy|athletic|heavyset|wiry|lanky)\b/i],
  ["skin", /\b(skin|complexion|freckl|tan|pale|dark-skinned)\w*/i],
  ["scar", /\bscar/i],
  ["mark", /\b(tattoo|birthmark|piercing|mole|brand)\w*/i],
  ["voice", /\bvoice\b|\baccent\b/i],
  ["age", /\b(\d{1,3}|teen|twenties|thirties|forties|fifties|sixties)\b.*\b(years?|old|age)\b|\baged?\b/i],
  ["face", /\b(face|jaw|nose|lips|cheekbones|beard|stubble)\b/i],
];
export const traitKind = (text: string): TraitKind => TRAIT_KIND.find(([, re]) => re.test(text))?.[0] ?? "other";

const METER_ALIASES: Record<string, Meter> = {
  tired: "fatigue", tiredness: "fatigue", exhaustion: "fatigue", fatigue: "fatigue", hunger: "hunger", hungry: "hunger", thirst: "thirst", thirsty: "thirst",
  pain: "pain", drunk: "intox", intox: "intox", intoxication: "intox", drunkenness: "intox", health: "health", hp: "health", composure: "composure",
  ballast: "composure", arousal: "arousal", lust: "arousal", stress: "stress", anxiety: "stress",
};
const AXIS_ALIASES: Record<string, Axis> = {
  trust: "trust", affection: "affection", love: "affection", fondness: "affection", respect: "respect", familiarity: "familiarity", comfort: "comfort",
  safety: "comfort", attraction: "attraction", desire: "attraction", fear: "fear", "fear of": "fear", "afraid of": "fear", dread: "fear",
  worry: "worry", worries: "worry", "fear for": "worry", "fears for": "worry", "afraid for": "worry", concern: "worry", resentment: "resentment", resent: "resentment", anger: "resentment",
  obligation: "obligation", debt: "obligation", rivalry: "rivalry", rival: "rivalry", jealousy: "rivalry",
};
const BIG_CAUSE = /\b(betray\w*|rescue\w*|saved?\b|saving|unforgiv\w*|life|died|death|confess\w*|attack\w*|abandon\w*)\b/i;
const DOWN_CAUSE = /\b(betray\w*|lie|lies|lied|lying|neglect\w*|abandon\w*|broke|broken|break\w*|cheat\w*|hurt\w*|reject\w*|refus\w*|cruel\w*|deceiv\w*|deceit\w*|revealed|left (?:her|him|them)|walked away|turned away|pushed (?:her|him|them) away|cold|withdr[ae]w\w*|distan\w*|end(?:ed|s)? it|split|dumped|argu\w*|resent\w*)\b/i;
const ROMANCE_CAUSE = /\b(kiss\w*|attract\w*|desir\w*|crush\w*|flirt\w*|blush\w*|in love|lov(?:e|es|ed|ing)|romanc\w*|romantic\w*|date|dating|lips|mouth|jealous\w*|long(?:s|ed|ing) for|butterfl\w*|chemistry|sparks?|aroused|arousal|wants? (?:her|him|them)|sexual\w*|seduc\w*|caress\w*)\b/i;
/** Words that name a crowd, not a person: "know Group: …" means everyone in the scene. */
const GROUP_WORD = /^(?:the |all the |whole )*(?:group|whole group|everyone|everybody|all|all present|all of them|all of us|circle|others|rest|crowd|camp|team|squad|party|survivors|room|table|fire|us|them|they|we|both|both of them|girls|boys|kids|everyone present|everyone here|whole camp)$/;
/** Words for people at large ("the general public", "nobody"): no one in particular, so never a person. */
const PUBLIC_WORD = /^(?:the )?(?:general )?public$|^(?:the )?(?:whole )?(?:world|town|school|city|village)$|^(?:other )?people$|^everyone else$|^anyone(?: else)?$|^outsiders$|^(?:nobody|no one|noone|none)(?: else)?$/;
/** "from everyone": the crowd words, and people at large (but not "nobody"). */
const EVERYONE_WORD = (n: string) => GROUP_WORD.test(n) || (PUBLIC_WORD.test(n) && !/^(?:nobody|no one|noone|none)/.test(n));
const isCrowd = (name: string) => {
  const n = norm(personName(name));
  return GROUP_WORD.test(n) || PUBLIC_WORD.test(n);
};
/** Ops said of a person, which a list of names in the subject spreads over each of them. */
const PERSON_OPS = new Set<string>(["mood", "body", "look", "trait", "drive", "mask", "dead", "bond", "ladder", "know", "pressure", "room", "keeps", "owe", "promise", "rep"]);

interface Ctx {
  cfg: FoldConfig;
  changes: Change[];
  verdict: Verdict;
  ev: TrackerEvent;
  notes: DriftNote[];
}

export class Folder {
  state: WorldState;
  changes: Record<string, Change[]> = {};
  verdicts: Record<string, Verdict> = {};

  constructor(
    public cfg: FoldConfig,
    state?: WorldState,
  ) {
    this.state = state ?? emptyWorld();
    if (!state) {
      this.ensureChar(cfg.userName || "You", 0, { isUser: true });
      if (cfg.mainName) this.ensureChar(cfg.mainName, 0, { isMain: true });
    }
  }

  // ---------- names ----------

  /** Finds a character by name, alias, {{user}}/{{char}}, first or last name, or a one-letter typo. */
  findChar(name: string): Character | undefined {
    const n = norm(personName(name));
    if (!n) return undefined;
    const chars = Object.values(this.state.chars);
    if (/^(\{\{user\}\}|user|you|your character|me|i)$/.test(n)) return chars.find((c) => c.isUser);
    if (/^(\{\{char\}\}|char)$/.test(n)) return chars.find((c) => c.isMain);
    const exact = chars.find((c) => c.id === slug(n) || norm(c.name) === n || c.aliases.some((a) => norm(a) === n));
    if (exact) return exact;
    // "Jackie" for Jackie Taylor, "Jackie Taylor" for Jackie, "Holloway" for James Holloway.
    const words = (s: string) => norm(s).split(" ");
    const nw = n.split(" ");
    const pick = (list: Character[]) => {
      if (list.length <= 1) return list[0];
      // Several share the name: whoever is in the scene, then your character or the main one.
      const here = list.filter((c) => c.tier === "spot" || c.tier === "peri");
      if (here.length === 1) return here[0];
      const lead = list.filter((c) => c.isUser || c.isMain);
      return lead.length === 1 ? lead[0] : undefined;
    };
    const first = pick(chars.filter((c) => [c.name, ...c.aliases].some((x) => words(x)[0] === n || (nw.length > 1 && nw[0] === norm(x)))));
    if (first) return first;
    if (nw.length === 1 && n.length >= 3) {
      const last = pick(chars.filter((c) => words(c.name).length > 1 && words(c.name).at(-1) === n));
      if (last) return last;
    }
    if (n.length >= 5) {
      const typo = chars.filter((c) => lev(norm(c.name), n, 1) <= 1);
      if (typo.length === 1) return typo[0];
    }
    return undefined;
  }

  ensureChar(name: string, seq: number, opts: { isUser?: boolean; isMain?: boolean } = {}): Character {
    const found = opts.isUser ? Object.values(this.state.chars).find((c) => c.isUser) : this.findChar(name);
    if (found) {
      found.lastSeq = Math.max(found.lastSeq, seq);
      return found;
    }
    const clean = personName(name).replace(/#\d+.*$/, "").replace(/[“”"]/g, "").trim() || name.trim();
    let id = opts.isUser ? "user" : slug(clean);
    // A merged-away person's id stays free of clashes.
    for (let i = 2; !opts.isUser && this.state.chars[id]; i++) id = `${slug(clean)}-${i}`;
    const key = clean.toLowerCase();
    const c: Character = {
      id,
      name: clean,
      aliases: [],
      isUser: !!opts.isUser,
      isMain: !!opts.isMain,
      firstSeq: seq,
      lastSeq: seq,
      meters: {},
      flags: [],
      injuries: [],
      conditions: [],
      traits: [],
      drives: {},
      journal: [],
      stamina: this.cfg.stamina?.[key] ?? (opts.isUser ? this.cfg.stamina?.user : undefined) ?? "ordinary",
    };
    this.state.chars[id] = c;
    for (const t of this.cfg.seedTraits?.[opts.isUser ? "user" : key] ?? []) c.traits.push({ kind: traitKind(t), text: t, by: "card", seq: 0 });
    // A secret kept from everyone is kept from whoever turns up later too.
    if (!opts.isUser) for (const f of Object.values(this.state.facts)) if (f.secret?.everyone && !f.secret.keepers.includes(id)) f.secret.from.push(id);
    return c;
  }

  /** "Mari, Gen and Robin" → each of them (unless someone really goes by the whole thing). */
  each(name: string): string[] {
    const parts = personName(name).split(/\s*(?:,|&|\+|\/|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return [name];
    const n = norm(personName(name));
    return Object.values(this.state.chars).some((c) => norm(c.name) === n || c.aliases.some((x) => norm(x) === n)) ? [name] : parts;
  }

  /** A person named in an op: resolves or creates (never for names that look like groups or places). */
  person(name: string | undefined, seq: number): Character | undefined {
    if (!name?.trim()) return undefined;
    // A crowd or "the public" is never a person, even one made by mistake before.
    if (isCrowd(name)) return undefined;
    return this.findChar(name) ?? this.ensureChar(name, seq);
  }

  /** The people a name stands for: "the group", "everyone", "the circle" mean whoever is in the scene. */
  people(name: string | undefined, seq: number): Character[] {
    if (name?.trim() && GROUP_WORD.test(norm(personName(name))))
      return Object.values(this.state.chars).filter((c) => (c.tier === "spot" || c.tier === "peri") && !c.dead);
    const c = this.person(name, seq);
    return c ? [c] : [];
  }

  nameOf(id: string) {
    return this.state.chars[id]?.name ?? id;
  }

  now(): number | null {
    return this.state.time?.minutes ?? null;
  }

  // ---------- applying ----------

  apply(ev: TrackerEvent) {
    // Knowledge and scene lines the model wrote are read again from their text, so older ones get what the
    // parser has learned since (fields in the cause, "kept by A, B", a mode after the scene's title). The engine's own carry args the text doesn't.
    if ((ev.op.op === "know" || ev.op.op === "secret" || ev.op.op === "scene") && (ev.source === "model" || ev.source === "inline" || ev.source === "init") && ev.op.raw) {
      const op = parseLine(ev.op.raw);
      if (op?.op === ev.op.op) ev = { ...ev, op };
    }
    const ctx: Ctx = { cfg: this.cfg, changes: [], verdict: { raw: ev.op.raw, ok: true }, ev, notes: [] };
    try {
      // "mood Mari, Gen & Robin: tense" is said of each of them, not of one person by that name.
      const each = PERSON_OPS.has(ev.op.op) && ev.op.subject ? this.each(ev.op.subject) : [];
      if (each.length > 1) for (const subject of each) this.applyOp({ ...ev.op, subject }, ctx);
      else this.applyOp(ev.op, ctx);
      if (ev.op.op === "cast" || ev.op.op === "at" || ev.op.op === "clock") this.promiseChecks(ctx);
      // A beat is stamped with where and when its reply ends, whichever order the lines came in.
      if (ev.op.op === "cast" || ev.op.op === "at" || ev.op.op === "clock") {
        const b = this.state.beats?.at(-1);
        if (b?.seq === ev.seq) this.stamp(b);
      }
    } catch (e) {
      ctx.verdict = { raw: ev.op.raw, ok: false, reason: `couldn't apply: ${(e as Error).message}` };
    }
    this.verdicts[ev.id] = ctx.verdict;
    if (ev.messageId && ctx.changes.length) (this.changes[ev.messageId] ??= []).push(...ctx.changes);
    this.state.lastSeq = Math.max(this.state.lastSeq, ev.seq);
  }

  private reject(ctx: Ctx, reason: string) {
    ctx.verdict = { raw: ctx.ev.op.raw, ok: false, reason };
  }
  private warn(ctx: Ctx, w: string) {
    ctx.verdict.warn = ctx.verdict.warn ? `${ctx.verdict.warn}; ${w}` : w;
  }
  private push(ctx: Ctx, c: Omit<Change, "source">) {
    const engine = ctx.ev.source === "engine" ? { event: ctx.ev.id, ...(ctx.ev.op.why?.length ? { why: ctx.ev.op.why } : {}) } : {};
    ctx.changes.push({ ...c, source: ctx.ev.source, ...engine });
  }
  private isLocked(path: string) {
    const p = path.toLowerCase();
    return this.state.locks.some((l) => p === l || p.startsWith(`${l}.`));
  }
  private ai(ctx: Ctx) {
    return ctx.ev.source !== "user";
  }
  private needCause(ctx: Ctx, op: Op) {
    if (op.cause || !this.ai(ctx) || ctx.ev.source === "init" || ctx.ev.source === "engine") return true;
    if (this.cfg.strictness === "strict") {
      this.reject(ctx, "needs a cause (— why)");
      return false;
    }
    this.warn(ctx, "no cause given");
    return true;
  }

  /** Moves the clock and lets every body drift with it. */
  private moveClock(to: number, form: "date" | "day", ctx: Ctx, flag?: string) {
    const prev = this.state.time;
    const from = prev && prev.form === form ? prev.minutes : null;
    this.state.time = { minutes: to, form };
    if (!prev) this.state.start = { minutes: to, form };
    // A switch from "Day 1" to a calendar keeps how long ago the start was.
    else if (prev.form !== form && this.state.start) this.state.start = { minutes: to - (prev.minutes - this.state.start.minutes), form };
    // M26: a switch of clock form starts the count again; nothing drifts across it.
    if (prev && prev.form !== form) for (const c of Object.values(this.state.chars)) c.driftAt = to;
    if (from == null) {
      this.push(ctx, { kind: "clock", text: shortStoryTime(formatStoryTime({ minutes: to, form })), path: "clock", to: formatStoryTime({ minutes: to, form }) });
      return;
    }
    if (to > from) for (const c of Object.values(this.state.chars)) driftCharacter(c, c.driftAt ?? from, to, ctx.notes);
    else for (const c of Object.values(this.state.chars)) c.driftAt = to;
    const a = formatStoryTime({ minutes: from, form });
    const b = formatStoryTime({ minutes: to, form });
    this.push(ctx, { kind: "clock", text: `${shortStoryTime(a)} → ${shortStoryTime(b)}`, path: "clock", from: a, to: b, ...(flag ? { flag } : {}) });
    // A jump of three hours or more starts a new scene.
    if (to - from >= 180) this.newScene(ctx.ev.seq);
    for (const n of ctx.notes.splice(0)) this.push(ctx, { kind: "body", text: `${n.who}: ${n.text}`, subject: n.who, path: `chars.${slug(n.who)}.body`, tone: "up" });
    this.dueChecks(ctx);
  }

  /** docs/20 1.1: a beat takes the story's time, place and people as they stand now. */
  private stamp(b: Beat) {
    const st = this.state;
    b.minutes = st.time?.minutes ?? null;
    b.form = st.time?.form;
    b.place = [...st.place];
    b.who = Object.values(st.chars).filter((c) => (c.tier === "spot" || c.tier === "peri") && !c.dead).map((c) => c.id);
  }

  /** E2: where and when the story is, for an object's history. */
  private where() {
    return { ...(this.state.place.length ? { at: this.state.place.join(" › ") } : {}), ...(this.state.time ? { time: this.state.time.minutes } : {}) };
  }

  /** E2: the known place a path names (the same place written in full or by its last part). */
  placeAt(path: string[]): Place | undefined {
    if (!path.length) return undefined;
    const exact = this.state.places[slug(path.join(" "))];
    if (exact) return exact;
    const tail = path.map(norm);
    return Object.values(this.state.places).find((p) => {
      const pp = p.path.map(norm);
      return tail.length <= pp.length ? tail.every((x, i) => x === pp[pp.length - tail.length + i]) : pp.every((x, i) => x === tail[tail.length - pp.length + i]);
    });
  }

  /**
   * One message's move and cast, to tell who went along. A move takes everyone present with it,
   * but when the same message also says who is in the scene (a cast line), the people present
   * before who aren't in it stayed behind: three walking to the cabin don't bring the camp. Only
   * when the cast line names someone who came along; one that just notes a change says nothing.
   */
  private turnCast: { key: string; named: Set<string>; cast: boolean; move?: { from: string[]; carried: string[] } } | null = null;

  private castTurn(ctx: Ctx) {
    const key = `${ctx.ev.messageId ?? ""}:${ctx.ev.seq}:${ctx.ev.source}`;
    if (this.turnCast?.key !== key) this.turnCast = { key, named: new Set(), cast: false };
    return this.turnCast;
  }

  private leftBehind(ctx: Ctx) {
    const t = this.turnCast;
    if (!t?.cast || !t.move || !ctx.ev.messageId) return;
    // A cast line that only notes a change ("Tom@arrive") says nothing about who came along.
    if (!t.move.carried.some((id) => t.named.has(id) && !this.state.chars[id]?.isUser)) return;
    const from = t.move.from.join(" › ");
    for (const id of t.move.carried) {
      const c = this.state.chars[id];
      if (!c || t.named.has(id) || c.isUser || c.dead || (c.tier !== "spot" && c.tier !== "peri")) continue;
      c.tier = "off";
      c.place = from;
      c.activity = undefined;
      this.push(ctx, { kind: "cast", text: `${c.name} stayed behind (${t.move.from.at(-1)})`, subject: c.name, path: `chars.${c.id}.tier` });
    }
    t.move.carried = [];
  }

  /** The message that last named the mode. */
  private modeSeq = -1;

  private setMode(mode: string, seq: number) {
    this.state.mode = clip(mode).toLowerCase();
    this.modeSeq = seq;
  }

  private newScene(seq: number) {
    this.state.sceneNo++;
    this.state.sceneStartSeq = seq;
    this.state.sceneTitle = undefined;
    // A new scene doesn't inherit the last one's mode (a drive's "travel" in the kitchen after), unless
    // this same message named it.
    if (this.modeSeq !== seq) this.state.mode = undefined;
    for (const c of Object.values(this.state.chars)) c.activity = undefined;
  }

  /** Promises, debts, deadlines and plans whose time has come. */
  private dueChecks(ctx: Ctx) {
    const now = this.now();
    if (now == null) return;
    for (const o of Object.values(this.state.obligations)) {
      if (o.status === "open" && o.due?.minutes != null && now >= o.due.minutes) {
        o.status = "due";
        this.push(ctx, { kind: o.kind, text: `${o.kind === "promise" ? "Promise" : "Debt"} due: ${o.what}`, subject: this.nameOf(o.who), path: `obligations.${o.id}`, tone: "due" });
      }
    }
    for (const d of Object.values(this.state.deadlines)) {
      if (!d.done && d.at != null && now >= d.at && !(d as { passed?: boolean }).passed) {
        (d as { passed?: boolean }).passed = true;
        this.push(ctx, { kind: "deadline", text: `Deadline passed: ${d.title}`, path: `deadlines.${d.id}`, tone: "due" });
      }
    }
  }

  /**
   * E3: keeping a promise warms the bond and breaking one cools it, by how much it mattered. An
   * override (Kept after Broken, They had a reason, Forgive) takes back what the last verdict moved;
   * forgiving lets the resentment go but not the lost trust.
   */
  private feelPromise(o: Obligation, ctx: Ctx, seq: number) {
    if (!o.whom) return;
    const imp = o.importance ?? 2;
    const kept: { axis: Axis; delta: number }[] = [];
    for (const m of o.moves ?? []) {
      if (o.status === "forgiven" && m.axis !== "resentment") {
        kept.push(m);
        continue;
      }
      this.nudgeBond(o.whom, o.who, m.axis, -m.delta, `${o.status}: ${o.what}`, ctx, seq);
    }
    o.moves = kept;
    const moves: [Axis, number][] = o.status === "kept" ? [["trust", imp >= 3 ? 2 : 1]] : o.status === "broken" ? (imp <= 1 ? [["trust", -1]] : [["trust", imp >= 3 ? -2 : -1], ["resentment", imp >= 3 ? 2 : 1]]) : [];
    for (const [axis, d] of moves) {
      const moved = this.nudgeBond(o.whom, o.who, axis, d, `${o.status} a promise: ${o.what}`, ctx, seq);
      if (moved) o.moves.push({ axis, delta: moved });
    }
    o.felt = true;
  }

  /** One bond axis, by d (clamped); returns what it actually moved. */
  private nudgeBond(from: string, to: string, axis: Axis, d: number, cause: string, ctx: Ctx, seq: number) {
    const st = this.state;
    const key = `${from}>${to}`;
    const b = (st.bonds[key] ??= { from, to, axes: {}, tags: [], history: [] });
    const lo = (BIPOLAR_AXES as readonly string[]).includes(axis) ? -5 : 0;
    const prev = b.axes[axis] ?? 0;
    const next = Math.max(lo, Math.min(5, prev + d));
    if (next === prev) return 0;
    b.axes[axis] = next;
    b.history.push({ axis, from: prev, to: next, delta: next - prev, cause, seq });
    this.push(ctx, { kind: "bond", text: `${this.nameOf(from)} → ${this.nameOf(to)} · ${cap(axis)} ${next - prev > 0 ? "+" : ""}${next - prev}`, subject: this.nameOf(from), reason: cause, path: `bonds.${key}.${axis}`, tone: next > prev === (axis !== "resentment") ? "up" : "down" });
    return next - prev;
  }

  /**
   * E3: promises on the clock. A meeting is kept when both are there (and at the place, if it
   * names one) inside its window, and broken once the window has passed without it; any promise
   * with a time is broken a while after it (a day, or its own window) unless something kept it.
   */
  private promiseChecks(ctx: Ctx) {
    const now = this.now();
    if (now == null) return;
    const st = this.state;
    const here = (id: string) => {
      const c = st.chars[id];
      return Boolean(c && (c.isUser || c.tier === "spot" || c.tier === "peri"));
    };
    const at = (place: string) => {
      const want = norm(place.replace(/^the\s+/i, ""));
      return st.place.some((p) => norm(p.replace(/^the\s+/i, "")) === want);
    };
    for (const o of Object.values(st.obligations)) {
      if (o.kind !== "promise" || (o.status !== "open" && o.status !== "due") || o.due?.minutes == null) continue;
      const due = o.due.minutes;
      const win = o.window ?? (o.meet ? 60 : 1440);
      let verdict: "kept" | "broken" | null = null;
      if (o.meet && o.whom && now >= due - win && now <= due + win && here(o.who) && here(o.whom) && at(o.meet)) verdict = "kept";
      // Never broken sooner than its window after it was made: a time already behind the clock when
      // it was promised ("at dinner, 15:05", said at 15:10) is a slip, not a promise broken on arrival.
      else if (now > Math.max(due, o.made ?? due) + win) verdict = "broken";
      if (!verdict) continue;
      o.status = verdict;
      o.auto = true;
      const who = this.nameOf(o.who);
      this.push(ctx, { kind: "promise", text: verdict === "kept" ? `Promise kept: ${o.what}` : o.meet ? `${o.whom ? this.nameOf(o.whom) : "Someone"} was stood up: ${o.what}` : `Promise broken: ${o.what}`, subject: who, path: `obligations.${o.id}`, reason: verdict === "kept" ? "both were there in time" : "the time passed", tone: verdict === "kept" ? "up" : "down", memory: true });
      this.feelPromise(o, ctx, ctx.ev.seq);
    }
  }

  /** "Day 4 06:00", "tomorrow", "tonight", "+2h", "in 3 days" → story minutes. */
  private when(text: string | undefined): number | null {
    if (!text) return null;
    let t = text.trim().toLowerCase();
    const abs = parseStoryTime(text.replace(/^(?:at|on|by)\s+/i, ""));
    const now = this.now();
    const form = this.state.time?.form;
    if (abs && (now == null || !form || abs.form === form)) return abs.minutes;
    if (now == null) return null;
    // A day count on a calendar clock ("Day 1 15:05" on 11 October 2001), or a date on a day count, is
    // off this clock: read as minute 905 of year one, Buffy's promise to Dawn broke as she made it. Its
    // time of day is what was meant.
    if (abs) t = t.match(/(\d{1,2}:\d{2})\s*$/)?.[1] ?? "";
    const day = Math.floor(now / 1440) * 1440;
    const hm = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    const at = (base: number) => {
      if (!hm) return null;
      let h = Number(hm[1]) % 24;
      if (hm[3] === "pm" && h < 12) h += 12;
      if (hm[3] === "am" && h === 12) h = 0;
      return base + h * 60 + Number(hm[2] ?? 0);
    };
    if (/\btomorrow\b/.test(t)) return at(day + 1440) ?? day + 1440 + 9 * 60;
    if (/\btonight\b/.test(t)) return at(day) ?? day + 21 * 60;
    if (/\bdawn\b|\bsunrise\b/.test(t)) return day + (now % 1440 > 6 * 60 ? 1440 : 0) + 6 * 60;
    if (/\bnoon\b/.test(t)) return day + (now % 1440 > 12 * 60 ? 1440 : 0) + 12 * 60;
    if (/\bmidnight\b/.test(t)) return day + 1440;
    const rel = t.match(/^(?:\+|in\s+)(.+)$/);
    if (rel) {
      const d = parseDuration(rel[1]!.replace(/^(\d+)(\w)/, "$1 $2"));
      if (d != null) return now + d;
    }
    const nextDay = t.match(/\bnext\s+week\b/) ? now + 7 * 1440 : null;
    if (nextDay) return nextDay;
    const plain = at(day);
    // E3: "around 9" (said without am or pm) is the next nine that comes, morning or evening.
    if (plain != null && /^around\b/.test(t) && hm && !hm[3] && Number(hm[1]) < 12) return [plain, plain + 720, plain + 1440].find((x) => x >= now) ?? plain + 1440;
    return plain != null ? (plain < now ? plain + 1440 : plain) : null;
  }

  applyOp(op: Op, ctx: Ctx): void {
    const st = this.state;
    const seq = ctx.ev.seq;
    const a = op.args;
    switch (op.op) {
      case "clock": {
        if (this.isLocked("clock") && this.ai(ctx)) return this.reject(ctx, "the clock is locked");
        const now = this.now();
        // A skip in parts saved before Mea read them ("+1h30m | 1996-05-24 15:48") is read again here.
        const late = a.plus == null && typeof a.set === "string" && a.set.trim().startsWith("+") ? leadingDuration(a.set.trim().slice(1)) : null;
        if (a.plus != null || late) {
          if (now == null) return this.reject(ctx, "no time set yet to move from");
          let plus = (a.plus as number | undefined) ?? late!.minutes;
          const capMin = ctx.ev.source === "model" || ctx.ev.source === "inline" ? 7 * 1440 : Infinity;
          if (plus > capMin) {
            this.warn(ctx, `capped a ${Math.round(plus / 1440)}-day jump at 7 days`);
            plus = capMin;
          }
          if (plus <= 0) return;
          return this.moveClock(now + plus, st.time!.form, ctx);
        }
        const t = parseStoryTime(a.set);
        if (!t) return this.reject(ctx, "use +45m, +2h, Day N HH:MM or YYYY-MM-DD HH:MM");
        // M26: "Day N" and a calendar date count minutes from different starts; only the setup, you
        // or /timeskip can switch between them (and bodies don't drift across the switch).
        if (now != null && t.form !== st.time!.form && ctx.ev.source !== "init" && ctx.ev.source !== "user" && ctx.ev.source !== "timeskip")
          return this.reject(ctx, st.time!.form === "day" ? "the clock counts days here: use Day N HH:MM or +2h" : "the clock follows a calendar here: use YYYY-MM-DD HH:MM or +2h");
        if (now != null && t.minutes < now && !a.flashback && this.ai(ctx) && ctx.ev.source !== "timeskip")
          return this.reject(ctx, "story time can't go backwards (write flashback if it's one)");
        if (now != null && t.minutes - now > 7 * 1440 && this.ai(ctx) && ctx.ev.source !== "timeskip" && ctx.ev.source !== "init") this.warn(ctx, "a jump of more than a week");
        return this.moveClock(t.minutes, t.form, ctx, a.flashback ? "flashback" : undefined);
      }
      case "wx": {
        if (!a.to) return this.reject(ctx, "no weather given");
        const prev = st.weather?.now;
        if (prev && norm(prev) === norm(a.to)) return;
        st.weather = { now: clip(a.to), prev, seq };
        this.push(ctx, { kind: "weather", text: prev ? `${prev} → ${a.to}` : a.to, path: "weather", from: prev, to: a.to });
        return;
      }
      case "at": {
        const path = (a.path as string[]).map((s) => clip(s)).filter(Boolean);
        if (!path.length) return this.reject(ctx, "no place given");
        if (this.isLocked("place") && this.ai(ctx)) return this.reject(ctx, "the place is locked");
        const before = st.place;
        if (before.join(" › ").toLowerCase() === path.join(" › ").toLowerCase()) return;
        // E2: what was in the place you're leaving, for "what's changed since you were last here".
        const left = this.placeAt(before);
        if (left) left.seen = itemsAt(st, left).map((i) => i.id);
        st.place = path;
        const id = slug(path.join(" "));
        const p = (st.places[id] ??= { id, name: path.at(-1)!, path, visits: 0, lastSeq: seq });
        p.visits++;
        p.lastSeq = seq;
        // A move to a different building or further starts a new scene.
        const common = before.findIndex((x, i) => norm(x) !== norm(path[i] ?? ""));
        const moved = before.length > 0 && (common < 0 ? before.length !== path.length : common < Math.max(1, path.length - 1));
        if (moved) this.newScene(seq);
        const along = Object.values(st.chars).filter((c) => c.tier === "spot" || c.tier === "peri");
        for (const c of along) c.place = path.join(" › ");
        if (moved) {
          const t = this.castTurn(ctx);
          t.move = { from: before, carried: along.map((c) => c.id) };
          this.leftBehind(ctx);
        }
        this.push(ctx, { kind: "place", text: before.length ? `${before.at(-1)} → ${path.at(-1)}` : path.join(" › "), path: "place", from: before.join(" › "), to: path.join(" › "), ...(moved ? { newScene: true } : {}) });
        return;
      }
      case "scene": {
        if (a.mode) this.setMode(String(a.mode), seq);
        if (a.to && norm(a.to) !== norm(st.sceneTitle ?? "")) {
          const fresh = Boolean(st.sceneTitle);
          if (fresh) this.newScene(seq);
          st.sceneTitle = clip(a.to);
          // newScene marks a real change of scene (not the first title), which memory treats as a break.
          this.push(ctx, { kind: "scene", text: `Scene: ${st.sceneTitle}`, path: "scene", ...(fresh ? { newScene: true } : {}) });
        }
        return;
      }
      case "mode":
        this.setMode(String(a.to), seq);
        return;
      case "cast": {
        const turn = this.castTurn(ctx);
        turn.cast = true;
        // Events stored before castArgs dropped "traits: …" bits still carry them.
        const list = (a.list as { name: string; tier: string; note?: string }[]).filter((x) => !castLabel(x.name));
        for (const it of list.flatMap((x) => this.each(x.name).map((name) => ({ ...x, name })))) {
          const c = this.person(it.name, seq);
          if (!c) continue;
          turn.named.add(c.id);
          if (c.dead && /spot|peri|arrive/.test(it.tier)) {
            this.warn(ctx, `${c.name} is dead`);
            continue;
          }
          const was = c.tier;
          const tier = /^(left|leave|leaves|off|away|gone|exit\w*)$/.test(it.tier) ? "off" : /^peri/.test(it.tier) ? "peri" : "spot";
          c.tier = tier;
          c.activity = it.note ? clip(it.note.replace(/^(→|←)\s*/, "")) : tier === "off" ? undefined : c.activity;
          if (tier !== "off") {
            c.place = st.place.join(" › ") || c.place;
            for (const k of ["hunger", "thirst", "fatigue"] as const) if (c.meters[k] == null && !c.isUser) c.meters[k] = 1;
            c.driftAt ??= this.now();
          } else if (it.note && /→/.test(it.note)) c.place = clip(it.note.replace(/^.*→\s*/, ""));
          if (was !== tier) {
            if (tier === "off" && was) this.push(ctx, { kind: "cast", text: `${c.name} left${c.activity ? "" : ""}`, subject: c.name, path: `chars.${c.id}.tier` });
            else if (tier !== "off" && (was === "off" || !was) && !c.isUser && c.firstSeq !== seq) this.push(ctx, { kind: "cast", text: `${c.name} arrived`, subject: c.name, path: `chars.${c.id}.tier` });
            else if (tier !== "off" && !was && !c.isUser) this.push(ctx, { kind: "cast", text: `${c.name} appears`, subject: c.name, path: `chars.${c.id}.tier` });
          }
          c.lastSeq = seq;
        }
        this.leftBehind(ctx);
        return;
      }
      case "mood": {
        const c = this.person(op.subject, seq);
        if (!c) return this.reject(ctx, "whose mood?");
        if (c.isUser && this.cfg.sealedPersona && this.ai(ctx)) return this.reject(ctx, "your character's inner life is yours to write");
        if (this.isLocked(`chars.${c.id}.mood`) && this.ai(ctx)) return this.reject(ctx, "locked");
        if (!a.to) return this.reject(ctx, "no mood given");
        const prev = c.mood?.name;
        if (prev && norm(prev) === norm(a.to)) return;
        c.mood = { name: clip(a.to), v: clamp(a.v, -3, 3), a: clamp(a.a, 0, 5), d: clamp(a.d, -3, 3), prev, seq };
        this.push(ctx, { kind: "mood", text: `${c.name}: ${c.mood.name}`, subject: c.name, path: `chars.${c.id}.mood`, from: prev, to: c.mood.name });
        return;
      }
      case "body": {
        const c = this.person(op.subject, seq);
        if (!c) return this.reject(ctx, "whose body?");
        if (this.isLocked(`chars.${c.id}.body`) && this.ai(ctx)) return this.reject(ctx, "locked");
        const now = this.now();
        for (const m of a.meters as { meter: string; delta?: number; set?: number }[]) {
          const k = METER_ALIASES[m.meter];
          if (!k || !(METERS as readonly string[]).includes(k)) {
            c.flags = uniq([...c.flags, `${m.meter} ${m.set ?? m.delta}`]);
            continue;
          }
          const prev = c.meters[k];
          const next = clamp(m.set ?? (prev ?? (k === "health" || k === "composure" ? 5 : 0)) + (m.delta ?? 0), 0, 5)!;
          if (prev === next) continue;
          c.meters[k] = next;
          // Meters drift in fractions between replies; the chip shows the whole steps people read.
          this.push(ctx, { kind: "body", text: `${c.name}: ${k} ${prev == null ? "–" : Math.round(prev)} → ${Math.round(next)}`, subject: c.name, path: `chars.${c.id}.meters.${k}`, from: prev, to: next, tone: (k === "health" || k === "composure") === next > (prev ?? next) ? "up" : "down" });
        }
        for (const inj of a.injuries as { where: string; severity?: string; treated?: boolean; heal?: boolean }[]) {
          const where = clip(inj.where);
          const cur = c.injuries.find((i) => overlap(i.where, where) >= 0.5 || norm(i.where) === norm(where));
          if (inj.heal) {
            if (cur) {
              c.injuries = c.injuries.filter((i) => i !== cur);
              this.push(ctx, { kind: "body", text: `${c.name}: ${cur.where} healed`, subject: c.name, path: `chars.${c.id}.injuries`, tone: "up" });
            }
            continue;
          }
          const sev = severityOf(inj.severity);
          if (cur) {
            if (inj.treated && !cur.treated) cur.treated = true;
            if (sev > cur.severity) {
              cur.severity = sev;
              cur.worst = Math.max(cur.worst, sev) as typeof cur.worst;
              cur.since = now;
              this.push(ctx, { kind: "body", text: `${c.name}: ${where} worse (${SEVERITY[sev]})`, subject: c.name, path: `chars.${c.id}.injuries`, tone: "down" });
            }
            continue;
          }
          c.injuries.push({ where, severity: sev, treated: !!inj.treated, since: now, worst: sev });
          this.push(ctx, { kind: "body", text: `${c.name} hurt: ${where} (${SEVERITY[sev]})`, subject: c.name, path: `chars.${c.id}.injuries`, tone: "down", memory: sev >= 3 });
        }
        for (const f of a.flags as string[]) {
          const kinds = conditionsIn(f);
          if (kinds.length && endsCondition(f)) {
            c.conditions = c.conditions.filter((k) => !kinds.includes(k.kind));
            continue;
          }
          let added = false;
          for (const k of kinds) if (addCondition(c, k, f, now)) added = true;
          if (added) this.push(ctx, { kind: "body", text: `${c.name}: ${f}`, subject: c.name, path: `chars.${c.id}.conditions`, tone: "down" });
          else if (!kinds.length && !c.flags.some((x) => norm(x) === norm(f))) {
            c.flags = uniq([...c.flags, clip(f)]).slice(-12);
            this.push(ctx, { kind: "body", text: `${c.name}: ${f}`, subject: c.name, path: `chars.${c.id}.flags` });
          }
        }
        for (const x of a.clear as string[]) {
          c.flags = c.flags.filter((f) => !norm(f).includes(norm(x)));
          const kinds = conditionsIn(x);
          c.conditions = c.conditions.filter((k) => !kinds.includes(k.kind));
        }
        return;
      }
      case "look": {
        const c = this.person(op.subject, seq);
        if (!c || !a.to) return this.reject(ctx, "whose look?");
        if (this.isLocked(`chars.${c.id}.look`) && this.ai(ctx)) return this.reject(ctx, "locked");
        if (c.look && norm(c.look) === norm(a.to)) return;
        c.look = clip(a.to);
        this.push(ctx, { kind: "look", text: `${c.name}: ${clip(a.to)}`, subject: c.name, path: `chars.${c.id}.look` });
        return;
      }
      case "trait": {
        const c = this.person(op.subject, seq);
        if (!c) return this.reject(ctx, "whose traits?");
        for (const text of a.list as string[]) {
          const kind = traitKind(text);
          const cur = kind !== "other" ? c.traits.find((t) => t.kind === kind) : c.traits.find((t) => norm(t.text) === norm(text));
          const by: Trait["by"] = ctx.ev.source === "user" ? "user" : ctx.ev.source === "init" ? "card" : "model";
          if (cur && norm(cur.text) === norm(text)) continue;
          // Looks that don't drift: the user's word and the card hold against the story.
          if (cur && (cur.by === "user" || cur.by === "card") && by === "model") {
            if (!/\b(dye|dyed|contacts|magic|spell|cut|shaved|grew|surgery|transform\w*|changed)\b/i.test(`${text} ${op.cause ?? ""}`)) {
              this.warn(ctx, `kept "${cur.text}" (${cur.by === "user" ? "your word" : "from the card"})`);
              continue;
            }
          }
          if (cur) c.traits = c.traits.filter((t) => t !== cur);
          c.traits.push({ kind, text: clip(text), by, seq });
          this.push(ctx, { kind: "trait", text: `${c.name}: ${clip(text)}`, subject: c.name, path: `chars.${c.id}.traits.${kind}`, from: cur?.text, to: text });
        }
        return;
      }
      case "drive":
      case "mask": {
        const c = this.person(op.subject, seq);
        if (!c) return this.reject(ctx, "whose?");
        if (c.isUser && this.cfg.sealedPersona && this.ai(ctx)) return this.reject(ctx, "your character's inner life is yours to write");
        const target = op.op === "drive" ? c.drives : (c.mask ??= {});
        const keys = op.op === "drive" ? ["want", "fear", "need", "tactic"] : ["shown", "felt", "tell"];
        let any = false;
        for (const k of keys) {
          if (!a[k]) continue;
          if ((target as Record<string, string>)[k] && norm((target as Record<string, string>)[k]!) === norm(a[k])) continue;
          (target as Record<string, string>)[k] = clip(a[k]);
          any = true;
          if (op.op === "mask" && k === "felt") this.push(ctx, { kind: "mask", text: `${c.name} hides: ${clip(a[k])}`, subject: c.name, path: `chars.${c.id}.mask`, to: a[k] });
          if (op.op === "drive" && k === "want") this.push(ctx, { kind: "drive", text: `${c.name} wants: ${clip(a[k])}`, subject: c.name, path: `chars.${c.id}.drives.want` });
        }
        if (!any && !keys.some((k) => a[k])) return this.reject(ctx, `write ${keys.join(": / ")}:`);
        return;
      }
      case "think": {
        const c = this.person(op.subject, seq);
        if (!c || !a.text) return this.reject(ctx, "whose thoughts?");
        if (c.isUser && this.cfg.sealedPersona && this.ai(ctx)) return this.reject(ctx, "your character's inner life is yours to write");
        c.thoughts = { text: a.text.trim(), seq };
        // A private change: the thoughts drawer under the reply reads it; the chips never show it.
        this.push(ctx, { kind: "thought", text: `${c.name} thinks`, subject: c.name, path: `chars.${c.id}.thoughts`, to: c.thoughts.text });
        return;
      }
      case "journal": {
        const c = this.person(op.subject, seq);
        if (!c || !a.text) return this.reject(ctx, "whose journal?");
        if (c.isUser && this.cfg.sealedPersona && this.ai(ctx)) return this.reject(ctx, "your character's inner life is yours to write");
        c.journal.push({ text: clip(a.text), seq, at: st.time ? formatStoryTime(st.time) : null });
        if (c.journal.length > 40) c.journal.splice(0, c.journal.length - 40);
        this.push(ctx, { kind: "journal", text: `${c.name}'s journal`, subject: c.name, path: `chars.${c.id}.journal`, to: a.text });
        return;
      }
      case "dead": {
        const c = this.person(op.subject, seq);
        if (!c) return this.reject(ctx, "who died?");
        if (c.isUser && this.ai(ctx)) return this.reject(ctx, "only you decide your character's fate");
        if (c.dead) return;
        c.dead = true;
        c.tier = "off";
        this.push(ctx, { kind: "death", text: `${c.name} died`, subject: c.name, reason: op.cause ?? a.text, path: `chars.${c.id}.dead`, tone: "down", memory: true });
        st.milestones.push({ text: `${c.name} died${op.cause ? ` (${op.cause})` : ""}`, who: [c.id], seq, at: st.time ? formatStoryTime(st.time) : null });
        return;
      }
      case "rename": {
        const c = this.findChar(op.subject ?? "");
        if (!c || !a.to) return this.reject(ctx, "rename whom?");
        c.aliases = uniq([...c.aliases, c.name]);
        c.name = clip(a.to);
        return;
      }
      case "merge": {
        if (ctx.ev.source !== "user") return this.reject(ctx, "only you can merge people");
        const from = this.findChar(op.subject ?? "");
        const into = this.findChar(a.to ?? "");
        if (!from || !into) return this.reject(ctx, "merge whom into whom?");
        if (from.id === into.id) return;
        if (from.isUser) return this.reject(ctx, "your character can't be merged away");
        this.mergeChars(from, into);
        this.push(ctx, { kind: "cast", text: `${from.name} is ${into.name}`, subject: into.name, path: `chars.${into.id}` });
        return;
      }
      case "edit": {
        if (ctx.ev.source !== "user") return this.reject(ctx, "only you can edit fields directly");
        const path = (a.path as (string | number)[]).map(String);
        const err = editPath(st, path, a.value);
        if (err) return this.reject(ctx, err);
        // Whatever was typed, a person keeps the shape the rest of the app reads.
        if (path[0] === "chars" && path[1] && st.chars[path[1]]) repairChar(st.chars[path[1]]!, path[1]);
        // A person removed takes their bonds and ladders with them.
        if (path.length === 2 && path[0] === "chars" && a.value == null) {
          for (const k of Object.keys(st.bonds)) if (k.split(">").includes(path[1]!)) delete st.bonds[k];
          for (const k of Object.keys(st.ladders)) if (k.split(">").includes(path[1]!)) delete st.ladders[k];
        }
        const who = path[0] === "chars" && path[1] ? st.chars[path[1]]?.name : undefined;
        this.push(ctx, { kind: "edit", text: `Edited ${who ? `${who} · ` : ""}${path.slice(who ? 2 : 0).join(" › ") || path.join(" › ")}`, subject: who, path: path.join("."), to: a.value });
        return;
      }
      case "bond": {
        const from = this.person(op.subject, seq);
        const to = this.person(op.object, seq);
        if (!from || !to) return this.reject(ctx, "write bond A>B: axis ±N");
        if (from.id === to.id) return this.reject(ctx, "a bond needs two people");
        if (from.isUser && this.cfg.sealedPersona && this.ai(ctx) && (a.moves as unknown[]).length) return this.reject(ctx, "how your character feels is yours to write");
        if (!this.needCause(ctx, op)) return;
        const key = `${from.id}>${to.id}`;
        const b = (st.bonds[key] ??= { from: from.id, to: to.id, axes: {}, tags: [], history: [] });
        if (this.isLocked(`bonds.${key}`) && this.ai(ctx)) return this.reject(ctx, "locked");
        for (const m of a.moves as { axis: string; delta?: number; set?: number }[]) {
          const axis = AXIS_ALIASES[m.axis.replace(/s$/, "")] ?? AXIS_ALIASES[m.axis];
          if (!axis || !(AXES as readonly string[]).includes(axis)) {
            this.warn(ctx, `unknown axis "${m.axis}"`);
            continue;
          }
          const lo = (BIPOLAR_AXES as readonly string[]).includes(axis) ? -5 : 0;
          const prev = b.axes[axis] ?? 0;
          let next = m.set != null ? m.set : prev + (m.delta ?? 0);
          next = Math.max(lo, Math.min(5, Math.round(next)));
          let delta = next - prev;
          let flag: string | undefined;
          // TRK-11 / ALMANAC §8.2: typical ±1, major ±2, ±3 only for betrayal, rescue or the unforgivable.
          const limit = BIG_CAUSE.test(op.cause ?? "") ? 3 : 2;
          if (this.ai(ctx) && ctx.ev.source !== "init" && Math.abs(delta) > limit) {
            if (this.cfg.limits) {
              flag = `capped from ${delta > 0 ? "+" : ""}${delta}`;
              delta = Math.sign(delta) * limit;
              next = prev + delta;
            } else flag = "big jump";
          }
          if (!delta) continue;
          b.axes[axis] = next;
          b.history.push({ axis, from: prev, to: next, delta, cause: op.cause, seq });
          if (b.history.length > 200) b.history.splice(0, b.history.length - 200);
          const good = axis === "fear" || axis === "resentment" || axis === "rivalry" ? delta < 0 : delta > 0;
          this.push(ctx, {
            kind: "bond",
            text: `${from.name} → ${to.name} · ${cap(axis)} ${delta > 0 ? "+" : ""}${delta}`,
            subject: from.name,
            reason: op.cause,
            path: `bonds.${key}.${axis}`,
            from: prev,
            to: next,
            tone: good ? "up" : "down",
            ...(flag ? { flag } : {}),
          });
        }
        if (a.label && norm(a.label) !== norm(b.label ?? "")) {
          const prev = b.label;
          b.label = clip(a.label);
          this.push(ctx, { kind: "bond", text: `${from.name} → ${to.name}: ${b.label}`, subject: from.name, reason: op.cause, path: `bonds.${key}.label`, from: prev, to: b.label, memory: true });
        }
        for (const t of a.tagsAdd as string[]) if (t && !b.tags.includes(t.toLowerCase())) b.tags.push(t.toLowerCase());
        b.tags = b.tags.filter((t) => !(a.tagsRemove as string[]).includes(t));
        return;
      }
      case "ladder": {
        const from = this.person(op.subject, seq);
        const to = this.person(op.object, seq);
        if (!from || !to || from.id === to.id) return this.reject(ctx, "write ladder A>B: tier N");
        if (from.isUser && this.ai(ctx)) return this.reject(ctx, "your character's side of a romance changes only through your words");
        let tier: number | undefined = a.tier;
        if (tier == null && a.word) {
          const i = LADDER.findIndex((n) => n.toLowerCase() === a.word);
          tier = i >= 0 ? i : LADDER_WORDS[a.word as string];
        }
        if (tier == null || tier < 0 || tier > 7) return this.reject(ctx, `a rung 0–7 (${LADDER.join(", ")})`);
        const key = `${from.id}>${to.id}`;
        const cur = st.ladders[key];
        const prev = cur?.tier ?? (this.cfg.romance === "established" ? 7 : 0);
        if (tier === prev) return;
        const up = tier > prev;
        // A romance starts from something romantic: attraction on the bond, or a romantic cause. Shock or tension isn't one.
        if (!cur && up && this.ai(ctx) && ctx.ev.source !== "init" && this.cfg.romance !== "established" && !((st.bonds[key]?.axes.attraction ?? 0) > 0) && !ROMANCE_CAUSE.test(op.cause ?? ""))
          return this.reject(ctx, "a romance starts from attraction or a romantic moment; tension between friends is a bond");
        if (this.ai(ctx) && up) {
          const pace = this.cfg.romance;
          if (pace === "off") return this.reject(ctx, "romance is off in this story");
          const scenesSince = cur ? st.sceneNo - cur.scene : 99;
          const maxStep = pace === "fast" ? 2 : 1;
          if (tier - prev > maxStep) {
            this.warn(ctx, `${pace} pace: one rung at a time`);
            tier = prev + maxStep;
          }
          if (pace === "slow" && prev >= 1 && scenesSince < 2) return this.reject(ctx, "slow burn: a step up needs two separate scenes of returned signals");
          if (pace === "measured" && prev >= 1 && scenesSince < 1) return this.reject(ctx, "measured pace: one step per scene");
        }
        // A rung is lost to betrayal, neglect, cruelty or a revealed lie, never to a re-read of the moment.
        if (!up && this.ai(ctx) && !DOWN_CAUSE.test(op.cause ?? ""))
          return this.reject(ctx, LADDER_WARM.test(op.cause ?? "") ? "a warm beat doesn't lower the ladder" : `the ladder is at ${LADDER[prev]} (${prev}/7); it only drops for a betrayal, neglect, cruelty or a revealed lie`);
        const l = (st.ladders[key] ??= { from: from.id, to: to.id, tier: prev, seq, scene: st.sceneNo, history: [] });
        l.tier = tier;
        l.evidence = op.cause;
        l.seq = seq;
        l.scene = st.sceneNo;
        l.history.push({ tier, evidence: op.cause, seq });
        this.push(ctx, { kind: "romance", text: `${from.name} → ${to.name}: ${LADDER[tier]} (${tier}/7)`, subject: from.name, reason: op.cause, path: `ladders.${key}`, from: LADDER[prev], to: LADDER[tier], tone: up ? "up" : "down", memory: tier >= 5 || !up });
        return;
      }
      case "know": {
        const holders = this.people(op.subject, seq);
        if (!holders.length || !a.fact) return this.reject(ctx, "write know Holder: fact | route · status · truth");
        if (!this.needCause(ctx, op) && !a.route) return;
        const f = this.fact(a.key, a.fact, seq, a.truth);
        const status = (a.status ?? "knows") as KnowStatus;
        const one = holders.length === 1;
        for (const holder of holders) {
          const cur = f.stances[holder.id];
          if (cur?.set && this.ai(ctx)) {
            if (one) return this.reject(ctx, "you set what they know about this");
            continue;
          }
          if (cur && cur.status === status) continue;
          // 2.3: what a flagged leak let out doesn't count as learned while the flag is open.
          const held = /knows|believes|suspects/.test(status) && this.ai(ctx) && ctx.ev.messageId ? this.cfg.held?.find((h) => h.messageId === ctx.ev.messageId && norm(h.who) === norm(holder.name) && overlap(h.text, f.statement) >= 0.4) : undefined;
          if (held) {
            if (one) return this.reject(ctx, `held: the checker flagged this reply for letting it out to ${holder.name}; it counts once you dismiss the flag or fix the sentence`);
            continue;
          }
          f.stances[holder.id] = { status, route: a.route ?? op.cause, seq, ...(ctx.ev.source === "user" ? { set: true } : {}) };
          if (f.secret?.from.includes(holder.id) && /knows|believes|suspects/.test(status)) f.secret.from = f.secret.from.filter((x) => x !== holder.id);
          this.push(ctx, { kind: "knowledge", text: `${holder.name} ${status === "knows" ? "learned" : `now ${status}`}: ${clip(f.statement)}`, subject: holder.name, reason: a.route ?? op.cause, path: `facts.${f.key}.${holder.id}` });
        }
        return;
      }
      case "secret": {
        if (!a.fact && !a.key) return this.reject(ctx, "write secret #key: fact | kept by A · from B");
        const ids = (xs: unknown) => uniq(((xs ?? []) as string[]).flatMap((n) => this.people(n, seq).map((c) => c.id)));
        const named = ((a.from ?? []) as string[]).filter((n) => n.trim());
        const all = named.some((n) => EVERYONE_WORD(norm(personName(n))));
        const fromIds = ids(named.filter((n) => !EVERYONE_WORD(norm(personName(n)))));
        if (named.length && !all && !fromIds.length) return this.reject(ctx, `from whom? "${named.join(", ")}" isn't anyone in the story; name the people`);
        const f = this.fact(a.key, a.fact ?? a.key, seq, "true");
        const keepers = uniq([...(f.secret?.keepers ?? []), ...ids(a.keepers)]);
        const knownTo = ids(a.knownTo).filter((id) => !keepers.includes(id));
        const suspects = ids(a.suspectedBy).filter((id) => !keepers.includes(id) && !knownTo.includes(id));
        for (const id of knownTo) if (!f.stances[id]?.set) f.stances[id] = { status: "knows", route: "known to them", seq };
        for (const id of suspects) if (!f.stances[id]?.set) f.stances[id] = { status: "suspects", route: "suspects it", seq };
        // "from everyone" / "from the public": everyone but the keepers, now and whoever turns up later.
        const everyone = all || Boolean(f.secret?.everyone);
        const wanted = uniq([...fromIds, ...(all ? Object.values(st.chars).filter((c) => !c.isUser).map((c) => c.id) : [])]).filter((id) => !keepers.includes(id) && !knownTo.includes(id) && !suspects.includes(id));
        // Someone who already found out isn't put back in the dark by the secret being written again (only you can).
        const told = (id: string) => /knows|believes|suspects/.test(f.stances[id]?.status ?? "");
        const back = ctx.ev.source === "user" ? [] : wanted.filter(told);
        const from = uniq([...(f.secret?.from ?? []), ...wanted.filter((id) => !back.includes(id))]).filter((id) => !keepers.includes(id));
        f.secret = { keepers, from, ...(everyone ? { everyone: true } : {}) };
        if (back.length) ctx.verdict.reason = `${back.map((x) => this.nameOf(x)).join(", ")} already found out, and still knows`;
        for (const k of keepers) f.stances[k] ??= { status: "knows", route: "keeps it", seq };
        for (const k of from) if (!f.stances[k] || f.stances[k]!.status === "unaware") f.stances[k] = { status: "unaware", route: "kept from them", seq };
        this.push(ctx, { kind: "secret", text: `Secret: ${clip(f.statement)}`, path: `facts.${f.key}`, reason: op.cause });
        return;
      }
      case "reveal": {
        const f = a.key ? st.facts[slug(a.key)] ?? Object.values(st.facts).find((x) => overlap(x.statement, a.key) > 0.6) : undefined;
        if (!f) return this.reject(ctx, "no such secret or fact");
        const to = uniq(((a.to ?? []) as string[]).flatMap((n) => this.people(n, seq).map((c) => c.id)));
        for (const id of to) f.stances[id] = { status: "knows", route: op.cause ?? "revealed", seq };
        if (f.secret) f.secret.from = f.secret.from.filter((x) => !to.includes(x));
        f.revealed.push({ to, seq, how: op.cause });
        this.push(ctx, { kind: "secret", text: `Revealed to ${to.map((x) => this.nameOf(x)).join(", ") || "someone"}: ${clip(f.statement)}`, path: `facts.${f.key}`, reason: op.cause, tone: "warn", memory: true });
        return;
      }
      case "pressure": {
        // E1: drawn by the engine, or set by you; the model never writes them (they're hidden from it as text to play, not to report).
        if (ctx.ev.source !== "engine" && ctx.ev.source !== "user") return this.reject(ctx, "pressures are drawn by Mea, not the ledger");
        const c = this.person(op.subject, seq);
        if (!c || c.isUser) return this.reject(ctx, "whose pressure?");
        const cur = c.pressure;
        if (cur?.locked && ctx.ev.source === "engine" && a.lock !== false) return;
        const stage = (["hidden", "growing", "cracking", "head", "resolved"].includes(a.stage) ? a.stage : undefined) as NonNullable<typeof c.pressure>["stage"] | undefined;
        const text = a.text ? clip(a.text) : cur?.text;
        if (!text) return this.reject(ctx, "write pressure Name: what they carry | stage: hidden");
        const next = {
          text,
          stage: stage ?? (a.text && a.text !== cur?.text ? "hidden" : (cur?.stage ?? "hidden")),
          by: (["deck", "grounded", "you"].includes(a.by) ? a.by : (cur?.by ?? "you")) as "deck" | "grounded" | "you",
          locked: a.lock != null ? Boolean(a.lock) : cur?.locked,
          scene: st.sceneNo,
          seq,
          draws: Number(a.draw) || cur?.draws || 1,
          history: [...(cur?.history ?? [])],
        };
        if (cur && cur.text === next.text && cur.stage === next.stage && cur.locked === next.locked) return;
        next.history.push({ stage: next.stage, ...(next.text !== cur?.text ? { text: next.text } : {}), seq });
        c.pressure = next;
        this.push(ctx, { kind: "pressure", text: next.stage === "resolved" ? `${c.name}'s pressure eases` : !cur || cur.text !== next.text ? `${c.name} carries something` : `${c.name}: pressure ${next.stage}`, path: `chars.${c.id}.pressure`, reason: op.cause, tone: next.stage === "cracking" || next.stage === "head" ? "warn" : undefined });
        return;
      }
      case "expose": {
        // B2: only the engine (rules after each reply) and you move a secret's exposure clock.
        if (ctx.ev.source !== "engine" && ctx.ev.source !== "user") return this.reject(ctx, "exposure is moved by Mea, not the ledger");
        const f = a.key ? (st.facts[slug(a.key)] ?? Object.values(st.facts).find((x) => overlap(x.statement, a.key) > 0.6)) : undefined;
        if (!f) return this.reject(ctx, "no such secret");
        const e = ((st.exposure ??= {})[f.key] ??= { cur: 0, max: 6, history: [], near: {} });
        const prev = e.cur;
        e.cur = Math.max(0, Math.min(e.max, a.cur ?? prev + (a.delta ?? 0)));
        const who = a.who ? this.person(a.who, seq) : undefined;
        if (who && e.cur !== prev) {
          const n = (e.near[who.id] ??= { score: 0, why: [] });
          n.score = Math.max(0, n.score + (e.cur - prev));
          if (e.cur > prev && op.cause) n.why = [...n.why.filter((w) => w !== op.cause), op.cause].slice(-4);
        }
        if (e.cur === prev) return;
        e.history.push({ delta: e.cur - prev, v: e.cur, why: op.cause, who: who?.id, seq });
        this.push(ctx, { kind: "secret", text: `Exposure ${e.cur}/${e.max}: ${clip(f.statement)}`, path: `exposure.${f.key}`, reason: op.cause, from: prev, to: e.cur, tone: e.cur >= e.max ? "warn" : e.cur > prev ? "due" : undefined, memory: e.cur >= e.max });
        return;
      }
      case "item": {
        // Owner first ("item Jackie: silver bracelet", "item Jackie: Lucky Strike → gone") means the thing she has.
        const owner = op.subject && !st.items[slug(clip(op.subject))] ? this.findChar(op.subject) : undefined;
        if (owner) {
          const thing = String(a.from ?? a.to ?? "").replace(/^at\s+/i, "").trim();
          if (!thing || this.findChar(thing)) return this.reject(ctx, "write item Thing: from → to (the thing first, not its owner)");
          const args = a.from ? { ...a, from: owner.name } : { ...a, to: owner.name };
          return this.applyOp({ ...op, subject: thing, args }, ctx);
        }
        const name = clip(op.subject);
        if (!name) return this.reject(ctx, "which item?");
        if (!this.needCause(ctx, op)) return;
        const id = slug(name);
        const it = (st.items[id] ??= { id, name, custody: [], lastSeq: seq });
        if (this.isLocked(`items.${id}`) && this.ai(ctx)) return this.reject(ctx, "locked");
        it.lastSeq = seq;
        if (a.owner) {
          const o = this.findChar(a.owner);
          it.owner = o?.id ?? clip(a.owner);
          return;
        }
        if (a.condition) {
          it.condition = clip(a.condition);
          this.push(ctx, { kind: "item", text: `${name}: ${it.condition}`, path: `items.${id}` });
          return;
        }
        if (a.gone) {
          it.gone = true;
          const was = it.holder;
          it.holder = undefined;
          it.custody.push({ from: was, how: a.gone, seq, ...this.where() });
          // E2: a lost gift is noticed (it goes to memory, and the note tells the giver's scenes).
          const from = it.gift ? this.findChar(it.gift) : undefined;
          this.push(ctx, { kind: "item", text: it.gift ? `${name} (a gift from ${it.gift}): ${a.gone}` : `${name}: ${a.gone}`, path: `items.${id}`, reason: op.cause, tone: "down", ...(from ? { memory: true } : {}) });
          if (from && it.owner && it.owner !== from.id) it.lostGift = seq;
          return;
        }
        const toChar = a.to ? this.findChar(a.to) ?? (looksLikePerson(a.to) ? this.person(a.to, seq) : undefined) : undefined;
        const holder = toChar?.id ?? (a.to ? `place:${clip(a.to)}` : it.holder);
        // G2: a first hand-off says who it came from ("item key: Mira → Joss"), for the object's trail.
        const was = it.holder ?? (a.from ? this.findChar(a.from)?.id : undefined);
        it.gone = false;
        it.holder = holder;
        if (a.where) it.where = clip(a.where);
        let gave: Character | undefined;
        if (a.gift) {
          gave = this.findChar(a.gift);
          const fresh = !it.gift;
          it.gift = gave?.name ?? clip(a.gift);
          if (toChar) it.owner = toChar.id;
          if (!fresh) gave = undefined;
        }
        if (!it.owner && toChar) it.owner = toChar.id;
        it.lostGift = undefined;
        it.custody.push({ from: was, to: holder, how: op.cause, seq, ...this.where() });
        // A jacket handed back is no longer part of the giver's look.
        const giver = was && was !== holder ? st.chars[was] : undefined;
        if (giver?.look && !this.isLocked(`chars.${giver.id}.look`)) {
          const look = lookWithout(giver.look, name);
          if (look !== giver.look) giver.look = look || undefined;
        }
        const nm = (h?: string) => (h ? (h.startsWith("place:") ? h.slice(6) : this.nameOf(h)) : "");
        this.push(ctx, { kind: "item", text: was && was !== holder ? `${name}: ${nm(was)} → ${nm(holder)}` : `${name} → ${nm(holder)}`, path: `items.${id}`, reason: op.cause, from: nm(was), to: nm(holder), memory: Boolean(a.gift) });
        // E2: a gift moves a bond: the one who got it warms to the one who gave it.
        if (gave && toChar && gave.id !== toChar.id) this.applyOp({ op: "bond", subject: toChar.name, object: gave.name, args: { moves: [{ axis: "affection", delta: 1 }] }, cause: `a gift: ${name}`, raw: "" }, ctx);
        return;
      }
      case "room": {
        // E2: whose place this is, and what kind of place.
        const who = this.person(op.subject, seq);
        const path = ((a.path ?? []) as string[]).map((x) => clip(x)).filter(Boolean);
        if (!who || !path.length) return this.reject(ctx, "write room A: Town › Place | room");
        const p = this.placeAt(path) ?? (st.places[slug(path.join(" "))] ??= { id: slug(path.join(" ")), name: path.at(-1)!, path, visits: 0, lastSeq: seq });
        const kind = a.kind ? clip(a.kind) : (p.kind ?? "room");
        if (p.owner === who.id && p.kind === kind) return;
        if (this.isLocked(`places.${p.id}`) && this.ai(ctx)) return this.reject(ctx, "locked");
        p.owner = who.id;
        p.kind = kind;
        this.push(ctx, { kind: "place", text: `${p.name}: ${who.isUser ? this.cfg.userName || "your" : who.name}'s ${kind}`, path: `places.${p.id}`, reason: op.cause });
        return;
      }
      case "keeps": {
        // E2: something of theirs, kept somewhere ("keeps Mira: the ledger @ Lamp room").
        const who = this.person(op.subject, seq);
        const name = clip(a.item);
        if (!who || !name) return this.reject(ctx, "write keeps A: item @ place");
        const id = slug(name);
        const it = (st.items[id] ??= { id, name, custody: [], lastSeq: seq });
        if (this.isLocked(`items.${id}`) && this.ai(ctx)) return this.reject(ctx, "locked");
        const holder = a.place ? `place:${clip(a.place)}` : it.holder;
        if (it.owner === who.id && it.holder === holder && !it.gone) return;
        const was = it.holder;
        it.owner = who.id;
        it.gone = false;
        it.lastSeq = seq;
        if (holder !== was) {
          it.holder = holder;
          it.custody.push({ from: was, to: holder, how: op.cause ?? "kept there", seq, ...this.where() });
        }
        this.push(ctx, { kind: "item", text: `${name}: ${who.isUser ? this.cfg.userName || "yours" : who.name}'s${holder?.startsWith("place:") ? `, kept at ${holder.slice(6)}` : ""}`, path: `items.${id}`, reason: op.cause });
        return;
      }
      case "thread": {
        const title = clip(op.subject ?? a.detail);
        if (!title) return this.reject(ctx, "which thread?");
        const id = this.threadId(title);
        let t = st.threads[id];
        const action = a.action as string;
        if (!t) {
          if (action === "resolve") return this.reject(ctx, "no such open thread");
          t = st.threads[id] = { id, title, status: "open", openedSeq: seq, lastSeq: seq, history: [], kind: a.kind };
          t.history.push({ op: "new", detail: a.detail, seq });
          t.latest = a.detail;
          this.push(ctx, { kind: "thread", text: `New thread: ${title}`, path: `threads.${id}`, reason: a.detail });
          return;
        }
        // A restatement with nothing new isn't progress (ALMANAC 09 §1).
        if (action === "advance" && a.detail && t.latest && overlap(a.detail, t.latest) > 0.8) return;
        t.lastSeq = seq;
        t.history.push({ op: action, detail: a.detail, seq });
        if (t.history.length > 60) t.history.splice(0, t.history.length - 60);
        if (a.detail) t.latest = clip(a.detail);
        if (action === "resolve") t.status = "resolved";
        else if (action === "stall") {
          t.status = "stalled";
          t.blocker = a.blocker ?? a.detail;
        } else t.status = "open";
        if (a.kind) t.kind = a.kind;
        this.push(ctx, {
          kind: "thread",
          text: action === "resolve" ? `Resolved: ${t.title}` : action === "stall" ? `Stalled: ${t.title}` : `${t.title}: ${clip(a.detail ?? action)}`,
          path: `threads.${id}`,
          reason: a.detail,
          tone: action === "resolve" ? "up" : action === "complicate" ? "warn" : undefined,
          memory: action === "resolve",
        });
        return;
      }
      case "owe":
      case "promise": {
        const who = this.person(op.subject, seq);
        const whom = op.object ? this.person(op.object, seq) : undefined;
        if (!who || !a.what) return this.reject(ctx, `write ${op.op} A → B: what | status [due …]`);
        const id = this.obligationId(op.op, who.id, whom?.id, a.what);
        const made = this.now();
        const o = (st.obligations[id] ??= { id, kind: op.op, who: who.id, whom: whom?.id, what: clip(a.what), status: "open", seq, ...(made != null ? { made } : {}) });
        if (a.due) o.due = { minutes: this.when(a.due), text: a.due };
        // E3: a meeting, its window, and how much it matters.
        if (a.meet) o.meet = clip(a.meet);
        if (a.importance) o.importance = a.importance;
        if (a.window) o.window = parseDuration(String(a.window).replace(/^(\d+)(\w)/, "$1 $2")) ?? o.window;
        const status = a.status as typeof o.status | undefined;
        const fresh = o.seq === seq && o.status === "open" && !o.felt;
        if (status && status !== o.status) {
          o.status = status;
          o.auto = ctx.ev.source === "engine";
          this.push(ctx, { kind: op.op, text: `${cap(op.op === "owe" ? "debt" : "promise")} ${status}: ${o.what}`, subject: who.name, path: `obligations.${id}`, reason: op.cause, tone: status === "kept" || status === "paid" ? "up" : status === "broken" ? "down" : "due", memory: status === "broken" || status === "kept" });
          if (op.op === "promise" && whom) this.feelPromise(o, ctx, seq);
        } else if (fresh) this.push(ctx, { kind: op.op, text: `${op.op === "owe" ? `${who.name} owes ${whom?.name ?? "someone"}` : `${who.name} ${o.meet ? `will meet ${whom?.name ?? "someone"} at ${o.meet}` : `promised${whom ? ` ${whom.name}` : ""}`}`}: ${o.what}`, subject: who.name, path: `obligations.${id}`, reason: op.cause });
        this.promiseChecks(ctx);
        return;
      }
      case "deadline": {
        if (!a.title) return this.reject(ctx, "write deadline Title: when");
        const id = slug(a.title);
        const d = (st.deadlines[id] ??= { id, title: clip(a.title), at: null, text: "", done: false, seq });
        if (a.when) {
          d.text = clip(a.when);
          d.at = this.when(a.when);
        }
        if (a.done && !d.done) {
          d.done = true;
          this.push(ctx, { kind: "deadline", text: `Done: ${d.title}`, path: `deadlines.${id}`, tone: "up" });
        } else if (d.seq === seq) this.push(ctx, { kind: "deadline", text: `Deadline: ${d.title}${d.text ? ` (${d.text})` : ""}`, path: `deadlines.${id}`, tone: "due" });
        return;
      }
      case "plant": {
        if (!a.text) return this.reject(ctx, "plant what?");
        const id = slug(a.text);
        if (st.plants[id]) return;
        st.plants[id] = { id, text: clip(a.text), payoff: a.payoff ? clip(a.payoff) : undefined, seq, scene: st.sceneNo };
        this.push(ctx, { kind: "plant", text: `Planted: ${clip(a.text)}`, path: `plants.${id}` });
        return;
      }
      case "payoff": {
        const p = Object.values(st.plants).find((x) => x.paidSeq == null && (slug(a.text) === x.id || overlap(x.text, a.text) >= 0.5));
        if (!p) return this.reject(ctx, "no unpaid plant like that");
        p.paidSeq = seq;
        this.push(ctx, { kind: "plant", text: `Paid off: ${clip(p.text)}`, path: `plants.${p.id}`, reason: a.payoff, tone: "up", memory: true });
        return;
      }
      case "clue": {
        if (!a.text) return this.reject(ctx, "what clue?");
        if (st.clues.some((c) => overlap(c.text, a.text) > 0.8)) return;
        st.clues.push({ id: slug(a.text), text: clip(a.text), pointsTo: a.pointsTo, reliability: a.reliability, seq });
        this.push(ctx, { kind: "clue", text: `Clue: ${clip(a.text)}`, path: `clues.${slug(a.text)}` });
        return;
      }
      case "gauge": {
        const name = clip(op.subject);
        if (!name) return this.reject(ctx, "write gauge Name: 3/6");
        const g = (st.gauges[slug(name)] ??= { name, cur: 0, max: a.max ?? 6, history: [] });
        if (a.max) g.max = a.max;
        const prev = g.cur;
        g.cur = Math.max(0, Math.min(g.max, a.cur ?? prev + (a.delta ?? 0)));
        if (g.cur === prev) return;
        g.cause = op.cause;
        g.history.push({ v: g.cur, seq });
        this.push(ctx, { kind: "gauge", text: `${name} ${g.cur}/${g.max}`, path: `gauges.${slug(name)}`, reason: op.cause, from: prev, to: g.cur, tone: g.cur >= g.max ? "warn" : undefined });
        return;
      }
      case "clockf": {
        const faction = clip(op.subject);
        if (!faction || !a.project) return this.reject(ctx, "write clockf Faction: project +1 (3/6)");
        const existing = Object.values(st.clocks).find((c) => norm(c.faction) === norm(faction) && overlap(c.name, a.project) >= 0.5);
        const id = existing ? `${slug(existing.faction)}:${slug(existing.name)}` : `${slug(faction)}:${slug(a.project)}`;
        const c = (st.clocks[id] ??= { faction, name: clip(a.project), cur: 0, max: a.max ?? 6, history: [] });
        if (a.max) c.max = a.max;
        const prev = c.cur;
        c.cur = Math.max(0, Math.min(c.max, a.cur ?? prev + (a.delta ?? 1)));
        if (c.cur === prev) return;
        c.history.push({ v: c.cur, seq });
        this.push(ctx, { kind: "faction", text: `${faction}: ${c.name} ${c.cur}/${c.max}`, path: `clocks.${id}`, reason: op.cause, tone: c.cur >= c.max ? "warn" : undefined, memory: c.cur >= c.max });
        return;
      }
      case "rep": {
        const who = this.person(op.subject ?? this.cfg.userName, seq);
        const group = clip(op.object);
        if (!who || !group) return this.reject(ctx, "write rep Name @ Group: ±N — deed");
        const id = `${who.id}@${slug(group)}`;
        const r = (st.rep[id] ??= { who: who.id, group, score: 0, tags: [], history: [] });
        const prev = r.score;
        r.score = Math.max(-3, Math.min(3, prev + (a.delta ?? 0)));
        for (const t of a.tags as string[]) if (!r.tags.includes(t)) r.tags.push(t);
        if (r.score === prev && !(a.tags as string[]).length) return;
        r.history.push({ delta: r.score - prev, deed: op.cause, seq });
        this.push(ctx, { kind: "reputation", text: `${who.name} @ ${group} ${r.score > prev ? "+" : ""}${r.score - prev}`, path: `rep.${id}`, reason: op.cause, tone: r.score > prev ? "up" : "down" });
        return;
      }
      case "event":
      case "plan": {
        if (!a.title) return this.reject(ctx, `write ${op.op} Title: when | kind | who: …`);
        const id = slug(a.title);
        const kind = (a.kind ?? (/birthday/i.test(a.title) ? "birthday" : /anniversar/i.test(a.title) ? "anniversary" : op.op === "plan" ? "plan" : "recurring")) as "plan";
        const e = (st.calendar[id] ??= { id, title: clip(a.title), kind, when: "", at: null, who: [], seq });
        if (a.when) {
          e.when = clip(a.when);
          e.at = kind === "plan" || kind === "appointment" ? this.when(a.when) : null;
        }
        e.who = uniq([...e.who, ...((a.who as string[]) ?? []).map((n) => this.findChar(n)?.id ?? n)]);
        if (a.done) e.done = true;
        if (e.seq === seq) this.push(ctx, { kind: "calendar", text: `${cap(kind)}: ${e.title}${e.when ? ` (${e.when})` : ""}`, path: `calendar.${id}` });
        return;
      }
      case "motif": {
        if (!a.text) return this.reject(ctx, "what running bit?");
        const id = slug(a.text);
        const existing = st.motifs[id] ?? Object.values(st.motifs).find((m) => overlap(m.text, a.text) >= 0.7);
        if (existing) {
          existing.uses++;
          existing.lastSeq = seq;
          return;
        }
        st.motifs[id] = { id, text: clip(a.text), who: a.who, firstSeq: seq, lastSeq: seq, uses: 1 };
        this.push(ctx, { kind: "motif", text: `Running bit: ${clip(a.text)}`, path: `motifs.${id}` });
        return;
      }
      case "beat": {
        if (!a.text) return this.reject(ctx, "what happened?");
        const beats = (st.beats ??= []);
        // One beat per reply: a second line for the same reply adds to it.
        const last = beats.at(-1);
        const b = last?.seq === seq ? last : { text: "", seq, minutes: null, place: [], who: [] };
        if (b !== last) beats.push(b);
        b.text = b.text ? `${b.text}; ${cut(a.text, 240)}` : cut(a.text, 240);
        this.stamp(b);
        if (beats.length > MAX_BEATS) beats.splice(0, beats.length - MAX_BEATS);
        return;
      }
      case "milestone": {
        if (!a.text) return this.reject(ctx, "what milestone?");
        if (st.milestones.some((m) => overlap(m.text, a.text) > 0.8)) return;
        const who = (a.who ? String(a.who).split(/\s*(?:&|,|\band\b)\s*/) : []).map((n: string) => this.findChar(n)?.id ?? n);
        st.milestones.push({ text: clip(a.text), who, seq, at: st.time ? formatStoryTime(st.time) : null });
        this.push(ctx, { kind: "milestone", text: `Milestone: ${clip(a.text)}`, path: `milestones.${slug(a.text)}`, memory: true, tone: "up" });
        return;
      }
      case "lock": {
        if (ctx.ev.source !== "user") return this.reject(ctx, "only you can lock fields");
        const path = String(a.path ?? "").toLowerCase().trim();
        if (!path) return;
        st.locks = a.on ? uniq([...st.locks, path]) : st.locks.filter((l) => l !== path);
        return;
      }
      case "set":
      case "unset": {
        const path = String(a.path ?? "").trim();
        const res = applyPatch(st.custom, { changes: [{ path, op: "set", value: op.op === "unset" ? null : a.value, reason: op.cause }] }, {
          templates: this.cfg.templates,
          locks: st.locks,
          source: ctx.ev.source === "user" ? "user" : ctx.ev.source === "init" ? "init" : ctx.ev.source === "timeskip" ? "timeskip" : "ai",
          limits: this.cfg.limits,
          seq,
        });
        if (res.rejected.length) return this.reject(ctx, res.rejected[0]!.why);
        st.custom = res.state;
        for (const c of res.changes) this.push(ctx, fromPatch(c));
        return;
      }
      case "sim":
        applySim(st.sim, op.args as SimOp, seq);
        return;
    }
  }

  fact(key: string | undefined, statement: string, seq: number, truth?: string) {
    const st = this.state;
    const facts = Object.values(st.facts);
    // Said again without its key, it's the same fact: a secret first (at the reveal's 0.6), then anything close.
    const k = key
      ? slug(key)
      : (facts.find((f) => f.secret && overlap(f.statement, statement) >= 0.6)?.key ?? facts.find((f) => overlap(f.statement, statement) >= 0.75)?.key ?? slug(statement));
    // A #key given to a fact first written without one takes it over, stances and all.
    if (key && !st.facts[k]) {
      const old = facts.find((f) => !f.secret && f.key === slug(f.statement) && overlap(f.statement, statement) >= 0.75);
      if (old) {
        delete st.facts[old.key];
        st.facts[k] = { ...old, key: k };
      }
    }
    const f = (st.facts[k] ??= { key: k, statement: clip(statement), truth: (truth as Truth) ?? "true", stances: {}, revealed: [], firstSeq: seq, lastSeq: seq });
    f.lastSeq = seq;
    if (truth) f.truth = truth as Truth;
    return f;
  }

  /** Folds one person into another (the same person written two ways): every bond, item, secret and promise follows. */
  mergeChars(from: Character, into: Character) {
    const st = this.state;
    const swap = (id: string | undefined) => (id === from.id ? into.id : id);
    const newer = from.lastSeq > into.lastSeq;
    into.aliases = uniq([...into.aliases, ...from.aliases, from.name]).filter((x) => norm(x) !== norm(into.name));
    into.firstSeq = Math.min(into.firstSeq, from.firstSeq);
    into.lastSeq = Math.max(into.lastSeq, from.lastSeq);
    into.isMain ||= from.isMain;
    into.dead ||= from.dead;
    // What changes scene to scene comes from whoever was seen last; the rest fills gaps.
    for (const k of ["tier", "activity", "place", "mood", "look", "thoughts"] as const) {
      if (from[k] != null && (newer || into[k] == null)) (into as unknown as Record<string, unknown>)[k] = from[k];
    }
    for (const [k, v] of Object.entries(from.meters)) if (into.meters[k as Meter] == null) into.meters[k as Meter] = v;
    into.drives = { ...from.drives, ...into.drives };
    if (from.mask) into.mask = { ...from.mask, ...into.mask };
    into.flags = uniq([...into.flags, ...from.flags]);
    for (const i of from.injuries) if (!into.injuries.some((x) => norm(x.where) === norm(i.where))) into.injuries.push(i);
    for (const c of from.conditions) if (!into.conditions.some((x) => x.kind === c.kind)) into.conditions.push(c);
    for (const t of from.traits) {
      const clash = into.traits.find((x) => (t.kind !== "other" ? x.kind === t.kind : norm(x.text) === norm(t.text)));
      if (!clash) into.traits.push(t);
      else if (clash.by === "model" && t.by !== "model") into.traits[into.traits.indexOf(clash)] = t;
    }
    into.journal = [...into.journal, ...from.journal].sort((x, y) => x.seq - y.seq).slice(-40);
    delete st.chars[from.id];
    // Bonds and ladders are keyed by both ends.
    for (const table of [st.bonds, st.ladders] as Record<string, Bond | Ladder>[]) {
      for (const [k, v] of Object.entries(table)) {
        if (v.from !== from.id && v.to !== from.id) continue;
        delete table[k];
        v.from = swap(v.from)!;
        v.to = swap(v.to)!;
        if (v.from === v.to) continue;
        const key = `${v.from}>${v.to}`;
        const cur = table[key];
        if (!cur) table[key] = v;
        else if ("axes" in cur && "axes" in v) {
          cur.axes = { ...v.axes, ...cur.axes };
          cur.tags = uniq([...cur.tags, ...v.tags]);
          cur.label ??= v.label;
          cur.history = [...v.history, ...cur.history].sort((x, y) => x.seq - y.seq);
        } else if ("tier" in cur && "tier" in v && v.seq > cur.seq) table[key] = v;
      }
    }
    for (const it of Object.values(st.items)) {
      it.holder = swap(it.holder);
      it.owner = swap(it.owner);
      for (const c of it.custody) {
        c.from = swap(c.from);
        c.to = swap(c.to);
      }
    }
    for (const f of Object.values(st.facts)) {
      const s = f.stances[from.id];
      if (s) {
        if (!f.stances[into.id] || f.stances[into.id]!.seq < s.seq) f.stances[into.id] = s;
        delete f.stances[from.id];
      }
      if (f.secret) {
        const keepers = uniq(f.secret.keepers.map((x) => swap(x)!));
        f.secret = { ...f.secret, keepers, from: uniq(f.secret.from.map((x) => swap(x)!)).filter((x) => !keepers.includes(x)) };
        // One of the keepers all along: the stance "kept from them" the other name had doesn't stick.
        if (keepers.includes(into.id) && f.stances[into.id]?.status === "unaware") f.stances[into.id] = { status: "knows", route: "keeps it", seq: f.stances[into.id]!.seq };
      }
      for (const r of f.revealed) r.to = uniq(r.to.map((x) => swap(x)!));
    }
    for (const o of Object.values(st.obligations)) {
      o.who = swap(o.who)!;
      o.whom = swap(o.whom);
    }
    for (const [k, r] of Object.entries(st.rep)) {
      if (r.who !== from.id) continue;
      delete st.rep[k];
      r.who = into.id;
      st.rep[`${into.id}@${slug(r.group)}`] ??= r;
    }
    for (const e of Object.values(st.calendar)) e.who = uniq(e.who.map((x) => swap(x)!));
    for (const m of st.milestones) m.who = uniq(m.who.map((x) => swap(x)!));
    for (const b of st.beats ?? []) b.who = uniq(b.who.map((x) => swap(x)!));
    st.locks = st.locks.map((l) => l.replace(`chars.${from.id}`, `chars.${into.id}`).replace(new RegExp(`(^|[.>])${from.id}(?=$|[.>])`, "g"), `$1${into.id}`));
  }

  threadId(title: string) {
    const st = this.state;
    const id = slug(title);
    if (st.threads[id]) return id;
    const close = Object.values(st.threads).find((t) => t.status !== "resolved" && (overlap(t.title, title) >= 0.6 || slug(t.title).startsWith(id) || id.startsWith(slug(t.title))));
    return close?.id ?? id;
  }

  obligationId(kind: string, who: string, whom: string | undefined, what: string) {
    const own = `${kind}:${who}>${whom ?? "-"}:${slug(what)}`;
    const close = Object.values(this.state.obligations).find((o) => o.kind === kind && o.who === who && o.whom === whom && overlap(o.what, what) >= 0.5);
    if (close || this.state.obligations[own]) return close?.id ?? own;
    // The same promise said again to someone else: "tell Dawn about the jealousy question at dinner"
    // to Gabriel (#467), then "the jealousy/Spike story at dinner" to Dawn (#501). One record, or
    // one is kept while the other breaks.
    const again = Object.values(this.state.obligations).find((o) => o.kind === kind && o.who === who && (o.status === "open" || o.status === "due") && restated(o.what, o.whom ? this.nameOf(o.whom) : "", what, whom ? this.nameOf(whom) : ""));
    return again?.id ?? own;
  }
}

const LADDER_WORDS: Record<string, number> = {
  stranger: 0, strangers: 0, aware: 1, noticed: 1, interested: 2, curious: 2, drawn: 2, charged: 3, tension: 3, spark: 3, tested: 4, spoken: 5,
  confessed: 5, declared: 5, together: 6, committed: 6, couple: 6, lovers: 6, dating: 6, established: 7, settled: 7, married: 7,
};
const LADDER_WARM = /\b(kiss\w*|hug\w*|smil\w*|laugh\w*|held|hold\w*|touch\w*|tender\w*|warm\w*|close(?:r)?|confess\w*)\b/i;

function clamp(v: unknown, lo: number, hi: number): number | undefined {
  const n = typeof v === "number" ? v : v == null ? undefined : Number(v);
  return n == null || !Number.isFinite(n) ? undefined : Math.max(lo, Math.min(hi, n));
}
const uniq = <T>(xs: T[]) => [...new Set(xs)];

function repairChar(c: Character, id: string) {
  c.id = id;
  c.name = typeof c.name === "string" && c.name.trim() ? c.name : id;
  for (const k of ["aliases", "flags", "injuries", "conditions", "traits", "journal"] as const) if (!Array.isArray(c[k])) (c as unknown as Record<string, unknown>)[k] = [];
  for (const k of ["meters", "drives"] as const) if (!c[k] || typeof c[k] !== "object" || Array.isArray(c[k])) (c as unknown as Record<string, unknown>)[k] = {};
  c.traits = c.traits.filter((t) => t && typeof t.text === "string").map((t) => ({ ...t, kind: t.kind ?? traitKind(t.text), by: t.by ?? "user", seq: t.seq ?? 0 }));
  if (c.tier && !["spot", "peri", "off"].includes(c.tier)) c.tier = "spot";
  c.firstSeq = Number(c.firstSeq) || 0;
  c.lastSeq = Number(c.lastSeq) || 0;
  c.stamina ||= "ordinary";
  c.isUser = Boolean(c.isUser);
  c.isMain = Boolean(c.isMain);
}

/** Sets (or, with null, removes) any field of the world by path; parents are made as needed. Returns why not. */
export function editPath(root: object, path: string[], value: unknown): string | null {
  if (path.some((k) => k === "__proto__" || k === "constructor" || k === "prototype")) return "not a field";
  if (["sim", "lastSeq"].includes(path[0]!)) return "that part isn't editable";
  let node = root as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]!;
    let next = node[k];
    if (next == null || typeof next !== "object") {
      if (value == null) return null; // removing something already gone
      next = /^\d+$/.test(path[i + 1]!) ? [] : {};
      node[k] = next;
    }
    node = next as Record<string, unknown>;
  }
  const last = path.at(-1)!;
  if (value == null) {
    if (Array.isArray(node) && /^\d+$/.test(last)) node.splice(Number(last), 1);
    else delete node[last];
  } else node[last] = value;
  return null;
}
const looksLikePerson = (s: string) => /^[A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){0,2}$/.test(s.trim()) && !/\b(table|floor|bag|box|drawer|shelf|room|house|car|desk|chest|pocket|safe|trunk|bed)\b/i.test(s);

function fromPatch(c: PatchChange): Omit<Change, "source"> {
  const fmt = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v == null || v === "" ? "–" : String(v));
  const text =
    c.kind === "row_added" ? `${c.label} added` : c.kind === "row_removed" ? `${c.label} removed` : c.delta != null ? `${c.label} ${c.delta > 0 ? "+" : ""}${c.delta}` : c.kind === "add" ? `${c.label} +${fmt(c.to)}` : c.kind === "remove" ? `${c.label} −${fmt(c.to)}` : `${c.label}: ${fmt(c.to)}`;
  return { kind: "custom", text, subject: c.row, reason: c.reason, path: `custom.${c.path}`, from: c.from, to: c.to, flag: c.limited ? `capped from ${fmt(c.limited.requested)}` : c.flag, memory: c.memory, tone: c.delta != null ? (c.delta > 0 ? "up" : "down") : undefined };
}

/** Folds events in order (TRK-04): the state as of the last event given. */
export function foldEvents(events: TrackerEvent[], cfg: FoldConfig): FoldResult {
  const f = new Folder(cfg);
  for (const ev of events) f.apply(ev);
  return { state: f.state, changes: f.changes, verdicts: f.verdicts };
}

export { detectStamina };
