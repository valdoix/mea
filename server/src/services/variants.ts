import { z } from "zod";
import type { CardData } from "../cards/card";
import { all, newId, now, one, parseJson, run } from "../db/db";
import { publish } from "../lib/events";
import { badRequest, notFound } from "../lib/http";
import { CRAFT, tidy } from "../creator/expand";
import { getCard } from "./characters";
import { callJson } from "./llm";
import { getPersona, type Persona, type PersonaData } from "./personas";

/**
 * Versions and variants (CHAR-06, PER-05): an alternate outfit, an era, an AU. A variant overlays
 * only the fields it changes, so the base card or persona is never duplicated and edits to the base
 * still flow through to every variant. A chat picks a variant; everything else stays the same.
 */

export type OwnerType = "character" | "persona";

export const OVERLAY_FIELDS: Record<OwnerType, readonly string[]> = {
  character: ["description", "personality", "scenario", "first_mes", "alternate_greetings", "mes_example", "system_prompt", "post_history_instructions"],
  persona: ["description", "appearance", "personality", "background", "pronouns"],
};

export type Overlay = Record<string, string | string[]>;

export interface Variant {
  id: string;
  ownerType: OwnerType;
  ownerId: string;
  name: string;
  note: string;
  overlay: Overlay;
  avatarId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string;
  owner_type: string;
  owner_id: string;
  name: string;
  note: string;
  overlay: string;
  avatar_id: string | null;
  sort: number;
  created_at: number;
  updated_at: number;
}

const out = (r: Row): Variant => ({ id: r.id, ownerType: r.owner_type as OwnerType, ownerId: r.owner_id, name: r.name, note: r.note, overlay: cleanOverlay(r.owner_type as OwnerType, parseJson<Overlay>(r.overlay, {})), avatarId: r.avatar_id, createdAt: r.created_at, updatedAt: r.updated_at });

/** Only known fields, and only ones that actually say something. */
export function cleanOverlay(type: OwnerType, o: Overlay): Overlay {
  const res: Overlay = {};
  for (const k of OVERLAY_FIELDS[type]) {
    const v = o[k];
    if (Array.isArray(v)) {
      const list = v.map((x) => String(x)).filter((x) => x.trim());
      if (list.length) res[k] = list;
    } else if (typeof v === "string" && v.trim()) res[k] = v;
  }
  return res;
}

const changed = (type: OwnerType) => publish({ type: "library.changed", what: type === "character" ? "characters" : "personas" });

export function listVariants(type: OwnerType, ownerId: string) {
  return all<Row>("SELECT * FROM variants WHERE owner_type = ? AND owner_id = ? ORDER BY sort, created_at", type, ownerId).map(out);
}

export function getVariant(id: string | null | undefined) {
  if (!id) return undefined;
  const r = one<Row>("SELECT * FROM variants WHERE id = ?", id);
  return r ? out(r) : undefined;
}

export function createVariant(type: OwnerType, ownerId: string, input: { name: string; note?: string; overlay?: Overlay; avatarId?: string | null }) {
  if (type === "character" ? !getCard(ownerId) : !getPersona(ownerId)) throw notFound(type === "character" ? "Character not found" : "Persona not found");
  const id = newId();
  const t = now();
  const sort = (one<{ n: number | null }>("SELECT MAX(sort) AS n FROM variants WHERE owner_type = ? AND owner_id = ?", type, ownerId)?.n ?? -1) + 1;
  run(
    "INSERT INTO variants (id, owner_type, owner_id, name, note, overlay, avatar_id, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    type,
    ownerId,
    input.name.trim() || "Variant",
    input.note ?? "",
    JSON.stringify(cleanOverlay(type, input.overlay ?? {})),
    input.avatarId ?? null,
    sort,
    t,
    t,
  );
  changed(type);
  return getVariant(id)!;
}

export function updateVariant(id: string, patch: { name?: string; note?: string; overlay?: Overlay; avatarId?: string | null }) {
  const v = getVariant(id);
  if (!v) throw notFound("Variant not found");
  run(
    "UPDATE variants SET name = ?, note = ?, overlay = ?, avatar_id = ?, updated_at = ? WHERE id = ?",
    patch.name?.trim() || v.name,
    patch.note ?? v.note,
    JSON.stringify(cleanOverlay(v.ownerType, patch.overlay ?? v.overlay)),
    patch.avatarId !== undefined ? patch.avatarId : v.avatarId,
    now(),
    id,
  );
  changed(v.ownerType);
  return getVariant(id)!;
}

