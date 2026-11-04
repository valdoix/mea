import { describe, expect, test } from "bun:test";
import { PLACES, readPlace } from "../../web/src/lib/places";

/** The scene window reads a place's name into a kind of place to paint (web/src/lib/places.ts). */
describe("places", () => {
  test("every kind of place is listed once", () => {
    const ids = PLACES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(75);
  });

  test.each([
    [["Jackie's house", "the living room"], "living"],
    [["Sunnyvale", "Buffy's house"], "living"],
    [["The apartment", "kitchen"], "homekitchen"],
    [["Winterfell", "the kitchens"], "kitchen"],
    [["Winterfell", "kitchen"], "kitchen"],
    [["The Lannister manor", "kitchen"], "kitchen"],
    [["Home", "bathroom"], "bathroom"],
    [["Hotel suite", "en suite"], "bathroom"],
    [["The backyard", "swimming pool"], "pool"],
    [["Leisure centre", "indoor pool"], "indoorpool"],
    [["The dive bar", "pool table"], "tavern"],
    [["Hakone", "the onsen"], "hotspring"],
    [["The woods", "the cabin"], "cabin"],
    [["The Black Pearl", "captain's cabin"], "shipcabin"],
    [["The Black Pearl", "on deck"], "deck"],
    [["Flight 815", "economy class"], "plane"],
    [["The highway", "Jackie's car", "back seat"], "car"],
    [["Downtown", "car park"], "city"],
    [["The war camp", "the general's tent"], "tent"],
    [["The northern front", "war camp"], "camp"],
    [["Precinct 9", "the office"], "office"],
    [["The castle", "maester's office"], "study"],
    [["Sunnydale High", "the library"], "library"],
    [["Sunnydale High", "classroom"], "classroom"],
    [["The Bronze", "dance floor"], "club"],
    [["Las Vegas", "the casino"], "casino"],
    [["Mall", "arcade"], "arcade"],
    [["Main Street", "laundromat"], "laundromat"],
    [["Downtown", "art gallery"], "gallery"],
    [["The opera house"], "theater"],
    [["Radio station", "sound booth"], "studio"],
    [["Kyoto", "the dojo"], "shrine"],
    [["The aquarium"], "aquarium"],
    [["Mount Wilson", "the observatory"], "observatory"],
    [["Riverrun", "the stables"], "stable"],
    [["The wizard's tower"], "alchemy"],
    [["The old house", "the attic"], "attic"],
    [["Backyard", "treehouse"], "treehouse"],
    [["The USS Dallas", "submarine"], "submarine"],
    [["Mission control", "the lab"], "lab"],
    [["Winterfell", "the godswood"], "forest"],
    [["Somewhere"], "hills"],
  ] as const)("%p reads as %s", (path, kind) => {
    expect(readPlace([...path])).toBe(kind);
  });
});
