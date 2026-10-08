import { z } from "zod";
import { getSetting } from "../lib/settings";
import { countTokens } from "../lib/tokens";
import { resolver } from "../memory/entities";
import { getCard } from "../services/characters";
import { historyForPrompt, messageCountOf, mustChat } from "../services/chats";
import { callJson } from "../services/llm";
import { getDefaultPersona, getPersona } from "../services/personas";
import { evalCondition } from "../trackers/condition";
import { currentFold } from "../trackers/store";
import { activateLore, type EntryExtra, extraOf } from "./activate";
import { loadLoreState, scanEntriesFor } from "./service";

/**
 * Lore helpers: entry types with suggested fields (LORE-09), AI-assisted writing shown as a
 * diff (LORE-11), the live typing preview (LORE-08), and glossary terms (LORE-15).
 */

export const ENTRY_TEMPLATES: Record<NonNullable<EntryExtra["type"]>, { label: string; fields: string[]; hint: string }> = {
  character: { label: "Character", fields: ["Appearance", "Personality", "Voice", "History", "Relationships", "Wants"], hint: "A person: how they look, act and talk, and what drives them." },
  location: { label: "Location", fields: ["What it looks like", "Atmosphere", "Who's there", "Notable features", "Dangers"], hint: "A place, from a world down to a room. Give it a parent to nest it." },
  item: { label: "Item", fields: ["Appearance", "What it does", "History", "Who has it"], hint: "An object that matters to the story." },
  faction: { label: "Faction", fields: ["Who they are", "Goals", "Leaders", "Methods", "Allies and enemies"], hint: "A group, guild, house or organisation." },
  concept: { label: "Concept", fields: ["What it is", "How it works", "Limits", "Who knows"], hint: "Magic, technology, a belief, a custom." },
  event: { label: "Event", fields: ["What happened", "When", "Who was involved", "Consequences"], hint: "Something that happened (or will)." },
  rule: { label: "Rule", fields: ["The rule", "Why", "Exceptions"], hint: "A rule of this world that must always hold." },
};

/** A skeleton for a new entry of a type. */
export function templateContent(type: NonNullable<EntryExtra["type"]>, name = "") {
  const t = ENTRY_TEMPLATES[type];
  return `${name ? `${name}. ` : ""}${t.fields.map((f) => `${f}: `).join("\n")}`;
}

// ---------- AI assist (LORE-11) ----------

const assistSchema = z.object({ comment: z.string().default(""), content: z.string().default(""), keys: z.array(z.string()).default([]), aliases: z.array(z.string()).default([]), essentials: z.string().default("") });

export type AssistAction = "draft" | "keys" | "condense" | "rewrite";

const ASK: Record<AssistAction, string> = {
  draft: "Draft a lorebook entry from the one-line idea. Third person, present tense, 80–160 words, concrete and useful to a storyteller. Suggest a short title, trigger keys (names and phrases), aliases, and one-sentence essentials.",
  keys: "Suggest trigger keys for this entry: the names, nicknames and short phrases a story would use when this entry matters (3–8, no generic words), plus aliases, and one-sentence essentials. Keep the content as it is.",
  condense: "Condense this entry for token efficiency: keep every fact, name and number, drop filler, at most half the length. Also write one-sentence essentials.",
  rewrite: "Rewrite this entry in a clean, consistent lorebook style: third person, present tense, short declarative sentences grouped by topic. Keep every fact, name and number.",
};

