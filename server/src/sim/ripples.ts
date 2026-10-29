import { parseLine } from "../trackers/dsl";
import type { Op, Thread, WorldState } from "../trackers/types";
import { SPECS } from "./grammar";
import { canLead, reach } from "./reach";
import { type Roster } from "./roster";
import type { Cand } from "./storyteller";
import type { Arc, EndResult, Twist } from "./types";
import { type ArcEvent, peopleOf, swing, tied } from "./web";

/**
 * How one subplot's step spreads to the rest of the world. web.ts lets subplots lean on each
 * other's dice; this is what happens right away when a step matters:
 * - Answers: subplots linked to it (tied, aimed at the same person, or led by someone close to the
 *   people in it) step soon, or at once, in answer. Each answer is a step of its own and can spread
 *   further, a little less each time.
 * - Settles: some outcomes decide another subplot outright (an apology closes the rift between the
 *   same two people; a revenge that lands means the one protecting its target failed).
 * - Sparks: harm done to someone makes the people close to them start a subplot of their own.
 * - Threads: a subplot about a plot thread advances or complicates it, and a thread that moves on
 *   the page turns the subplots about it.
 * People only answer what they could know: a secret subplot reaches no one outside it until it slips.
 */

export interface Ripple {
  from: Arc;
  ev: ArcEvent;
  stage: string;
  twist?: Twist;
  /** How many steps away from the first one (0: the step itself). */
  depth: number;
}

export type Reaction =
  | { arc: Arc; act: "end"; result: EndResult; text: string; why: string }
  | { arc: Arc; act: "answer"; mod: number; why: string; heat?: number; harmed?: string };

