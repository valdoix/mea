import { z } from "zod";
import { findLeaks, type MapRow, variantBlock } from "../creator/variantcore";
import { all, now, one, parseJson, run, tx } from "../db/db";
import { badRequest, notFound } from "../lib/http";
import { planFor, shortName } from "../lore/versionlore";
import type { Found } from "../accuracy/slips";
import { setMemState } from "../memory/store";
import { cleanText } from "../memory/text";
import { expandMacros } from "../prompt/macros";
import { addMessage, createChat, getChatRow, updateChat } from "./chats";
import { getCard } from "./characters";
import { type LinkKind, linkInfo, listLinkedVersions } from "./linked";
import { callJson } from "./llm";
import { getDefaultPersona, getPersona } from "./personas";
import { getUniverse } from "./universes";

/**
 * Versions in chats (docs/14, part 6). A story set in a version or a universe stays in it: a reply
 * that uses a name the map changed or dropped is flagged (with the version's name as a one-tap fix),
 * those names never become Codex pages, a chat can be retold in another version, and a new chat
 * with a version brings your persona's version from the same universe.
 */

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// ---------- the map a chat lives by ----------

interface ChatMap {
  rows: MapRow[];
  /** "College AU": what the version is called, for the issue's wording. */
  label: string;
}

const mapCache = new Map<string, { at: number; map: ChatMap }>();
const TTL = 15_000;

/** One card's or persona's map: its own (from the studio) and its universe's shared one. */
function mapOf(kind: LinkKind, id: string | null): ChatMap | null {
  if (!id) return null;
  const link = linkInfo(kind, id);
  if (!link?.origin) return null;
  const plan = planFor(kind, id, link.origin, link);
  const rows = [...plan.map];
  const u = getUniverse(link.universeId);
  for (const r of u?.map ?? []) if (!rows.some((x) => x.from.trim() && norm(x.from) === norm(r.from))) rows.push(r);
  return { rows: rows.filter((r) => r.type !== "self"), label: link.label || u?.name || `${link.origin.name}'s version` };
}

/** The chat's map: its character's, plus its persona's (a few seconds' cache, as every reply asks). */
export function chatMap(chatId: string): ChatMap | null {
  const hit = mapCache.get(chatId);
  if (hit && now() - hit.at < TTL) return hit.map.rows.length ? hit.map : null;
  const chat = getChatRow(chatId);
  const a = chat ? mapOf("character", chat.character_id) : null;
  const b = chat ? mapOf("persona", chat.persona_id) : null;
  const map: ChatMap = { rows: [...(a?.rows ?? [])], label: a?.label ?? b?.label ?? "" };
  for (const r of b?.rows ?? []) if (!map.rows.some((x) => norm(x.from) === norm(r.from))) map.rows.push(r);
  mapCache.set(chatId, { at: now(), map });
  if (mapCache.size > 200) mapCache.delete(mapCache.keys().next().value!);
  return map.rows.length ? map : null;
}

export const forgetChatMap = (chatId?: string) => (chatId ? mapCache.delete(chatId) : mapCache.clear());

/** Names that don't belong in this chat's world (the map changed or dropped them), for the Codex. */
export function foreignNames(chatId: string): Set<string> {
  const map = chatMap(chatId);
  const out = new Set<string>();
  for (const r of map?.rows ?? []) {
    if ((r.state !== "changed" && r.state !== "dropped") || r.from.trim().length < 3) continue;
    if (r.state === "changed" && (!r.to.trim() || norm(r.to) === norm(r.from) || norm(shortName(r.to)) === norm(r.from))) continue;
    out.add(norm(r.from));
  }
  return out;
}

// ---------- the leak check (a slip, accuracy/slips.ts) ----------

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every place the term is written, the way the leak check matches it. */
export function replaceTerm(text: string, from: string, to: string) {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(from)}(?=$|[^\\p{L}\\p{N}])`, /\p{Lu}/u.test(from) ? "gu" : "giu");
  return text.replace(re, (_m, lead: string) => `${lead}${to}`);
}

/** A reply that uses a name this version's map changed or dropped. Rules only; free. */
export function universeLeaks(chatId: string, text: string): Found[] {
  const map = chatMap(chatId);
  if (!map) return [];
  const leaks = findLeaks(map.rows, [{ where: "field", key: "reply", label: "reply", text: cleanText(text) }]);
  const seen = new Set<string>();
  const out: Found[] = [];
  for (const l of leaks) {
    if (seen.has(l.term)) continue;
    seen.add(l.term);
    const to = l.state === "changed" ? shortName(l.to) : "";
    out.push({
      kind: "universe",
      severity: "minor",
      claim: l.term,
      conflict: to ? `In ${map.label}, ${l.term} is ${l.to}.` : `${l.term} isn't part of ${map.label}.`,
      citations: [{ ref: "V", type: "card", label: `${map.label}'s map` }],
      fix: to ? `Call it "${to}", not "${l.term}".` : `Leave out ${l.term}: it doesn't exist in this version.`,
      ...(to ? { replace: { from: l.term, to } } : {}),
      by: "rules",
    });
  }
  return out;
}

