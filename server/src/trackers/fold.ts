import { applySim } from "../sim/fold";
import type { SimOp } from "../sim/types";
import { formatStoryTime, parseDuration, parseStoryTime, shortStoryTime } from "./clock";
import { addCondition, conditionsIn, detectStamina, driftCharacter, type DriftNote, endsCondition, SEVERITY, severityOf } from "./drift";
import { applyPatch, type Change as PatchChange } from "./patch";
import type { Template } from "./schema";
import {
  AXES,
  type Axis,
  BIPOLAR_AXES,
  type Change,
  type Character,
  emptyWorld,
  type EventSource,
  type KnowStatus,
  LADDER,
  METERS,
  type Meter,
  type Op,
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
}

export interface FoldResult {
  state: WorldState;
  /** Changes per message id (TRK-07). */
  changes: Record<string, Change[]>;
  verdicts: Record<string, Verdict>;
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
const clip = (s: string | undefined, n = 300) => (s ?? "").trim().slice(0, n);

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
  safety: "comfort", attraction: "attraction", desire: "attraction", fear: "fear", resentment: "resentment", resent: "resentment", anger: "resentment",
  obligation: "obligation", debt: "obligation", rivalry: "rivalry", rival: "rivalry", jealousy: "rivalry",
};
const BIG_CAUSE = /\b(betray\w*|rescue\w*|saved?\b|saving|unforgiv\w*|life|died|death|confess\w*|attack\w*|abandon\w*)\b/i;
const DOWN_CAUSE = /\b(betray\w*|lie|lied|neglect\w*|abandon\w*|broke|broken|cheat\w*|hurt|rejected|refus\w*)\b/i;

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

  /** Finds a character by name, alias, {{user}}/{{char}}, first name or a one-letter typo. */
  findChar(name: string): Character | undefined {
    const n = norm(name);
    if (!n) return undefined;
    const chars = Object.values(this.state.chars);
    if (/^(\{\{user\}\}|user|you|your character|me|i)$/.test(n)) return chars.find((c) => c.isUser);
    if (/^(\{\{char\}\}|char)$/.test(n)) return chars.find((c) => c.isMain);
    const exact = chars.find((c) => c.id === slug(n) || norm(c.name) === n || c.aliases.some((a) => norm(a) === n));
    if (exact) return exact;
    const first = chars.filter((c) => norm(c.name).split(" ")[0] === n || n.split(" ")[0] === norm(c.name));
    if (first.length === 1) return first[0];
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
    const clean = name.replace(/#\d+.*$/, "").replace(/[“”"]/g, "").trim();
    const id = opts.isUser ? "user" : slug(clean);
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
    return c;
  }

  /** A person named in an op: resolves or creates (never for names that look like groups or places). */
  person(name: string | undefined, seq: number): Character | undefined {
    if (!name?.trim()) return undefined;
    return this.findChar(name) ?? this.ensureChar(name, seq);
  }

  nameOf(id: string) {
    return this.state.chars[id]?.name ?? id;
  }

  now(): number | null {
    return this.state.time?.minutes ?? null;
  }

  // ---------- applying ----------

  apply(ev: TrackerEvent) {
    const ctx: Ctx = { cfg: this.cfg, changes: [], verdict: { raw: ev.op.raw, ok: true }, ev, notes: [] };
    try {
      this.applyOp(ev.op, ctx);
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
    ctx.changes.push({ ...c, source: ctx.ev.source });
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
    const from = this.state.time?.minutes ?? null;
    this.state.time = { minutes: to, form };
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

  private newScene(seq: number) {
    this.state.sceneNo++;
    this.state.sceneStartSeq = seq;
    this.state.sceneTitle = undefined;
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

  /** "Day 4 06:00", "tomorrow", "tonight", "+2h", "in 3 days" → story minutes. */
  private when(text: string | undefined): number | null {
    if (!text) return null;
    const t = text.trim().toLowerCase();
    const abs = parseStoryTime(text.replace(/^(?:at|on|by)\s+/i, ""));
    if (abs) return abs.minutes;
    const now = this.now();
    if (now == null) return null;
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
    return plain != null ? (plain < now ? plain + 1440 : plain) : null;
  }

  applyOp(op: Op, ctx: Ctx) {
    const st = this.state;
    const seq = ctx.ev.seq;
    const a = op.args;
    switch (op.op) {
      case "clock": {
        if (this.isLocked("clock") && this.ai(ctx)) return this.reject(ctx, "the clock is locked");
        const now = this.now();
        if (a.plus != null) {
          if (now == null) return this.reject(ctx, "no time set yet to move from");
          let plus = a.plus as number;
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
        if (now != null && t.minutes < now && !a.flashback && this.ai(ctx) && ctx.ev.source !== "timeskip")
          return this.reject(ctx, "story time can't go backwards (write flashback if it's one)");
        if (now != null && t.minutes - now > 7 * 1440 && this.ai(ctx) && ctx.ev.source !== "timeskip" && ctx.ev.source !== "init") this.warn(ctx, "a jump of more than a week");
        return this.moveClock(t.minutes, t.form, ctx, a.flashback ? "flashback" : undefined);
      }
      case "wx": {
        if (!a.to) return this.reject(ctx, "no weather given");
        const prev = st.weather?.now;
        if (prev && norm(prev) === norm(a.to)) return;
        st.weather = { now: clip(a.to, 80), prev, seq };
        this.push(ctx, { kind: "weather", text: prev ? `${prev} → ${a.to}` : a.to, path: "weather", from: prev, to: a.to });
        return;
      }
      case "at": {
        const path = (a.path as string[]).map((s) => clip(s, 60)).filter(Boolean);
        if (!path.length) return this.reject(ctx, "no place given");
        if (this.isLocked("place") && this.ai(ctx)) return this.reject(ctx, "the place is locked");
        const before = st.place;
        if (before.join(" › ").toLowerCase() === path.join(" › ").toLowerCase()) return;
        st.place = path;
        const id = slug(path.join(" "));
        const p = (st.places[id] ??= { id, name: path.at(-1)!, path, visits: 0, lastSeq: seq });
        p.visits++;
        p.lastSeq = seq;
        // A move to a different building or further starts a new scene.
        const common = before.findIndex((x, i) => norm(x) !== norm(path[i] ?? ""));
        const moved = before.length > 0 && (common < 0 ? before.length !== path.length : common < Math.max(1, path.length - 1));
        if (moved) this.newScene(seq);
        for (const c of Object.values(st.chars)) if (c.tier === "spot" || c.tier === "peri") c.place = path.join(" › ");
        this.push(ctx, { kind: "place", text: before.length ? `${before.at(-1)} → ${path.at(-1)}` : path.join(" › "), path: "place", from: before.join(" › "), to: path.join(" › "), ...(moved ? { newScene: true } : {}) });
        return;
      }
      case "scene": {
        if (a.to && norm(a.to) !== norm(st.sceneTitle ?? "")) {
          const fresh = Boolean(st.sceneTitle);
          if (fresh) this.newScene(seq);
          st.sceneTitle = clip(a.to, 80);
          // newScene marks a real change of scene (not the first title), which memory treats as a break.
          this.push(ctx, { kind: "scene", text: `Scene: ${st.sceneTitle}`, path: "scene", ...(fresh ? { newScene: true } : {}) });
        }
        return;
      }
      case "mode":
        st.mode = clip(a.to, 30).toLowerCase();
        return;
      case "cast": {
        for (const it of a.list as { name: string; tier: string; note?: string }[]) {
          const c = this.person(it.name, seq);
          if (!c) continue;
          if (c.dead && /spot|peri|arrive/.test(it.tier)) {
            this.warn(ctx, `${c.name} is dead`);
            continue;
          }
          const was = c.tier;
          const tier = /^(left|leave|leaves|off|away|gone|exit\w*)$/.test(it.tier) ? "off" : /^peri/.test(it.tier) ? "peri" : "spot";
          c.tier = tier;
          c.activity = it.note ? clip(it.note.replace(/^(→|←)\s*/, ""), 120) : tier === "off" ? undefined : c.activity;
          if (tier !== "off") {
            c.place = st.place.join(" › ") || c.place;
            for (const k of ["hunger", "thirst", "fatigue"] as const) if (c.meters[k] == null && !c.isUser) c.meters[k] = 1;
            c.driftAt ??= this.now();
          } else if (it.note && /→/.test(it.note)) c.place = clip(it.note.replace(/^.*→\s*/, ""), 120);
          if (was !== tier) {
            if (tier === "off" && was) this.push(ctx, { kind: "cast", text: `${c.name} left${c.activity ? "" : ""}`, subject: c.name, path: `chars.${c.id}.tier` });
            else if (tier !== "off" && (was === "off" || !was) && !c.isUser && c.firstSeq !== seq) this.push(ctx, { kind: "cast", text: `${c.name} arrived`, subject: c.name, path: `chars.${c.id}.tier` });
            else if (tier !== "off" && !was && !c.isUser) this.push(ctx, { kind: "cast", text: `${c.name} appears`, subject: c.name, path: `chars.${c.id}.tier` });
          }
          c.lastSeq = seq;
        }
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
        c.mood = { name: clip(a.to, 60), v: clamp(a.v, -3, 3), a: clamp(a.a, 0, 5), d: clamp(a.d, -3, 3), prev, seq };
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
          const where = clip(inj.where, 60);
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
            c.flags = uniq([...c.flags, clip(f, 60)]).slice(-12);
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
        c.look = clip(a.to, 240);
        this.push(ctx, { kind: "look", text: `${c.name}: ${clip(a.to, 60)}`, subject: c.name, path: `chars.${c.id}.look` });
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
          c.traits.push({ kind, text: clip(text, 120), by, seq });
          this.push(ctx, { kind: "trait", text: `${c.name}: ${clip(text, 60)}`, subject: c.name, path: `chars.${c.id}.traits.${kind}`, from: cur?.text, to: text });
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
          (target as Record<string, string>)[k] = clip(a[k], 160);
          any = true;
          if (op.op === "mask" && k === "felt") this.push(ctx, { kind: "mask", text: `${c.name} hides: ${clip(a[k], 60)}`, subject: c.name, path: `chars.${c.id}.mask`, to: a[k] });
          if (op.op === "drive" && k === "want") this.push(ctx, { kind: "drive", text: `${c.name} wants: ${clip(a[k], 60)}`, subject: c.name, path: `chars.${c.id}.drives.want` });
        }
        if (!any && !keys.some((k) => a[k])) return this.reject(ctx, `write ${keys.join(": / ")}:`);
        return;
      }
      case "think": {
        const c = this.person(op.subject, seq);
        if (!c || !a.text) return this.reject(ctx, "whose thoughts?");
        if (c.isUser && this.cfg.sealedPersona && this.ai(ctx)) return this.reject(ctx, "your character's inner life is yours to write");
        c.thoughts = { text: clip(a.text, 400), seq };
        // A private change: the thoughts drawer under the reply reads it; the chips never show it.
        this.push(ctx, { kind: "thought", text: `${c.name} thinks`, subject: c.name, path: `chars.${c.id}.thoughts`, to: c.thoughts.text });
        return;
      }
      case "journal": {
        const c = this.person(op.subject, seq);
        if (!c || !a.text) return this.reject(ctx, "whose journal?");
        if (c.isUser && this.cfg.sealedPersona && this.ai(ctx)) return this.reject(ctx, "your character's inner life is yours to write");
        c.journal.push({ text: clip(a.text, 400), seq, at: st.time ? formatStoryTime(st.time) : null });
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
        c.name = clip(a.to, 60);
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
          b.label = clip(a.label, 60);
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
        if (!up && this.ai(ctx) && !DOWN_CAUSE.test(op.cause ?? "") && LADDER_WARM.test(op.cause ?? "")) return this.reject(ctx, "a warm beat doesn't lower the ladder");
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
        const holder = this.person(op.subject, seq);
        if (!holder || !a.fact) return this.reject(ctx, "write know Holder: fact | route · status · truth");
        if (!this.needCause(ctx, op) && !a.route) return;
        const f = this.fact(a.key, a.fact, seq, a.truth);
        const status = (a.status ?? "knows") as KnowStatus;
        const cur = f.stances[holder.id];
        if (cur?.set && this.ai(ctx)) return this.reject(ctx, "you set what they know about this");
        if (cur && cur.status === status) return;
        f.stances[holder.id] = { status, route: a.route ?? op.cause, seq, ...(ctx.ev.source === "user" ? { set: true } : {}) };
        if (f.secret?.from.includes(holder.id) && /knows|believes|suspects/.test(status)) f.secret.from = f.secret.from.filter((x) => x !== holder.id);
        this.push(ctx, { kind: "knowledge", text: `${holder.name} ${status === "knows" ? "learned" : `now ${status}`}: ${clip(f.statement, 70)}`, subject: holder.name, reason: a.route ?? op.cause, path: `facts.${f.key}.${holder.id}` });
        return;
      }
      case "secret": {
        if (!a.fact && !a.key) return this.reject(ctx, "write secret #key: fact | kept by A · from B");
        const f = this.fact(a.key, a.fact ?? a.key, seq, "true");
        const keepers = ((a.keepers ?? []) as string[]).map((n) => this.person(n, seq)?.id).filter(Boolean) as string[];
        const from = ((a.from ?? []) as string[]).map((n) => this.person(n, seq)?.id).filter(Boolean) as string[];
        f.secret = { keepers: uniq([...(f.secret?.keepers ?? []), ...keepers]), from: uniq([...(f.secret?.from ?? []), ...from]) };
        for (const k of keepers) f.stances[k] ??= { status: "knows", route: "keeps it", seq };
        for (const k of from) if (!f.stances[k] || f.stances[k]!.status === "unaware") f.stances[k] = { status: "unaware", route: "kept from them", seq };
        this.push(ctx, { kind: "secret", text: `Secret: ${clip(f.statement, 60)}`, path: `facts.${f.key}`, reason: op.cause });
        return;
      }
      case "reveal": {
        const f = a.key ? st.facts[slug(a.key)] ?? Object.values(st.facts).find((x) => overlap(x.statement, a.key) > 0.6) : undefined;
        if (!f) return this.reject(ctx, "no such secret or fact");
        const to = ((a.to ?? []) as string[]).map((n) => this.person(n, seq)?.id).filter(Boolean) as string[];
        for (const id of to) f.stances[id] = { status: "knows", route: op.cause ?? "revealed", seq };
        if (f.secret) f.secret.from = f.secret.from.filter((x) => !to.includes(x));
        f.revealed.push({ to, seq, how: op.cause });
        this.push(ctx, { kind: "secret", text: `Revealed to ${to.map((x) => this.nameOf(x)).join(", ") || "someone"}: ${clip(f.statement, 60)}`, path: `facts.${f.key}`, reason: op.cause, tone: "warn", memory: true });
        return;
      }
      case "item": {
        const name = clip(op.subject, 80);
        if (!name) return this.reject(ctx, "which item?");
        if (!this.needCause(ctx, op)) return;
        const id = slug(name);
        const it = (st.items[id] ??= { id, name, custody: [], lastSeq: seq });
        if (this.isLocked(`items.${id}`) && this.ai(ctx)) return this.reject(ctx, "locked");
        it.lastSeq = seq;
        if (a.owner) {
          const o = this.findChar(a.owner);
          it.owner = o?.id ?? clip(a.owner, 60);
          return;
        }
        if (a.condition) {
          it.condition = clip(a.condition, 80);
          this.push(ctx, { kind: "item", text: `${name}: ${it.condition}`, path: `items.${id}` });
          return;
        }
        if (a.gone) {
          it.gone = true;
          const was = it.holder;
          it.holder = undefined;
          it.custody.push({ from: was, how: a.gone, seq });
          this.push(ctx, { kind: "item", text: `${name}: ${a.gone}`, path: `items.${id}`, reason: op.cause, tone: "down" });
          return;
        }
        const toChar = a.to ? this.findChar(a.to) ?? (looksLikePerson(a.to) ? this.person(a.to, seq) : undefined) : undefined;
        const holder = toChar?.id ?? (a.to ? `place:${clip(a.to, 80)}` : it.holder);
        const was = it.holder;
        it.gone = false;
        it.holder = holder;
        if (a.where) it.where = clip(a.where, 60);
        if (a.gift) {
          it.gift = this.findChar(a.gift)?.name ?? clip(a.gift, 60);
          if (toChar) it.owner = toChar.id;
        }
        if (!it.owner && toChar) it.owner = toChar.id;
        it.custody.push({ from: was, to: holder, how: op.cause, seq });
        const nm = (h?: string) => (h ? (h.startsWith("place:") ? h.slice(6) : this.nameOf(h)) : "");
        this.push(ctx, { kind: "item", text: was && was !== holder ? `${name}: ${nm(was)} → ${nm(holder)}` : `${name} → ${nm(holder)}`, path: `items.${id}`, reason: op.cause, from: nm(was), to: nm(holder), memory: Boolean(a.gift) });
        return;
      }
      case "thread": {
        const title = clip(op.subject ?? a.detail, 100);
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
        if (a.detail) t.latest = clip(a.detail, 200);
        if (action === "resolve") t.status = "resolved";
        else if (action === "stall") {
          t.status = "stalled";
          t.blocker = a.blocker ?? a.detail;
        } else t.status = "open";
        if (a.kind) t.kind = a.kind;
        this.push(ctx, {
          kind: "thread",
          text: action === "resolve" ? `Resolved: ${t.title}` : action === "stall" ? `Stalled: ${t.title}` : `${t.title}: ${clip(a.detail ?? action, 60)}`,
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
        const o = (st.obligations[id] ??= { id, kind: op.op, who: who.id, whom: whom?.id, what: clip(a.what, 160), status: "open", seq });
        if (a.due) o.due = { minutes: this.when(a.due), text: a.due };
        const status = a.status as typeof o.status | undefined;
        const fresh = o.seq === seq && o.status === "open" && !o.felt;
        if (status && status !== o.status) {
          o.status = status;
          this.push(ctx, { kind: op.op, text: `${cap(op.op === "owe" ? "debt" : "promise")} ${status}: ${o.what}`, subject: who.name, path: `obligations.${id}`, reason: op.cause, tone: status === "kept" || status === "paid" ? "up" : status === "broken" ? "down" : "due", memory: status === "broken" || status === "kept" });
          // Keeping a promise warms the bond; breaking one cools it (once).
          if (op.op === "promise" && whom && !o.felt && (status === "kept" || status === "broken")) {
            o.felt = true;
            const key = `${whom.id}>${who.id}`;
            const b = (st.bonds[key] ??= { from: whom.id, to: who.id, axes: {}, tags: [], history: [] });
            const moves: [Axis, number][] = status === "kept" ? [["trust", 1]] : [["trust", -1], ["resentment", 1]];
            for (const [axis, d] of moves) {
              const lo = (BIPOLAR_AXES as readonly string[]).includes(axis) ? -5 : 0;
              const prev = b.axes[axis] ?? 0;
              const next = Math.max(lo, Math.min(5, prev + d));
              if (next === prev) continue;
              b.axes[axis] = next;
              b.history.push({ axis, from: prev, to: next, delta: next - prev, cause: `${status} a promise: ${o.what}`, seq });
              this.push(ctx, { kind: "bond", text: `${whom.name} → ${who.name} · ${cap(axis)} ${d > 0 ? "+" : ""}${d}`, subject: whom.name, reason: `${status} promise`, path: `bonds.${key}.${axis}`, tone: status === "kept" ? "up" : "down" });
            }
          }
        } else if (fresh) this.push(ctx, { kind: op.op, text: `${op.op === "owe" ? `${who.name} owes ${whom?.name ?? "someone"}` : `${who.name} promised`}: ${o.what}`, subject: who.name, path: `obligations.${id}`, reason: op.cause });
        return;
      }
      case "deadline": {
        if (!a.title) return this.reject(ctx, "write deadline Title: when");
        const id = slug(a.title);
        const d = (st.deadlines[id] ??= { id, title: clip(a.title, 100), at: null, text: "", done: false, seq });
        if (a.when) {
          d.text = clip(a.when, 60);
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
        st.plants[id] = { id, text: clip(a.text, 160), payoff: a.payoff ? clip(a.payoff, 120) : undefined, seq, scene: st.sceneNo };
        this.push(ctx, { kind: "plant", text: `Planted: ${clip(a.text, 60)}`, path: `plants.${id}` });
        return;
      }
      case "payoff": {
        const p = Object.values(st.plants).find((x) => x.paidSeq == null && (slug(a.text) === x.id || overlap(x.text, a.text) >= 0.5));
        if (!p) return this.reject(ctx, "no unpaid plant like that");
        p.paidSeq = seq;
        this.push(ctx, { kind: "plant", text: `Paid off: ${clip(p.text, 60)}`, path: `plants.${p.id}`, reason: a.payoff, tone: "up", memory: true });
        return;
      }
      case "clue": {
        if (!a.text) return this.reject(ctx, "what clue?");
        if (st.clues.some((c) => overlap(c.text, a.text) > 0.8)) return;
        st.clues.push({ id: slug(a.text), text: clip(a.text, 160), pointsTo: a.pointsTo, reliability: a.reliability, seq });
        this.push(ctx, { kind: "clue", text: `Clue: ${clip(a.text, 60)}`, path: `clues.${slug(a.text)}` });
        return;
      }
      case "gauge": {
        const name = clip(op.subject, 60);
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
        const faction = clip(op.subject, 60);
        if (!faction || !a.project) return this.reject(ctx, "write clockf Faction: project +1 (3/6)");
        const existing = Object.values(st.clocks).find((c) => norm(c.faction) === norm(faction) && overlap(c.name, a.project) >= 0.5);
        const id = existing ? `${slug(existing.faction)}:${slug(existing.name)}` : `${slug(faction)}:${slug(a.project)}`;
        const c = (st.clocks[id] ??= { faction, name: clip(a.project, 80), cur: 0, max: a.max ?? 6, history: [] });
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
        const group = clip(op.object, 60);
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
        const e = (st.calendar[id] ??= { id, title: clip(a.title, 100), kind, when: "", at: null, who: [], seq });
        if (a.when) {
          e.when = clip(a.when, 60);
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
        st.motifs[id] = { id, text: clip(a.text, 120), who: a.who, firstSeq: seq, lastSeq: seq, uses: 1 };
        this.push(ctx, { kind: "motif", text: `Running bit: ${clip(a.text, 50)}`, path: `motifs.${id}` });
        return;
      }
      case "milestone": {
        if (!a.text) return this.reject(ctx, "what milestone?");
        if (st.milestones.some((m) => overlap(m.text, a.text) > 0.8)) return;
        const who = (a.who ? String(a.who).split(/\s*(?:&|,|\band\b)\s*/) : []).map((n: string) => this.findChar(n)?.id ?? n);
        st.milestones.push({ text: clip(a.text, 160), who, seq, at: st.time ? formatStoryTime(st.time) : null });
        this.push(ctx, { kind: "milestone", text: `Milestone: ${clip(a.text, 60)}`, path: `milestones.${slug(a.text)}`, memory: true, tone: "up" });
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
    const k = key ? slug(key) : (Object.values(st.facts).find((f) => overlap(f.statement, statement) >= 0.75)?.key ?? slug(statement));
    const f = (st.facts[k] ??= { key: k, statement: clip(statement, 240), truth: (truth as Truth) ?? "true", stances: {}, revealed: [], firstSeq: seq, lastSeq: seq });
    f.lastSeq = seq;
    if (truth) f.truth = truth as Truth;
    return f;
  }

  threadId(title: string) {
    const st = this.state;
    const id = slug(title);
    if (st.threads[id]) return id;
    const close = Object.values(st.threads).find((t) => t.status !== "resolved" && (overlap(t.title, title) >= 0.6 || slug(t.title).startsWith(id) || id.startsWith(slug(t.title))));
    return close?.id ?? id;
  }

  obligationId(kind: string, who: string, whom: string | undefined, what: string) {
    const close = Object.values(this.state.obligations).find((o) => o.kind === kind && o.who === who && o.whom === whom && overlap(o.what, what) >= 0.5);
    return close?.id ?? `${kind}:${who}>${whom ?? "-"}:${slug(what)}`;
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
