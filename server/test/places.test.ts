import { describe, expect, test } from "bun:test";
import { dressHome, PLACES, readHome, readPlace } from "../../web/src/lib/places";
import { worldOf } from "../../web/src/lib/westeros";

/** The scene window reads a place's name into a kind of place to paint (web/src/lib/places.ts). */
describe("places", () => {
  test("every kind of place is listed once", () => {
    const ids = PLACES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(140);
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

/** docs/25 Part 1: each place reads as the nearest painting there is, until its own is painted. */
describe("Westeros", () => {
  const world = "westeros" as const;

  test.each([
    [["Harrenhal"], "castle"],
    [["Harrenhal", "Kingspyre Tower"], "meltedtower"],
    [["Harrenhal", "the Wailing Tower"], "meltedtower"],
    [["Harrenhal", "the Tower of Dread"], "meltedtower"],
    [["Harrenhal", "the Tower of Ghosts"], "meltedtower"],
    [["Harrenhal", "Widow's Tower"], "meltedtower"],
    [["Harrenhal", "the Widow's Tower"], "meltedtower"],
    [["Harrenhal", "the Flowstone Yard"], "flowstoneyard"],
    [["Harrenhal", "the bear pit"], "bearpit"],
    [["Harrenhal", "the sept"], "ruinsept"],
    [["Harrenhal", "the Hall of a Hundred Hearths"], "hundredhearths"],
    [["Harrenhal", "the Great Hall"], "hall"],
    [["Harrenhal", "the armory"], "forge"],
    [["Harrenhal", "the barracks"], "tavern"],
    [["Harrenhal", "the rookery"], "attic"],
    [["Harrenhal", "the walls"], "rooftops"],
    [["Harrenhal", "the gates"], "castle"],
    [["Harrenhal", "the dungeons"], "dungeon"],
    [["Harrenhal", "the kitchens"], "kitchen"],
    [["Harrenhal", "Lord Bolton's solar"], "study"],
    [["Harrenhal", "the tourney field"], "camp"],
    [["Harrenhal", "the Gods Eye"], "lake"],
    [["the Gods Eye"], "lake"],
  ] as const)("Harrenhal: %p reads as %s", (path, kind) => {
    expect(readPlace([...path])).toBe(kind);
  });

  test.each([
    [["King's Landing"], "rooftops"],
    [["King’s Landing"], "rooftops"],
    [["Kings Landing"], "rooftops"],
    [["King's Landing", "somewhere nobody named"], "rooftops"],
    [["King's Landing", "Flea Bottom"], "street"],
    [["King's Landing", "the Street of Steel"], "street"],
    [["King's Landing", "the Street of Silk"], "street"],
    [["King's Landing", "a brothel"], "tavern"],
    [["King's Landing", "Littlefinger's brothel"], "tavern"],
    [["King's Landing", "the Mud Gate"], "street"],
    [["King's Landing", "the King's Gate"], "street"],
    [["King's Landing", "the Lion Gate"], "street"],
    [["King's Landing", "the Blackwater Rush"], "river"],
    [["King's Landing", "Blackwater Bay"], "shore"],
    [["King's Landing", "the Dragonpit"], "ruins"],
    [["King's Landing", "Rhaenys's Hill"], "ruins"],
    [["King's Landing", "Visenya's Hill"], "temple"],
    [["King's Landing", "Aegon's High Hill"], "castle"],
    [["King's Landing", "the Great Sept of Baelor"], "temple"],
    [["King's Landing", "inside the Great Sept"], "chapel"],
    [["King's Landing", "the tourney grounds"], "camp"],
    [["King's Landing", "the Fishmonger's Square"], "market"],
    [["King's Landing", "the Alchemists' Guildhall"], "alchemy"],
    [["the Red Keep"], "castle"],
    [["King's Landing", "the Red Keep"], "castle"],
    [["King's Landing", "the Red Keep", "the gate"], "castle"],
    [["King's Landing", "the Red Keep", "the Throne Room"], "throneroom"],
    [["King's Landing", "the Red Keep", "the Iron Throne"], "throneroom"],
    [["King's Landing", "the Red Keep", "the Queen's Ballroom"], "ballroom"],
    [["King's Landing", "the Red Keep", "the small council chamber"], "dining"],
    [["King's Landing", "the Red Keep", "the Tower of the Hand"], "study"],
    [["King's Landing", "the Red Keep", "the Hand's solar"], "study"],
    [["King's Landing", "the Red Keep", "the White Sword Tower"], "roundroom"],
    [["King's Landing", "the Red Keep", "the Round Room"], "roundroom"],
    [["King's Landing", "the Red Keep", "Maegor's Holdfast"], "holdfast"],
    [["Maegor's Holdfast"], "holdfast"],
    [["King's Landing", "the Red Keep", "the Maidenvault"], "parlor"],
    [["King's Landing", "the Red Keep", "the Traitor's Walk"], "hallway"],
    [["King's Landing", "the Red Keep", "the serpentine steps"], "staircase"],
    [["King's Landing", "the Red Keep", "the river stairs"], "staircase"],
    [["King's Landing", "the Red Keep", "the dragon skulls"], "skullcellar"],
    [["King's Landing", "the Red Keep", "the Black Cells"], "dungeon"],
    [["King's Landing", "the Red Keep", "the outer ward"], "street"],
    [["King's Landing", "the Red Keep", "the Queen's apartments"], "masterbedroom"],
    [["King's Landing", "the Red Keep", "the royal sept"], "chapel"],
    [["King's Landing", "the Red Keep", "the godswood"], "forest"],
    [["King's Landing", "the Red Keep", "the Grand Maester's chambers"], "alchemy"],
  ] as const)("King's Landing: %p reads as %s", (path, kind) => {
    expect(readPlace([...path])).toBe(kind);
  });

  test.each([
    ["the rookery", "attic"],
    ["the mews", "stable"],
    ["the armoury", "forge"],
    ["the armorer's forge", "forge"],
    ["the maester's turret", "alchemy"],
    ["the maester's chambers", "alchemy"],
    ["the guardroom", "tavern"],
    ["the guard hall", "tavern"],
    ["the buttery", "cellar"],
    ["the brewhouse", "cellar"],
    ["the bakehouse", "kitchen"],
    ["the granary", "cellar"],
    ["the cistern", "cellar"],
    ["the garderobe", "cellar"],
    ["the treasury", "study"],
    ["the map room", "study"],
    ["the counting room", "study"],
    ["the council chamber", "dining"],
    ["the tower", "attic"],
    ["the broken tower", "attic"],
    ["the library tower", "library"],
    ["the bell tower", "rooftops"],
    ["the training yard", "camp"],
    ["the tiltyard", "camp"],
    ["the lists", "camp"],
    ["the yard", "street"],
    ["the courtyard", "street"],
    ["the well", "street"],
    ["the battlements", "rooftops"],
    ["the ramparts", "rooftops"],
    ["the gatehouse", "castle"],
    ["the portcullis", "castle"],
    ["the postern", "castle"],
    ["the sally port", "castle"],
    ["the drawbridge", "castle"],
    ["the covered bridge", "hallway"],
    ["the antechamber", "hallway"],
    ["the glass gardens", "greenhouse"],
    ["the hot pools", "hotspring"],
    ["the infirmary", "sickroom"],
    ["the laundry", "kitchen"],
    ["the wash house", "kitchen"],
    ["the sewing room", "parlor"],
    ["the ladies' gallery", "parlor"],
    ["the minstrels' gallery", "hall"],
    ["the guest house", "bedroom"],
    ["the lady's chambers", "masterbedroom"],
    ["the sept", "chapel"],
    ["the wardrobe", "closet"],
  ] as const)("a castle's rooms: %s reads as %s", (room, kind) => {
    expect(readPlace(["Winterfell", room])).toBe(kind);
  });

  test.each([
    [["Sunspear"], "castle"],
    [["Moat Cailin"], "castle"],
    [["Deepwood Motte"], "castle"],
    [["Oldtown"], "street"],
    [["Oldtown", "the Hightower"], "castle"],
    [["Oldtown", "the Citadel"], "castle"],
    [["Lannisport"], "street"],
    [["Barrowton"], "village"],
    [["Castle Black", "the Wall"], "tundra"],
    [["Braavos", "the House of Black and White"], "temple"],
    [["Pentos", "Illyrio's manse"], "living"],
  ] as const)("elsewhere: %p reads as %s", (path, kind) => {
    expect(readPlace([...path])).toBe(kind);
  });

  // Words that could be anything only count in a chat on the Westeros calendar.
  test.each([
    [["the Wall"], "hills", "tundra"],
    [["the Twins"], "hills", "castle"],
    [["Pyke"], "hills", "castle"],
    [["the Rock"], "hills", "castle"],
    [["the tower"], "hills", "attic"],
    [["the armory"], "hills", "forge"],
    [["the yard"], "hills", "street"],
    [["the rookery"], "hills", "attic"],
    [["the outer ward"], "hospital", "street"],
    [["the kitchen"], "homekitchen", "kitchen"],
    [["the office"], "office", "study"],
    [["the hospital"], "hospital", "sickroom"],
    [["the sept"], "temple", "temple"],
    [["Harrenhal", "the wall"], "rooftops", "rooftops"],
    [["Somewhere"], "hills", "hills"],
  ] as const)("%p is %s in another story and %s in Westeros", (path, plain, westeros) => {
    expect(readPlace([...path])).toBe(plain);
    expect(readPlace([...path], { world: null })).toBe(plain);
    expect(readPlace([...path], { world })).toBe(westeros);
  });

  test("the Twins' rooms are in a castle, in Westeros", () => {
    expect(readPlace(["The Twins", "the armory"], { world })).toBe("forge");
    expect(readHome(["The Twins", "the Great Hall"], null, { world })).toMatchObject({ house: "the twins", style: "old" });
  });

  // Nothing here is a castle, so none of these change.
  test.each([
    [["Downtown", "the tower"], "city"],
    [["Mercy General Hospital", "the ward"], "hospital"],
    [["Mercy General Hospital", "the outer ward"], "hospital"],
    [["The armory bar"], "tavern"],
    [["Greenwich Village", "art gallery"], "gallery"],
    [["Greenwich Village", "the laundromat"], "laundromat"],
    [["Greenwich Village", "the hospital"], "hospital"],
    [["The hotel", "reception"], "office"],
  ] as const)("not a castle: %p reads as %s", (path, kind) => {
    expect(readPlace([...path])).toBe(kind);
  });

  test.each([
    [["Harrenhal"], "harrenhal"],
    [["Harrenhal", "the rookery"], "harrenhal"],
    [["Harrenhal", "the Hall of a Hundred Hearths"], "harrenhal"],
    [["Harrenhal", "the sept"], "harrenhal"],
    [["King's Landing", "the Red Keep", "the Queen's apartments"], "the red keep"],
    [["King's Landing", "the Red Keep", "the royal sept"], "the red keep"],
    [["King's Landing", "the Red Keep", "the Throne Room"], "the red keep"],
    [["King's Landing", "Flea Bottom"], "king's landing"],
    [["King’s Landing", "Flea Bottom"], "king's landing"],
    [["King's Landing", "the Great Sept of Baelor"], "king's landing"],
    [["the Great Sept of Baelor"], "the great sept of baelor"],
    [["Winterfell", "the guest house"], "winterfell"],
  ] as const)("%p is old-world, in %s", (path, house) => {
    expect(readHome([...path])).toMatchObject({ house, style: "old" });
  });

  // docs/25 §2.4: what a castle flew in a given year.
  test.each([
    [["the Red Keep"], 250, true, false],
    [["the Red Keep"], 282, true, false],
    [["the Red Keep"], 283, false, false],
    [["the Red Keep"], 297, false, false],
    [["the Red Keep"], 298, false, true],
    [["the Red Keep"], null, false, true],
    [["Winterfell"], 250, false, false],
  ] as const)("%p in %p: dragon %p, a second house %p", (path, year, dragon, second) => {
    const keep = readHome([...path], null, { year })?.keep;
    expect(Boolean(keep?.dragon)).toBe(dragon);
    expect(Boolean(keep?.second)).toBe(second);
  });

  test("Harrenhal's holder changes, and your word beats the year", () => {
    const whent = readHome(["Harrenhal"], null, { year: 281 })?.keep?.banners;
    const lannister = readHome(["Harrenhal"], null, { year: 299 })?.keep?.banners;
    expect(whent).toBeDefined();
    expect(lannister).not.toEqual(whent);
    expect(readHome(["Harrenhal"], null, { year: 299, keeps: { harrenhal: { masonry: "fused", banners: ["#000000", "#ffffff"] } } })?.keep?.banners).toEqual([[0, 0, 0], [255, 255, 255]]);
  });

  test("a manse is grand", () => {
    expect(readHome(["Pentos", "Illyrio's manse"])).toEqual({ house: "illyrio's manse", style: "grand" });
  });

  test("everywhere in Westeros is old-world, unless you've said otherwise", () => {
    expect(readHome(["the kitchen"], null, { world })).toMatchObject({ house: "the kitchen", style: "old" });
    expect(readHome(["Lannisport", "the fishmonger"], null, { world })).toMatchObject({ house: "lannisport", style: "old" });
    expect(readHome(["Jackie's house", "the den"], null, { world })).toMatchObject({ house: "jackie's house", style: "old" });
    expect(readHome(["The mansion"], null, { world })).toMatchObject({ house: "the mansion", style: "old" });
    expect(readHome(["Jackie's house", "the den"], { "jackie's house": "grand" }, { world })?.style).toBe("grand");
    expect(readHome([], null, { world })).toBeNull();
  });

  test("an apartment outside a castle is still a flat", () => {
    expect(readHome(["New York", "Jackie's apartment"])).toEqual({ house: "jackie's apartment", style: "humble" });
    expect(readPlace(["New York", "Jackie's apartment"])).toBe("living");
  });

  test("a ruin stands whole again when the story says so", () => {
    expect(readPlace(["the ruins"])).toBe("ruins");
    expect(readPlace(["the restored ruins"])).toBe("restored");
    expect(readPlace(["The abbey ruins, rebuilt"])).toBe("restored");
    expect(readPlace(["King's Landing", "the Dragonpit"])).toBe("ruins");
    expect(readPlace(["King's Landing", "the rebuilt Dragonpit"])).toBe("restored");
    expect(readPlace(["the restored theatre"])).toBe("theater");
  });

  // docs/25 §2.3: what each castle is built of.
  test.each([
    [["King's Landing", "the Red Keep", "the Throne Room"], "redstone"],
    [["Maegor's Holdfast"], "redstone"],
    [["Harrenhal", "the Great Hall"], "fused"],
    [["Winterfell", "the solar"], "ashlar"],
    [["The castle", "the kitchens"], "ashlar"],
    [["The abbey", "the chapel"], "ashlar"],
  ] as const)("%p is built of %s", (path, masonry) => {
    expect(readHome([...path])?.keep?.masonry).toBe(masonry);
  });

  test("somewhere old-world but not stone has no keep", () => {
    expect(readHome(["The Lannister manor", "kitchen"])?.keep).toBeUndefined();
    expect(readHome(["The Prancing Pony inn"])?.keep).toBeUndefined();
    expect(readHome(["Mira's house", "the den"], { "mira's house": "old" })?.keep).toBeUndefined();
    expect(readHome(["Lannisport", "the inn"], null, { world })?.keep).toBeUndefined();
    expect(readHome(["The Twins", "the Great Hall"], null, { world })?.keep?.masonry).toBe("ashlar");
    expect(readHome(["New York", "Jackie's apartment"])?.keep).toBeUndefined();
  });

  test("your word on a keep beats its name, and a nonsense one doesn't", () => {
    const keeps = { harrenhal: { masonry: "ashlar", banners: ["#112233", "#ffeedd"] } };
    expect(readHome(["Harrenhal", "the Great Hall"], null, { keeps })?.keep).toEqual({ masonry: "ashlar", banners: [[17, 34, 51], [255, 238, 221]] });
    expect(readHome(["Harrenhal", "the Great Hall"], null, { keeps: { harrenhal: { masonry: "marble" } } })?.keep?.masonry).toBe("fused");
    expect(readHome(["Harrenhal", "the Great Hall"], null, { keeps: { harrenhal: { masonry: "marble", banners: ["red", "blue"] } } })?.keep?.masonry).toBe("fused");
    expect(readHome(["Mira's house"], { "mira's house": "old" }, { keeps: { "mira's house": { masonry: "redstone" } } })?.keep).toEqual({ masonry: "redstone" });
    expect(readHome(["Harrenhal"], { harrenhal: "modern" })?.keep).toBeUndefined();
  });

  test("the chat's calendar names its world", () => {
    expect(worldOf("westeros")).toBe("westeros");
    expect(worldOf("gregorian")).toBeNull();
    expect(worldOf("custom:westeros-ish")).toBeNull();
    expect(worldOf(null)).toBeNull();
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
    expect(readHome([...path])).toMatchObject({ house, style });
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
