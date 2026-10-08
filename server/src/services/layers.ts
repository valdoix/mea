import { controlsText, type ControlValues, type Preset } from "../prompt/preset";
import { type CharacterSettings, characterSettings } from "./charsettings";
import type { ChatSettings } from "./chats";
import { resolvePreset } from "./presets";

/**
 * Layered overrides (PROMPT-06): global → character → chat. The chat's own choice wins; a value it
 * leaves empty falls through to the character's default, then to the global one.
 */
export function layered(chat: Pick<ChatSettings, "presetId" | "profileId" | "authorsNote" | "controls" | "story" | "truths">, characterId: string | null | undefined) {
  const cs: CharacterSettings = characterSettings(characterId);
  return {
    presetId: chat.presetId ?? cs.presetId ?? null,
    profileId: chat.profileId ?? cs.profileId ?? null,
    authorsNote: chat.authorsNote?.content.trim() ? chat.authorsNote : cs.authorsNote?.content.trim() ? cs.authorsNote : undefined,
    controls: { ...(cs.controls ?? {}), ...(chat.controls ?? {}) } as ControlValues,
    story: { ...(cs.story ?? {}), ...(chat.story ?? {}) },
    truths: [...(cs.truths ?? []), ...(chat.truths ?? [])],
    /** Where each value came from, for the chat panel ("from the character"). */
    from: {
      preset: chat.presetId ? "chat" : cs.presetId ? "character" : "global",
      profile: chat.profileId ? "chat" : cs.profileId ? "character" : "global",
      authorsNote: chat.authorsNote?.content.trim() ? "chat" : cs.authorsNote?.content.trim() ? "character" : null,
    },
  };
}

/**
 * The preset as this request uses it: PROMPT-10 per-model prefill (a profile's prefill, even an
 * empty one, replaces the preset's) and PROMPT-07 controls rendered for the Controls block.
 */
export function presetForRequest(presetId: string | null, prefill: string | undefined, controls: ControlValues): { preset: Preset & { id: string }; controls: string } {
  const base = resolvePreset(presetId);
  const preset = prefill !== undefined ? { ...base, prefill } : base;
  return { preset, controls: controlsText(preset.controls, controls) };
}
