import { isPng } from "../cards/png";
import { badRequest } from "../lib/http";
import { importLorebookJson } from "../lore/service";
import { importStPreset } from "../prompt/preset";
import { importCharacterFile } from "./characters";
import { importStPersonas } from "./personas";
import { createPreset } from "./presets";

export type ImportResult =
  | { kind: "character"; id: string; name: string; lorebookId: string | null; notes: string[] }
  | { kind: "lorebook"; id: string; name: string; notes: string[] }
  | { kind: "preset"; id: string; name: string; notes: string[] }
  | { kind: "personas"; ids: string[]; name: string; notes: string[] };

const stripExt = (f: string) => f.replace(/\.[^.]+$/, "") || "Imported";

/** Detects what a file is and imports it (DATA-01): cards, lorebooks, presets, personas. */
export async function importFile(bytes: Uint8Array, filename: string): Promise<ImportResult> {
  const lower = filename.toLowerCase();
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isPng(bytes) || zip || lower.endsWith(".charx")) {
    const r = await importCharacterFile(bytes, filename);
    return { kind: "character", id: r.id, name: r.name, lorebookId: r.lorebookId, notes: r.lorebookId ? ["Its embedded lorebook was imported and linked."] : [] };
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw badRequest("This file isn't a PNG card, CHARX, or JSON file");
  }
  if (!json || typeof json !== "object") throw badRequest("Unrecognized file");

  const data = (json.data && typeof json.data === "object" ? json.data : {}) as Record<string, unknown>;
  const looksLikeCard =
    typeof json.spec === "string" ? String(json.spec).startsWith("chara_card") : ("first_mes" in json || "first_mes" in data) && ("name" in json || "name" in data);
  if (looksLikeCard) {
    const r = await importCharacterFile(bytes, filename);
    return { kind: "character", id: r.id, name: r.name, lorebookId: r.lorebookId, notes: r.lorebookId ? ["Its embedded lorebook was imported and linked."] : [] };
  }
  if ("entries" in json) {
    const id = importLorebookJson(json, stripExt(filename));
    return { kind: "lorebook", id, name: typeof json.name === "string" && json.name ? json.name : stripExt(filename), notes: [] };
  }
  if ("prompts" in json || "prompt_order" in json || "openai_max_tokens" in json) {
    const preset = importStPreset(json, stripExt(filename));
    const id = createPreset(preset);
    return { kind: "preset", id, name: preset.name, notes: preset.importNotes ?? [] };
  }
  if ("personas" in json || (json.power_user && typeof json.power_user === "object")) {
    const ids = importStPersonas(json);
    if (!ids.length) throw badRequest("No personas found in this file");
    return { kind: "personas", ids, name: `${ids.length} persona${ids.length === 1 ? "" : "s"}`, notes: ["Persona avatars aren't included in SillyTavern's settings file; add them in Mea."] };
  }
  throw badRequest("Couldn't tell what this file is. Mea imports character cards, lorebooks, presets, and personas.");
}
