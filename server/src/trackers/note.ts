import { countTokens } from "../lib/tokens";
import { type CalendarId, describeWhen, noteTime } from "./calendars";
import { parseStoryTime, shortStoryTime, timeOfDay, formatStoryTime } from "./clock";
import { METER_WORDS, meterWords, SEVERITY, STAMINA } from "./drift";
import type { Field, Template } from "./schema";
import type { PersonaMode } from "../services/layers";
import { BIPOLAR_AXES, type Bond, type Character, LADDER, type WorldState } from "./types";

/**
 * The story-state note (TRK-06, after ALMANAC's <ledger-note>): verified state placed shallow
 * in the prompt. Lanes with budgets: NOW · PRESENT · STAKES · KNOWLEDGE · HOOKS · CUSTOM ·
 * VOICES · ELSEWHERE. Meters go out as words, never numbers.
 */
export interface NoteOptions {
  userName: string;
  /** Total budget in tokens. */
  budget?: number;
  /** The newest message seq (for "opened 340 messages ago" and quiet threads). */
  seq: number;
  /** A thread untouched this many messages may be offered as a hook (TRK-31). */
  quietAfter?: number;
  templates?: Template[];
  /** Enabled sections; others are left out of the note. */
  sections?: Partial<Record<Section, boolean>>;
  /** NPC voice notes (CHAT-27), by lower-case name. */
  voices?: Record<string, string>;
  /** Pinned cast members, always described. */
  pinned?: { name: string; text: string }[];
  /** What reaches the scene from off the page (sim/crossings). */
  elsewhere?: string;
  nudges?: boolean;
  /** How the date reads (calendars.ts); Gregorian keeps the short weekday form. */
  calendar?: CalendarId;
  season?: string;
  /** The Persona control, so the note agrees with it (sealed when unset). */
  persona?: PersonaMode | null;
  /** The kind of request: impersonation and expansion write the user, so the note doesn't forbid it. */
  kind?: string;
}

/** How the note names the player's character: the same rule as the Persona control (sealed when unset). */
function userLabel(o: NoteOptions) {
  if (o.kind && o.kind !== "story" && o.kind !== "continue") return "the player's character";
  if (o.persona === "full_cast") return "the player's character, written by you";
  if (o.persona === "director") return "the player's character; write them only inside the player's direction";
  if (o.persona === "continuity") return "the player's character; never write their words, thoughts or choices, only finish an action they began";
  return "the player's character; never write their actions or words";
}

export type Section = "scene" | "cast" | "body" | "bonds" | "romance" | "knowledge" | "items" | "threads" | "stakes" | "calendar" | "motifs" | "persona" | "custom" | "world";

const on = (o: NoteOptions, s: Section) => o.sections?.[s] !== false;
const tok = (s: string) => countTokens(s);

function bondWords(b: Bond): string {
  const ax = b.axes;
  const parts: string[] = [];
  const say = (v: number | undefined, pos: string, neg: string, strong = 3) => {
    if (v == null || v === 0) return;
    if (v >= strong) parts.push(`deep ${pos}`);
    else if (v > 0) parts.push(pos);
    else if (v <= -strong) parts.push(`deep ${neg}`);
    else parts.push(neg);
  };
  say(ax.trust, "trust", "distrust");
  say(ax.affection, "fondness", "dislike");
  say(ax.respect, "respect", "contempt");
  say(ax.comfort, "ease", "unease");
  for (const k of ["attraction", "fear", "resentment", "rivalry", "obligation", "familiarity"] as const) {
    const v = ax[k] ?? 0;
    if (v >= 2) parts.push(v >= 4 ? `strong ${k}` : k);
  }
  return [b.label, ...parts.slice(0, 4)].filter(Boolean).join(", ");
}

function present(st: WorldState) {
  return Object.values(st.chars).filter((c) => (c.tier === "spot" || c.tier === "peri") && !c.dead);
}

function carried(st: WorldState, id: string) {
  return Object.values(st.items).filter((i) => i.holder === id && !i.gone);
}

