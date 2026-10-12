import type { CardData } from "../cards/card";
import { countTokens, MESSAGE_OVERHEAD } from "../lib/tokens";
import type { ActivationResult, TraceItem } from "../lore/activate";
import type { Role } from "../lore/types";
import type { MemoryContext, MemoryTrace } from "../memory/context";
import { cleanText, needsCleaning } from "../memory/text";
import { expandMacros, type MacroContext } from "./macros";
import { controlsText, controlValues, lengthHint, type Preset, type PromptBlock } from "./preset";

/** M12: the line that marks a main prompt as Mea's Charter (prompt/mea.ts), which a card's system prompt doesn't replace. */
const CHARTER_MARK = "What decides, highest first";

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

/** Said before every "Expand my draft", whatever the preset's own wording: older presets lack it. */
const DRAFT_TURN = "[Stop playing {{char}} for this one message: it is the exception to the persona rule. Don't reply to the draft below or continue the story: write {{user}}'s own message from it.]";

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
  /** Prompt size target in tokens (CTX-01), not the model's maximum. It includes the reply's room. */
  contextTarget: number;
  /** H3: tokens kept free for the reply (max_tokens as sent, thinking included). Defaults to the preset's max_tokens. */
  reserve?: number;
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
  /** H3: preset blocks left out for this request (the writer's own planning pass, when a separate planner planned). */
  skipBlocks?: string[];
  /** H1: one ceiling for everything Mea adds (null tokens: automatic), cut in this order; `keep` is never cut. */
  ceiling?: { tokens: number | null; order: string[]; keep?: string[] };
  /** The route reasons natively, so planning goes in its reasoning rather than a <think> block. */
  providerReasoning?: boolean;
  /** The plan watch's second try: a last line insists the reply open with its <think> plan. */
  forcePlan?: boolean;
  /** The plan step: this request writes only the planning pass; the story is written from it next. */
  planOnly?: boolean;
  /** Speaker marks are on: the cast's numbered roster, and whether the last reply dropped its marks. */
  speakers?: { roster: string; dropped: boolean };
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
  /** P1: a prompt lane (prompt/lanes.ts); the Inspector lists it by name, with its text. */
  lane?: string;
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
  /** P1: the lane this block is, and (clipped) what it said. */
  lane?: string;
  text?: string;
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
  /** D2: the craft coach's numbers for this turn. */
  craft?: Record<string, unknown>;
  /** B1: memory and lore reworded to keep a secret off the page. */
  reworded?: { where: string; before: string; after: string; by: "rules" | "model" }[];
  /** H1: the ceiling on what Mea adds, and what was cut to fit it this turn. */
  ceiling?: { tokens: number; auto: boolean; before: number; after: number; cuts: { key: string; name: string; tokens: number }[] };
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

/** The model's family, for per-model notes in a preset ({{modelFamily}}): claude, deepseek, gemini, glm, kimi, gpt, open, or "". */
export function modelFamily(model: string | undefined): string {
  const id = (model ?? "").toLowerCase();
  if (/claude|anthropic/.test(id)) return "claude";
  if (/deepseek|\br1\b/.test(id)) return "deepseek";
  if (/gemini|gemma/.test(id)) return "gemini";
  if (/glm|zhipu|z-ai/.test(id)) return "glm";
  if (/kimi|moonshot/.test(id)) return "kimi";
  if (/gpt|\bo[1345]\b|openai/.test(id)) return "gpt";
  if (/mistral|mixtral|llama|qwen|hermes|command-r|nemo|magnum|euryale|wizard/.test(id)) return "open";
  return "";
}

