import { z } from "zod";
import { all, now, parseJson, run } from "../db/db";
import type { Standing } from "./types";

/**
 * The person sheet (docs/21 Part 2): what the lore says about each person, read once by the model
 * and kept until their text changes. Is it a person who could act, are they alive, where are they,
 * and do they belong to the story's present? The roster reads it before its own guesses, and after
 * what you set and what the story showed.
 */
export type SheetKind = "person" | "animal" | "group" | "thing";
export type SheetStatus = "alive" | "dead" | "absent" | "captive" | "changed" | "unknown";
export type SheetWhen = "now" | "past" | "later" | "unknown";

export interface Sheet {
  kind: SheetKind;
  status: SheetStatus;
  /** Where they are now, as the lore says ("Los Angeles"), or null. */
  whereabouts: string | null;
  /** Far from the story's town (another city, abroad). */
  far: boolean;
  inStory: SheetWhen;
  /** The words of their lore the reading rests on. */
  quote?: string;
  /** The text it was read from (a hash), so a change reads it again. */
  basis: string;
  at: number;
}

/** Where a value in the roster came from: you, the story, the lore read, or the old guesses. */
export type Basis = "you" | "story" | "lore" | "guess" | "none";

export const sheetKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export function sheetsFor(chatId: string): Record<string, Sheet> {
  const rows = all<{ name_key: string; data: string }>("SELECT name_key, data FROM world_sheets WHERE chat_id = ?", chatId);
  return Object.fromEntries(rows.map((r) => [r.name_key, parseJson<Sheet>(r.data, null as unknown as Sheet)]).filter(([, s]) => s));
}

export function saveSheet(chatId: string, name: string, s: Sheet) {
  run(
    "INSERT INTO world_sheets (chat_id, name_key, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id, name_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
    chatId,
    sheetKey(name),
    JSON.stringify(s),
    now(),
  );
}

/** What a sheet makes of someone's standing; undefined when it doesn't say. */
export function sheetStanding(s: Sheet): Standing | undefined {
  if (s.kind === "animal") return "companion";
  if (s.kind !== "person") return "changed";
  if (s.status === "dead") return "dead";
  if (s.status === "captive") return "captive";
  if (s.status === "changed") return "changed";
  if (s.status === "absent" || s.far) return "away";
  if (s.status === "alive") return "here";
  return undefined;
}

/**
 * Someone only the lore knows, who has no place in this story now: a group, a thing, someone who died
 * before it, or someone who comes later. Away isn't gone: Giles in England can still think of coming back.
 */
export const offStory = (s: Sheet) => s.kind === "group" || s.kind === "thing" || (s.inStory === "past" && s.status === "dead") || s.inStory === "later";

// ---------- the model's reading ----------

export const sheetSchema = z.object({
  people: z.array(
    z.object({
      name: z.string(),
      kind: z.string(),
      status: z.string(),
      whereabouts: z.string().nullable().optional(),
      far: z.boolean().optional(),
      inStory: z.string(),
      quote: z.string().optional(),
    }),
  ),
});

export type SheetRead = z.infer<typeof sheetSchema>["people"][number];

export function sheetPrompt(people: { name: string; text: string }[], o: { setting: string; now: string; town: string }) {
  const system = [
    "You read a story's lore and say, for each entry, what it means for the story's present. You only report what the text says or plainly implies; when it doesn't say, answer unknown or null.",
    'Return JSON: {"people":[{"name","kind","status","whereabouts","far","inStory","quote"}]}, one item per entry, names exactly as given.',
    "kind: person (someone who could act on their own), animal (a pet or beast), group (a faction, family, crew), thing (a place, object, idea, or a title that isn't a person).",
    "status, now: alive · dead (dead and not back) · absent (alive but gone from the story's town: moved away, left, last seen elsewhere) · captive · changed (alive but can't act as themself: soulless, petrified, possessed) · unknown.",
    "A vampire or other undead who walks and acts is alive here. Someone who died and came back is alive.",
    "whereabouts: where they are now, as a short place name, or null. far: true when that's away from the story's town (another city, country, dimension).",
    "inStory: now (alive in the story's present, wherever they are: someone away in another city is still now) · past (dead before the story's present) · later (not born or not yet arrived in the story's time) · unknown.",
    "quote: the few words of their entry your reading rests on, copied exactly; empty when nothing says.",
  ].join("\n");
  const user = [
    `THE STORY: ${o.setting}`,
    `NOW: ${o.now}${o.town ? `, in ${o.town}` : ""}`,
    "",
    ...people.map((p) => `ENTRY ${p.name}\n${p.text}\n`),
  ].join("\n");
  return { system, user };
}

const KINDS = new Set(["person", "animal", "group", "thing"]);
const STATUSES = new Set(["alive", "dead", "absent", "captive", "changed", "unknown"]);
const WHENS = new Set(["now", "past", "later", "unknown"]);

/** One reading held to what was asked: a known name, known values, and a quote that's really in their text. */
export function checkRead(r: SheetRead, text: string, basis: string): Sheet | null {
  if (!KINDS.has(r.kind) || !STATUSES.has(r.status) || !WHENS.has(r.inStory)) return null;
  const kind = r.kind as SheetKind;
  const status = r.status as SheetStatus;
  const inStory = r.inStory as SheetWhen;
  const flat = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const quote = r.quote?.trim() && flat(text).includes(flat(r.quote)) ? r.quote.trim() : undefined;
  const where = r.whereabouts?.trim() || null;
  return { kind, status, whereabouts: where && where.length <= 80 ? where : null, far: Boolean(r.far), inStory, ...(quote ? { quote } : {}), basis, at: now() };
}

/** Forget every reading in a chat, so the next one reads everyone again. */
export function clearSheets(chatId: string) {
  run("DELETE FROM world_sheets WHERE chat_id = ?", chatId);
}
