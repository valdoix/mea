import type { Op, OpName } from "./types";
import { leadingDuration } from "./clock";

/**
 * The ledger language (after ALMANAC §20): one change per line, readable, tolerant to parse.
 *
 *   clock: +45m                         bond Mira>Alex: trust +1; affection +1 — he gave it back
 *   at: Port Ellis › Lighthouse          item Locket: Alex → Mira — returned
 *   cast: Mira@spot(by the stove) · Joss@left(→ street)
 *
 * Unknown or malformed lines are reported, never guessed at.
 */

const OPS: OpName[] = [
  "clock", "wx", "at", "scene", "mode", "cast", "mood", "body", "look", "trait", "drive", "mask", "think", "journal", "dead",
  "bond", "ladder", "know", "secret", "reveal", "item", "thread", "owe", "promise", "deadline", "plant", "payoff", "clue",
  "gauge", "clockf", "rep", "event", "plan", "motif", "milestone", "set", "lock", "unset", "rename", "merge", "edit", "expose", "pressure", "room", "keeps",
];
const ALIASES: Record<string, OpName> = {
  time: "clock", weather: "wx", place: "at", location: "at", where: "at", present: "cast", emotion: "mood", outfit: "look", appearance: "look",
  thought: "think", thoughts: "think", inner: "think", relationship: "bond", romance: "ladder", knowledge: "know", inventory: "item",
  debt: "owe", favour: "owe", favor: "owe", vow: "promise", due: "deadline", chekhov: "plant", faction: "clockf", reputation: "rep",
  calendar: "event", appointment: "plan", callback: "motif", bit: "motif", died: "dead", death: "dead", drives: "drive", wants: "drive",
  injury: "body", condition: "body", traits: "trait", title: "scene",
};

export interface ParseResult {
  ops: Op[];
  unknown: string[];
  /** The <ledger> block had no closing tag (cut off). */
  truncated: boolean;
}

/** Splits "text — cause" (em/en dash or double hyphen; a spaced single hyphen only before lowercase words). */
export function splitCause(s: string): [string, string | undefined] {
  const m = s.match(/\s+(?:—|–|--)\s+(.+)$/) ?? s.match(/\s+-\s+([a-z].+)$/);
  if (!m) return [s.trim(), undefined];
  return [s.slice(0, m.index).trim(), m[1]!.trim()];
}

const ARROW = /\s*(?:→|->|=>|⟶)\s*/;

/** "old → new" → [old, new]; "new" → [undefined, new]. */
export function arrow(s: string): [string | undefined, string] {
  const parts = s.split(ARROW);
  return parts.length >= 2 ? [parts[0]!.trim() || undefined, parts.slice(1).join(" → ").trim()] : [undefined, s.trim()];
}

/** Pulls the <ledger>…</ledger> block out of a reply, returning the reply without it. */
export function extractLedger(text: string): { body: string | null; rest: string; truncated: boolean } {
  const open = text.search(/<ledger\b[^>]*>/i);
  if (open < 0) return { body: null, rest: text, truncated: false };
  const afterOpen = text.indexOf(">", open) + 1;
  const close = text.slice(afterOpen).search(/<\/ledger\s*>/i);
  if (close < 0) return { body: text.slice(afterOpen), rest: text.slice(0, open).trimEnd(), truncated: true };
  const end = afterOpen + close;
  const closeLen = text.slice(end).match(/^<\/ledger\s*>/i)![0].length;
  return { body: text.slice(afterOpen, end), rest: (text.slice(0, open) + text.slice(end + closeLen)).trim(), truncated: false };
}

