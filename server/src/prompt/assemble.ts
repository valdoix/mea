import type { CardData } from "../cards/card";
import { countTokens, MESSAGE_OVERHEAD } from "../lib/tokens";
import type { ActivationResult, TraceItem } from "../lore/activate";
import type { Role } from "../lore/types";
import type { MemoryContext, MemoryTrace } from "../memory/context";
import { cleanText, needsCleaning } from "../memory/text";
import { expandMacros, type MacroContext } from "./macros";
import { controlsText, controlValues, lengthHint, type Preset, type PromptBlock } from "./preset";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface HistoryMessage {
  id: string;
  role: Role;
  content: string;
  seq?: number;
}

export type AssembleKind = "story" | "continue" | "impersonate" | "expand";

export interface AssembleInput {
  kind: AssembleKind;
  preset: Preset;
  card: CardData;
  userName: string;
  personaText: string;
  mode: "companion" | "narrator";
  /** Visible, non-hidden messages, oldest first. For "continue", the last one is the partial reply. */
  history: HistoryMessage[];
  authorsNote?: { content: string; depth?: number; role?: Role };
  lore: ActivationResult | null;
  /** Prompt size target in tokens (CTX-01), not the model's maximum. */
  contextTarget: number;
  modelId: string;
  vars: Record<string, string>;
  seed: string;
  draft?: string;
  feedback?: string;
  now?: Date;
  /**
   * Memory (MEM-02): given the tokens left for memory + history, returns the Story So Far,
   * recalled memories, and the verbatim window. Without it, history is trimmed newest-first.
   */
  memory?: (available: number) => MemoryContext;
  /** Provider tokens per estimated token for this model (CTX-03). */
  tokenRatio?: number;
  /** Strip markup and reasoning from messages older than this depth (CTX-07). 0 = off. */
  filterDepth?: number;
  /**
   * Extra blocks from chat tools and trackers (TRK-06, CHAT-09…13): the story-state note, story
   * settings, OOC notes, cues, guidance. `prefix` blocks join the stable cached prefix; the rest
   * go in at a depth.
   */
  extras?: PromptExtra[];
  /** PROMPT-07: the active preset controls, already rendered. */
  controls?: string;
  /** Every control's value, readable in blocks as {{ctl.id}}. */
  controlValues?: Record<string, string>;
  /** Evaluates a block's `when` against the story state; blocks with a condition need it to hold. */
  when?: (cond: string) => boolean;
  /** A swipe: the take it replaces, so the new one can open differently. */
  swipe?: { rejected: string };
}

export interface PromptExtra {
  id: string;
  name: string;
  content: string;
  /** Messages from the end (0 = after the last message). Ignored for prefix blocks. */
  depth?: number;
  role?: Role;
  prefix?: boolean;
}

export interface BlockTrace {
  id: string;
  name: string;
  kind: string;
  role: string;
  tokens: number;
  included: boolean;
  note?: string;
  depth?: number;
}

export interface PromptTrace {
  blocks: BlockTrace[];
  history: { included: number; total: number; tokens: number; dropped: number; evicted?: number; filtered?: number };
  lore: TraceItem[];
  /** Layer sizes in estimated tokens (CTX-01, CTX-02). */
  budget: {
    contextTarget: number;
    reserve: number;
    fixed: number;
    history: number;
    total: number;
    memory: number;
    recall: number;
    lore: number;
    ratio: number;
    effectiveTarget: number;
  };
  memory?: MemoryTrace;
}

export interface AssembleResult {
  messages: ChatMessage[];
  trace: PromptTrace;
  estPromptTokens: number;
  /** Variables after macro side effects ({{setvar}}), to persist on the chat. */
  vars: Record<string, string>;
  /** Where the stable prefix and the history end, for explicit caching (CONN-12). */
  cacheMarks: { prefixEnd: number; historyEnd: number };
  /** The verbatim window's start, to persist when the request is sent (CTX-05). */
  evictedThrough: number | null;
}

const tok = (s: string) => countTokens(s) + MESSAGE_OVERHEAD;