function personLine(st: WorldState, c: Character, o: NoteOptions, here: Character[]): string {
  const bits: string[] = [];
  if (!c.isUser || !o.sections || on(o, "persona")) {
    if (c.mood && !(c.isUser && false)) bits.push(c.mood.name);
    if (on(o, "body")) {
      const words = meterWords(c);
      if (words.length) bits.push(words.join(", "));
      for (const i of c.injuries) bits.push(`${i.where} ${SEVERITY[i.severity]}${i.treated ? " (treated)" : ""}`);
      for (const k of c.conditions) bits.push(k.text);
      if (c.flags.length) bits.push(c.flags.slice(-4).join(", "));
      const st = STAMINA[c.stamina];
      if (st?.note) bits.push(st.note);
    }
  }
  const tail: string[] = [];
  if (c.activity) tail.push(c.activity);
  if (c.look) tail.push(`wearing: ${c.look}`);
  if (c.traits.length) tail.push(`always: ${c.traits.map((t) => t.text).join("; ")}`);
  if (on(o, "items")) {
    const items = carried(st, c.id);
    if (items.length) tail.push(`has: ${items.map((i) => `${i.name}${i.where ? ` (${i.where})` : ""}`).join(", ")}`);
  }
  if (!c.isUser) {
    if (c.drives.want) tail.push(`wants: ${c.drives.want}`);
    if (c.drives.fear) tail.push(`fears: ${c.drives.fear}`);
    if (c.mask?.felt && c.mask.shown) tail.push(`shows ${c.mask.shown} but feels ${c.mask.felt}${c.mask.tell ? ` (tell: ${c.mask.tell})` : ""}`);
    if (on(o, "bonds")) {
      for (const other of here) {
        if (other.id === c.id) continue;
        const b = st.bonds[`${c.id}>${other.id}`];
        const l = on(o, "romance") ? st.ladders[`${c.id}>${other.id}`] : undefined;
        const w = b ? bondWords(b) : "";
        if (w || (l && l.tier > 0)) tail.push(`toward ${other.isUser ? o.userName : other.name}: ${[w, l && l.tier > 0 ? `${LADDER[l.tier]} (${l.tier}/7)` : ""].filter(Boolean).join(" · ")}`);
      }
    }
  }
  const name = c.isUser ? `${o.userName} (${userLabel(o)})` : c.name;
  return `- ${name}${bits.length ? `: ${bits.join("; ")}` : ""}${tail.length ? ` · ${tail.join(" · ")}` : ""}`;
}

function customLines(st: WorldState, templates: Template[]): string[] {
  const out: string[] = [];
  const fmt = (f: Field, v: unknown): string => {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "";
    if (f.type === "table" && Array.isArray(v))
      return (v as Record<string, unknown>[])
        .map((row) => {
          const key = f.keyField ?? f.fields?.[0]?.key ?? "name";
          const cells = (f.fields ?? []).filter((s) => s.key !== key && (s.visibility ?? "prompt") === "prompt").map((s) => [s.label, fmt(s, row[s.key])] as const).filter(([, x]) => x);
          return `${row[key]}${cells.length ? ` (${cells.map(([l, x]) => `${l.toLowerCase()} ${x}`).join(", ")})` : ""}`;
        })
        .join("; ");
    if (f.type === "object" && typeof v === "object") return (f.fields ?? []).map((s) => fmt(s, (v as Record<string, unknown>)[s.key])).filter(Boolean).join(", ");
    if (Array.isArray(v)) return v.join(", ");
    if (f.type === "meter") return `${v}/100`;
    return String(v);
  };
  for (const t of templates) {
    const vals = st.custom[t.key];
    if (!vals) continue;
    const parts = t.schema.fields
      .filter((f) => (f.visibility ?? "prompt") === "prompt")
      .map((f) => [f.label, fmt(f, vals[f.key])] as const)
      .filter(([, v]) => v)
      .map(([l, v]) => `${l}: ${v}`);
    if (parts.length) out.push(`${t.name}: ${parts.join(" · ")}`);
  }
  return out;
}