/** True when the chat is set in a version with a map (so the check has something to do). */
export const universeCheckOn = (chatId: string) => Boolean(chatMap(chatId));

// ---------- choosing a persona for a version ----------

/**
 * The persona for a new chat with this character: the one asked for; otherwise, when the character
 * is a version in a universe, your persona's version in that universe (or any persona in it), before
 * your usual one.
 */
export function personaForVersion(characterId: string, asked?: string | null): string | null {
  if (asked) return asked;
  const row = one<{ universe_id: string | null; default_persona_id: string | null }>("SELECT universe_id, default_persona_id FROM characters WHERE id = ?", characterId);
  const usual = getPersona(row?.default_persona_id) ?? getDefaultPersona();
  if (!row?.universe_id) return usual?.id ?? null;
  const inUniverse = all<{ id: string; variant_of: string | null }>("SELECT id, variant_of FROM personas WHERE universe_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC", row.universe_id);
  if (usual && inUniverse.some((p) => p.id === usual.id)) return usual.id;
  return inUniverse.find((p) => p.variant_of && p.variant_of === usual?.id)?.id ?? inUniverse[0]?.id ?? usual?.id ?? null;
}

// ---------- retell in another universe ----------

export interface RetellArc {
  id: string;
  level: string;
  title: string;
  from: number;
  to: number | null;
}

/** The versions this chat could be retold in, and the arcs (chapters and scenes) it could retell. */
export function retellOptions(chatId: string) {
  const chat = getChatRow(chatId);
  if (!chat || chat.deleted_at) throw notFound("Chat not found");
  const link = chat.character_id ? linkInfo("character", chat.character_id) : null;
  // The whole family: the original and every version of it, but not the card this chat already plays.
  const originId = link?.origin?.id ?? chat.character_id;
  const family = originId ? [{ id: originId, name: getCard(originId)?.name ?? "", label: "", kind: null as string | null, original: true }, ...listLinkedVersions("character", originId).map((v) => ({ id: v.id, name: v.name, label: v.label, kind: v.kind as string | null, original: false }))] : [];
  const versions = family
    .filter((v) => v.id !== chat.character_id)
    .map((v) => {
      const u = one<{ id: string; name: string }>("SELECT u.id, u.name FROM characters c JOIN universes u ON u.id = c.universe_id AND u.deleted_at IS NULL WHERE c.id = ?", v.id);
      return { ...v, universe: u ?? null };
    });
  const arcs = all<{ id: string; level: string; title: string; start_seq: number; end_seq: number | null }>(
    "SELECT id, level, title, start_seq, end_seq FROM summaries WHERE chat_id = ? AND level IN ('story', 'arc', 'chapter', 'scene') AND state = 'ready' AND content != '' ORDER BY CASE level WHEN 'story' THEN 0 WHEN 'arc' THEN 1 WHEN 'chapter' THEN 2 ELSE 3 END, start_seq",
    chatId,
  ).map((r): RetellArc => ({ id: r.id, level: r.level, title: r.title || (r.level === "story" ? "The story so far" : `#${r.start_seq}–#${r.end_seq ?? "…"}`), from: r.start_seq, to: r.end_seq }));
  return { versions, arcs };
}

const retellSchema = z.object({ recap: z.string().default(""), title: z.string().default(""), greeting: z.string().default("") });

/**
 * Starts a new chat with another version, opening on what happened in this one (an arc, or the
 * story so far) told again through that version's map. Its memory starts fresh; the retold recap
 * rides along as its opening ("previously on…") and as a note the story keeps to.
 */
