import { z } from "zod";
import { meaPreset } from "./mea";

export const blockKinds = [
  "text",
  "character",
  "description",
  "personality",
  "scenario",
  "persona",
  "examples",
  "lore_before",
  "lore_after",
  "history",
  "authors_note",
  "post_history",
  "memory_story",
  "memory_recall",
  "controls",
] as const;

export const roleSchema = z.enum(["system", "user", "assistant"]);

export const blockSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(blockKinds),
  enabled: z.boolean(),
  role: roleSchema,
  position: z.enum(["inline", "depth"]),
  depth: z.number().int().min(0).max(1000).optional(),
  content: z.string().optional(),
  /** Sent only while this holds on the story state, e.g. `mode = conflict` (TRK-12 conditions). */
  when: z.string().max(300).optional(),
});

export const samplersSchema = z.object({
  temperature: z.number().min(0).max(5).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().min(0).optional(),
  min_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  repetition_penalty: z.number().min(0).max(3).optional(),
  max_tokens: z.number().int().min(16).max(65536).optional(),
  seed: z.number().int().optional(),
  stop: z.array(z.string()).optional(),
});

/**
 * Preset controls (PROMPT-07): friendly switches a preset exposes ("More dialogue", "Slow burn")
 * so a chat can change its feel without opening the builder. Active ones fill the Controls block.
 */
export const controlSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  help: z.string().max(300).default(""),
  type: z.enum(["toggle", "choice", "text"]),
  default: z.union([z.boolean(), z.string()]),
  /** Toggle: the instruction while it's on. Text: the instruction, with {{value}} for what was typed. */
  text: z.string().max(4000).default(""),
  /** Choice: one instruction per option (empty = nothing added). */
  options: z.array(z.object({ value: z.string().min(1).max(40), label: z.string().max(60), text: z.string().max(4000) })).max(40).default([]),
  /** Shown under "More" in the chat panel, so simple use sees only the main few. */
  advanced: z.boolean().default(false),
});
export type PresetControl = z.infer<typeof controlSchema>;
export type ControlValues = Record<string, boolean | string>;

export const presetSchema = z.object({
  name: z.string().min(1),
  mode: z.enum(["simple", "advanced"]),
  blocks: z.array(blockSchema),
  samplers: samplersSchema,
  impersonationPrompt: z.string(),
  expandPrompt: z.string(),
  continuePrompt: z.string(),
  prefill: z.string(),
  /** Simple-mode knobs (PROMPT-02). */
  simple: z.object({ length: z.enum(["short", "normal", "long"]), style: z.string() }),
  importNotes: z.array(z.string()).optional(),
  controls: z.array(controlSchema).max(30).default([]),
  /** Sent when the player sends nothing and the last message is already a reply: the world moves on. */
  waitPrompt: z.string().default(""),
  /** Marks a preset Mea ships (e.g. "mea"), so it can be installed once and restored. */
  builtin: z.string().optional(),
});

export type PromptBlock = z.infer<typeof blockSchema>;
export type Samplers = z.infer<typeof samplersSchema>;
export type Preset = z.infer<typeof presetSchema>;

const b = (id: string, name: string, kind: PromptBlock["kind"], extra: Partial<PromptBlock> = {}): PromptBlock => ({
  id,
  name,
  kind,
  enabled: true,
  role: "system",
  position: "inline",
  ...extra,
});

/** Mea's own default preset (the full text lives in mea.ts). */
export function defaultPreset(): Preset {
  return meaPreset();
}

/**
 * What a control is set to: this layer's value, else the preset's default. Values saved for the
 * controls Mea shipped before its default preset (More dialogue, Slow burn, Mature content) still count.
 */
export function controlValue(c: PresetControl, values: ControlValues = {}): boolean | string {
  const v = values[c.id];
  if (c.type === "choice" && typeof v === "boolean") return c.id === "dialogue" && v ? "forward" : c.default;
  if (v !== undefined) return v;
  if (c.id === "romance" && values.slowburn === true) return "slow";
  if (values.mature === true && c.id === "intimacy") return "explicit";
  if (values.mature === true && c.id === "violence") return "graphic";
  return c.default;
}

/** Every control's value, for {{ctl.id}} in blocks. */
export function controlValues(controls: PresetControl[], values: ControlValues = {}): Record<string, string> {
  return Object.fromEntries(controls.map((c) => [c.id, String(controlValue(c, values))]));
}

/** The instructions of the controls that are on, with chat/character values over the preset's defaults. */
export function controlsText(controls: PresetControl[], values: ControlValues = {}) {
  const lines: string[] = [];
  for (const c of controls) {
    const v = controlValue(c, values);
    if (c.type === "toggle" && v === true && c.text.trim()) lines.push(c.text.trim());
    if (c.type === "choice") {
      const opt = c.options.find((o) => o.value === v);
      if (opt?.text.trim()) lines.push(opt.text.trim());
    }
    if (c.type === "text" && typeof v === "string" && v.trim() && c.text.trim()) lines.push(c.text.trim().replace(/\{\{value\}\}/g, v.trim()));
  }
  return lines.length ? `[Story preferences]\n${lines.map((l) => `- ${l}`).join("\n")}` : "";
}

/**
 * Presets made before Phase 1 gain the memory blocks: the Story So Far right before the
 * history (cached prefix) and recalled memories at depth 1 (dynamic block) (CTX-04).
 */