/** Returns a proposal; the editor shows it as a diff and you accept what you want. */
export async function assistEntry(action: AssistAction, input: { idea?: string; comment?: string; content?: string; keys?: string[]; type?: EntryExtra["type"]; style?: string; chatId?: string | null }) {
  const r = await callJson({
    task: "helper",
    kind: `lore:${action}`,
    chatId: input.chatId ?? undefined,
    name: "lore_assist",
    schema: assistSchema,
    system: `You help write lorebook entries for interactive fiction. ${ASK[action]}${input.style ? ` Style notes from the author: ${input.style}` : ""} Reply with JSON only: {"comment": "…", "content": "…", "keys": ["…"], "aliases": ["…"], "essentials": "…"}`,
    user: [
      input.type ? `TYPE: ${ENTRY_TEMPLATES[input.type].label} (${ENTRY_TEMPLATES[input.type].fields.join(", ")})` : "",
      input.idea ? `IDEA: ${input.idea}` : "",
      input.comment ? `TITLE: ${input.comment}` : "",
      input.keys?.length ? `KEYS: ${input.keys.join(", ")}` : "",
      input.content ? `ENTRY:\n${input.content}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 900,
  });
  const d = r.data;
  const keep = action === "keys";
  return {
    comment: d.comment || input.comment || "",
    content: keep ? (input.content ?? "") : d.content || input.content || "",
    keys: d.keys.length ? [...new Set(d.keys.map((k) => k.trim()).filter(Boolean))] : (input.keys ?? []),
    aliases: [...new Set(d.aliases.map((k) => k.trim()).filter(Boolean))],
    essentials: d.essentials,
    tokens: { before: countTokens(input.content ?? ""), after: countTokens(keep ? (input.content ?? "") : d.content || input.content || "") },
  };
}

// ---------- typing preview (LORE-08) ----------

/** Entries your draft would trigger that aren't active now. No model calls, so it's instant. */
export function previewLore(chatId: string, draft: string) {
  const chat = mustChat(chatId);
  const card = chat.character_id ? getCard(chat.character_id) : undefined;
  const persona = getPersona(chat.persona_id) ?? getDefaultPersona();
  let state: ReturnType<typeof currentFold>["result"]["state"] | null = null;
  try {
    state = currentFold(chatId).result.state;
  } catch {
    state = null;
  }
  const entries = scanEntriesFor({ characterId: chat.character_id, personaId: persona?.id ?? null, chatId }).flatMap((e) => {
    const when = extraOf(e).trackerWhen?.trim();
    if (!when) return [e];
    return state && evalCondition(state, when) ? [{ ...e, constant: true }] : [];
  });
  if (!entries.length || !draft.trim()) return [];
  const history = historyForPrompt(chatId).map((m) => `${m.role === "user" ? (persona?.name ?? "You") : m.role === "assistant" ? (card?.name ?? "Character") : "Note"}: ${m.content}`);
  const present = state ? Object.values(state.chars).filter((c) => !c.isUser && (c.tier === "spot" || c.tier === "peri")).map((c) => c.name) : [];
  const base = {
    entries,
    messageCount: messageCountOf(chatId),
    state: loadLoreState(chatId),
    defaults: { ...getSetting("lore.defaults"), tokenBudget: 0 },
    countTokens,
    random: () => 0,
    all: entries,
  };
  const now = new Set(activateLore({ ...base, history, present }).activated.map((a) => a.entry.id));
  const named = resolver(chatId).mentionedIn(draft).map((e) => e.name);
  const next = activateLore({ ...base, history: [...history, `${persona?.name ?? "You"}: ${draft}`], present: [...present, ...named] });
  return next.activated
    .filter((a) => !now.has(a.entry.id))
    .map((a) => ({ id: a.entry.id, bookId: a.entry.bookId, bookName: a.entry.bookName, title: a.entry.comment || a.entry.keys[0] || "(untitled)", reason: a.reason, tokens: countTokens(a.content), type: extraOf(a.entry).type ?? null }));
}

// ---------- glossary (LORE-15) ----------

/** Terms to underline in messages: entry keys and aliases (plain words, not regexes), with a snippet. */
export function glossary(chatId: string) {
  const chat = mustChat(chatId);
  const persona = getPersona(chat.persona_id) ?? getDefaultPersona();
  const terms: { term: string; entryId: string; bookId: string; title: string; type: string | null; snippet: string }[] = [];
  const seen = new Set<string>();
  for (const e of scanEntriesFor({ characterId: chat.character_id, personaId: persona?.id ?? null, chatId })) {
    if (!e.enabled || !e.content.trim()) continue;
    const x = extraOf(e);
    for (const k of [...e.keys, ...(x.aliases ?? [])]) {
      const term = k.trim();
      if (term.length < 3 || /^\/.*\/[a-z]*$/.test(term) || /[{}]/.test(term)) continue;
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push({ term, entryId: e.id, bookId: e.bookId, title: e.comment || e.keys[0] || term, type: x.type ?? null, snippet: e.content.replace(/\s+/g, " ").slice(0, 260) });
    }
  }
  // Longest first, so "Old Port" wins over "Port" when underlining.
  return terms.sort((a, b) => b.term.length - a.term.length).slice(0, 400);
}