export const label = (a: Arc) => SPECS[a.kind].label.toLowerCase();
/** "Joss's revenge". */
export const arcWords = (a: Arc) => `${a.leadName}'s ${label(a)}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s);

/** Whether a step matters beyond its own subplot: an ending, a turn, or a clear result late in its shape. */
export function decisive(rp: Pick<Ripple, "ev" | "stage" | "twist">): boolean {
  if (rp.ev.ending) return true;
  if (rp.twist === "reversal" || rp.twist === "slip") return true;
  return rp.ev.result !== "cost" && ["reversal", "crisis", "climax"].includes(rp.stage);
}

/** Could this person know what a subplot is up to? Its own people do; others by how secret it is. */
export function aware(o: Arc, id: string, r: Roster, slipped = false): boolean {
  const a = r.actors.get(id);
  if (!a) return false;
  if (peopleOf(o, r).includes(a)) return true;
  const secrecy = slipped && o.secrecy === "secret" ? "private" : o.secrecy;
  if (secrecy === "public") return true;
  if (secrecy === "secret") return false;
  return [o.lead, o.target].some((p) => !!p && (a.ties.get(p) ?? 0) >= 2);
}

/** Someone in `f` (its target or lead) whom `o`'s lead is close to, and who isn't already in `o`. */
function closeOne(o: Arc, f: Arc, r: Roster) {
  const lead = r.actors.get(o.lead);
  if (!lead) return undefined;
  const mine = peopleOf(o, r);
  return [f.target, f.lead].map((id) => (id ? r.actors.get(id) : undefined)).find((p) => !!p && p !== lead && !mine.includes(p) && (lead.ties.get(p.id) ?? 0) >= 2);
}

/** The same two people, either way round. */
const pair = (a: Arc, b: Arc) => !!a.target && !!b.target && ((a.lead === b.lead && a.target === b.target) || (a.lead === b.target && a.target === b.lead));

/** What a step does to the other running subplots that haven't moved yet this moment. */
export function reactionsTo(rp: Ripple, arcs: Arc[], r: Roster, moved: Set<string>): Reaction[] {
  const f = rp.from;
  const ev = rp.ev;
  const out: Reaction[] = [];
  const met = !!ev.ending && (ev.result === "met" || ev.result === "price");
  const lost = !!ev.ending && ev.result === "lost";
  const X = f.target;
  const name = (id?: string) => (id ? (r.actors.get(id)?.name ?? id) : "someone");
  const xName = name(X);
  const hostile = !!SPECS[f.kind].hostile;
  const slipped = rp.twist === "slip" || !!ev.ending;
  const exposed = f.kind === "secret" && (lost || rp.twist === "slip" || (ev.result === "loss" && (rp.stage === "crisis" || rp.stage === "climax")));
  const end = (o: Arc, result: EndResult, text: string) => out.push({ arc: o, act: "end", result, text, why: `${arcWords(f)} ended` });
  const answer = (o: Arc, mod: number, why: string) => out.push({ arc: o, act: "answer", mod, why });
  for (const o of arcs) {
    if (o.id === f.id || o.status !== "running" || moved.has(o.id) || o.clock.cur >= o.clock.max) continue;
    // Outcomes that settle another subplot outright.
    if (met && f.kind === "reconcile" && o.kind === "rift" && pair(o, f)) end(o, "met", `In the end, the rift between ${o.leadName} and ${name(o.target)} closed: ${f.leadName} made amends.`);
    else if (met && hostile && X && o.kind === "protect" && o.target === X) end(o, "lost", `In the end, ${o.leadName} couldn't keep ${xName} safe from ${f.leadName}.`);
    else if (lost && hostile && X && o.kind === "protect" && o.target === X) end(o, "met", `In the end, the danger to ${xName} passed: ${f.leadName} had failed, and ${o.leadName} was there.`);
    else if (met && f.kind === "courtship" && X && o.kind === "courtship" && o.target === X && o.lead !== f.lead) end(o, "lost", `In the end, ${xName} chose ${f.leadName}, and ${o.leadName} was left with nothing to hope for.`);
    else if (met && f.kind === "rivalry" && o.kind === "rivalry" && pair(o, f)) end(o, "lost", `In the end, ${f.leadName} came out on top, and ${o.leadName} had to swallow it.`);
    // Outcomes that turn another subplot's dice hard.
    else if (met && f.kind === "investigation" && X && o.lead === X && (o.kind === "scheme" || o.kind === "secret")) answer(o, -2, `${f.leadName} found them out`);
    else if (met && f.kind === "protect" && X && SPECS[o.kind].hostile && o.target === X) answer(o, -2, `${xName} is guarded now`);
    else if (exposed && o.kind === "investigation" && o.target === f.lead) answer(o, 2, `${f.leadName}'s secret slipped`);
    else if (met && f.kind === "debt" && X && o.lead === X) answer(o, -1, `${f.leadName} collected what ${xName} owed`);
    else if (decisive(rp)) {
      // The rest answer by how they're linked: tied, aimed at the same person, or led by someone close to it.
      const isTied = tied(o, f, r).length > 0;
      const sameTarget = !!X && o.target === X;
      const close = closeOne(o, f, r);
      if (!isTied && !sameTarget && !close) continue;
      if (!isTied && !aware(f, o.lead, r, slipped)) continue;
      const g = swing(ev.result);
      const harmed = close && ((close.id === f.target && hostile && g > 0) || (close.id === f.lead && g < 0)) ? close.name : undefined;
      out.push({ arc: o, act: "answer", mod: 0, why: `answering ${arcWords(f)}`, ...(harmed ? { heat: Math.min(3, o.heat + 1), harmed } : {}) });
    }
  }
  return out;
}

/**
 * Harm done to someone moves the people close to them: a hostile step that lands on its target makes
 * someone who cares start protecting them; one that ends it makes them want it answered.
 */
