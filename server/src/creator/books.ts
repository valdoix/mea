import { badRequest, notFound } from "../lib/http";
import { CATEGORY_INFO, withCategory } from "../lore/format";
import { createEntry, createLorebook, deleteEntry, getLorebook, type LinkType, linkLorebook, linkedBooks, updateEntry } from "../lore/service";
import { type BookRole, defaultEntry } from "../lore/types";
import { getCard } from "../services/characters";

/**
 * Small books bound to a card or persona, so it ships lean and its depth and rules travel with it
 * (export merges every linked book into the card's character_book):
 *  - the depth book: deepening answers and depth entries, firing on meaning;
 *  - the rules book: always-on entries that keep a character playing to spec under any preset
 *    (think before replying, craft, the relationship arc's rule) plus a re-anchor of who they are;
 *  - world agency: a narrator card's agenda and holds, as an always-on entry in its rules book.
 */

const ROLE_SETTINGS: Record<BookRole, { semantic?: boolean }> = { depth: { semantic: true }, lore: { semantic: true }, people: {}, rules: {} };
const ROLE_NAME: Record<BookRole, string> = { depth: "depth book", lore: "lore book", people: "people book", rules: "rules book" };
const ROLE_ABOUT: Record<BookRole, (name: string) => string> = {
  depth: (n) => `Depth for ${n}: detail that surfaces when it's relevant instead of riding every turn.`,
  lore: (n) => `The deep lore of ${n}: entries surface on relevance so the story consults canon instead of inventing it.`,
  people: (n) => `The people of ${n}: entries fire by name so the narrator can voice them on cue.`,
  rules: (n) => `How ${n} stays itself in any chat: an anchor line and the always-on rules it plays by. Made by the creator; travels with the card on export.`,
};

/** The book with this role linked to the card or persona, or a new one (named after it) linked to it. */
export function ensureRoleBook(role: BookRole, owner: { type: LinkType; id: string; name: string }, existingId?: string | null): string {
  const existing = existingId ? getLorebook(existingId) : undefined;
  if (existing && !existing.deletedAt) {
    if (!existing.links.some((l) => l.type === owner.type && l.id === owner.id)) linkLorebook(existing.id, owner.type, owner.id);
    return existing.id;
  }
  const linked = linkedBooks(owner.type, owner.id).map((b) => getLorebook(b.id)).find((b) => b && !b.deletedAt && b.settings.role === role);
  if (linked) return linked.id;
  return createLorebook({ name: `${owner.name} ${ROLE_NAME[role]}`, description: ROLE_ABOUT[role](owner.name), settings: { role, ...ROLE_SETTINGS[role] }, links: [{ target_type: owner.type, target_id: owner.id }] });
}

export interface DepthItem {
  id: string;
  title: string;
  content: string;
  keys: string[];
  entryId?: string;
}

/** Writes depth entries into the depth book: new ones added, changed ones updated, nothing you added by hand touched. Returns entry ids by item id. */
export function writeDepthBook(bookId: string, items: DepthItem[]): Record<string, string> {
  const book = getLorebook(bookId);
  if (!book) throw notFound("Lorebook not found");
  const out: Record<string, string> = {};
  for (const it of items.filter((i) => i.content.trim())) {
    const keys = it.keys.length ? it.keys : [it.title];
    const cur = it.entryId ? book.entries.find((e) => e.id === it.entryId) : undefined;
    const base = withCategory(defaultEntry({ comment: it.title, keys, content: it.content.trim(), extra: { creatorDepth: it.id } }), "current", { defaults: false });
    if (cur) {
      updateEntry(cur.id, { ...cur, comment: it.title, keys, content: it.content.trim() });
      out[it.id] = cur.id;
    } else out[it.id] = createEntry(bookId, { ...base, position: "after_char", order: CATEGORY_INFO.current.order }).id;
  }
  return out;
}

// ---------- the rules book ----------

const DELIBERATION =
  "<deliberation>\nBefore writing {{char}}'s next reply, work through this silently, then write only the reply:\n- BEAT: what just changed in the scene.\n- LENS: how {{char}} perceives it, through their own values and voice.\n- STATE: where {{char}} is emotionally and with {{user}} right now.\n- BODY: what {{char}}'s body allows or prevents here (for spatial sense; never narrate it as a list).\n- BIND: the conflict between two things {{char}} values. Keep them inside it: make them pay for the choice instead of reframing the moment into an easier one.\n- CALIBRATION: react in proportion. Respond strongly only to what genuinely moves {{char}}; stay flat toward what doesn't. The unmoved reactions are as load-bearing as the intense ones.\n</deliberation>";

const CRAFT_RULES =
  "<craft>\nNarrate in {{char}}'s own voice and lens, not a neutral camera: word choice, rhythm and what gets noticed are shaped by who {{char}} is. Keep dialogue in their idiolect.\nTreat physical detail as a reference, never recite it like a spec sheet.\nDon't: open with weather or a sigh as filler; restate {{user}}'s action back before responding; resolve tension quickly just to keep things comfortable; write {{user}}'s thoughts, words or choices; flatten {{char}} into an accommodating version of themselves; repeat an emotional beat in new words instead of advancing it.\n</craft>";

const ARC_RULE =
  "<arc>\n{{char}} changes as the bond with {{user}} deepens. Read where it stands from the re-anchor's Now line and the recent scenes; move it gradually, in the direction the interaction earns, and let {{char}}'s manner and voice reflect the current level rather than jumping to the end. Only the reactions the arc names shift; {{char}}'s hard limits never move at any level.\n</arc>";

const NARRATOR_RULES =
  "<narration>\nYou narrate this world: set scenes, describe, and voice its people, each in their own register; never collapse into a single character and never write {{user}}'s actions, words or feelings. Treat lore that surfaces as canon and never invent canon that contradicts it.\n</narration>";