/**
 * Values blocks can read about the reply being written: {{kind}}, {{turn}}, {{isFirst}}, {{isSwipe}},
 * {{rejectedOpening}}, {{lastOpening}} / {{lastClosing}} (the echo guard), {{persona}} and
 * {{userSealed}} (the Persona control), {{ledger}} (inline tracker mode), {{planned}} (a separate planner planned it), {{providerReasoning}} (the route reasons natively), {{modelFamily}},
 * {{speakerMarks}} / {{speakerRoster}} / {{marksDropped}} (speaker marks: on, the numbered cast, the last reply left them out), and {{ctl.id}} for every preset control.
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
    // H3: a separate planner planned this reply (the writer's own pass is left out).
    planned: input.skipBlocks?.includes("mea-planning") ? "yes" : "",
    providerReasoning: input.providerReasoning ? "yes" : "",
    modelFamily: modelFamily(input.modelId),
    speakerMarks: input.speakers && !input.planOnly && (input.kind === "story" || input.kind === "continue") ? "yes" : "",
    speakerRoster: input.speakers?.roster ?? "",
    marksDropped: input.speakers?.dropped ? "yes" : "",
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
  const reserve = input.reserve ?? preset.samplers.max_tokens ?? 1200;
  const ratio = input.tokenRatio && input.tokenRatio > 0 ? input.tokenRatio : 1;
  // H3: the reply's room comes off the target in provider tokens, then the rest is scaled to Mea's estimate.
  const effectiveTarget = Math.floor(Math.max(0, input.contextTarget - reserve) / ratio);

  const inline: Inline[] = [];
  const depthItems: DepthItem[] = [];
  const blocks: BlockTrace[] = [];
  let loreTokens = 0;

  preset.blocks.forEach((block: PromptBlock, index) => {
    const trace: BlockTrace = { id: block.id, name: block.name, kind: block.kind, role: block.role, tokens: 0, included: false };
    blocks.push(trace);
    if (input.skipBlocks?.includes(block.id)) {
      trace.note = "the separate planner planned this reply";
      return;
    }
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
        if (block.id === "main" && card.system_prompt.trim() && (block.content ?? "").includes(CHARTER_MARK)) {
          // M12: Mea's Charter stays; the card's own system prompt follows it as the card's instructions.
          const own = x(card.system_prompt.replace(/\{\{original\}\}/gi, ""));
          content = [x(block.content), own && `[The character card's own instructions]\n${own}`].filter(Boolean).join("\n\n");
          trace.note = "the character's system prompt follows the Charter";
        } else {
          content = block.id === "main" && card.system_prompt.trim() ? x(card.system_prompt.replace(/\{\{original\}\}/gi, block.content ?? "")) : x(block.content);
          if (block.id === "main" && card.system_prompt.trim()) trace.note = "replaced by the character's system prompt";
        }
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
        // The card's last word is about {{char}}'s replies ("never write {{user}}…"): a draft of {{user}}'s own message skips it.
        if (input.kind === "impersonate" || input.kind === "expand") {
          trace.note = "not for a draft of your own message";
          return;
        }
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

  // H1: what Mea adds, so the ceiling pass can cut it in order.
  const added: { key: string; name: string; tokens: number; trace: BlockTrace; inline?: Inline; depth?: DepthItem }[] = [];
  for (const [i, e] of (input.extras ?? []).entries()) {
    const content = e.content.trim();
    const trace: BlockTrace = {
      id: `extra:${e.id}`,
      name: e.name,
      kind: e.lane ? "lane" : "extra",
      role: e.role ?? "system",
      tokens: content ? tok(content) : 0,
      included: Boolean(content),
      ...(e.lane ? { lane: e.lane, text: content.slice(0, 4000) } : e.id === "advisor" ? { text: content.slice(0, 6000) } : {}),
    };
    blocks.push(trace);
    if (!content) continue;
    const key = e.lane ?? e.id;
    if (e.prefix) {
      // Stable blocks go just before the history so the cached prefix stays unchanged turn to turn.
      const at = inline.findIndex((x) => x.kind === "history");
      const item: Inline = { kind: "msg", msg: { role: e.role ?? "system", content } };
      inline.splice(at < 0 ? inline.length : at, 0, item);
      added.push({ key, name: e.name, tokens: trace.tokens, trace, inline: item });
    } else {
      trace.depth = e.depth ?? 1;
      const item: DepthItem = { depth: e.depth ?? 1, role: e.role ?? "system", content, order: 500 + i };
      depthItems.push(item);
      added.push({ key, name: e.name, tokens: trace.tokens, trace, depth: item });
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
  // L8: a story or continue request never ends on a reply already written (it would read as a prefill).
  if (input.kind === "continue") tail.push({ role: "system", content: x(preset.continuePrompt) || "[Continue your last reply from where it stopped.]" });
  // A draft of {{user}}'s own message is asked for as the last turn, so the model doesn't take it as {{user}}'s message to answer.
  if (input.kind === "impersonate") tail.push({ role: "user", content: x(preset.impersonationPrompt) });
  if (input.kind === "expand") tail.push({ role: "user", content: [x(DRAFT_TURN), x(preset.expandPrompt)].join("\n") });
  // Nothing new from the player, and the last message is already a reply: the world moves on.
  if (input.kind === "story" && input.history.at(-1)?.role === "assistant") tail.push({ role: "system", content: x(preset.waitPrompt) || "[Continue the story.]" });
  if (input.kind === "story" && input.forcePlan) {
    tail.push({ role: "system", content: "[The last try skipped the planning pass. Start this reply with <think>, run the [BEFORE YOU WRITE] pass step by step, close with </think>, and only then write the story.]" });
  }
  if (input.kind === "story" && input.planOnly) {
    tail.push({
      role: "system",
      content:
        "[PLAN ONLY. This turn is the planning pass and nothing else: write <think>, then the [BEFORE YOU WRITE] pass from NOW to VOICE as labelled lines of fragments, then </think>, and stop. No story, no line of dialogue, no sentence of the reply, no ledger: the reply is written in the next turn, from this plan.]",
    });
  }
  if (input.kind === "story" && preset.prefill.trim()) tail.push({ role: "assistant", content: x(preset.prefill) });

  const fixed =
    inline.reduce((n, i) => n + (i.kind === "msg" ? tok(i.msg.content) : 0), 0) +
    depthItems.reduce((n, d) => n + (d.content ? tok(d.content) : 0), 0) +
    tail.reduce((n, m) => n + tok(m.content), 0) +
    (triggered && recallItem ? tok(triggered) : 0);
  const available = Math.max(0, effectiveTarget - fixed - 32);

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
  // H1: one ceiling for everything Mea adds (lanes, notes, the Story So Far, recalled memories).
  // Over it, things go in your order; what you keep, and the safety lanes, never do. Freed room goes back to the history.
  let freed = 0;
  let ceilingTrace: PromptTrace["ceiling"];
  let story = storyText;
  let recallMem = recallMemory;
  if (input.ceiling) {
    const auto = input.ceiling.tokens == null || input.ceiling.tokens <= 0;
    const cap = auto ? Math.round(effectiveTarget * 0.3) : input.ceiling.tokens!;
    const keep = new Set([...(input.ceiling.keep ?? []), ...NEVER_CUT]);
    const items: { key: string; name: string; tokens: number; cut: () => void }[] = [
      ...added.map((a) => ({
        key: a.key,
        name: a.name,
        tokens: a.tokens,
        cut: () => {
          if (a.inline) inline.splice(inline.indexOf(a.inline), 1);
          if (a.depth) a.depth.content = "";
          a.trace.included = false;
          a.trace.note = "cut: over the ceiling";
          freed += a.tokens;
        },
      })),
      ...(story ? [{ key: "memory", name: "The Story So Far", tokens: tok(story), cut: () => ((story = ""), memoryInline && ((memoryInline.trace.included = false), (memoryInline.trace.note = "cut: over the ceiling"))) }] : []),
      ...(recallMem ? [{ key: "recall", name: "Recalled memories", tokens: tok(recallMem), cut: () => ((recallMem = ""), recallItem?.recall && ((recallItem.recall.included = false), (recallItem.recall.note = "cut: over the ceiling"))) }] : []),
    ];
    const before = items.reduce((n, x) => n + x.tokens, 0);
    let total = before;
    const cuts: { key: string; name: string; tokens: number }[] = [];
    for (const key of input.ceiling.order) {
      if (total <= cap) break;
      if (keep.has(key)) continue;
      for (const it of items.filter((x) => x.key === key)) {
        it.cut();
        total -= it.tokens;
        cuts.push({ key: it.key, name: it.name, tokens: it.tokens });
      }
    }
    if (recallItem && recallMem !== recallMemory) {
      recallItem.content = [triggered, recallMem].filter(Boolean).join("\n\n");
      recallItem.recall!.tokens = recallItem.content ? tok(recallItem.content) : 0;
    }
    ceilingTrace = { tokens: cap, auto, before, after: total, cuts };
  }
  const memoryTokens = (story ? tok(story) : 0) + (recallMem ? tok(recallMem) : 0);
  const historyBudget = Math.max(0, available + freed - memoryTokens);
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
      if (story) tagged.push({ role: item.role, content: story, tag: placedHistory ? "tail" : "prefix" });
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
        memory: story ? tok(story) : 0,
        recall: recallMem ? tok(recallMem) : 0,
        lore: loreTokens,
        ratio,
        effectiveTarget,
      },
      memory: mem?.trace,
      ...(ceilingTrace ? { ceiling: ceilingTrace } : {}),
    },
  };
}

/** H1: never cut, whatever the order says: the canon rule, inline ledger instructions, and the lanes that keep secrets and later canon off the page. */
export const NEVER_CUT = ["canon", "offpage", "ledger"];