/** Calendar entries for today and tomorrow (birthdays and anniversaries match on day and month). */
export function calendarToday(st: WorldState): string[] {
  const t = st.time;
  if (!t) return [];
  const out: string[] = [];
  const now = formatStoryTime(t);
  const md = (s: string) => {
    const m = s.match(/^\d{1,4}-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}` : null;
  };
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const wordDate = (w: string) => {
    const m = w.toLowerCase().match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)|([a-z]+)\s+(\d{1,2})/);
    if (!m) return null;
    const day = Number(m[1] ?? m[4]);
    const mon = MONTHS.findIndex((x) => x.startsWith((m[2] ?? m[3])!.slice(0, 3)));
    return mon >= 0 ? `${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
  };
  const today = t.form === "date" ? md(now) : null;
  const tomorrowT = t.form === "date" ? md(formatStoryTime({ minutes: t.minutes + 1440, form: "date" })) : null;
  const dayNo = Math.floor(t.minutes / 1440) + 1;
  for (const e of Object.values(st.calendar)) {
    if (e.done) continue;
    if (e.at != null) {
      const d = e.at - t.minutes;
      if (d >= -60 && d <= 1440) out.push(`${e.title} ${d <= 0 ? "now" : `at ${shortStoryTime(formatStoryTime({ minutes: e.at, form: t.form }))}`}`);
      continue;
    }
    const w = wordDate(e.when) ?? md(e.when);
    if (w && today && w === today) out.push(`today: ${e.title}`);
    else if (w && tomorrowT && w === tomorrowT) out.push(`tomorrow: ${e.title}`);
    const dm = e.when.match(/^day\s*(\d+)$/i);
    if (dm && Number(dm[1]) === dayNo) out.push(`today: ${e.title}`);
  }
  return out;
}

export interface NoteResult {
  text: string;
  tokens: number;
  lanes: { name: string; tokens: number; dropped?: boolean }[];
}

export function buildNote(st: WorldState, o: NoteOptions): NoteResult {
  const budget = o.budget ?? 700;
  const quiet = o.quietAfter ?? 40;
  const lanes: { name: string; lines: string[]; priority: number }[] = [];

  // NOW
  if (on(o, "scene")) {
    const now: string[] = [];
    if (st.time && o.calendar === "westeros") now.push(noteTime(st.time, "westeros", o.season));
    else if (st.time) now.push(`${shortStoryTime(formatStoryTime(st.time))}${timeOfDay(formatStoryTime(st.time)) ? ` (${timeOfDay(formatStoryTime(st.time))})` : ""}`);
    if (st.weather) now.push(st.weather.now);
    if (st.place.length) now.push(st.place.join(" › "));
    if (st.sceneTitle) now.push(`scene: ${st.sceneTitle}`);
    if (st.mode) now.push(`mode: ${st.mode}`);
    const cal = on(o, "calendar") ? calendarToday(st) : [];
    const lines = now.length ? [`NOW: ${now.join(" · ")}`] : [];
    if (cal.length) lines.push(`CALENDAR: ${cal.join("; ")}`);
    if (lines.length) lanes.push({ name: "now", lines, priority: 0 });
  }

  // PRESENT
  if (on(o, "cast")) {
    const here = present(st);
    const lines = here.sort((a, b) => Number(a.isUser) - Number(b.isUser) || Number(b.tier === "spot") - Number(a.tier === "spot")).map((c) => personLine(st, c, o, here));
    for (const p of o.pinned ?? []) if (!here.some((c) => c.name.toLowerCase() === p.name.toLowerCase())) lines.push(`- ${p.name} (not here; keep in mind): ${p.text}`);
    if (lines.length) lanes.push({ name: "present", lines: ["PRESENT:", ...lines], priority: 1 });
  }

  // STAKES
  if (on(o, "stakes")) {
    const lines: string[] = [];
    const now = st.time?.minutes ?? null;
    const nm = (id?: string) => (id ? (st.chars[id]?.isUser ? o.userName : (st.chars[id]?.name ?? id)) : "someone");
    for (const ob of Object.values(st.obligations)) {
      if (ob.status !== "open" && ob.status !== "due") continue;
      const due = ob.due?.minutes;
      const soon = due != null && now != null && due - now <= 1440;
      if (ob.status === "due" || soon || ob.kind === "owe") lines.push(`${ob.kind === "promise" ? "Promise" : "Debt"}: ${nm(ob.who)} → ${nm(ob.whom)}: ${ob.what}${ob.status === "due" ? " (due now)" : ob.due ? ` (due ${ob.due.text})` : ""}`);
    }
    for (const d of Object.values(st.deadlines)) {
      if (d.done) continue;
      const left = d.at != null && now != null ? d.at - now : null;
      if (left == null || left <= 2 * 1440) lines.push(`Deadline: ${d.title}${left != null ? (left < 0 ? " (passed)" : ` (in ${left < 120 ? `${left} min` : `${Math.round(left / 60)} h`})`) : d.text ? ` (${d.text})` : ""}`);
    }
    for (const g of Object.values(st.gauges)) if (g.cur >= g.max - 1) lines.push(`${g.name} ${g.cur}/${g.max}${g.cur >= g.max ? " — full" : ""}`);
    for (const c of Object.values(st.clocks)) if (c.cur >= c.max - 1) lines.push(`${c.faction}: ${c.name} ${c.cur}/${c.max}`);
    if (lines.length) lanes.push({ name: "stakes", lines: ["STAKES:", ...lines.slice(0, 8).map((l) => `- ${l}`)], priority: 2 });
  }

  // KNOWLEDGE: who in the room doesn't know what (a firewall against leaks).
  if (on(o, "knowledge")) {
    const here = new Set(present(st).map((c) => c.id));
    const lines: string[] = [];
    for (const f of Object.values(st.facts)) {
      for (const [id, s] of Object.entries(f.stances)) {
        if (!here.has(id) || st.chars[id]?.isUser) continue;
        const who = st.chars[id]?.name ?? id;
        if (s.status === "unaware") lines.push(`${who} doesn't know: ${f.statement}${f.secret?.keepers.length ? ` (kept by ${f.secret.keepers.map((k) => (st.chars[k]?.isUser ? o.userName : st.chars[k]?.name ?? k)).join(", ")})` : ""}`);
        else if (s.status === "wrong") lines.push(`${who} has it wrong: ${f.statement}`);
        else if (s.status === "suspects" || s.status === "doubts") lines.push(`${who} ${s.status}: ${f.statement}`);
      }
    }
    if (lines.length) lanes.push({ name: "knowledge", lines: ["KNOWLEDGE (act only on what each person knows):", ...lines.slice(0, 8).map((l) => `- ${l}`)], priority: 3 });
  }

  // HOOKS (TRK-31): optional, never forced.
  if (o.nudges !== false && (on(o, "threads") || on(o, "motifs"))) {
    const lines: string[] = [];
    if (on(o, "threads")) {
      const quietThreads = Object.values(st.threads)
        .filter((t) => t.status !== "resolved" && o.seq - t.lastSeq >= quiet)
        .sort((a, b) => a.lastSeq - b.lastSeq)
        .slice(0, 2);
      for (const t of quietThreads) lines.push(`${t.title}${t.latest ? ` — ${t.latest}` : ""} (quiet for ${o.seq - t.lastSeq} messages)`);
      const plants = Object.values(st.plants)
        .filter((p) => p.paidSeq == null && st.sceneNo - p.scene >= 4)
        .slice(0, 1);
      for (const p of plants) lines.push(`planted earlier: ${p.text}${p.payoff ? ` (could pay off as: ${p.payoff})` : ""}`);
    }
    if (on(o, "motifs")) {
      const bit = Object.values(st.motifs)
        .filter((m) => o.seq - m.lastSeq >= 30)
        .sort((a, b) => b.uses - a.uses)[0];
      if (bit) lines.push(`running bit: ${bit.text}`);
    }
    if (lines.length) lanes.push({ name: "hooks", lines: ["HOOKS (optional; pick one up only if it fits naturally):", ...lines.map((l) => `- ${l}`)], priority: 5 });
  }

  if (on(o, "custom") && o.templates?.length) {
    const lines = customLines(st, o.templates);
    if (lines.length) lanes.push({ name: "custom", lines, priority: 4 });
  }

  if (o.voices) {
    const here = present(st);
    const lines = here.map((c) => [c.name, o.voices![c.name.toLowerCase()]] as const).filter(([, v]) => v).map(([n, v]) => `- ${n}: ${v}`);
    if (lines.length) lanes.push({ name: "voices", lines: ["VOICES:", ...lines], priority: 2 });
  }

  if (o.elsewhere) lanes.push({ name: "elsewhere", lines: [o.elsewhere], priority: 2 });

  // Fit the budget: drop the lowest-priority lanes first, then trim the longest.
  const header = "[Story state: verified. Keep the story consistent with it; never recite it or mention it.]";
  const cost = () => tok([header, ...lanes.flatMap((l) => l.lines)].join("\n"));
  const dropped: string[] = [];
  while (lanes.length && cost() > budget) {
    const worst = [...lanes].sort((a, b) => b.priority - a.priority)[0]!;
    if (worst.lines.length > 3 && worst.priority > 0) worst.lines.pop();
    else {
      lanes.splice(lanes.indexOf(worst), 1);
      dropped.push(worst.name);
    }
  }
  if (!lanes.length) return { text: "", tokens: 0, lanes: dropped.map((name) => ({ name, tokens: 0, dropped: true })) };
  const ordered = [...lanes].sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
  const text = [header, ...ordered.flatMap((l) => l.lines)].join("\n");
  return {
    text,
    tokens: tok(text),
    lanes: [...ordered.map((l) => ({ name: l.name, tokens: tok(l.lines.join("\n")) })), ...dropped.map((name) => ({ name, tokens: 0, dropped: true }))],
  };
}

const ORDER = ["now", "present", "voices", "stakes", "knowledge", "custom", "elsewhere", "hooks"];

/** A one-line HUD (TRK-27): "Thu 23:10 · Lighthouse · Mira: wistful". */
export function hudLine(st: WorldState, templates: Template[] = [], calendar: CalendarId = "gregorian"): string {
  const parts: string[] = [];
  if (st.time) parts.push(calendar === "gregorian" ? shortStoryTime(formatStoryTime(st.time)) : describeWhen(st.time, calendar).short);
  if (st.weather) parts.push(st.weather.now);
  if (st.place.length) parts.push(st.place.at(-1)!);
  for (const c of present(st)) if (!c.isUser && c.mood) parts.push(`${c.name}: ${c.mood.name}`);
  for (const t of templates) for (const f of t.schema.fields) if (f.hud && st.custom[t.key]?.[f.key] != null) parts.push(`${f.label} ${String(st.custom[t.key]![f.key])}`);
  return parts.slice(0, 6).join(" · ");
}

export { METER_WORDS, parseStoryTime, BIPOLAR_AXES };
