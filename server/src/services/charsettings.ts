import { z } from "zod";
import { one, parseJson, run } from "../db/db";

/**
 * Per-character settings (migration 7):
 * - PROMPT-06 layered overrides: defaults every chat with this character starts from (global →
 *   character → chat). A chat's own choice always wins; empty means "fall through".
 * - CHAR-07: your private notes and the source link (never sent to the model).
 * - CHAR-14: the voice lab's kept lines (the voice fingerprint the drift detector will use).
 */

const short = (n: number) => z.string().max(n);

export const voiceLineSchema = z.object({ id: z.string(), situation: short(80), cue: short(400), line: short(1500) });
export type VoiceLine = z.infer<typeof voiceLineSchema>;

export const characterSettingsSchema = z.object({
  notes: short(20_000).optional(),
  sourceUrl: short(2000).optional(),
  presetId: z.string().nullable().optional(),
  profileId: z.string().nullable().optional(),
  authorsNote: z.object({ content: z.string().max(8000), depth: z.number().int().min(0).max(100), role: z.enum(["system", "user", "assistant"]) }).nullable().optional(),
  story: z.object({ genre: short(60), tone: short(60), pov: short(40), tense: short(20), style: short(200), intensity: short(40), language: short(30) }).partial().optional(),
  truths: z.array(short(300)).max(30).optional(),
  /** PROMPT-07: preset control values for this character's chats. */
  controls: z.record(z.string(), z.union([z.boolean(), z.string()])).optional(),
  voice: z.object({ kept: z.array(voiceLineSchema).max(60) }).optional(),
});
export type CharacterSettings = z.infer<typeof characterSettingsSchema>;

export function characterSettings(id: string | null | undefined): CharacterSettings {
  if (!id) return {};
  const r = one<{ settings: string }>("SELECT settings FROM characters WHERE id = ?", id);
  return r ? parseJson<CharacterSettings>(r.settings, {}) : {};
}

/** Merges a patch; a key set to null (or an empty string for text) goes back to "not set". */
export function patchCharacterSettings(id: string, patch: Partial<CharacterSettings>) {
  const cur = characterSettings(id) as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "" || v === undefined) delete cur[k];
    else cur[k] = v;
  }
  run("UPDATE characters SET settings = ? WHERE id = ?", JSON.stringify(cur), id);
  return cur as CharacterSettings;
}
