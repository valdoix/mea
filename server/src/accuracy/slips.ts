import type { GuardsConfig } from "../lib/settings";
import type { WorldState } from "../trackers/types";
import type { Issue } from "./checker";
import { guardInput, type GuardInput, nameGuard, povGuard, puppetGuard, tenseGuard } from "./guards";
import { deadRule, leakRule, nameRule, ruleInput, type RuleInput, timeRule, traitRule } from "./rules";
import { timelineIssues } from "./timeline";

/**
 * The slip registry (Almanac plan P1): every check Mea runs on a reply, in one list. A check is a
 * function from the reply (and the story state as the reply found it) to issues. Each can be
 * switched off per chat in Chat › Guards (`guards.slips`), on top of the switch it already had.
 * A new check is one entry here, usually with its rule in a file of its own.
 */

export type Found = Omit<Issue, "id">;

export interface SlipContext {
  chatId: string;
  text: string;
  seq: number;
  messageId?: string;
  role: string;
  /** Who wrote the reply (the character, or a narrator's speaker). */
  speaker: string;
  state: WorldState | null;
  guards: GuardsConfig;
  /** CON-02: the continuity checker is on (Settings › Memory). */
  continuity: boolean;
  /** CON-06: the knowledge-leak guard is on for this chat. */
  leaks: boolean;
  /** What the checks before this one found in this pass (a later check can build on them). */
  found?: Found[];
  /** Shared, lazily built inputs for the rules and the guards. */
  rules: () => RuleInput;
  guard: () => GuardInput;
}

export interface Slip {
  id: string;
  label: string;
  /** One line for Chat › Guards. */
  description: string;
  /** "reply": checked right after a reply; "trackers": once the trackers have read it. */
  phase: "reply" | "trackers";
  /** The check's own conditions (its existing switch, the message's role); the per-chat toggle is separate. */
  on: (ctx: SlipContext) => boolean;
  run: (text: string, state: WorldState | null, ctx: SlipContext) => Found[];
  /** The guard setting that also governs it, so Chat › Guards shows one switch, not two. */
  setting?: keyof GuardsConfig;
}

const assistant = (ctx: SlipContext) => ctx.role === "assistant";

export const SLIPS: Slip[] = [
  { id: "trait", label: "Looks", description: "Eye and hair colour against the story's records and the card.", phase: "reply", on: (c) => c.continuity, run: (_t, _s, c) => traitRule(c.rules()) },
  { id: "dead", label: "The dead", description: "Someone dead speaking or acting.", phase: "reply", on: (c) => c.continuity, run: (_t, _s, c) => deadRule(c.rules()) },
  { id: "time", label: "Time of day", description: "Morning or night against the story clock.", phase: "reply", on: (c) => c.continuity, run: (_t, _s, c) => timeRule(c.rules()) },
  {
    id: "name",
    label: "Names",
    description: "Names that look like typos of names the story knows.",
    phase: "reply",
    setting: "names",
    on: (c) => c.guards.names !== "off" && (c.continuity || assistant(c)),
    run: (_t, _s, c) => (c.continuity ? nameRule(c.rules()) : nameGuard(c.guard())),
  },
  { id: "leak", label: "Knowledge leaks", description: "Someone using a secret they don't know.", phase: "reply", on: (c) => c.continuity && c.leaks, run: (_t, _s, c) => leakRule(c.rules()) },
  { id: "puppet", label: "Writing for you", description: "The reply writing your character's words or actions.", phase: "reply", setting: "puppet", on: (c) => assistant(c) && c.guards.puppet, run: (_t, _s, c) => puppetGuard(c.guard()) },
  { id: "pov", label: "Point of view", description: "Who narrates, and how you're addressed.", phase: "reply", setting: "pov", on: (c) => assistant(c) && c.guards.pov, run: (_t, _s, c) => povGuard(c.guard()) },
  { id: "tense", label: "Tense", description: "Past or present, and replies that wobble between them.", phase: "reply", setting: "tense", on: (c) => assistant(c) && c.guards.tense, run: (_t, _s, c) => tenseGuard(c.guard()) },
  {
    id: "timeline",
    label: "Timeline",
    description: "The clock running backwards or jumping with nothing said.",
    phase: "trackers",
    setting: "timeline",
    on: (c) => c.guards.timeline && Boolean(c.messageId),
    run: (_t, _s, c) => timelineIssues(c.chatId, c.messageId!),
  },
];

export const slipById = (id: string) => SLIPS.find((s) => s.id === id);

/** The per-chat toggle (Chat › Guards): on unless switched off. */
export const slipAllowed = (id: string, guards: GuardsConfig) => guards.slips?.[id] !== false;

export function slipContext(o: Omit<SlipContext, "rules" | "guard">): SlipContext {
  let r: RuleInput | null = null;
  let g: GuardInput | null = null;
  return {
    ...o,
    rules: () => (r ??= ruleInput(o.chatId, o.text, o.state, { speaker: o.speaker, messageId: o.messageId })),
    guard: () => (g ??= guardInput(o.chatId, o.text, { seq: o.seq, messageId: o.messageId, cfg: o.guards })),
  };
}

/**
 * Runs the checks of one phase that are on, in registry order. A check that throws is skipped
 * (and reported through `onError`), never the whole pass.
 */
export function runSlips(ctx: SlipContext, phase: Slip["phase"], onError?: (id: string, e: Error) => void): Found[] {
  const out: Found[] = [];
  ctx.found = out;
  for (const s of SLIPS) {
    if (s.phase !== phase || !slipAllowed(s.id, ctx.guards) || !s.on(ctx)) continue;
    try {
      out.push(...s.run(ctx.text, ctx.state, ctx));
    } catch (e) {
      onError?.(s.id, e as Error);
    }
  }
  return out;
}

/**
 * The list Chat › Guards shows: each check, whether its switch here is on, the setting that also
 * governs it, and whether it would run on the next reply (`runs`: switched on and nothing else stops it).
 */
export function slipCatalog(chatId: string, guards: GuardsConfig, env: { continuity: boolean; leaks: boolean }) {
  const ctx = slipContext({ chatId, text: "", seq: 0, messageId: "-", role: "assistant", speaker: "", state: null, guards, ...env });
  return SLIPS.map((s) => {
    const on = slipAllowed(s.id, guards) && (!s.setting || guards[s.setting] !== false) && !(s.setting === "names" && guards.names === "off");
    return { id: s.id, label: s.label, description: s.description, phase: s.phase, setting: s.setting ?? null, on, runs: on && s.on(ctx) };
  });
}
