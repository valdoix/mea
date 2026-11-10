/**
 * docs/33 Part 13: what a `wx` line is about. Models write light and mood there ("first thin gold
 * on the kitchen tile", "kitchen half-dark, fridge hum") and the air of a room ("cold clean air
 * off the ice"), and the story then carried those as its weather for hours. Weather is the sky,
 * the temperature outside, wind and rain; the rest is kept as what it is.
 */

/** Words that are only ever about outdoors. */
const OUTDOOR = /\b(?:rain\w*|drizzl\w*|showers?|downpour|storm\w*|thunder\w*|lightning|snow\w*|sleet|hail\w*|fog\w*|mist\w*|haze|hazy|smog|overcast|cloud\w*|sky|skies|wind\w*|breez\w*|gales?|gust\w*|humid|muggy|frost\w*|blizzard|heat ?wave|clear(?:ing)?|squall\w*|monsoon)\b/i;
/** Words that are weather outdoors and just the air of a room indoors. */
const WEAK = /\b(?:sun|sunny|sunshine|cold|cool|chill\w*|warm|hot|mild|crisp|freezing|sweltering|scorching|balmy|dry|damp|degrees|stifling|bitter)\b|\d\s*°/i;
const INDOOR = /\b(?:kitchen|\w*room|hall\w*|inside|indoors?|rink|ice|fridge|tiles?|lamp\w*|house|shops?|store|mall|car|bed\w*|ceiling|floor\w*|radiator|heater|heating|air.?con\w*|thermostat|bath\w*|corridor|office|basement|attic|cellar|library|shutters?|curtains?|blinds|counter|hum|vents?|stairwell|lobby|garage|crypt)\b/i;

export type WxKind = "weather" | "indoor" | "light";

export function wxKind(text: string): WxKind {
  const t = text.replace(/\b(?:crystal|perfectly|all) clear\b/gi, "clear");
  if (OUTDOOR.test(t)) return "weather";
  if (WEAK.test(t)) return INDOOR.test(t) ? "indoor" : "weather";
  return "light";
}
