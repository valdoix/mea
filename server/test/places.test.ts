import { describe, expect, test } from "bun:test";
import { dressHome, PLACES, readHome, readPlace } from "../../web/src/lib/places";

/** The scene window reads a place's name into a kind of place to paint (web/src/lib/places.ts). */
describe("places", () => {
  test("every kind of place is listed once", () => {
    const ids = PLACES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(129);
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
    [["The penthouse"], "penthouse"],
    [["The mansion"], "living"],
    [["The villa"], "living"],
    [["The townhouse"], "living"],
    [["The bungalow"], "living"],
    [["The old house"], "living"],
    [["The beach house"], "beachhouse"],
    [["The trailer"], "trailer"],
    [["The houseboat"], "houseboat"],
    [["The dorm"], "dorm"],
    [["The cottage"], "cottage"],
    [["the wine cellar"], "winecellar"],
    [["the crawlspace"], "crawlspace"],
    [["the playroom"], "playroom"],
    [["the sewing room"], "craftroom"],
    [["the sauna"], "sauna"],
    [["the dressing room"], "dressing"],
    [["the long gallery"], "longgallery"],
    [["the atrium"], "atrium"],
    [["the screened porch"], "screenporch"],
    [["the secret room"], "hiddenroom"],
    // Nor is a room in one.
    [["the foyer"], "foyer"],
    [["the hallway"], "hallway"],
    [["the closet"], "closet"],
    [["the staircase"], "staircase"],
    [["the breakfast nook"], "nook"],
    [["the mudroom"], "mudroom"],
    [["the pantry"], "pantry"],
    [["the sunroom"], "sunroom"],
    [["the parlor"], "parlor"],
    [["the guest room"], "guestroom"],
    [["the kid's room"], "kidsroom"],
    [["the teenager's room"], "teenroom"],
    [["Studio apartment"], "studioapt"],
    [["The warehouse loft"], "loft"],
    [["The old house", "the loft"], "attic"],
    [["The old house", "the master bathroom"], "spabath"],
    [["The hotel", "the bathroom"], "bathroom"],
    [["the upstairs corridor"], "hallway"],
    [["the garage"], "garage"],
    [["the patio"], "patio"],
    [["Jackie's house", "the backyard"], "patio"],
    // Rooms the broad "room" rule made into bedrooms.
    [["the media room"], "hometheater"],
    [["the screening room"], "hometheater"],
    [["the TV room"], "den"],
    [["the rec room"], "recroom"],
    [["the music room"], "musicroom"],
    [["the great room"], "greatroom"],
    [["the trophy room"], "trophyroom"],
    [["the boiler room"], "basement"],
    [["the panic room"], "panicroom"],
    // Named for what they are, wherever they are.
    [["the home theater"], "hometheater"],
    [["the home bar"], "homebar"],
    [["the laundry room"], "laundryroom"],
    // A public word inside a home.
    [["Jackie's house", "the theater"], "hometheater"],
    [["Jackie's house", "the library"], "homelibrary"],
    [["Jackie's house", "the office"], "homeoffice"],
    [["Jackie's house", "the master bedroom"], "masterbedroom"],
    [["Jackie's house", "the nursery"], "nursery"],
    [["Jackie's house", "the den"], "den"],
    [["Jackie's house", "the basement"], "basement"],
    [["Jackie's house", "the garage"], "garage"],
    [["Jackie's house", "the front porch"], "porch"],
    [["Jackie's house", "the staircase"], "staircase"],
    [["Jackie's house", "the game room"], "gameroom"],
    [["Jackie's house", "the home gym"], "homegym"],
    [["Jackie's house", "the balcony"], "balcony"],
    [["Jackie's house", "the roof"], "rooftops"],
    [["Jackie's house", "the billiard room"], "gameroom"],
    [["Jackie's house", "the bar"], "homebar"],
    [["Jackie's house", "the laundry"], "laundryroom"],
    [["Jackie's house", "the sickroom"], "sickroom"],
    [["Jackie's house", "the hall"], "hallway"],
    [["Jackie's house", "the deck"], "porch"],
    [["The mansion", "the ballroom"], "hall"],
    // Between rooms take after what they're in.
    [["Winterfell", "the dining room"], "dining"],
    [["Winterfell", "the garage"], "stable"],
    [["Winterfell", "the basement"], "cellar"],
    [["Winterfell", "the hallway"], "hallway"],
    [["Castle hallway"], "hallway"],
    [["The abbey", "the stairs"], "staircase"],
    [["Winterfell", "the closet"], "closet"],
    [["The woods", "the cottage"], "cottage"],
    [["Greenwich Village"], "village"],
    [["The farm"], "village"],
    [["Winterfell", "the rec room"], "cellar"],
    [["Winterfell", "the home gym"], "homegym"],
    [["Jackie's house", "the dining room"], "dining"],
    [["The master bedroom", "the closet"], "closet"],
    [["Mercy General Hospital", "the corridor"], "hospital"],
    [["Hospital corridor"], "hospital"],
    [["The starship", "corridor"], "starship"],
    [["The restaurant", "dining room"], "cafe"],
    [["The woods", "the stairs"], "staircase"],
    [["Downtown", "the corridor"], "hallway"],
    [["The master bedroom", "the hallway"], "hallway"],
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

/** docs/24 §2.2: which home a place is in, and how it's kept. */
describe("homes", () => {
  test.each([
    [["Sunnydale", "Buffy's house", "the kitchen"], "buffy's house", "modern"],
    [["Buffy's house"], "buffy's house", "modern"],
    [["New York", "Jackie's apartment", "bedroom"], "jackie's apartment", "humble"],
    [["Greenwich Village", "Jackie's apartment", "the kitchen"], "jackie's apartment", "humble"],
    [["The mansion", "the ballroom"], "the mansion", "grand"],
    [["The penthouse"], "the penthouse", "grand"],
    [["Winterfell", "the solar"], "winterfell", "old"],
    [["The Lannister manor", "kitchen"], "the lannister manor", "old"],
    [["The trailer", "bedroom"], "the trailer", "humble"],
    [["The cottage", "the den"], "the cottage", "modern"],
    [["The woods", "the cabin", "bed"], "the cabin", "modern"],
  ] as const)("%p is %s, %s", (path, house, style) => {
    expect(readHome([...path])).toEqual({ house, style });
  });

  test.each([[["the kitchen"]], [["Downtown", "the bar"]], [["Mercy General Hospital", "bedroom"]], [["The opera house", "the stage"]], [["The trailer park"]], [[]]])("%p is nobody's home", (path) => {
    expect(readHome([...path])).toBeNull();
  });

  test("your correction wins, and a nonsense one doesn't", () => {
    expect(readHome(["Jackie's house", "the den"], { "jackie's house": "old" })?.style).toBe("old");
    expect(readHome(["Jackie's house", "the den"], { "jackie's house": "nonsense" })?.style).toBe("modern");
  });

  test("every room of a house is dressed alike, and another house differently", () => {
    const a = dressHome({ house: "jackie's house", style: "modern" });
    expect(dressHome(readHome(["Jackie's house", "the kitchen"])!)).toEqual(a);
    expect(dressHome(readHome(["Jackie's house", "the attic"])!)).toEqual(a);
    const others = ["buffy's house", "giles's flat", "the mansion", "angel's place"].map((house) => dressHome({ house, style: "modern" }));
    expect(others.some((o) => JSON.stringify([o.wall, o.trim, o.floor, o.fabric]) !== JSON.stringify([a.wall, a.trim, a.floor, a.fabric]))).toBe(true);
  });
});
