import type { HistoryMessage, PromptExtra } from "./assemble";
import type { WorldState } from "../trackers/types";

/**
 * Prompt lanes (Almanac plan P1): what the Almanac features add to a reply's prompt, each in its
 * own named, tagged block that the Inspector lists by name with its tokens and text. A feature
 * registers a lane provider; `gatherLanes` runs them all for a reply.
 */

export const LANES = {
  lessons: { tag: "LESSONS", label: "Lessons from your swipes" },
  canon: { tag: "CANON", label: "Canon cutoff" },
  offpage: { tag: "OFFPAGE", label: "Kept off the page" },
  craft: { tag: "CRAFT", label: "Craft coach" },
  pressures: { tag: "PRESSURES", label: "Hidden pressures" },
  promises: { tag: "PROMISES", label: "Promises on the clock" },
  slips: { tag: "LAST SLIPS", label: "Last reply's slips" },
  corrections: { tag: "CORRECTIONS", label: "Out of date: what changed since" },
} as const;
export type LaneId = keyof typeof LANES;

export interface LaneExtra extends PromptExtra {
  lane: LaneId;
}

/**
 * One lane: `[TAG]` and its text, as a prompt extra the Inspector shows under its label.
 * Empty text gives null (the lane stays out of the prompt).
 */
export function lane(id: LaneId, label: string | null, text: string, opts: { depth?: number; prefix?: boolean; role?: PromptExtra["role"] } = {}): LaneExtra | null {
  const body = text.trim();
  if (!body) return null;
  const def = LANES[id];
  return { id: `lane:${id}`, name: label ?? def.label, content: `[${def.tag}]\n${body}`, depth: opts.depth ?? 1, prefix: opts.prefix, role: opts.role, lane: id };
}

/** What a lane provider gets about the reply being written. */
export interface LaneContext {
  chatId: string;
  kind: "story" | "continue" | "impersonate" | "expand";
  /** The story state as of the message being written (null when the trackers are off). */
  state: WorldState | null;
  history: HistoryMessage[];
  /** A swipe or rewrite of this message. */
  excludeMessageId?: string;
  characterId: string;
}

type LaneFn = (ctx: LaneContext) => LaneExtra | LaneExtra[] | null;
const providers: { id: LaneId; fn: LaneFn }[] = [];

export function registerLane(id: LaneId, fn: LaneFn) {
  providers.push({ id, fn });
}

/** Every lane for one reply. A lane that fails is left out (and logged), never the reply. */
export function gatherLanes(ctx: LaneContext): LaneExtra[] {
  const out: LaneExtra[] = [];
  for (const p of providers) {
    try {
      const r = p.fn(ctx);
      if (r) out.push(...(Array.isArray(r) ? r : [r]));
    } catch (e) {
      console.error(`[mea] the ${p.id} lane failed:`, e);
    }
  }
  return out;
}
