import type { WorldState } from "../trackers/types";
import { rng } from "./dice";
import { SPECS } from "./grammar";
import type { Arc, SimState } from "./types";

/**
 * The drama director: reads how tense the story is (on the page and off it) and nudges the
 * world toward a target curve set by a storyteller personality. Below the target it escalates
 * (more beats, more twists, heat up on a hostile subplot); above it, it eases (fewer beats, kinder
 * dice, a quiet stretch). It never writes the story; it only leans on the dice.
 */
export type Personality = "steady" | "rising" | "chaotic" | "gentle";

export const PERSONALITIES: Record<Personality, { label: string; about: string }> = {
  steady: { label: "Steady", about: "An even hum of events; nothing piles up." },
  rising: { label: "Rising action", about: "Tension climbs over the story's days, with breathing room after each climax." },
  chaotic: { label: "Chaotic", about: "Quiet days and wild ones, at random." },
  gentle: { label: "Gentle", about: "Low stakes; losses soften, nothing irreversible off the page." },
};

const STAGE_WEIGHT = { hook: 0.4, rising: 0.7, reversal: 1, crisis: 1.4, climax: 1.8, aftermath: 0.2 } as const;

/** Story tension now, 0–10: the scene's own pressure plus what's moving off the page. */
export function measureTension(st: WorldState, sim: SimState): number {
  let t = 0;
  const mode = st.mode ?? "";
  if (/crisis|conflict/.test(mode)) t += 3;
  else if (/stealth|investigation/.test(mode)) t += 1.5;
  else if (/downtime|intimacy/.test(mode)) t -= 0.5;
  const here = Object.values(st.chars).filter((c) => c.tier === "spot" || c.tier === "peri");
  for (const c of here) {
    if (c.injuries.some((i) => i.severity >= 3)) t += 1.2;
    if ((c.meters.stress ?? 0) >= 4 || (c.meters.composure ?? 5) <= 1) t += 0.6;
  }
  const now = st.time?.minutes ?? null;
  if (now != null) {
    for (const d of Object.values(st.deadlines)) if (!d.done && d.at != null && d.at - now < 1440 && d.at - now > -120) t += 1;
    for (const o of Object.values(st.obligations)) if (o.status === "due") t += 0.5;
  }
  for (const g of Object.values(st.gauges)) if (g.cur >= g.max - 1) t += 0.8;
  const running = Object.values(sim.arcs).filter((a) => a.status === "running" || a.status === "fate");
  const off = running.reduce((n, a) => n + (0.5 + a.heat * 0.5) * STAGE_WEIGHT[a.stage] * (SPECS[a.kind].hostile ? 1.3 : 0.8), 0);
  t += Math.min(5, off * 0.6);
  return Math.max(0, Math.min(10, Math.round(t * 10) / 10));
}

/** Where the director wants tension to be at this story time. */
export function targetTension(p: Personality, sim: SimState, now: number, seed: string): number {
  const day = Math.floor(now / 1440);
  // Breathing room: right after a climax, the target dips for half a day.
  const lastEnd = Math.max(0, ...Object.values(sim.arcs).map((a) => a.ending?.at ?? 0));
  const relief = lastEnd && now - lastEnd < 12 * 60 ? 2 : 0;
  switch (p) {
    case "gentle":
      return Math.max(1, 2.5 - relief / 2);
    case "rising": {
      const first = sim.tension[0]?.at ?? now;
      const days = (now - first) / 1440;
      return Math.max(1, Math.min(8.5, 3 + days * 0.6) - relief);
    }
    case "chaotic":
      return Math.max(0.5, 1.5 + rng(`${seed}:chaos:${day}`)() * 7.5 - relief);
    default:
      return Math.max(1, 4 - relief);
  }
}

export interface DirectorLean {
  /** Multiplier on beat rates. */
  rate: number;
  /** Extra twist chance. */
  twist: number;
  /** Roll modifier for hostile subplots (positive: they do better) and for the rest. */
  hostileMod: number;
  kindMod: number;
  /** Seeding chance multiplier. */
  seed: number;
  /** Losses soften to costs (gentle). */
  soften: boolean;
  why: string;
}

export function lean(p: Personality, tension: number, target: number): DirectorLean {
  const gap = target - tension;
  if (p === "gentle") return { rate: gap > 0 ? 1 : 0.7, twist: 0, hostileMod: -1, kindMod: 1, seed: 0.8, soften: true, why: "director: gentle" };
  if (gap > 1.5) return { rate: 1.4, twist: p === "chaotic" ? 0.12 : 0.08, hostileMod: 1, kindMod: 0, seed: 1.5, soften: false, why: "director: raising the stakes" };
  if (gap > 0.5) return { rate: 1.15, twist: 0.04, hostileMod: 0, kindMod: 0, seed: 1.2, soften: false, why: "director: a little more" };
  if (gap < -1.5) return { rate: 0.6, twist: 0, hostileMod: -1, kindMod: 1, seed: 0.6, soften: false, why: "director: easing off" };
  if (gap < -0.5) return { rate: 0.85, twist: 0, hostileMod: 0, kindMod: 0, seed: 0.9, soften: false, why: "director: a breather" };
  return { rate: 1, twist: p === "chaotic" ? 0.05 : 0, hostileMod: 0, kindMod: 0, seed: 1, soften: false, why: "" };
}

/** The subplot the director turns up when the story needs more: the hottest hostile one nearest the player. */
export function escalationTarget(arcs: Arc[], reach: (a: Arc) => number): Arc | undefined {
  return arcs
    .filter((a) => a.status === "running" && SPECS[a.kind].hostile && a.heat < 3)
    .sort((x, y) => reach(y) - reach(x) || y.heat - x.heat)[0];
}
