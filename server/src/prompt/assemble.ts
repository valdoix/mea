import type { CardData } from "../cards/card";
import { countTokens, MESSAGE_OVERHEAD } from "../lib/tokens";
import type { ActivationResult, TraceItem } from "../lore/activate";
import type { Role } from "../lore/types";
import { expandMacros, type MacroContext } from "./macros";
import { lengthHint, type Preset, type PromptBlock } from "./preset";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface HistoryMessage {
  id: string;
  role: Role;
  content: string;
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
  history: { included: number; total: number; tokens: number; dropped: number };
  lore: TraceItem[];
  budget: { contextTarget: number; reserve: number; fixed: number; history: number; total: number };
}

export interface AssembleResult {
  messages: ChatMessage[];
  trace: PromptTrace;
  estPromptTokens: number;
  /** Variables after macro side effects ({{setvar}}), to persist on the chat. */
  vars: Record<string, string>;
}

const tok = (s: string) => countTokens(s) + MESSAGE_OVERHEAD;

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

/** Builds the final message list for a request (PROMPT-01), with a full trace for the inspector (DBG-01). */
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
    extra: { draft: input.draft ?? "" },
    now: input.now,
  };
  const x = (s: string | undefined) => expandMacros(s ?? "", ctx).trim();
  const lore = input.lore?.placements;
  const reserve = preset.samplers.max_tokens ?? 1200;

  type Inline = { kind: "msg"; msg: ChatMessage } | { kind: "history" };
  const inline: Inline[] = [];
  const depthItems: { depth: number; role: Role; content: string; order: number }[] = [];
  const blocks: BlockTrace[] = [];

  preset.blocks.forEach((block: PromptBlock, index) => {
    const trace: BlockTrace = { id: block.id, name: block.name, kind: block.kind, role: block.role, tokens: 0, included: false };
    blocks.push(trace);
    if (!block.enabled) {
      trace.note = "disabled";
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
        break;
      case "lore_after":
        content = (lore?.after_char ?? []).join("\n\n");
        break;
      case "history":
        inline.push({ kind: "history" });
        trace.included = true;
        return;
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

  for (const d of lore?.depth ?? []) depthItems.push({ depth: d.depth, role: d.role, content: d.content, order: 1000 + d.order });

  const hint = lengthHint(preset);
  if (input.kind === "story" && hint) depthItems.push({ depth: 0, role: "system", content: hint, order: 9000 });
  if (input.feedback?.trim() && (input.kind === "story" || input.kind === "continue")) {
    depthItems.push({ depth: 0, role: "system", content: `[Note for this reply: ${input.feedback.trim()}]`, order: 9001 });
  }

  const tail: ChatMessage[] = [];
  if (input.kind === "continue") tail.push({ role: "system", content: x(preset.continuePrompt) });
  if (input.kind === "impersonate") tail.push({ role: "system", content: x(preset.impersonationPrompt) });
  if (input.kind === "expand") tail.push({ role: "system", content: x(preset.expandPrompt) });
  if (input.kind === "story" && preset.prefill.trim()) tail.push({ role: "assistant", content: x(preset.prefill) });

  const fixed =
    inline.reduce((n, i) => n + (i.kind === "msg" ? tok(i.msg.content) : 0), 0) + depthItems.reduce((n, d) => n + tok(d.content), 0) + tail.reduce((n, m) => n + tok(m.content), 0);
  const historyBudget = Math.max(0, input.contextTarget - reserve - fixed - 32);

  // Newest messages first until the budget is used; always keep the latest message.
  const chosen: HistoryMessage[] = [];
  let historyTokens = 0;
  for (let i = input.history.length - 1; i >= 0; i--) {
    const m = input.history[i]!;
    const t = tok(m.content);
    if (historyTokens + t > historyBudget && chosen.length > 0) break;
    chosen.unshift(m);
    historyTokens += t;
  }

  const hist = chosen.map((m) => ({ role: m.role, content: m.content }));
  const slots: ChatMessage[][] = Array.from({ length: hist.length + 1 }, () => []);
  for (const d of [...depthItems].sort((a, b) => a.order - b.order)) {
    slots[Math.max(0, hist.length - d.depth)]!.push({ role: d.role, content: d.content });
  }
  const merged: ChatMessage[] = [];
  for (let i = 0; i <= hist.length; i++) {
    merged.push(...slots[i]!);
    if (i < hist.length) merged.push(hist[i]!);
  }

  let messages: ChatMessage[] = [];
  let placedHistory = false;
  for (const item of inline) {
    if (item.kind === "history") {
      messages.push(...merged);
      placedHistory = true;
    } else messages.push(item.msg);
  }
  if (!placedHistory) messages.push(...merged);
  messages.push(...tail);

  // Squash the leading run of system messages into one (friendlier to most providers).
  const firstNonSystem = messages.findIndex((m) => m.role !== "system");
  const lead = firstNonSystem < 0 ? messages.length : firstNonSystem;
  if (lead > 1) {
    messages = [{ role: "system", content: messages.slice(0, lead).map((m) => m.content).join("\n\n") }, ...messages.slice(lead)];
  }

  const estPromptTokens = messages.reduce((n, m) => n + tok(m.content), 0);
  return {
    messages,
    estPromptTokens,
    vars: ctx.vars,
    trace: {
      blocks,
      history: { included: chosen.length, total: input.history.length, tokens: historyTokens, dropped: input.history.length - chosen.length },
      lore: input.lore?.trace ?? [],
      budget: { contextTarget: input.contextTarget, reserve, fixed, history: historyTokens, total: estPromptTokens },
    },
  };
}
