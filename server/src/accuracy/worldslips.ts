import { cleanText } from "../memory/text";
import { dayOfYear, outOfClimate } from "../sim/sky";
import { worldConfig } from "../sim/service";
import type { WorldState } from "../trackers/types";
import { sentences } from "./rules";
import { type Found, SLIPS } from "./slips";

/**
 * Reply checks against the world itself (docs/33 Parts 7 and 13), each one entry in the slip
 * registry and none calling a model: weather the climate can't have.
 */

/** Not the weather now: a memory, a wish, a comparison, a picture. */
const NOT_NOW = /\b(?:remember\w*|recall\w*|years ago|back (?:then|home|in|when)|used to|last (?:winter|year|christmas)|as if|as though|like (?:a|an|the|fresh|new)|would|could|might|if|wish\w*|dream\w*|imagin\w*|photo\w*|picture\w*|painting|postcard|globe|movie|film|tv|television|song|story|stories|once|never|someday|christmas)\b/i;
const FREEZE = /\b(?:frost(?:ed|y)?|snow(?:s|ing|fall|ed|flakes?|drifts?)?|sleet|blizzard|black ice|icy (?:roads?|wind|pavements?|sidewalks?)|ice on the (?:windshield|windscreen|car|road|puddles?))\b/i;
const FREEZE_NOT = /\bfrost(?:ed|ing)? (?:glass|tips?|flakes|cake|cupcakes?)|\bfrosting\b|\bsnow ?(?:cone|globe|white)\b/i;
const HEAT = /\b(?:sweltering|scorching|blistering|heat ?wave)\b/i;

/** A reply writing weather this place can't have at this time of year ("frost on the car" in a mediterranean October). */
export function weatherRule(text: string, st: WorldState, cfg: { climate: string; latitude: number }): Found[] {
  if (!st.time) return [];
  const doy = dayOfYear(st.time.minutes, st.time.form);
  for (const s of sentences(cleanText(text))) {
    if (NOT_NOW.test(s) || FREEZE_NOT.test(s)) continue;
    const word = FREEZE.exec(s)?.[0] ?? HEAT.exec(s)?.[0];
    if (!word) continue;
    const why = outOfClimate(word, cfg.climate, doy, cfg.latitude);
    if (!why) continue;
    return [
      {
        kind: "weather",
        severity: "minor",
        claim: s.trim(),
        conflict: `"${word}" doesn't fit where and when this is: ${why}.`,
        citations: [{ ref: "T", type: "tracker", label: "the story's climate and date" }],
        fix: `Keep the weather to what this place has at this time of year (${why}).`,
        by: "rules",
      },
    ];
  }
  return [];
}

SLIPS.push({
  id: "weather",
  label: "Weather",
  description: "Weather the story's climate can't have at this time of year (frost in a warm autumn).",
  phase: "reply",
  on: (c) => c.role === "assistant" && c.continuity && Boolean(c.state?.time),
  run: (text, st, c) => (st ? weatherRule(text, st, worldConfig(c.chatId)) : []),
});
