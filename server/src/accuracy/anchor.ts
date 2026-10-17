import type { CardData } from "../cards/card";
import type { PromptExtra } from "../prompt/assemble";
import { characterSettings } from "../services/charsettings";
import { messageCountOf, mustChat } from "../services/chats";
import { type PersonaMode, storyDials } from "../services/layers";
import { driftState, spokenPart, voiceSamples } from "./drift";
import { guardsFor } from "./guards";
import { voiceFacts, voiceLines } from "../lore/voice";

/**
 * The re-anchor block (CON-03): a short, constant reminder of who the character is, placed near
 * the end of the prompt where long sessions drift. It's built from the card (or your own text in
 * the character editor) with a couple of voice samples, and gets stronger while the drift
 * detector (CON-10) says the voice has wandered.
 */

const words = (s: string, n: number) => {
  const w = s.replace(/\s+/g, " ").trim().split(" ");
  return w.length > n ? `${w.slice(0, n).join(" ")}…` : w.join(" ");
};

/** The character in a sentence or two: personality first, else the description's opening. */
export function essence(card: CardData) {
  const src = card.personality.trim() || card.description.trim();
  const sents = src.replace(/\{\{char\}\}/gi, card.name).split(/(?<=[.!?])\s+/).filter(Boolean);
  return words(sents.slice(0, 3).join(" "), 70);
}

/** The anchor's last line follows the preset's Persona control (sealed when there's none). */
function personaLine(name: string, user: string, persona: PersonaMode | null | undefined) {
  if (persona === "full_cast") return `Write ${name}, the world and ${user} true to who each of them is.`;
  if (persona === "director") return `Write ${name} and the world; write ${user} only inside the player's direction.`;
  if (persona === "continuity") return `Write ${name} and the world, never ${user}'s words, thoughts, feelings or choices; you may only finish an action ${user} began.`;
  return `Write ${name} and the world, never ${user}'s words, actions or thoughts.`;
}

export function buildAnchor(o: { card: CardData; userName: string; characterId: string | null; strong?: boolean; reasons?: string[]; persona?: PersonaMode | null; /** docs/15, 3.5: the voice slots from their lore. */ voice?: string[] }) {
  const own = characterSettings(o.characterId).anchor?.trim();
  const samples = voiceSamples(o.characterId)
    .lines.map((l) => spokenPart(l))
    .filter((l) => l.length >= 12 && l.length <= 220);
  const pick = samples.slice(0, o.strong ? 4 : 2);
  const lines = [
    `[Who ${o.card.name} is: keep to this]`,
    own || essence(o.card),
    ...(o.voice ?? []),
    pick.length ? `How ${o.card.name} talks: ${pick.map((l) => `"${l.replace(/^["“]|["”]$/g, "")}"`).join(" · ")}` : "",
    o.strong && o.reasons?.length ? `Lately the replies have drifted from this voice: ${o.reasons.join("; ")}. Bring ${o.card.name}'s own voice back.` : "",
    personaLine(o.card.name, o.userName, o.persona),
  ];
  return lines.filter(Boolean).join("\n");
}

/** The re-anchor for this request, or null when it isn't due (CON-03). */
export function anchorExtra(chatId: string, card: CardData, userName: string, characterId: string | null): PromptExtra | null {
  const cfg = guardsFor(chatId);
  if (cfg.anchor === "off") return null;
  const drift = cfg.drift ? driftState(chatId) : null;
  const drifting = Boolean(drift?.drifting);
  if (cfg.anchor === "auto" && !drifting && messageCountOf(chatId) < cfg.anchorAfter) return null;
  return {
    id: "anchor",
    name: drifting ? "Re-anchor (stronger: voice drifting)" : "Re-anchor",
    content: buildAnchor({ card, userName, characterId, strong: drifting, reasons: drift?.reasons, persona: storyDials(mustChat(chatId)).persona, voice: voiceLines(voiceFacts(chatId, card.name), userName) }),
    depth: cfg.anchorDepth,
  };
}
