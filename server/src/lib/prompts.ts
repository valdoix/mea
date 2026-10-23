import { z } from "zod";
import { getSetting } from "./settings";

/**
 * Service prompt profiles (PROMPT-09): every helper prompt (summaries, trackers, the checker, the
 * Archivist, the studios…) can be added to or replaced, grouped into named sets you switch between.
 * Your text lives in settings, separate from Mea's defaults, so it survives updates; deleting an
 * override restores the default. The reply contract (the JSON shape, "reply with only…") is always
 * kept, so a replaced prompt can't break the parser.
 */

export const overrideSchema = z.object({ mode: z.enum(["append", "replace"]), text: z.string().max(20_000) });
export const promptSetSchema = z.object({ id: z.string().min(1).max(60), name: z.string().min(1).max(80), overrides: z.record(z.string(), overrideSchema) });
export type PromptSet = z.infer<typeof promptSetSchema>;

export interface ServicePrompt {
  id: string;
  group: string;
  label: string;
  help: string;
  match: (kind: string) => boolean;
}

const is =
  (...kinds: string[]) =>
  (k: string) =>
    kinds.includes(k);
const starts =
  (...prefixes: string[]) =>
  (k: string) =>
    prefixes.some((p) => k.startsWith(p));

/** Order matters: the first match wins. "global" applies to every helper (append only). */
export const SERVICE_PROMPTS: ServicePrompt[] = [
  { id: "memory.scene", group: "Memory", label: "Scene records", help: "Summarises each scene into a record with memories, quotes and changes.", match: is("scene", "scene-repair") },
  { id: "memory.verify", group: "Memory", label: "Summary check", help: "Checks a record against the messages it came from.", match: is("verify") },
  { id: "memory.rollup", group: "Memory", label: "Chapters, arcs and the story so far", help: "Rolls records up into longer summaries.", match: is("chapter", "arc", "story") },
  { id: "memory.boundary", group: "Memory", label: "Scene breaks", help: "Decides whether a new scene started.", match: is("gate:scene") },
  { id: "memory.journal", group: "Memory", label: "Journals", help: "First-person journals of the cast.", match: is("journal") },
  { id: "memory.librarian", group: "Memory", label: "Librarian and recall query", help: "Picks which memories matter now, and rewrites the search query.", match: is("librarian", "librarian:query") },
  { id: "memory.sleep", group: "Memory", label: "Sleep (consolidation)", help: "Digests trivia and refreshes entity descriptions.", match: is("digest", "entity") },
  { id: "memory.recap", group: "Memory", label: "Recap", help: "The “previously on” recap.", match: is("recap") },
  { id: "trackers.ledger", group: "Trackers and world", label: "Tracker ledger", help: "Writes the story-state ledger after each reply.", match: is("tracker", "tracker:start") },
  { id: "trackers.gate", group: "Trackers and world", label: "Tracker gate", help: "Decides whether anything trackable changed.", match: is("gate:tracker") },
  { id: "world.telling", group: "Trackers and world", label: "The world off the page", help: "Tells what happened elsewhere.", match: is("world:telling") },
  { id: "world.wording", group: "Trackers and world", label: "New subplots", help: "Words the subplots the world offers or starts.", match: is("world:wording") },
  { id: "accuracy.checker", group: "Accuracy", label: "Continuity checker", help: "Checks replies against established facts.", match: is("continuity") },
  { id: "accuracy.archivist", group: "Accuracy", label: "Archivist", help: "Answers questions about the story with citations.", match: is("archivist") },
  { id: "accuracy.quiz", group: "Accuracy", label: "Memory quiz", help: "Asks and answers the memory quiz.", match: is("quiz", "quiz:answer") },
  { id: "lore.assist", group: "Lore", label: "Lore entry assist", help: "Draft, keys, condense and tidy in the lorebook editor.", match: starts("lore:") },
  { id: "lore.chronicle", group: "Lore", label: "Chronicle", help: "Story-born lore proposals.", match: is("chronicle") },
  { id: "studio.plan", group: "Lore", label: "Lore Studio: questions and plan", help: "Read-back, directions and the outline.", match: is("studio:readback", "studio:directions", "studio:outline") },
  { id: "studio.entries", group: "Lore", label: "Lore Studio: entries", help: "Writes each entry; checks for contradictions.", match: is("studio:entry", "studio:consistency") },
  { id: "creator.expand", group: "Creators", label: "Expand my idea", help: "Expanding, going deeper, extending answers.", match: (k) => k.startsWith("expand:") || k === "extend" },
  { id: "creator.interview", group: "Creators", label: "Creator: questions", help: "What Mea understood, and the interview.", match: is("creator:readback") },
  { id: "creator.bible", group: "Creators", label: "Creator: bible", help: "Writes, rewrites and checks the bible.", match: is("creator:bible", "creator:bible-section", "creator:bible-check") },
  { id: "creator.fields", group: "Creators", label: "Creator: card fields", help: "Writes the description, greetings, examples and the rest.", match: starts("creator:") },
  { id: "creator.tools", group: "Creators", label: "Card tools", help: "Field actions, sorting notes, card review, greetings, rules, voice lab, variants.", match: (k) => k.startsWith("assist:") || k === "variant" },
];

export const GLOBAL_ID = "global";

export function servicePromptFor(kind: string) {
  return SERVICE_PROMPTS.find((p) => p.match(kind)) ?? null;
}

function activeSet(): PromptSet | null {
  const id = getSetting("prompts.active");
  if (!id) return null;
  return getSetting("prompts.sets").find((s) => s.id === id) ?? null;
}

/** The output contract at the end of a default prompt ("Reply with JSON only: {…}"), kept under a replacement. */
export function replyContract(system: string) {
  const m = system.match(/(?:^|\n|\.\s+)(Reply (?:with|in)[\s\S]*)$/);
  return m ? m[1]!.trim() : "";
}

/** The system prompt with your overrides for this kind applied. */
export function applyServicePrompt(kind: string, system: string, set: PromptSet | null = activeSet()): string {
  if (!set) return system;
  const sp = servicePromptFor(kind);
  const own = sp ? set.overrides[sp.id] : undefined;
  const global = set.overrides[GLOBAL_ID];
  if (!own?.text.trim() && !global?.text.trim()) return system;
  // Your text goes before the reply contract, which always stays last.
  const contract = replyContract(system);
  const head = contract ? system.slice(0, system.lastIndexOf(contract)).trimEnd() : system;
  let body = head;
  if (own?.text.trim()) {
    if (own.mode === "append") body = `${head}\n\nAdditional instructions from the author:\n${own.text.trim()}`;
    else body = own.text.includes("{{default}}") ? own.text.replace(/\{\{default\}\}/g, head).trim() : own.text.trim();
  }
  if (global?.text.trim()) body = `${body}\n\nAlways: ${global.text.trim()}`;
  return contract ? `${body}\n\n${contract}` : body;
}