export function ensureMemoryBlocks(blocks: PromptBlock[]) {
  // PROMPT-07: presets from before controls gain the block right after the main prompt.
  if (!blocks.some((x) => x.kind === "controls")) {
    const at = blocks.findIndex((x) => x.id === "main");
    blocks.splice(at < 0 ? 0 : at + 1, 0, b("controls", "Preset controls", "controls"));
  }
  if (!blocks.some((x) => x.kind === "memory_story")) {
    const at = blocks.findIndex((x) => x.kind === "history");
    blocks.splice(at < 0 ? blocks.length : at, 0, b("memory_story", "Story so far (memory)", "memory_story"));
  }
  if (!blocks.some((x) => x.kind === "memory_recall")) {
    const at = blocks.findIndex((x) => x.kind === "history");
    blocks.splice(at < 0 ? blocks.length : at + 1, 0, b("memory_recall", "Recalled memories & triggered lore", "memory_recall", { position: "depth", depth: 1 }));
  }
  return blocks;
}

const LENGTH_HINTS: Record<Preset["simple"]["length"], string> = {
  short: "Keep this reply short: one or two paragraphs.",
  normal: "",
  long: "Write a long, detailed reply: four to six paragraphs.",
};
export const lengthHint = (p: Preset) => LENGTH_HINTS[p.simple.length];

/** Converts a SillyTavern chat-completion preset (PROMPT-05). Returns notes about anything not carried over. */
export function importStPreset(json: unknown, name: string): Preset {
  const root = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const notes: string[] = [];
  const preset = defaultPreset();
  preset.name = name;
  preset.mode = "advanced";
  delete preset.builtin;
  // Mea's planning and variety switches only work with Mea's own blocks.
  preset.controls = preset.controls.filter((c) => c.id !== "planning" && c.id !== "variety");
  preset.waitPrompt = "";

  const prompts = Array.isArray(root.prompts) ? (root.prompts as Record<string, unknown>[]) : [];
  const orders = Array.isArray(root.prompt_order) ? (root.prompt_order as { character_id?: number; order?: { identifier: string; enabled: boolean }[] }[]) : [];
  const order = (orders.find((o) => o.character_id === 100001) ?? orders.find((o) => o.character_id === 100000) ?? orders[0])?.order;
  const byId = new Map(prompts.map((p) => [String(p.identifier), p]));

  const markerKinds: Record<string, PromptBlock["kind"]> = {
    charDescription: "description",
    charPersonality: "personality",
    scenario: "scenario",
    personaDescription: "persona",
    worldInfoBefore: "lore_before",
    worldInfoAfter: "lore_after",
    dialogueExamples: "examples",
    chatHistory: "history",
  };

  if (order && order.length) {
    const blocks: PromptBlock[] = [];
    for (const item of order) {
      const p = byId.get(item.identifier);
      const id = item.identifier;
      const role = (["system", "user", "assistant"].includes(String(p?.role)) ? p?.role : "system") as PromptBlock["role"];
      const depthPos = p?.injection_position === 1;
      const pos: Partial<PromptBlock> = depthPos ? { position: "depth", depth: Number(p?.injection_depth ?? 4) } : {};
      if (markerKinds[id]) {
        blocks.push(b(id, String(p?.name ?? id), markerKinds[id]!, { enabled: item.enabled, role, ...pos }));
      } else if (id === "jailbreak") {
        blocks.push(b(id, String(p?.name ?? "Post-history instructions"), "post_history", { enabled: item.enabled, role, content: String(p?.content ?? ""), ...pos }));
      } else if (p && typeof p.content === "string") {
        blocks.push(b(id, String(p.name ?? id), "text", { enabled: item.enabled, role, content: p.content, ...pos }));
      } else if (p?.marker) {
        notes.push(`Skipped marker "${id}" (not supported).`);
      }
    }
    if (!blocks.some((x) => x.kind === "history")) blocks.push(b("history", "Chat history", "history"));
    ensureMemoryBlocks(blocks);
    if (!blocks.some((x) => x.kind === "authors_note")) blocks.push(b("authors_note", "Author's note", "authors_note", { position: "depth", depth: 4 }));
    preset.blocks = blocks;
  } else {
    notes.push("No prompt order found: kept Mea's default blocks.");
  }

  const num = (k: string) => (typeof root[k] === "number" ? (root[k] as number) : undefined);
  preset.samplers = {
    temperature: num("temperature") ?? 1,
    top_p: num("top_p"),
    top_k: num("top_k") || undefined,
    min_p: num("min_p") || undefined,
    frequency_penalty: num("frequency_penalty") || undefined,
    presence_penalty: num("presence_penalty") || undefined,
    repetition_penalty: num("repetition_penalty") && num("repetition_penalty") !== 1 ? num("repetition_penalty") : undefined,
    max_tokens: num("openai_max_tokens") ?? 1200,
  };
  if (typeof root.assistant_prefill === "string") preset.prefill = root.assistant_prefill;
  if (typeof root.impersonation_prompt === "string" && root.impersonation_prompt.trim()) preset.impersonationPrompt = root.impersonation_prompt;
  if (typeof root.continue_nudge_prompt === "string" && root.continue_nudge_prompt.trim()) preset.continuePrompt = root.continue_nudge_prompt.replace(/\{\{lastChatMessage\}\}/g, "");

  for (const k of ["wi_format", "scenario_format", "personality_format", "new_chat_prompt", "new_example_chat_prompt", "group_nudge_prompt", "bias_preset_selected", "names_behavior", "squash_system_messages"]) {
    const v = root[k];
    if (v !== undefined && v !== "" && v !== false && v !== null && v !== 0) notes.push(`"${k}" isn't used by Mea.`);
  }
  preset.importNotes = notes;
  return presetSchema.parse(preset);
}