function num(s: string | undefined): number | undefined {
  if (s == null) return undefined;
  const n = Number(String(s).replace(/[^\d.+-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/** "trust +1; affection -2; label "wary"; tags +ally" → structured bond args. */
function bondArgs(rest: string) {
  const moves: { axis: string; delta?: number; set?: number }[] = [];
  let label: string | undefined;
  const tagsAdd: string[] = [];
  const tagsRemove: string[] = [];
  for (const part of rest.split(/\s*[;,]\s*/)) {
    const p = part.trim();
    if (!p) continue;
    let m = p.match(/^label\s*[:=]?\s*["“]?(.+?)["”]?$/i);
    if (m) {
      label = m[1]!.trim();
      continue;
    }
    m = p.match(/^tags?\s*[:=]?\s*(.+)$/i);
    if (m) {
      for (const t of m[1]!.split(/\s+/)) (t.startsWith("-") ? tagsRemove : tagsAdd).push(t.replace(/^[+-]/, ""));
      continue;
    }
    m = p.match(/^([a-z][a-z -]*?)\s*([+-]\s*\d+(?:\.\d+)?)$/i);
    if (m) {
      moves.push({ axis: m[1]!.trim().toLowerCase(), delta: num(m[2]) });
      continue;
    }
    // "trust 4 → 2" and "trust +4 → +2" (old → new) set the new value.
    m = p.match(/^([a-z][a-z -]*?)\s*(?:=|:|\bto\b)?\s*([+-]?\s*\d+(?:\.\d+)?)(?:\s*(?:→|->)\s*([+-]?\s*\d+))?$/i);
    if (m) {
      moves.push({ axis: m[1]!.trim().toLowerCase(), set: num(m[3] ?? m[2]) });
      continue;
    }
    if (/^["“]/.test(p)) label = p.replace(/["“”]/g, "").trim();
  }
  return { moves, label, tagsAdd, tagsRemove };
}

/** "soaked; fatigue 3; hunger +1; injury: left arm, wound, bandaged; healed: left arm" */
function bodyArgs(rest: string) {
  const meters: { meter: string; delta?: number; set?: number }[] = [];
  const injuries: { where: string; severity?: string; treated?: boolean; heal?: boolean }[] = [];
  const flags: string[] = [];
  const clear: string[] = [];
  for (const part of rest.split(/\s*;\s*/)) {
    const p = part.trim();
    if (!p) continue;
    let m = p.match(/^(injur(?:y|ies|ed)|wound(?:ed)?|hurt)\s*[:=]\s*(.+)$/i);
    if (m) {
      const bits = m[2]!.split(/\s*,\s*/);
      injuries.push({ where: bits[0]!, severity: bits.find((b) => /scratch|bruise|minor|wound|cut|serious|deep|broken|critical|grave|mortal/i.test(b)), treated: bits.some((b) => /bandag|treat|stitch|splint|dress|clean/i.test(b)) });
      continue;
    }
    m = p.match(/^(healed|heals|recovered)\s*[:=]\s*(.+)$/i);
    if (m) {
      injuries.push({ where: m[2]!.trim(), heal: true });
      continue;
    }
    m = p.match(/^(?:no longer|not)\s+(.+)$/i) ?? p.match(/^-\s*(.+)$/);
    if (m) {
      clear.push(m[1]!.trim());
      continue;
    }
    m = p.match(/^([a-z]+)\s*(?:[:=])?\s*(\d+(?:\.\d+)?)\s*(?:→|->)\s*(\d+(?:\.\d+)?)\b/i);
    if (m) {
      meters.push({ meter: m[1]!.toLowerCase(), set: num(m[3]) });
      continue;
    }
    m = p.match(/^([a-z]+)\s*([+-]\s*\d+)$/i);
    if (m) {
      meters.push({ meter: m[1]!.toLowerCase(), delta: num(m[2]) });
      continue;
    }
    m = p.match(/^([a-z]+)\s*(?:[:=])?\s*(\d+(?:\.\d+)?)\+?(?:\s*\(.*\))?$/i);
    if (m) {
      meters.push({ meter: m[1]!.toLowerCase(), set: num(m[2]) });
      continue;
    }
    for (const f of p.split(/\s*(?:,|\+|\band\b)\s*/)) if (f.trim()) flags.push(f.trim());
  }
  return { meters, injuries, flags, clear };
}

const TIER_WORD = /^(spot|here|present|peri\w*|arriv\w*|enter\w*|left|leave\w*|off|away|gone|exit\w*)$/i;

/**
 * "Mira@spot(by the stove) · Joss@left(→ street) · Tom@arrive(← harbor)".
 * Models also write a place after the @ ("Jackie@down-slope(finding James)", "Misty@down-slope@spot"):
 * the name stops at the first @, a tier word is the tier, and anything else is where they are.
 */
function castArgs(rest: string) {
  return rest
    .split(/\s*(?:·|•|\||;)\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const note = x.match(/\(([^)]*)\)\s*$/)?.[1]?.trim();
      const [name, ...tags] = x.replace(/\s*\([^)]*\)\s*$/, "").split(/\s*@\s*/);
      const tier = tags.find((t) => TIER_WORD.test(t))?.toLowerCase() ?? "spot";
      const where = tags.filter((t) => t && !TIER_WORD.test(t)).join(", ");
      return { name: name!.trim(), tier, note: note || where || undefined };
    })
    .filter((c) => c.name);
}

/** "a | b · c · d" → ["a", ["b","c","d"]] */
function pipe(rest: string): [string, string[]] {
  const [head, ...tail] = rest.split(/\s*\|\s*/);
  return [head!.trim(), tail.join(" · ").split(/\s*(?:·|•|,)\s*/).map((s) => s.trim()).filter(Boolean)];
}

const KNOW_STATUS = /^(knows|believes|suspects|doubts|wrong|unaware)$/i;
const TRUTH_WORD = /^(true|false|partial|unknown)$/i;

/**
 * A line's own fields written into its cause ("— heard it · knows · true", "— kept by A · from B —
 * why"): each bit `take` claims leaves the cause, and the rest of it stays the cause.
 */
function fieldsFromCause(out: Op, take: (bit: string) => boolean) {
  if (!out.cause) return;
  const bits = out.cause.split(/\s*(?:·|•|\|)\s*|\s+(?:—|–|--)\s+/).map((s) => s.trim()).filter(Boolean);
  const rest = bits.filter((b) => !take(b));
  if (rest.length < bits.length) out.cause = rest.join(" · ") || undefined;
}

const names = (s: string) => s.split(/\s*(?:,|&|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean);
const NAME = String.raw`\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){0,2}`;
const NAMES = String.raw`${NAME}(?:\s*(?:,|&|\band\b)\s*${NAME})*`;
const SECRET_META: [RegExp, "keepers" | "from" | "knownTo" | "suspectedBy"][] = [
  [/^kept by\s+(.+)$/i, "keepers"],
  [/^(?:kept )?from\s+(.+)$/i, "from"],
  [/^known (?:to|by)\s+(.+)$/i, "knownTo"],
  [/^suspected by\s+(.+)$/i, "suspectedBy"],
  // "Nat knows", "Gen and Robin suspect": names only (capitalised), so "she knows" stays prose.
  [new RegExp(String.raw`^(${NAMES})\s+(?:knows?|know it)$`, "u"), "knownTo"],
  [new RegExp(String.raw`^(${NAMES})\s+suspects?(?: it)?$`, "u"), "suspectedBy"],
];
/**
 * "kept by A, B · from C; known to D, suspected by E". In a cause (`strict`) every bit must be one of
 * these, or none is taken; after a "|" the ones that aren't are skipped.
 */
function secretMeta(a: Record<string, unknown>, text: string, strict = true) {
  const bits = text
    .split(/\s*(?:·|•|;|\|)\s*/)
    .flatMap((b) => b.split(/,\s*(?=(?:kept by|from|known (?:to|by)|suspected by)\s)/i))
    .map((b) => b.trim())
    .filter(Boolean);
  const hits = bits.map((b) => SECRET_META.map(([re, k]) => [b.match(re), k] as const).find(([m]) => m));
  if (!bits.length || (strict && hits.some((h) => !h))) return false;
  for (const [m, k] of hits.filter(Boolean) as [RegExpMatchArray, string][]) a[k] = [...((a[k] as string[] | undefined) ?? []), ...names(m[1]!)];
  return true;
}

function dueOf(text: string) {
  const m = text.match(/\[?\s*due\s*[:=]?\s*([^\]]+)\]?/i);
  return m ? m[1]!.trim() : undefined;
}

export function parseLine(raw: string): Op | null {
  const line = raw.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, "").trim();
  if (!line || /^<\/?ledger/i.test(line) || /^```/.test(line)) return null;
  // edit ["chars","mira","mood","name"] = "calm": your direct edit of any field (a JSON path and value).
  const edit = line.match(/^edit\s+(\[.*?\])\s*=\s*([\s\S]*)$/i);
  if (edit) {
    let path: unknown;
    let value: unknown;
    try {
      path = JSON.parse(edit[1]!);
    } catch {
      return null;
    }
    if (!Array.isArray(path) || !path.length || !path.every((k) => typeof k === "string" || typeof k === "number")) return null;
    try {
      value = JSON.parse(edit[2]!);
    } catch {
      value = edit[2]!.trim();
    }
    return { op: "edit", args: { path, value }, raw: line };
  }
  const head = line.match(/^([a-z]+)\b\s*(.*)$/i);
  if (!head) return null;
  const word = head[1]!.toLowerCase();
  const op = (OPS as string[]).includes(word) ? (word as OpName) : ALIASES[word];
  if (!op) return null;
  let rest = head[2]!;
  let subject: string | undefined;
  let object: string | undefined;
  const colon = rest.indexOf(":");
  // "op Subject>Object: …" / "op Subject: …" / "op: …" (some ops take no subject).
  if (colon >= 0 && !(op === "clock" && /^\s*\d{1,2}:\d{2}/.test(rest)) && !(["deadline", "plan", "event"].includes(op) && colon === 0)) {
    const left = rest.slice(0, colon).trim();
    const right = rest.slice(colon + 1).trim();
    if (left && !(op === "clock" && /\d$/.test(left) && /^\d{2}\b/.test(right))) {
      const rel = left.split(/\s*(?:>|→|->)\s*/);
      subject = rel[0]!.trim();
      object = rel[1]?.trim();
      rest = right;
    } else if (!left) rest = right;
  }
  rest = rest.trim();
  const [body, cause] = ["think", "journal", "motif", "scene"].includes(op) ? [rest, undefined] : splitCause(rest);
  const out: Op = { op, subject, object, args: {}, cause, raw: line };
  const a = out.args;
  switch (op) {
    case "clock": {
      const t = body.replace(/^now\s*/i, "");
      // "+45m", "+1h30m", "+2 hours 15 minutes"; a date written after it ("+1h30m | 1996-05-24 15:48") is only a gloss.
      const rel = /^\+/.test(t) ? leadingDuration(t.slice(1)) : null;
      if (rel) a.plus = rel.minutes;
      else {
        a.flashback = /\bflashback\b/i.test(t);
        a.set = t.replace(/\bflashback\b/i, "").trim();
      }
      break;
    }
    case "wx":
    case "at":
    case "look":
    case "mode":
    case "scene": {
      const [from, to] = arrow(body);
      a.from = from;
      a.to = to;
      if (op === "at") a.path = to.split(/\s*(?:›|>|»|\/)\s*/).map((s) => s.trim()).filter(Boolean);
      break;
    }
    case "cast":
      a.list = castArgs(body);
      break;
    case "mood": {
      const [main, vadPart] = body.split(/\s*\|\s*/);
      const [from, to] = arrow(main ?? "");
      a.from = from;
      a.to = to;
      const vad = vadPart ?? "";
      a.v = num(vad.match(/V\s*([+-]?\d)/i)?.[1]);
      a.a = num(vad.match(/A\s*([+-]?\d)/i)?.[1]);
      a.d = num(vad.match(/D\s*([+-]?\d)/i)?.[1]);
      break;
    }
    case "body":
      Object.assign(a, bodyArgs(body));
      break;
    case "trait":
      a.list = body.split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean);
      break;
    case "drive":
    case "mask": {
      for (const part of body.split(/\s*[;|]\s*/)) {
        const m = part.match(/^(want|wants|fear|fears|need|needs|tactic|shown|shows|felt|feels|tell)\s*[:=]?\s*(.+)$/i);
        if (m) a[m[1]!.toLowerCase().replace(/s$/, "").replace(/^show$/, "shown").replace(/^feel$/, "felt")] = m[2]!.trim();
      }
      break;
    }
    case "think":
    case "journal":
      a.text = body.replace(/^["“]|["”]$/g, "").trim();
      break;
    case "dead":
      a.text = body;
      // "dead Old Tom — lost in the storm" (the grammar's own form) has no colon: the body is the name.
      if (!out.subject && body.trim()) out.subject = body.trim().replace(/^["“]|["”]$/g, "");
      break;
    case "bond":
      Object.assign(a, bondArgs(body));
      break;
    case "ladder": {
      const m = body.match(/^(?:tier\s*)?(\d)(?:\s*(?:→|->)\s*(?:tier\s*)?(\d))?/i);
      a.tier = m ? num(m[2] ?? m[1]) : undefined;
      a.word = m ? undefined : arrow(body)[1].toLowerCase();
      break;
    }
    case "know": {
      // "fact · sees · true" with no "|": the first "·" starts the fields.
      const [fact, meta] = pipe(body.includes("|") ? body : body.replace(/\s*[·•]\s*/, " | "));
      a.fact = fact.replace(/^#([\w-]+)\s*/, (_, k) => ((a.key = k), ""));
      for (const m of meta) {
        if (KNOW_STATUS.test(m)) a.status = m.toLowerCase();
        else if (TRUTH_WORD.test(m)) a.truth = m.toLowerCase();
        else a.route = a.route ? `${a.route}, ${m}` : m;
      }
      fieldsFromCause(out, (b) => {
        if (!a.status && KNOW_STATUS.test(b)) return Boolean((a.status = b.toLowerCase()));
        if (!a.truth && TRUTH_WORD.test(b)) return Boolean((a.truth = b.toLowerCase()));
        return false;
      });
      break;
    }
    case "secret": {
      // Not pipe(): its commas separate names here ("kept by Jeff, Shauna").
      const bar = body.indexOf("|");
      a.key = subject?.replace(/^#/, "");
      a.fact = (bar < 0 ? body : body.slice(0, bar)).trim();
      if (bar >= 0) secretMeta(a, body.slice(bar + 1), false);
      // Fields in the cause only stand in for missing ones ("— from the card" is where it came from).
      else fieldsFromCause(out, (b) => !/^from the (?:card|story)$/i.test(b) && secretMeta(a, b));
      break;
    }
    case "room": {
      // E2: "room Mira: Port Ellis › Lighthouse › Lamp room | shop" (whose place it is, and what kind)
      const [where, kind] = body.split("|").map((x) => x.trim());
      a.path = (where ?? "").split(/\s*(?:›|>|»|\/)\s*/).map((s) => s.trim()).filter(Boolean);
      a.kind = kind?.toLowerCase() || undefined;
      break;
    }
    case "keeps": {
      // E2: "keeps Mira: the ledger @ Lamp room" (hers, kept there)
      const m = body.match(/^(.+?)\s*@\s*(.+)$/);
      a.item = (m?.[1] ?? body).trim();
      a.place = m?.[2]?.trim();
      break;
    }
    case "pressure": {
      // E1: "pressure Mira: is grieving and has told no one | stage: hidden | by: deck" (the engine and you only)
      const [main, ...meta] = body.split("|").map((x) => x.trim());
      a.text = main && !/^(?:stage|by|lock|unlock|draws?)\b/i.test(main) ? main : undefined;
      for (const m of main && !a.text ? [main, ...meta] : meta) {
        const kv = m.match(/^(stage|by|draws?)\s*[:=]\s*(\S+)/i);
        if (kv) a[kv[1]!.toLowerCase().replace(/s$/, "")] = kv[2]!.toLowerCase();
        else if (/^lock$/i.test(m)) a.lock = true;
        else if (/^unlock$/i.test(m)) a.lock = false;
      }
      break;
    }
    case "expose": {
      // B2: "expose #key: +1 | Willow — kept in earshot" or "expose #key: 4" (never the model's).
      a.key = subject?.replace(/^#/, "");
      const [main, ...meta] = body.split("|");
      const rel = (main ?? "").trim().match(/^([+-]\s*\d+)/);
      a.delta = rel ? num(rel[1]) : undefined;
      a.cur = rel ? undefined : num((main ?? "").trim().match(/^(\d+)/)?.[1]);
      a.who = meta.join("|").trim() || undefined;
      break;
    }
    case "reveal": {
      a.key = subject?.replace(/^#/, "");
      const m = body.match(/^(?:to\s+)?(.+)$/i);
      a.to = (m?.[1] ?? "").split(/\s*(?:,|&|\band\b)\s*/).map((s) => s.trim()).filter(Boolean);
      break;
    }
    case "item": {
      // "Alex → Mira", "+Mira (belt)", "→ gone", "owner Mira", "condition: cracked"
      const own = body.match(/^owner\s*[:=]?\s*(.+)$/i);
      const cond = body.match(/^condition\s*[:=]?\s*(.+)$/i);
      const gift = body.match(/\bgift(?:ed)?\s+from\s+([^;)]+)/i);
      if (own) a.owner = own[1]!.trim();
      else if (cond) a.condition = cond[1]!.trim();
      else {
        // E2: "(gift from A)" / ", gift from A" says who gave it, not where it is.
        const plain = body.replace(/\s*[,;(]?\s*\bgift(?:ed)?\s+from\s+[^;)]+\)?\s*$/i, "").trim();
        const where = plain.match(/\(([^)]+)\)\s*$/);
        const b = plain.replace(/\(([^)]+)\)\s*$/, "").trim();
        if (/^\+/.test(b)) a.to = b.slice(1).trim();
        else {
          const [from, to] = arrow(b);
          a.from = from;
          a.to = to;
        }
        a.where = where?.[1]?.trim();
        if (a.to && /^(gone|lost|destroyed|burned|burnt|broken|consumed|used up)$/i.test(a.to)) {
          a.gone = a.to.toLowerCase();
          a.to = undefined;
        }
      }
      if (gift) a.gift = gift[1]!.trim();
      break;
    }
    case "thread": {
      const m = body.match(/^(new|open|advance|advanced|complicate|complicated|bridge|resolve|resolved|close|closed|stall|stalled|reopen)(?:\s*\(([^)]*)\))?\s*[:,-]?\s*(.*)$/i);
      a.action = m ? m[1]!.toLowerCase().replace(/d$/, "").replace(/^open$/, "new").replace(/^close$/, "resolve") : "advance";
      if (a.action === "stalle") a.action = "stall";
      if (a.action === "advance" && m?.[1]?.toLowerCase() === "advanced") a.action = "advance";
      a.blocker = m?.[2];
      a.detail = (m ? m[3] : body)?.trim() || cause;
      const kind = (m?.[3] ?? body).match(/\[(plot|mystery|foreshadowing|promise|deadline|romance|quest)\]/i);
      if (kind) a.kind = kind[1]!.toLowerCase();
      break;
    }
    case "owe":
    case "promise": {
      // "Mira → Alex: a favour | open [due Day 4]"  (subject/object already split on > or →)
      const [what, meta] = pipe(body.replace(/\[\s*(?:due|window)[^\]]*\]/gi, ""));
      a.what = what.trim();
      a.status = meta.find((m) => /^(open|due|kept|broken|paid|forgiven|lapsed|excused)$/i.test(m))?.toLowerCase();
      a.due = dueOf(body);
      // E3: "meet @ the Bronze", "minor|major|vital", "[window 30m]"
      const meet = meta.map((m) => m.match(/^meet(?:ing)?\s*(?:@|at)\s*(.+)$/i)).find(Boolean);
      if (meet) a.meet = meet[1]!.trim();
      const imp = meta.find((m) => /^(minor|major|vital)$/i.test(m))?.toLowerCase();
      if (imp) a.importance = imp === "minor" ? 1 : imp === "vital" ? 3 : 2;
      const win = body.match(/\[\s*window\s*[:=]?\s*([^\]]+)\]/i);
      if (win) a.window = win[1]!.trim();
      break;
    }
    case "deadline": {
      const [title, when] = subject ? [subject, body] : body.split(/\s*[:|]\s*/);
      a.title = (title ?? "").trim();
      a.when = (when ?? "").replace(/\b(done|met|missed|passed)\b/i, "").trim();
      a.done = /\b(done|met|passed|missed)\b/i.test(body);
      break;
    }
    case "plant":
    case "payoff": {
      const [text, payoff] = (subject ? `${subject} — ${body}` : body).split(/\s*(?:—|–|--|\|)\s*(?:payoff\s*[:=]?\s*)?/i);
      a.text = (text ?? "").trim();
      a.payoff = (payoff ?? cause)?.trim();
      break;
    }
    case "clue": {
      const [text, meta] = pipe(subject ? `${subject}: ${body}` : body);
      const [t, points] = arrow(text);
      a.text = (points && t ? t : text).trim();
      a.pointsTo = t ? points : undefined;
      a.reliability = meta.find((m) => /reliab|solid|shaky|false|planted/i.test(m))?.replace(/^reliability\s*[:=]?\s*/i, "");
      break;
    }
    case "gauge": {
      const m = body.match(/(-?\d+)\s*(?:\/\s*(\d+))?/);
      const rel = body.match(/^([+-]\d+)/);
      a.delta = rel ? num(rel[1]) : undefined;
      a.cur = rel ? undefined : num(m?.[1]);
      a.max = num(m?.[2]);
      break;
    }
    case "clockf": {
      // "Harbor Guild: smuggling run +1 (3/6)"  or  "Harbor Guild: smuggling run 4/6"
      const m = body.match(/^(.*?)\s*(?:([+-]\d+))?\s*\(?\s*(?:(\d+)\s*\/\s*(\d+))?\s*\)?\s*$/);
      a.project = (m?.[1] ?? body).replace(/\s*(?:\d+\s*\/\s*\d+\s*(?:→|->)\s*)/, "").trim();
      a.delta = num(m?.[2]);
      a.cur = num(m?.[3]);
      a.max = num(m?.[4]);
      break;
    }
    case "rep": {
      // "Alex @ Harbor Guild: -1"
      const at = (subject ?? "").split(/\s*@\s*/);
      out.subject = at[0]?.trim();
      out.object = at[1]?.trim() ?? object;
      const m = body.match(/([+-]\d+)/);
      a.delta = num(m?.[1]);
      a.tags = (body.match(/tags?\s*[:=]?\s*(.+)$/i)?.[1] ?? "").split(/\s*,\s*/).filter(Boolean);
      break;
    }
    case "event":
    case "plan": {
      const [main, meta] = pipe(subject ? `${body}` : body);
      a.title = subject ?? main;
      a.when = subject ? main : (meta.find((m) => /\d|day|every|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight/i.test(m)) ?? "");
      a.kind = meta.find((m) => /^(birthday|anniversary|holiday|appointment|plan|recurring)$/i.test(m))?.toLowerCase() ?? (op === "plan" ? "plan" : undefined);
      a.who = (meta.find((m) => /^who\s*[:=]/i.test(m)) ?? "").replace(/^who\s*[:=]\s*/i, "").split(/\s*(?:,|&|\band\b)\s*/).filter(Boolean);
      a.done = meta.some((m) => /^(done|cancelled|canceled)$/i.test(m));
      break;
    }
    case "motif":
    case "milestone": {
      const [text, who] = (subject ? `${subject} — ${body}` : body).split(/\s*(?:—|–|--)\s*/);
      a.text = (text ?? "").replace(/^["“]|["”]$/g, "").trim();
      a.who = who?.trim();
      break;
    }
    case "set":
    case "unset":
    case "lock": {
      a.path = subject ?? body.split(/\s*[:=]\s*/)[0];
      a.value = subject ? body : body.split(/\s*[:=]\s*/).slice(1).join(":").trim();
      if (op === "lock") a.on = !/^(off|false|no|unlock)$/i.test(String(a.value).trim());
      break;
    }
    case "rename":
      a.to = arrow(body)[1];
      break;
    case "merge": {
      // "merge Jackie → Jackie Taylor": the first is folded into the second.
      const [from, to] = arrow(body);
      if (from) out.subject = from;
      a.to = to;
      break;
    }
  }
  return out;
}

export function parseLedger(text: string): ParseResult {
  const { body, truncated } = extractLedger(text);
  const source = body ?? text;
  const ops: Op[] = [];
  const unknown: string[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || /^<\/?ledger/i.test(t) || /^```/.test(t) || /^#+\s/.test(t)) continue;
    const op = parseLine(t);
    if (op) ops.push(op);
    else unknown.push(t);
  }
  return { ops, unknown, truncated };
}
