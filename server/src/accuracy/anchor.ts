import type { CardData } from "../cards/card";
import type { PromptExtra } from "../prompt/assemble";
import { characterSettings } from "../services/charsettings";
import { messageCountOf } from "../services/chats";
import { driftState, spokenPart, voiceSamples } from "./drift";
import { guardsFor } from "./guards";

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

export function buildAnchor(o: { card: CardData; userName: string; characterId: string | null; strong?: boolean; reasons?: string[] }) {
  const own = characterSettings(o.characterId).anchor?.trim();
  const samples = voiceSamples(o.characterId)
    .lines.map((l) => spokenPart(l))
    .filter((l) => l.length >= 12 && l.length <= 220);
  const pick = samples.slice(0, o.strong ? 4 : 2);
  const lines = [
    `[Who ${o.card.name} is: keep to this]`,
    own || essence(o.card),
    pick.length ? `How ${o.card.name} talks: ${pick.map((l) => `"${l.replace(/^["“]|["”]$/g, "")}"`).join(" · ")}` : "",
    o.strong && o.reasons?.length ? `Lately the replies have drifted from this voice: ${o.reasons.join("; ")}. Bring ${o.card.name}'s own voice back.` : "",
    `Write ${o.card.name} and the world, never ${o.userName}'s words, actions or thoughts.`,
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
    content: buildAnchor({ card, userName, characterId, strong: drifting, reasons: drift?.reasons }),
    depth: cfg.anchorDepth,
  };
}