export function sparkFrom(rp: Ripple, arcs: Arc[], r: Roster, declined: Set<string>): Cand | null {
  const f = rp.from;
  const ev = rp.ev;
  if (!SPECS[f.kind].hostile || !f.target) return null;
  const harmed = ev.ending ? ev.result === "met" || ev.result === "price" : ev.result === "win" && decisive(rp);
  if (!harmed) return null;
  const x = r.actors.get(f.target);
  const fl = r.actors.get(f.lead);
  if (!x) return null;
  const kind = ev.ending ? "revenge" : "protect";
  if (kind === "revenge" && (!fl || fl.dead || fl.isUser)) return null;
  const against = kind === "revenge" ? f.lead : x.id;
  const running = arcs.filter((a) => a.status === "running" || a.status === "fate");
  const c = [...r.actors.values()]
    .filter((c) => c.id !== x.id && c.id !== f.lead && canLead(c).ok && reach(c, x, "ripple").ok)
    .filter((c) => running.filter((a) => a.lead === c.id).length < 2 && !running.some((a) => a.lead === c.id && a.target === against))
    .filter((c) => aware(f, c.id, r, rp.twist === "slip" || !!ev.ending) && !declined.has(`${c.id}|${kind}|arc:${f.id}`))
    .sort((a, b) => (b.ties.get(x.id) ?? 0) - (a.ties.get(x.id) ?? 0) || a.id.localeCompare(b.id))[0];
  if (!c) return null;
  const base = { lead: c.id, leadName: c.name, grounds: [`arc:${f.id}`], score: 1, why: `answering ${arcWords(f)}`, key: `${c.id}|${kind}|arc:${f.id}` };
  return kind === "revenge"
    ? { ...base, kind, cast: [f.lead], target: f.lead, premise: `${c.name} won't let what ${f.leadName} did to ${x.name} stand.` }
    : { ...base, kind, cast: [x.id], target: x.id, premise: `${c.name} has caught wind that ${f.leadName} is moving against ${x.name}, and means to keep ${x.name} safe.` };
}

// ---------- plot threads ----------

/** The plot thread a subplot is about: the one it crossed into, or the one it grew from. */
export function threadOf(arc: Arc, st: WorldState): Thread | undefined {
  const id = arc.thread ?? arc.grounds.find((g) => g.startsWith("thread:"))?.slice(7);
  return id ? st.threads[id] : undefined;
}

/** How a subplot signs what it writes on a thread, so it doesn't answer itself. */
const offPage = (a: Arc) => `Off the page (${arcWords(a)})`;

/** A decisive step of a subplot about a thread moves the thread: forward if it went well, harder if not. */
export function threadNote(arc: Arc, rp: Pick<Ripple, "ev" | "stage" | "twist">, st: WorldState): Op | null {
  const t = threadOf(arc, st);
  if (!t || t.status === "resolved" || !decisive(rp)) return null;
  const good = swing(rp.ev.result) > 0 || rp.ev.result === "softened";
  const text = clip(rp.ev.text.replace(/\s+/g, " ").replace(/^In the end, /, ""), 160);
  return parseLine(`thread ${t.title}: ${good ? "advance" : "complicate"} — ${offPage(arc)}: ${text}`);
}

export interface ThreadPull {
  arc: Arc;
  mod: number;
  why: string;
  /** It answers at once, before its usual time. */
  due: boolean;
  heat?: number;
  /** The thread was settled on the page before this subplot got going: it has nothing left to do. */
  drop?: boolean;
  /** The thread's last seq: what this subplot has now seen. */
  seen: number;
  /** What happened on the thread. */
  detail?: string;
}

/** How the plot threads moved since each subplot about them last looked (on the page, or by another subplot). */
export function threadPulls(arcs: Arc[], st: WorldState): ThreadPull[] {
  const out: ThreadPull[] = [];
  for (const arc of arcs) {
    if (arc.status !== "running") continue;
    const t = threadOf(arc, st);
    if (!t) continue;
    const seen = Math.max(arc.threadSeen ?? 0, arc.seq, arc.beats.at(-1)?.seq ?? 0);
    if (t.lastSeq <= seen) continue;
    const h = t.history.filter((x) => x.seq > seen && !(x.detail ?? "").startsWith(offPage(arc))).at(-1);
    const base = { arc, seen: t.lastSeq, mod: 0, due: false, why: "", ...(h?.detail ? { detail: h.detail } : {}) };
    const title = `the thread "${t.title}"`;
    if (!h) out.push(base);
    else if (h.op === "resolve") out.push(arc.by === "engine" && (arc.stage === "hook" || arc.stage === "rising") ? { ...base, drop: true, why: `${title} was settled` } : { ...base, due: true, heat: Math.min(3, arc.heat + 1), why: `${title} was settled` });
    else if (h.op === "complicate") out.push({ ...base, mod: -1, due: true, heat: Math.min(3, arc.heat + 1), why: `${title} got harder` });
    else if (h.op === "stall") out.push({ ...base, due: true, why: `${title} stalled` });
    else out.push({ ...base, mod: 1, due: true, why: `${title} moved on` });
  }
  return out;
}
