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

  // docs/24 Part 2: the nearest painting there is for each, until the home rooms are painted.
  test.each([
    // A home is never a hillside.
    [["The penthouse"], "living"],
    [["The mansion"], "living"],
    [["The villa"], "living"],
    [["The townhouse"], "living"],
    [["The bungalow"], "living"],
    [["The old house"], "living"],
    [["The beach house"], "living"],
    [["The trailer"], "cabin"],
    [["The houseboat"], "shipcabin"],
    [["The dorm"], "bedroom"],
    // Nor is a room in one.
    [["the foyer"], "living"],
    [["the hallway"], "living"],
    [["the closet"], "living"],
    [["the staircase"], "living"],
    [["the breakfast nook"], "living"],
    [["the upstairs corridor"], "living"],
    [["the garage"], "forge"],
    [["the patio"], "meadow"],
    [["Jackie's house", "the backyard"], "meadow"],
    // Rooms the broad "room" rule made into bedrooms.
    [["the media room"], "living"],
    [["the screening room"], "living"],
    [["the TV room"], "living"],
    [["the rec room"], "living"],
    [["the music room"], "living"],
    [["the great room"], "living"],
    [["the trophy room"], "living"],
    [["the boiler room"], "cellar"],
    [["the panic room"], "cellar"],
    [["the guest room"], "bedroom"],
    // Named for what they are, wherever they are.
    [["the home theater"], "living"],
    [["the home bar"], "living"],
    [["the laundry room"], "homekitchen"],
    // A public word inside a home.
    [["Jackie's house", "the theater"], "living"],
    [["Jackie's house", "the game room"], "living"],
    [["Jackie's house", "the billiard room"], "living"],
    [["Jackie's house", "the bar"], "living"],
    [["Jackie's house", "the laundry"], "homekitchen"],
    [["Jackie's house", "the sickroom"], "bedroom"],
    [["Jackie's house", "the hall"], "living"],
    [["Jackie's house", "the deck"], "meadow"],
    [["The mansion", "the ballroom"], "hall"],
    // Between rooms take after what they're in.
    [["Winterfell", "the dining room"], "hall"],
    [["Winterfell", "the hallway"], "hall"],
    [["Castle hallway"], "hall"],
    [["The abbey", "the stairs"], "hall"],
    [["Jackie's house", "the dining room"], "living"],
    [["The master bedroom", "the closet"], "bedroom"],
    [["Mercy General Hospital", "the corridor"], "hospital"],
    [["Hospital corridor"], "hospital"],
    [["The starship", "corridor"], "starship"],
    [["The restaurant", "dining room"], "cafe"],
    [["The woods", "the stairs"], "living"],
    [["Downtown", "the corridor"], "living"],
  ] as const)("at home: %p reads as %s", (path, kind) => {
    expect(readPlace([...path])).toBe(kind);
  });

  // None of these is anyone's home, so the public word keeps its public meaning.
  test.each([
    [["The opera house", "the bar"], "tavern"],
    [["The coffee house", "the theater"], "theater"],
    [["The warehouse", "the bar"], "tavern"],
    [["The courthouse", "the hall"], "hall"],
    [["The Grand Hotel", "the bar"], "tavern"],
    [["Downtown", "the theater"], "theater"],
    [["the game room"], "arcade"],
    [["the dive bar", "pool table"], "tavern"],
    [["the sickroom"], "hospital"],
    [["Port Ellis", "the deck"], "deck"],
    [["Downtown", "parking garage"], "city"],
    [["Downtown", "trailer park"], "meadow"],
  ] as const)("not a home: %p reads as %s", (path, kind) => {
    expect(readPlace([...path])).toBe(kind);
  });
});
