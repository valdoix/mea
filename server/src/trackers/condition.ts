import { formatStoryTime, parseStoryTime, timeOfDay } from "./clock";
import { slug } from "./fold";
import { LADDER, type WorldState } from "./types";

/**
 * Tracker-driven triggers (TRK-12): conditions on tracker state that switch on lorebook entries,
 * guidance chips and the like.
 *
 *   time_of_day = night            bond Mira>Alex trust >= 3      present contains Joss
 *   location contains "Mira's house"   ladder Mira>Alex >= Spoken   fatigue Mira >= 4
 *   weather contains rain and mode = intimacy                      survival.supplies < 20
 */
type Val = string | number | boolean | string[] | null | undefined;

const norm = (s: string) => s.trim().toLowerCase().replace(/^["“']|["”']$/g, "");

function charOf(st: WorldState, name: string) {
  const n = norm(name);
  return Object.values(st.chars).find((c) => c.id === slug(n) || c.name.toLowerCase() === n || c.aliases.some((a) => a.toLowerCase() === n) || (n === "user" && c.isUser));
}

/** The value a reference points at, or undefined when it names nothing. */
export function resolveRef(st: WorldState, ref: string): Val {
  const r = ref.trim();
  const low = r.toLowerCase();
  const time = st.time ? formatStoryTime(st.time) : null;
  switch (low) {
    case "time_of_day":
    case "scene.time_of_day":
      return time ? timeOfDay(time) : null;
    case "time":
    case "clock":
      return time;
    case "hour":
      return st.time ? Math.floor((((st.time.minutes % 1440) + 1440) % 1440) / 60) : null;
    case "day":
      return st.time ? Math.floor(st.time.minutes / 1440) + 1 : null;
    case "weather":
    case "wx":
      return st.weather?.now ?? null;
    case "place":
    case "location":
    case "at":
      return st.place.join(" › ");
    case "mode":
      return st.mode ?? null;
    case "scene":
      return st.sceneTitle ?? null;
    case "present":
    case "cast":
      return Object.values(st.chars).filter((c) => c.tier === "spot" || c.tier === "peri").map((c) => c.name);
  }
  let m = r.match(/^bond\s+(.+?)\s*>\s*(.+?)\s+(\w+)$/i);
  if (m) {
    const a = charOf(st, m[1]!);
    const b = charOf(st, m[2]!);
    if (!a || !b) return undefined;
    const bond = st.bonds[`${a.id}>${b.id}`];
    return m[3]!.toLowerCase() === "label" ? (bond?.label ?? "") : ((bond?.axes as Record<string, number> | undefined)?.[m[3]!.toLowerCase()] ?? 0);
  }
  m = r.match(/^ladder\s+(.+?)\s*>\s*(.+)$/i);
  if (m) {
    const a = charOf(st, m[1]!);
    const b = charOf(st, m[2]!);
    return a && b ? (st.ladders[`${a.id}>${b.id}`]?.tier ?? 0) : undefined;
  }
  m = r.match(/^(mood|look|activity|place)\s+(.+)$/i);
  if (m) {
    const c = charOf(st, m[2]!);
    if (!c) return undefined;
    const k = m[1]!.toLowerCase();
    return k === "mood" ? (c.mood?.name ?? "") : k === "look" ? (c.look ?? "") : k === "activity" ? (c.activity ?? "") : (c.place ?? "");
  }
  m = r.match(/^(health|fatigue|hunger|thirst|pain|intox|composure|stress|arousal)\s+(.+)$/i);
  if (m) {
    const c = charOf(st, m[2]!);
    return c ? (c.meters[m[1]!.toLowerCase() as "health"] ?? 0) : undefined;
  }
  m = r.match(/^gauge\s+(.+)$/i);
  if (m) return st.gauges[slug(m[1]!)]?.cur;
  m = r.match(/^thread\s+(.+)$/i);
  if (m) return st.threads[slug(m[1]!)]?.status ?? Object.values(st.threads).find((t) => t.title.toLowerCase() === norm(m![1]!))?.status;
  m = r.match(/^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/i);
  if (m) {
    const v = st.custom[m[1]!.toLowerCase()]?.[m[2]!.toLowerCase()];
    return v as Val;
  }
  return undefined;
}

const OPS = [">=", "<=", "!=", "=", ">", "<", "!contains", "contains"] as const;

function compare(left: Val, op: (typeof OPS)[number], rightRaw: string): boolean {
  if (left === undefined) return false;
  const right = norm(rightRaw);
  if (op === "contains" || op === "!contains") {
    const hay = Array.isArray(left) ? left.map((x) => x.toLowerCase()) : [String(left ?? "").toLowerCase()];
    const hit = Array.isArray(left) ? hay.some((h) => h === right || h.includes(right)) : hay[0]!.includes(right);
    return op === "contains" ? hit : !hit;
  }
  // Ladder rungs by name.
  const ladder = LADDER.findIndex((n) => n.toLowerCase() === right);
  const rnum = ladder >= 0 ? ladder : Number(right);
  if (typeof left === "number" && Number.isFinite(rnum)) {
    switch (op) {
      case ">=":
        return left >= rnum;
      case "<=":
        return left <= rnum;
      case ">":
        return left > rnum;
      case "<":
        return left < rnum;
      case "=":
        return left === rnum;
      case "!=":
        return left !== rnum;
    }
  }
  // Story times compare as times.
  const lt = parseStoryTime(left);
  const rt = parseStoryTime(rightRaw);
  if (lt && rt) {
    const d = lt.minutes - rt.minutes;
    return op === ">=" ? d >= 0 : op === "<=" ? d <= 0 : op === ">" ? d > 0 : op === "<" ? d < 0 : op === "=" ? d === 0 : d !== 0;
  }
  const l = Array.isArray(left) ? left.join(", ").toLowerCase() : String(left ?? "").toLowerCase();
  if (op === "=") return l === right;
  if (op === "!=") return l !== right;
  return false;
}

/** Evaluates a condition; malformed conditions are false (and reported by checkCondition). */
export function evalCondition(st: WorldState, cond: string): boolean {
  const ors = cond.split(/\s+or\s+/i);
  return ors.some((part) => part.split(/\s+and\s+/i).every((clause) => evalClause(st, clause)));
}

function splitClause(clause: string): [string, (typeof OPS)[number], string] | null {
  for (const op of OPS) {
    const re = op === "contains" || op === "!contains" ? new RegExp(`\\s${op === "!contains" ? "(?:!contains|not contains|doesn't contain)" : "contains"}\\s`, "i") : new RegExp(`\\s*${op.replace(/[<>=!]/g, (c) => `\\${c}`)}\\s*`);
    const m = clause.match(re);
    if (m && m.index! > 0) {
      if (op === "=" && /[<>!]$/.test(clause.slice(0, m.index))) continue;
      return [clause.slice(0, m.index).trim(), op, clause.slice(m.index! + m[0].length).trim()];
    }
  }
  return null;
}

function evalClause(st: WorldState, clause: string): boolean {
  const s = splitClause(clause.trim());
  if (!s) return false;
  return compare(resolveRef(st, s[0]), s[1], s[2]);
}

/** Explains why a condition can't be read, or returns null when it's fine (for the editors). */
export function checkCondition(st: WorldState, cond: string): string | null {
  for (const part of cond.split(/\s+(?:and|or)\s+/i)) {
    const s = splitClause(part.trim());
    if (!s) return `"${part}" needs a comparison like = night, >= 3 or contains Joss`;
    if (resolveRef(st, s[0]) === undefined && !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/i.test(s[0])) return `"${s[0]}" names nothing the trackers know (yet)`;
  }
  return null;
}
