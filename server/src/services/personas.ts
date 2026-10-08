import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { publish } from "../lib/events";
import { linkedBooks } from "../lore/service";

export interface PersonaData {
  pronouns: string;
  description: string;
  appearance: string;
  personality: string;
  background: string;
}

interface PersonaRow {
  id: string;
  name: string;
  data: string;
  avatar_id: string | null;
  is_default: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

const changed = () => publish({ type: "library.changed", what: "personas" });

const emptyData = (): PersonaData => ({ pronouns: "", description: "", appearance: "", personality: "", background: "" });

function toPersona(r: PersonaRow) {
  return {
    id: r.id,
    name: r.name,
    data: { ...emptyData(), ...parseJson<Partial<PersonaData>>(r.data, {}) },
    avatarId: r.avatar_id,
    isDefault: Boolean(r.is_default),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

export type Persona = ReturnType<typeof toPersona> & { lorebooks?: { id: string; name: string }[] };

export function listPersonas(opts: { deleted?: boolean } = {}) {
  return all<PersonaRow>(`SELECT * FROM personas WHERE ${opts.deleted ? "deleted_at IS NOT NULL" : "deleted_at IS NULL"} ORDER BY is_default DESC, name COLLATE NOCASE`).map(toPersona);
}

export function getPersona(id: string | null | undefined): Persona | undefined {
  if (!id) return undefined;
  const r = one<PersonaRow>("SELECT * FROM personas WHERE id = ?", id);
  return r ? { ...toPersona(r), lorebooks: linkedBooks("persona", id) } : undefined;
}

export function getDefaultPersona(): Persona | undefined {
  const r = one<PersonaRow>("SELECT * FROM personas WHERE is_default = 1 AND deleted_at IS NULL") ?? one<PersonaRow>("SELECT * FROM personas WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1");
  return r ? toPersona(r) : undefined;
}

export function createPersona(input: { name: string; data?: Partial<PersonaData>; avatarId?: string | null; isDefault?: boolean }): string {
  const id = newId();
  const t = now();
  const first = !one("SELECT 1 FROM personas WHERE deleted_at IS NULL");
  tx(() => {
    if (input.isDefault || first) run("UPDATE personas SET is_default = 0");
    run(
      "INSERT INTO personas (id, name, data, avatar_id, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      input.name,
      JSON.stringify({ ...emptyData(), ...input.data }),
      input.avatarId ?? null,
      input.isDefault || first ? 1 : 0,
      t,
      t,
    );
  });
  changed();
  return id;
}

export function updatePersona(id: string, input: { name?: string; data?: Partial<PersonaData>; avatarId?: string | null; isDefault?: boolean }) {
  const cur = getPersona(id);
  if (!cur) return false;
  tx(() => {
    if (input.isDefault) run("UPDATE personas SET is_default = 0");
    run(
      "UPDATE personas SET name = ?, data = ?, avatar_id = ?, is_default = ?, updated_at = ? WHERE id = ?",
      input.name ?? cur.name,
      JSON.stringify({ ...cur.data, ...input.data }),
      input.avatarId !== undefined ? input.avatarId : cur.avatarId,
      input.isDefault !== undefined ? (input.isDefault ? 1 : 0) : cur.isDefault ? 1 : 0,
      now(),
      id,
    );
  });
  changed();
  return true;
}

export function softDeletePersona(id: string) {
  run("UPDATE personas SET deleted_at = ?, is_default = 0 WHERE id = ?", now(), id);
  changed();
}

export function restorePersona(id: string) {
  run("UPDATE personas SET deleted_at = NULL WHERE id = ?", id);
  changed();
}

/** Persona text for the prompt. */
export function personaPrompt(p: Persona | undefined): string {
  if (!p) return "";
  const d = p.data;
  const parts = [d.description];
  if (d.pronouns) parts.push(`Pronouns: ${d.pronouns}`);
  if (d.appearance) parts.push(`Appearance: ${d.appearance}`);
  if (d.personality) parts.push(`Personality: ${d.personality}`);
  if (d.background) parts.push(`Background: ${d.background}`);
  return parts.filter((s) => s.trim()).join("\n");
}

/** Imports SillyTavern personas (settings.json power_user section or the persona backup file). */
export function importStPersonas(json: unknown): string[] {
  const root = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const pu = (root.power_user && typeof root.power_user === "object" ? root.power_user : root) as Record<string, unknown>;
  const names = (pu.personas ?? {}) as Record<string, string>;
  const descs = (pu.persona_descriptions ?? {}) as Record<string, { description?: string }>;
  const ids: string[] = [];
  for (const [file, name] of Object.entries(names)) {
    if (typeof name !== "string" || !name.trim()) continue;
    ids.push(createPersona({ name: name.trim(), data: { description: descs[file]?.description ?? "" } }));
  }
  return ids;
}