export function deleteVariant(id: string) {
  const v = getVariant(id);
  run("DELETE FROM variants WHERE id = ?", id);
  // Chats that used it fall back to the base.
  if (v) {
    const key = v.ownerType === "character" ? "variantId" : "personaVariantId";
    run(`UPDATE chats SET settings = json_remove(settings, '$.${key}') WHERE json_extract(settings, '$.${key}') = ?`, id);
    changed(v.ownerType);
  }
}

/** The card as this variant plays it. A variant for another character is ignored. */
export function applyCardVariant(card: CardData, v: Variant | undefined, characterId: string): CardData {
  if (!v || v.ownerType !== "character" || v.ownerId !== characterId) return card;
  return { ...card, ...v.overlay } as CardData;
}

export function applyPersonaVariant<P extends Persona | undefined>(p: P, v: Variant | undefined): P {
  if (!p || !v || v.ownerType !== "persona" || v.ownerId !== p.id) return p;
  return { ...p, data: { ...p.data, ...(v.overlay as Partial<PersonaData>) } };
}

// ---------- drafting a variant with the model ----------

const draftSchema = z.object({ name: z.string().default(""), note: z.string().default(""), fields: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}) });

const FIELD_LABEL: Record<string, string> = {
  description: "description",
  personality: "personality summary",
  scenario: "scenario",
  first_mes: "greeting",
  alternate_greetings: "alternate greetings (a list)",
  mes_example: "example dialogue",
  system_prompt: "system prompt",
  post_history_instructions: "rules (post-history instructions)",
  appearance: "appearance",
  background: "background",
  pronouns: "pronouns",
};

/** Proposes an overlay for an idea ("winter outfit", "modern AU", "ten years later"): only the fields that must change. */
export async function draftVariant(type: OwnerType, ownerId: string, idea: string) {
  if (!idea.trim()) throw badRequest("Describe the variant first");
  const base: Record<string, unknown> =
    type === "character"
      ? (() => {
          const c = getCard(ownerId);
          if (!c) throw notFound("Character not found");
          return { name: c.name, description: c.description, personality: c.personality, scenario: c.scenario, first_mes: c.first_mes, mes_example: c.mes_example };
        })()
      : (() => {
          const p = getPersona(ownerId);
          if (!p) throw notFound("Persona not found");
          return { name: p.name, ...p.data };
        })();
  const fields = OVERLAY_FIELDS[type].filter((f) => f !== "system_prompt" && f !== "post_history_instructions");
  const r = await callJson({
    task: "summarizer",
    kind: "variant",
    name: "variant_draft",
    schema: draftSchema,
    system: [
      `You make a variant of ${type === "character" ? "a character card" : "the user's persona"} for interactive fiction: the same person in a different outfit, era, setting or alternate universe, as the author describes.`,
      "Rewrite only the fields that must change for this variant, in full, in the same style and format as the original. Keep the same person at the core: name, voice, personality and the history that still applies, unless the variant itself changes them. An outfit usually changes only appearance details; an alternate universe changes setting, history, scenario and greeting.",
      `Fields you may rewrite: ${fields.map((f) => `"${f}" (${FIELD_LABEL[f]})`).join(", ")}. Leave out every field that doesn't need to change.`,
      type === "character" ? "Greetings must never write {{user}}'s actions, words, thoughts or feelings." : "",
      `Craft rules:\n- ${CRAFT}`,
      'Reply with JSON only: {"name": "short variant name", "note": "one sentence on what changes", "fields": {"field": "full new text"}}',
    ]
      .filter(Boolean)
      .join("\n\n"),
    user: `THE ORIGINAL:\n${Object.entries(base)
      .filter(([, v]) => typeof v === "string" && v.trim())
      .map(([k, v]) => `## ${k}\n${v}`)
      .join("\n\n")}\n\nTHE VARIANT: ${idea.trim()}`,
    maxTokens: 5000,
    temperature: 0.75,
  });
  const overlay: Overlay = {};
  for (const [k, v] of Object.entries(r.data.fields)) {
    if (!fields.includes(k)) continue;
    overlay[k] = Array.isArray(v) ? v.map((x) => tidy(x)) : tidy(v);
  }
  return { name: r.data.name.trim() || idea.trim().slice(0, 40), note: r.data.note.trim(), overlay: cleanOverlay(type, overlay) };
}
