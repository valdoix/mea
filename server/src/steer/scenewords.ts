/**
 * The words of where a scene happens: rooms, fixtures, furniture and the props in the story state.
 * A scene set in a kitchen says "the kitchen window" and "against the counter" in reply after reply
 * because that's where they are, not because it's a habit. Before this, the worn-phrases list and
 * cooling told the writer to rest "the living room", "the kitchen window", "against the counter"
 * and "geometry notebook" in a kitchen scene (audit of 15 November), while the real tics went on.
 */

/** Rooms, fixtures and furniture: a phrase made only of these is the set, not a tic. */
export const SCENE_NOUNS = new Set(
  (
    "room rooms kitchen kitchens living dining bedroom bedrooms bathroom bathrooms hall hallway hallways landing stairs stair staircase stairwell " +
    "basement attic garage porch yard garden driveway doorway door doors window windows windowsill sill wall walls floor floors ceiling corner " +
    "counter counters countertop island sink stove oven fridge freezer microwave cabinet cabinets cupboard pantry shelf shelves table tables " +
    "chair chairs stool stools couch sofa armchair bench bed beds desk dresser closet mirror lamp light lights tile tiles rug carpet " +
    "archway arch frame mudroom laundry office study den lounge foyer entry entryway car seat seats dash dashboard wheel " +
    "street road sidewalk curb lot parking store shop mall school house home apartment cemetery park"
  ).split(" "),
);

/** Where-words: "against the counter" is a place, said with a preposition. */
const WHERE = new Set(
  "against across toward towards beside behind near onto inside outside past along by at in on into from to over under through around off the a an her his their its".split(" "),
);

/** The words in the story state's HERE and NOW lines, and the things people hold there: this scene's props. */
export function stateSceneWords(stateNote: string | undefined): string[] {
  if (!stateNote) return [];
  const lines = stateNote.split("\n").filter((l) => /^(?:NOW|HERE):/.test(l) || / · has: /.test(l));
  const text = lines.map((l) => (l.match(/^(?:NOW|HERE):(.*)$/)?.[1] ?? l.split(" · has: ")[1]?.split(" · ")[0] ?? "")).join(" ");
  return text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
}

/** A phrase made only of the scene's own words (and where-words): leave it to the scene. */
export function onlyScene(phrase: string, extra: Iterable<string> = []): boolean {
  const own = new Set(extra);
  const words = phrase.toLowerCase().replace(/[’']s\b/g, "").match(/[a-z]+/g) ?? [];
  const meaning = words.filter((w) => !WHERE.has(w));
  return meaning.length > 0 && meaning.every((w) => SCENE_NOUNS.has(w) || own.has(w));
}