export async function retell(chatId: string, input: { versionId: string; arcId?: string | null; steer?: string }) {
  const chat = getChatRow(chatId);
  if (!chat || chat.deleted_at) throw notFound("Chat not found");
  const opts = retellOptions(chatId);
  const target = opts.versions.find((v) => v.id === input.versionId);
  if (!target) throw badRequest("Pick a version of this character");
  const arc = input.arcId ? one<{ id: string; title: string; content: string; level: string }>("SELECT id, title, content, level FROM summaries WHERE id = ? AND chat_id = ?", input.arcId, chatId) : (one<{ id: string; title: string; content: string; level: string }>("SELECT id, title, content, level FROM summaries WHERE chat_id = ? AND level = 'story' AND content != ''", chatId) ?? null);
  if (!arc?.content.trim()) throw badRequest("This chat has no summary to retell yet: let its memory catch up first");
  const fromName = chat.character_id ? (getCard(chat.character_id)?.name ?? "") : "";
  const card = getCard(target.id);
  if (!card) throw notFound("Character not found");
  const link = linkInfo("character", target.id);
  const plan = link?.origin ? planFor("character", target.id, link.origin, link) : null;
  const u = getUniverse(link?.universeId);
  const map = [...(plan?.map ?? []), ...(u?.map ?? []).filter((r) => !plan?.map.some((x) => norm(x.from) === norm(r.from)))];
  const r = await callJson({
    task: "helper",
    kind: "version:retell",
    chatId,
    name: "version_retell",
    schema: retellSchema,
    system: [
      target.original
        ? `Retell a story that happened with a version of ${card.name} as it would have happened with ${card.name} as they really are (the original). Move every place, person and thing back to the original's world.`
        : `Retell a story that happened with ${fromName} as it would happen in this version of them: ${card.name}${target.label ? ` (${target.label})` : ""}.`,
      plan ? variantBlock({ ...plan, map }, { original: false }) : "",
      !plan && map.length ? `THE MAP (use the version's names; never an original name it changed or dropped):\n${map.map((m) => `- ${m.from} → ${m.state === "dropped" ? "(not in this version)" : m.to || m.from}`).join("\n")}` : "",
      "Keep the shape of what happened (who met whom, what was said and decided, how it ended) and move everything else into this world. Plain past tense, a recap the next scene can start from, no more than about 250 words. Never write anything the user's character thinks or feels that the story didn't show.",
      input.steer?.trim() ? `The author asks: ${input.steer.trim()}` : "",
      `Then write the new chat's opening message ("greeting"): ${card.name} picking the story up right where the recap leaves off, in this world, in the card's voice and format (narration and dialogue, 1–3 short paragraphs), ending on something {{user}} can answer. Never write {{user}}'s actions, words, thoughts or feelings. Call the user's character {{user}}.`,
      'Reply with JSON only: {"recap": "…", "title": "a short title for the retold story", "greeting": "…"}',
    ]
      .filter(Boolean)
      .join("\n\n"),
    user: [`THE CARD (${card.name}):\n${[card.description, card.personality, card.scenario].filter((x) => x?.trim()).join("\n\n").slice(0, 4000)}`, card.first_mes?.trim() ? `ITS USUAL GREETING (for voice and format only; the new one follows the recap):\n${card.first_mes.trim().slice(0, 2000)}` : "", `THE STORY TO RETELL (${arc.level === "story" ? "the story so far" : arc.title || arc.level}):\n${arc.content.trim()}`].filter(Boolean).join("\n\n"),
    maxTokens: 2500,
    temperature: 0.6,
  });
  const recap = r.data.recap.trim();
  if (!recap) throw badRequest("Mea couldn't retell that; try again");
  return startRetold(chatId, target.id, arc.id, recap, r.data.title, r.data.greeting);
}

/**
 * The retold chat itself: the version, your persona for it, and the recap as its opening. With a
 * greeting written for the retelling, the chat opens on it instead of the card's usual ones (which
 * would start the story over).
 */
export function startRetold(chatId: string, versionId: string, arcId: string, recap: string, title = "", greeting = "") {
  const card = getCard(versionId);
  if (!card) throw notFound("Character not found");
  const personaId = personaForVersion(versionId, null);
  const made = createChat({ characterId: versionId, personaId, title: title.trim() ? `${card.name}: ${title.trim()}` : undefined });
  updateChat(made.id, { settings: { retold: { fromChatId: chatId, arcId, recap } } });
  const opening = greeting.trim() ? expandMacros(greeting.trim(), { char: card.name, user: getPersona(personaId)?.name ?? "You", vars: {}, seed: made.id, mode: made.mode }) : "";
  if (opening) {
    const first = one<{ id: string }>("SELECT id FROM messages WHERE chat_id = ? AND seq = 1", made.id);
    if (first)
      tx(() => {
        run("DELETE FROM swipes WHERE message_id = ? AND idx > 0", first.id);
        run("UPDATE swipes SET content = ?, meta = ?, updated_at = ? WHERE message_id = ? AND idx = 0", opening, JSON.stringify({ greeting: true, retold: true }), now(), first.id);
        run("UPDATE messages SET active_swipe = 0 WHERE id = ?", first.id);
      });
    else addMessage(made.id, "assistant", opening, { name: card.name, meta: { greeting: true, retold: true } });
  }
  setMemState(made.id, { recap: { text: recap, seq: opening ? 1 : (made.messageCount ?? 0), at: now() } });
  return { chatId: made.id, recap, personaId, greeting: opening };
}

/** What a retold chat carries, for its prompt (chattools.ts). */
export function retoldNote(settings: unknown) {
  const r = (settings as { retold?: { recap?: string } })?.retold;
  return r?.recap?.trim() ? `[This story retells an earlier one in this version's world. What happened before it starts, as it went here:]\n${r.recap.trim()}` : "";
}

export const settingsRetold = (raw: string) => parseJson<{ retold?: { fromChatId: string; arcId: string; recap: string } }>(raw, {}).retold ?? null;
