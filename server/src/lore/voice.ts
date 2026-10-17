import { mustChat } from "../services/chats";
import { extraOf } from "./activate";
import { factsNowFor, type LoreFact } from "./facts";
import { scanEntriesFor } from "./service";
import { slotDef, VOICE_SLOTS } from "./slots";

/**
 * Voice slots in the re-anchor (docs/15, 3.5): pet names, catchphrases, greetings and goodbyes
 * from the character's lore feed the re-anchor block, so long chats keep the voice; the drift
 * alert names the voice slot the replies have wandered furthest from.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/** The character's voice facts in this chat (canon and the chat's own), from any entry that's theirs. */
export function voiceFacts(chatId: string, name: string): LoreFact[] {
  const chat = mustChat(chatId);
  const n = norm(name);
  const mine = scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId }).filter((e) => e.enabled && [e.comment, ...e.keys, extraOf(e).entity ?? ""].some((k) => norm(k) === n));
  if (!mine.length) return [];
  return [...factsNowFor(mine.map((e) => e.id), chatId).values()].flat().filter((f) => f.slot && VOICE_SLOTS.includes(f.slot));
}

/** The re-anchor's voice lines: "Calls {{user}}: love, little fish · Says: Tides willing". */
export function voiceLines(facts: LoreFact[], user: string): string[] {
  const by = new Map<string, string[]>();
  for (const f of facts) by.set(f.slot!, [...(by.get(f.slot!) ?? []), f.value]);
  const label: Record<string, string> = { "pet names": `Calls ${user}`, catchphrases: "Says", swearing: "Swearing", greeting: "Greets with", goodbye: "Says goodbye with", "never says": "Never says" };
  return VOICE_SLOTS.filter((k) => by.has(k)).map((k) => `${label[k] ?? slotDef(k)?.label ?? k}: ${by.get(k)!.map((v) => (k === "swearing" ? v : `“${v.replace(/^["“]|["”]$/g, "")}”`)).join(" · ")}`);
}

/**
 * The voice slot the recent replies are furthest from: a word they'd never use that shows up, else
 * a pet name or catchphrase that hasn't been heard at all. Null when the replies keep to them.
 */
export function furthestVoiceSlot(facts: LoreFact[], recent: string): string | null {
  const text = ` ${norm(recent)} `;
  const heard = (v: string) => text.includes(` ${norm(v)} `);
  const never = facts.filter((f) => f.slot === "never says").find((f) => heard(f.value));
  if (never) return `used a word they'd never use (“${never.value}”)`;
  for (const slot of ["pet names", "catchphrases"]) {
    const vals = facts.filter((f) => f.slot === slot);
    if (vals.length && !vals.some((f) => heard(f.value))) return `hasn't used their ${slot === "pet names" ? "pet names for you" : "catchphrases"} (“${vals[0]!.value}”) lately`;
  }
  return null;
}