const line = (s: string, max = 220) => s.replace(/\s+/g, " ").trim().slice(0, max);

export interface RulesSource {
  name: string;
  narrator: boolean;
  brief: string;
  section: (key: string) => string;
}

/** The always-on entries the rules book holds, each tagged with its role so a rewrite replaces it in place. */
export function rulesEntries(src: RulesSource) {
  const core = line(src.section("personality") || src.brief, 260);
  const drives = line(src.section("motivation"));
  const voice = line(src.section("voice"));
  const arc = src.section("arc");
  const reanchor = [`Core: ${core}`, drives && `Drives: ${drives}`, voice && `Voice: ${voice}`, `Now: ${arc ? `${line(arc, 160)} (at the start)` : "the start of the story"}`].filter(Boolean).join("\n");
  const rule = (role: string, comment: string, content: string, order: number) => ({ role, entry: defaultEntry({ comment, content, constant: true, position: "depth", depth: 4, order, extra: { creatorRule: role, category: "rule", type: "rule" } }) });
  return [
    rule("reanchor", `${src.name}: re-anchor`, reanchor, 1),
    ...(src.narrator ? [rule("narration", "Rules: narration", NARRATOR_RULES, 2)] : [rule("deliberation", "Rules: think before replying", DELIBERATION, 2), rule("craft", "Rules: voice and anti-patterns", CRAFT_RULES, 3)]),
    ...(arc && !src.narrator ? [rule("arc", "Rules: the relationship arc", ARC_RULE, 4)] : []),
  ];
}

/** Writes the rules entries into the book: each replaces the one with its role; an arc rule that no longer applies goes. */
export function writeRulesBook(bookId: string, src: RulesSource) {
  const book = getLorebook(bookId);
  if (!book) throw notFound("Lorebook not found");
  const want = rulesEntries(src);
  for (const { role, entry } of want) {
    const cur = book.entries.find((e) => e.extra.creatorRule === role);
    if (cur) updateEntry(cur.id, { ...cur, comment: entry.comment, content: entry.content, constant: true, extra: { ...cur.extra, ...entry.extra } });
    else createEntry(bookId, entry);
  }
  const roles = new Set(want.map((w) => w.role).concat("agency"));
  for (const e of book.entries) if (typeof e.extra.creatorRule === "string" && !roles.has(e.extra.creatorRule)) deleteEntry(e.id);
}

// ---------- world agency ----------

export interface Agency {
  enabled: boolean;
  agenda: string;
  holds: string[];
}

/** "Agenda: …\nHolds:\n- …" (the bible's World agency section) as agenda and holds. */
export function parseAgency(text: string): Agency {
  const agenda = text.match(/agenda\s*:\s*([\s\S]*?)(?:\n\s*holds?\s*:|$)/i)?.[1]?.trim() ?? "";
  const holdsPart = text.match(/holds?\s*:\s*([\s\S]*)$/i)?.[1] ?? "";
  const holds = holdsPart
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
  return { enabled: Boolean(agenda), agenda: agenda.replace(/\s+/g, " "), holds };
}

const agencyContent = (a: Agency) =>
  `<world_agency>\nThis world has an agenda of its own and pursues it quietly in the background, whatever {{user}} does: ${a.agenda}\n${a.holds.length ? `Holds (lines that never break, however hard a scene pushes; scenes may strain them, never break them):\n${a.holds.map((h) => `- ${h}`).join("\n")}\n` : ""}This is not a difficulty setting: the world doesn't fight {{user}} for the story, it has its own weather.\n</world_agency>`;

function rulesBookOf(characterId: string) {
  return linkedBooks("character", characterId)
    .map((b) => getLorebook(b.id))
    .find((b) => b && !b.deletedAt && b.settings.role === "rules");
}

/** A narrator card's world agency as its rules book holds it (off when there's no entry or it's switched off). */
export function getAgency(characterId: string): Agency {
  if (!getCard(characterId)) throw notFound("Character not found");
  const e = rulesBookOf(characterId)?.entries.find((x) => x.extra.creatorRule === "agency");
  if (!e) return { enabled: false, agenda: "", holds: [] };
  const a = e.extra.agency as Partial<Agency> | undefined;
  return { enabled: e.enabled, agenda: a?.agenda ?? "", holds: a?.holds ?? [] };
}

/** Turns world agency on or off, or edits it: written into the card's rules book at once, so it holds in every chat. */
export function setAgency(characterId: string, input: Agency): Agency {
  const card = getCard(characterId);
  if (!card) throw notFound("Character not found");
  const a: Agency = { enabled: input.enabled, agenda: input.agenda.trim().slice(0, 1200), holds: input.holds.map((h) => h.trim().slice(0, 300)).filter(Boolean).slice(0, 8) };
  if (a.enabled && !a.agenda) throw badRequest("Say what the world works toward first");
  const existing = rulesBookOf(characterId);
  if (!existing && !a.enabled) return a;
  const bookId = existing?.id ?? ensureRoleBook("rules", { type: "character", id: characterId, name: card.name });
  const book = getLorebook(bookId)!;
  const cur = book.entries.find((e) => e.extra.creatorRule === "agency");
  const entry = defaultEntry({ comment: "World agency", content: agencyContent(a), constant: true, enabled: a.enabled, position: "depth", depth: 4, order: 5, extra: { creatorRule: "agency", agency: { agenda: a.agenda, holds: a.holds }, category: "rule", type: "rule" } });
  if (cur) updateEntry(cur.id, { ...cur, content: entry.content, enabled: a.enabled, extra: { ...cur.extra, ...entry.extra } });
  else createEntry(bookId, entry);
  return a;
}
