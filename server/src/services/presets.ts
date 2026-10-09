import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { getSetting, setSetting } from "../lib/settings";
import { MEA_PRESET_VERSION, meaPreset } from "../prompt/mea";
import { defaultPreset, ensureMemoryBlocks, type Preset, presetSchema } from "../prompt/preset";

const changed = () => publish({ type: "library.changed", what: "presets" });

function parsePreset(raw: string): Preset {
  // Missing fields come from the default, but never its built-in mark or its wait prompt:
  // presets saved before those existed keep behaving as they did.
  const { builtin: _builtin, ...fallback } = { ...defaultPreset(), waitPrompt: "" };
  const parsed = presetSchema.safeParse({ ...fallback, ...parseJson<Partial<Preset>>(raw, {}) });
  if (!parsed.success) return fallback;
  ensureMemoryBlocks(parsed.data.blocks);
  return parsed.data;
}

export function listPresets() {
  return all<{ id: string; name: string; data: string; updated_at: number }>("SELECT id, name, data, updated_at FROM presets ORDER BY name COLLATE NOCASE").map((r) => ({
    id: r.id,
    name: r.name,
    mode: parsePreset(r.data).mode,
    isDefault: getSetting("chat.defaultPresetId") === r.id,
    updatedAt: r.updated_at,
  }));
}

export function getPreset(id: string | null | undefined): (Preset & { id: string }) | undefined {
  if (!id) return undefined;
  const r = one<{ id: string; data: string }>("SELECT id, data FROM presets WHERE id = ?", id);
  return r ? { ...parsePreset(r.data), id: r.id } : undefined;
}

/** Copies never carry the built-in mark: only Mea's own installed preset does. */
export function createPreset(preset: Preset, opts: { builtin?: boolean } = {}): string {
  const p = presetSchema.parse(preset);
  if (!opts.builtin) delete p.builtin;
  const id = newId();
  const t = now();
  run("INSERT INTO presets (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", id, p.name, JSON.stringify(p), t, t);
  changed();
  return id;
}

export function updatePreset(id: string, preset: Preset) {
  const p = presetSchema.parse(preset);
  // The built-in mark stays with the preset it was installed on, whatever the editor sends.
  const was = getPreset(id)?.builtin;
  if (was) p.builtin = was;
  else delete p.builtin;
  const res = run("UPDATE presets SET name = ?, data = ?, updated_at = ? WHERE id = ?", p.name, JSON.stringify(p), now(), id);
  changed();
  return res.changes > 0;
}

export function deletePreset(id: string) {
  run("DELETE FROM presets WHERE id = ?", id);
  if (getSetting("chat.defaultPresetId") === id) setSetting("chat.defaultPresetId", listPresets()[0]?.id ?? null);
  changed();
}

/** Makes sure a default preset exists (first run). */
export function ensureDefaultPreset(): string {
  ensureMeaPreset();
  const current = getSetting("chat.defaultPresetId");
  if (current && getPreset(current)) return current;
  const existing = listPresets()[0];
  const id = existing?.id ?? createPreset(defaultPreset());
  setSetting("chat.defaultPresetId", id);
  return id;
}

/** The installed copy of Mea's own preset, if there is one. */
export function meaPresetId(): string | null {
  return all<{ id: string; data: string }>("SELECT id, data FROM presets").find((r) => parseJson<Partial<Preset>>(r.data, {}).builtin === "mea")?.id ?? null;
}

/**
 * Installs Mea's own preset once per version and makes it the default when it first arrives.
 * A newer version updates the installed copy in place; your edits to it are replaced only then,
 * and "Restore" in the editor brings it back any time.
 */
export function ensureMeaPreset() {
  const installed = getSetting("presets.meaVersion");
  if (installed >= MEA_PRESET_VERSION && meaPresetId()) return;
  const existing = meaPresetId();
  if (existing) updatePreset(existing, meaPreset());
  else {
    const id = createPreset(meaPreset(), { builtin: true });
    if (!installed) setSetting("chat.defaultPresetId", id);
  }
  setSetting("presets.meaVersion", MEA_PRESET_VERSION);
}

/** Puts Mea's own preset back as shipped. */
export function restoreMeaPreset(): string {
  const id = meaPresetId();
  if (id) {
    updatePreset(id, meaPreset());
    return id;
  }
  return createPreset(meaPreset(), { builtin: true });
}

export function resolvePreset(presetId?: string | null): Preset & { id: string } {
  return getPreset(presetId) ?? getPreset(ensureDefaultPreset())!;
}
