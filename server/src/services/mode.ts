import type { CardData } from "../cards/card";
import type { ChatMode } from "./characters";

/**
 * Guesses whether a card is a narrator/world card or a 1-on-1 companion (CHAT-25).
 * Phase 0 uses text heuristics; Phase 2 adds a cheap model gate for unclear cases.
 */
export function detectMode(card: CardData): { mode: ChatMode; score: number; reasons: string[] } {
  const text = `${card.name}\n${card.description}\n${card.scenario}\n${card.system_prompt}\n${card.first_mes}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  const rules: [RegExp, number, string][] = [
    [/\b(narrator|game ?master|\bgm\b|dungeon master|storyteller)\b/, 3, "mentions a narrator or game master"],
    [/\byou are (the )?(narrator|world|story)/, 3, "describes itself as the narrator"],
    [/\b(npcs?|non-player characters?|side characters?)\b/, 2, "mentions NPCs"],
    [/\b(simulator|simulation|rpg|text adventure|interactive fiction|open world|sandbox)\b/, 2, "reads like a simulator or adventure"],
    [/\b(multiple characters|various characters|many characters|cast of)\b/, 2, "mentions multiple characters"],
    [/\b(the world of|setting:|world ?building|kingdom|continent|city of)\b/, 1, "focuses on a setting"],
    [/\bplay as\b/, 1, "invites {{user}} to play a role in a world"],
  ];
  for (const [re, w, why] of rules) {
    if (re.test(text)) {
      score += w;
      reasons.push(why);
    }
  }
  if (/\b(world|realm|academy|kingdom|city|universe|rpg|simulator|narrator)\b/.test(card.name.toLowerCase())) {
    score += 2;
    reasons.push("the name sounds like a place or system");
  }
  // First-person companion cues pull the other way.
  if (/\b(she|he|they) (is|has|was)\b/.test(text) && score < 3) score -= 1;
  return { mode: score >= 3 ? "narrator" : "companion", score, reasons };
}
