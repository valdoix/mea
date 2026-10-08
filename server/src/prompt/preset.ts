import { z } from "zod";

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

export const DEFAULT_MAIN_PROMPT = `{{if mode == narrator}}You are the narrator of an ongoing interactive story with {{user}}. Voice every character except {{user}}, describe the world around them, and keep the story moving. Never write {{user}}'s actions, words, or thoughts: end your reply where {{user}} would naturally respond.{{else}}You are {{char}} in an ongoing roleplay with {{user}}. Write {{char}}'s next reply only. Stay true to {{char}}'s personality, voice, and history, and never write {{user}}'s actions, words, or thoughts.{{/if}}

Write vivid, grounded prose. Show emotion through action, dialogue, and small sensory details. Keep continuity with everything established so far: names, places, appearances, the time of day, and what each character knows. Let scenes breathe, avoid repeating phrases from earlier replies, and move the story forward with intention.`;

export function defaultPreset(): Preset {
  return {
    name: "Mea default",
    mode: "simple",
    blocks: [
      b("main", "Main prompt", "text", { content: DEFAULT_MAIN_PROMPT }),
      b("character", "Character", "character"),
      b("lore_before", "Lore (before)", "lore_before"),
      b("persona", "Persona", "persona"),
      b("lore_after", "Lore (after)", "lore_after"),
      b("examples", "Example dialogue", "examples"),
      b("history", "Chat history", "history"),
      b("authors_note", "Author's note", "authors_note", { position: "depth", depth: 4 }),
      b("post_history", "Post-history instructions", "post_history", { content: "" }),
    ],
    samplers: { temperature: 1, top_p: 0.95, max_tokens: 1200 },
    impersonationPrompt:
      "[Write {{user}}'s next message in first person, in {{user}}'s own voice and style, continuing naturally from the story so far. Write only {{user}}'s words and actions, nothing for {{char}} or anyone else. Reply with the message only.]",
    expandPrompt:
      '[{{user}} wrote a rough draft of their next message:\n"""\n{{draft}}\n"""\nRewrite it as {{user}}\'s full in-character message. Keep every intention, action, and line of dialogue from the draft, expand it into vivid prose that matches the story\'s tense and point of view, and add nothing for {{char}} or anyone else. Reply with the message only.]',
    continuePrompt: "[Continue your last reply exactly where it stopped. Don't repeat anything already written; pick up mid-sentence if needed.]",
    prefill: "",
    simple: { length: "normal", style: "" },
  };
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
