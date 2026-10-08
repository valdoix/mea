import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { getSetting, setSetting } from "../lib/settings";
import { defaultPreset, type Preset, presetSchema } from "../prompt/preset";

const changed = () => publish({ type: "library.changed", what: "presets" });

function parsePreset(raw: string): Preset {
  const fallback = defaultPreset();
  const parsed = presetSchema.safeParse({ ...fallback, ...parseJson<Partial<Preset>>(raw, {}) });
  return parsed.success ? parsed.data : fallback;
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

export function createPreset(preset: Preset): string {
  const p = presetSchema.parse(preset);
  const id = newId();
  const t = now();
  run("INSERT INTO presets (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", id, p.name, JSON.stringify(p), t, t);
  changed();
  return id;
}

export function updatePreset(id: string, preset: Preset) {
  const p = presetSchema.parse(preset);
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
  const current = getSetting("chat.defaultPresetId");
  if (current && getPreset(current)) return current;
  const existing = listPresets()[0];
  const id = existing?.id ?? createPreset(defaultPreset());
  setSetting("chat.defaultPresetId", id);
  return id;
}

export function resolvePreset(presetId?: string | null): Preset & { id: string } {
  return getPreset(presetId) ?? getPreset(ensureDefaultPreset())!;
}