const words = (s: string) => (needsCleaning(s) ? cleanText(s) : s).replace(/^\s*#.*$/gm, "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
/** The first or last few words of a reply, for the echo guard (none for short replies). */
function edge(text: string, n: number, end: "open" | "close"): string {
  const w = words(text);
  if (w.join(" ").length < 200) return "";
  return (end === "open" ? w.slice(0, n) : w.slice(-n)).join(" ");
}

function characterBlock(card: CardData, x: (s: string) => string): string {
  const parts = [`## ${card.name}`];
  if (card.description.trim()) parts.push(x(card.description));
  if (card.personality.trim()) parts.push(`### Personality\n${x(card.personality)}`);
  if (card.scenario.trim()) parts.push(`### Scenario\n${x(card.scenario)}`);
  return parts.length > 1 ? parts.join("\n\n") : "";
}

function examplesBlock(raw: string, top: string[] = [], bottom: string[] = [], x: (s: string) => string): string {
  const chunks = raw
    .split(/<START>/i)
    .map((c) => x(c).trim())
    .filter(Boolean);
  const parts: string[] = [...top];
  if (chunks.length) parts.push(`Example dialogue (a style reference only, not events in this story):\n${chunks.join("\n---\n")}`);
  parts.push(...bottom);
  return parts.join("\n\n").trim();
}

type Tag = "prefix" | "history" | "dynamic" | "tail";
interface Tagged extends ChatMessage {
  tag: Tag;
}

type Inline = { kind: "msg"; msg: ChatMessage } | { kind: "history" } | { kind: "memory"; trace: BlockTrace; role: Role };
interface DepthItem {
  depth: number;
  role: Role;
  content: string;
  order: number;
  recall?: BlockTrace;
}

/**
 * Values blocks can read about the reply being written: {{kind}}, {{turn}}, {{isFirst}}, {{isSwipe}},
 * {{rejectedOpening}}, {{lastOpening}} / {{lastClosing}} (the echo guard), {{persona}} and
 * {{userSealed}} (the Persona control), {{ledger}} (inline tracker mode), and {{ctl.id}} for every preset control.
 */
function turnExtras(input: AssembleInput, lastReply: string): Record<string, string> {
  // Without values from the chat (tests, previews), the preset's own defaults apply.
  const ctl = input.controlValues ?? controlValues(input.preset.controls);
  const persona = ctl.persona ?? "";
  const replies = input.history.filter((m) => m.role === "assistant").length;
  const rejected = input.swipe ? words(input.swipe.rejected).slice(0, 16).join(" ") : "";
  return {
    draft: input.draft ?? "",
    kind: input.kind,
    turn: String(input.history.length),
    // The reply right after the card's opening message (none when the card has no greeting).
    isFirst: replies === 1 && input.history.find((m) => m.role !== "system")?.role === "assistant" && input.kind === "story" ? "yes" : "",
    isSwipe: input.swipe ? "yes" : "",
    rejectedOpening: rejected,
    lastOpening: edge(lastReply, 14, "open"),
    lastClosing: edge(lastReply, 14, "close"),
    persona,
    userSealed: persona === "director" || persona === "full_cast" ? "" : "yes",
    ledger: input.extras?.some((e) => e.id === "ledger") ? "yes" : "",
    ...Object.fromEntries(Object.entries(ctl).map(([k, v]) => [`ctl.${k}`, v])),
  };
}

/**
 * Builds the final message list for a request (PROMPT-01), with a full trace for the inspector (DBG-01).
 * Layout is cache-friendly (CTX-04): stable blocks and the Story So Far first, then the history,
 * with per-turn content (recall, triggered lore, notes) at shallow depth near the end.
 */
export function assemblePrompt(input: AssembleInput): AssembleResult {
  const { card, preset } = input;
  const lastOf = (role: Role) => [...input.history].reverse().find((m) => m.role === role)?.content ?? "";
  const ctx: MacroContext = {
    char: card.name,
    user: input.userName,
    persona: input.personaText,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    mesExamples: card.mes_example,
    charPrompt: card.system_prompt,
    charInstruction: card.post_history_instructions,
    mode: input.mode,
    model: input.modelId,
    lastMessage: input.history.at(-1)?.content ?? "",
    lastUserMessage: lastOf("user"),
    lastCharMessage: lastOf("assistant"),
    vars: { ...input.vars },
    seed: input.seed,
    // The turn is the same on every swipe of a reply (a swipe's history leaves the reply out).
    turn: input.history.length,
    extra: turnExtras(input, lastOf("assistant")),
    now: input.now,
  };
  const x = (s: string | undefined) => expandMacros(s ?? "", ctx).trim();
  const lore = input.lore?.placements;
  const reserve = preset.samplers.max_tokens ?? 1200;
  const ratio = input.tokenRatio && input.tokenRatio > 0 ? input.tokenRatio : 1;
  const effectiveTarget = Math.floor(input.contextTarget / ratio);

  const inline: Inline[] = [];
  const depthItems: DepthItem[] = [];
  const blocks: BlockTrace[] = [];
  let loreTokens = 0;

  preset.blocks.forEach((block: PromptBlock, index) => {
    const trace: BlockTrace = { id: block.id, name: block.name, kind: block.kind, role: block.role, tokens: 0, included: false };
    blocks.push(trace);
    if (!block.enabled) {
      trace.note = "disabled";
      return;
    }
    if (block.when?.trim() && !input.when?.(block.when)) {
      trace.note = `only when ${block.when.trim()}`;
      return;
    }
    let content = "";
    switch (block.kind) {
      case "text":
        content = block.id === "main" && card.system_prompt.trim() ? x(card.system_prompt.replace(/\{\{original\}\}/gi, block.content ?? "")) : x(block.content);
        if (block.id === "main" && card.system_prompt.trim()) trace.note = "replaced by the character's system prompt";
        break;
      case "character":
        content = characterBlock(card, x);
        break;
      case "controls":
        content = x(input.controls ?? controlsText(preset.controls));
        break;
      case "description":
        content = x(card.description);
        break;
      case "personality":
        content = card.personality.trim() ? `${card.name}'s personality: ${x(card.personality)}` : "";
        break;
      case "scenario":
        content = card.scenario.trim() ? `Scenario: ${x(card.scenario)}` : "";
        break;
      case "persona":
        content = input.personaText.trim() ? `About ${input.userName}:\n${x(input.personaText)}` : "";
        break;
      case "examples":
        content = examplesBlock(card.mes_example, lore?.ex_top, lore?.ex_bottom, x);
        break;
      case "lore_before":
        content = (lore?.before_char ?? []).join("\n\n");
        if (content) loreTokens += tok(content);
        break;
      case "lore_after":
        content = (lore?.after_char ?? []).join("\n\n");
        if (content) loreTokens += tok(content);
        break;
      case "history":
        inline.push({ kind: "history" });
        trace.included = true;
        return;
      case "memory_story":
        // Filled in once the memory context is known (it depends on the space left).
        inline.push({ kind: "memory", trace, role: block.role });
        return;
      case "memory_recall": {
        const depth = block.position === "depth" ? (block.depth ?? 1) : 1;
        trace.depth = depth;
        depthItems.push({ depth, role: block.role, content: "", order: index, recall: trace });
        return;
      }
      case "authors_note":
        content = [...(lore?.an_top ?? []), x(input.authorsNote?.content ?? block.content ?? ""), ...(lore?.an_bottom ?? [])].filter(Boolean).join("\n");
        break;
      case "post_history": {
        const phi = card.post_history_instructions.trim();
        content = phi ? x(phi.replace(/\{\{original\}\}/gi, block.content ?? "")) : x(block.content);
        break;
      }
    }
    if (!content) {
      trace.note = "empty";
      return;
    }
    trace.included = true;
    trace.tokens = tok(content);
    const isNote = block.kind === "authors_note";
    if (block.position === "depth" || (isNote && input.authorsNote?.depth != null)) {
      const depth = isNote && input.authorsNote?.depth != null ? input.authorsNote.depth : (block.depth ?? 4);
      trace.depth = depth;
      depthItems.push({ depth, role: isNote && input.authorsNote?.role ? input.authorsNote.role : block.role, content, order: index });
    } else {
      inline.push({ kind: "msg", msg: { role: block.role, content } });
    }
  });

  for (const [i, e] of (input.extras ?? []).entries()) {
    const content = e.content.trim();
    const trace: BlockTrace = { id: `extra:${e.id}`, name: e.name, kind: "extra", role: e.role ?? "system", tokens: content ? tok(content) : 0, included: Boolean(content) };
    blocks.push(trace);
    if (!content) continue;
    if (e.prefix) {
      // Stable blocks go just before the history so the cached prefix stays unchanged turn to turn.
      const at = inline.findIndex((x) => x.kind === "history");
      inline.splice(at < 0 ? inline.length : at, 0, { kind: "msg", msg: { role: e.role ?? "system", content } });
    } else {
      trace.depth = e.depth ?? 1;
      depthItems.push({ depth: e.depth ?? 1, role: e.role ?? "system", content, order: 500 + i });
    }
  }

  for (const d of lore?.depth ?? []) {
    depthItems.push({ depth: d.depth, role: d.role, content: d.content, order: 1000 + d.order });
    loreTokens += tok(d.content);
  }

  // Keyword-triggered lore rides with the recalled memories in the dynamic block (CTX-04).
  const triggered = (lore?.triggered ?? []).join("\n\n");
  if (triggered) loreTokens += tok(triggered);
  const recallItem = depthItems.find((d) => d.recall);
  if (!recallItem && triggered) depthItems.push({ depth: 1, role: "system", content: triggered, order: 999 });

  const hint = lengthHint(preset);
  if (input.kind === "story" && hint) depthItems.push({ depth: 0, role: "system", content: hint, order: 9000 });
  if (input.feedback?.trim() && (input.kind === "story" || input.kind === "continue")) {
    depthItems.push({ depth: 0, role: "system", content: `[Note for this reply: ${input.feedback.trim()}]`, order: 9001 });
  }

  const tail: ChatMessage[] = [];
  if (input.kind === "continue") tail.push({ role: "system", content: x(preset.continuePrompt) });
  if (input.kind === "impersonate") tail.push({ role: "system", content: x(preset.impersonationPrompt) });
  if (input.kind === "expand") tail.push({ role: "system", content: x(preset.expandPrompt) });
  // Nothing new from the player, and the last message is already a reply: the world moves on.
  if (input.kind === "story" && input.history.at(-1)?.role === "assistant" && preset.waitPrompt.trim()) tail.push({ role: "system", content: x(preset.waitPrompt) });
  if (input.kind === "story" && preset.prefill.trim()) tail.push({ role: "assistant", content: x(preset.prefill) });

  const fixed =
    inline.reduce((n, i) => n + (i.kind === "msg" ? tok(i.msg.content) : 0), 0) +
    depthItems.reduce((n, d) => n + (d.content ? tok(d.content) : 0), 0) +
    tail.reduce((n, m) => n + tok(m.content), 0) +
    (triggered && recallItem ? tok(triggered) : 0);
  const available = Math.max(0, effectiveTarget - reserve - fixed - 32);

  // Memory: the Story So Far, recalled memories, and which messages stay verbatim.
  const mem = input.memory?.(available);
  const memoryInline = inline.find((i): i is Extract<Inline, { kind: "memory" }> => i.kind === "memory");
  const storyText = mem?.story && memoryInline ? mem.story : "";
  const recallMemory = mem?.recall && recallItem ? mem.recall : "";
  const recallText = [triggered, recallMemory].filter(Boolean).join("\n\n");
  if (memoryInline) {
    memoryInline.trace.included = Boolean(storyText);
    memoryInline.trace.tokens = storyText ? tok(storyText) : 0;
    if (!storyText) memoryInline.trace.note = mem ? (mem.trace.enabled ? "nothing has left the window yet" : "memory is off") : "memory is off";
  }
  if (recallItem) {
    recallItem.content = recallText;
    recallItem.recall!.included = Boolean(recallText);
    recallItem.recall!.tokens = recallText ? tok(recallText) : 0;
    if (!recallText) recallItem.recall!.note = "nothing to recall";
  }
  const memoryTokens = (storyText ? tok(storyText) : 0) + (recallMemory ? tok(recallMemory) : 0);
  const historyBudget = Math.max(0, available - memoryTokens);
  const source = mem?.history ?? input.history;

  // Newest messages first until the budget is used; always keep the latest message.
  const chosen: HistoryMessage[] = [];
  let historyTokens = 0;
  for (let i = source.length - 1; i >= 0; i--) {
    const m = source[i]!;
    const t = tok(m.content);
    if (historyTokens + t > historyBudget && chosen.length > 0) break;
    chosen.unshift(m);
    historyTokens += t;
  }

  // CTX-07: older messages lose markup, reasoning, and status blocks; recent ones stay exact.
  let filtered = 0;
  const filterDepth = input.filterDepth ?? 0;
  const hist: ChatMessage[] = chosen.map((m, i) => {
    const depth = chosen.length - i;
    if (filterDepth > 0 && depth > filterDepth && needsCleaning(m.content)) {
      filtered++;
      return { role: m.role, content: cleanText(m.content) };
    }
    return { role: m.role, content: m.content };
  });

  const slots: Tagged[][] = Array.from({ length: hist.length + 1 }, () => []);
  for (const d of [...depthItems].sort((a, b) => a.order - b.order)) {
    if (!d.content) continue;
    slots[Math.max(0, hist.length - d.depth)]!.push({ role: d.role, content: d.content, tag: "dynamic" });
  }
  const merged: Tagged[] = [];
  for (let i = 0; i <= hist.length; i++) {
    merged.push(...slots[i]!);
    if (i < hist.length) merged.push({ ...hist[i]!, tag: "history" });
  }

  let tagged: Tagged[] = [];
  let placedHistory = false;
  for (const item of inline) {
    if (item.kind === "history") {
      tagged.push(...merged);
      placedHistory = true;
    } else if (item.kind === "memory") {
      if (storyText) tagged.push({ role: item.role, content: storyText, tag: placedHistory ? "tail" : "prefix" });
    } else tagged.push({ ...item.msg, tag: placedHistory ? "tail" : "prefix" });
  }
  if (!placedHistory) tagged.push(...merged);
  tagged.push(...tail.map((m) => ({ ...m, tag: "tail" as const })));

  // Squash the leading run of system messages into one (friendlier to most providers).
  const firstNonSystem = tagged.findIndex((m) => m.role !== "system");
  const lead = firstNonSystem < 0 ? tagged.length : firstNonSystem;
  if (lead > 1) {
    const head = tagged.slice(0, lead);
    const tag: Tag = head.find((m) => m.tag !== "prefix")?.tag ?? "prefix";
    tagged = [{ role: "system", content: head.map((m) => m.content).join("\n\n"), tag }, ...tagged.slice(lead)];
  }

  // Cache marks: the stable prefix ends before the history; the history ends before the first per-turn item.
  const firstHistory = tagged.findIndex((m) => m.tag !== "prefix");
  const prefixEnd = firstHistory < 0 ? tagged.length - 1 : firstHistory - 1;
  const firstDynamic = tagged.findIndex((m) => m.tag === "dynamic" || m.tag === "tail");
  const historyEnd = Math.max(prefixEnd, firstDynamic < 0 ? tagged.length - 1 : firstDynamic - 1);

  const messages: ChatMessage[] = tagged.map(({ role, content }) => ({ role, content }));
  const estPromptTokens = messages.reduce((n, m) => n + tok(m.content), 0);
  return {
    messages,
    estPromptTokens,
    vars: ctx.vars,
    cacheMarks: { prefixEnd, historyEnd },
    evictedThrough: mem ? mem.evictedThrough : null,
    trace: {
      blocks,
      history: {
        included: chosen.length,
        total: input.history.length,
        tokens: historyTokens,
        dropped: input.history.length - chosen.length,
        evicted: mem ? input.history.length - source.length : undefined,
        filtered,
      },
      lore: input.lore?.trace ?? [],
      budget: {
        contextTarget: input.contextTarget,
        reserve,
        fixed,
        history: historyTokens,
        total: estPromptTokens,
        memory: storyText ? tok(storyText) : 0,
        recall: recallMemory ? tok(recallMemory) : 0,
        lore: loreTokens,
        ratio,
        effectiveTarget,
      },
      memory: mem?.trace,
    },
  };
}
