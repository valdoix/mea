/**
 * The kinds of place a scene window can paint, how a place's name is read into one, and the
 * colour helpers the painter shares (the painting itself is in scenes.ts).
 */

export type RGB = [number, number, number];
export const TAU = Math.PI * 2;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
export const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => v + (b[i]! - v) * t) as RGB;
export const rgb = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
export function rand(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}
export const seedOf = (s: string) => [...s].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) % 2147483646 || 1;
export const DARK: RGB = [12, 9, 24];
export const WARM: RGB = [255, 196, 120];

export interface Wx {
  cloud: number;
  rain: number;
  snow: number;
  fog: number;
  storm: number;
  wind: number;
}
export interface Env {
  t: number;
  day: number;
  night: number;
  sunAlt: number;
  /** Near sunrise or sunset. */
  golden: number;
  sky: { top: RGB; bot: RGB };
  /** How lit the lamps are (night, or a dark day). */
  glow: number;
  c: Wx;
  light: { x: number; y: number; c: RGB; a: number } | null;
  T: number;
  still: boolean;
}
export type HomeStyle = "modern" | "humble" | "grand" | "old";
export const HOME_STYLES: { id: HomeStyle; label: string }[] = [
  { id: "modern", label: "Modern" },
  { id: "humble", label: "Humble" },
  { id: "grand", label: "Grand" },
  { id: "old", label: "Old-world" },
];
/** Whose home a place is in, and how it's kept. */
export interface Home {
  house: string;
  style: HomeStyle;
}
/** A home's colours: the same in every one of its rooms. */
export interface HomeDress extends Home {
  wall: RGB;
  trim: RGB;
  floor: RGB;
  fabric: RGB;
  /** Upholstery. */
  soft: RGB;
}
export interface Ctx {
  W: number;
  H: number;
  u: number;
  F: number;
  r: () => number;
  mini: boolean;
  home: HomeDress | null;
}

export const PLASTER: RGB[] = [
  [222, 196, 150],
  [204, 150, 138],
  [166, 178, 150],
  [150, 164, 188],
  [218, 206, 186],
  [190, 160, 196],
];
export const FABRIC: RGB[] = [
  [170, 44, 56],
  [40, 92, 150],
  [46, 120, 84],
  [196, 150, 52],
  [120, 60, 140],
  [210, 110, 60],
];

export const PLACE_GROUPS = [
  {
    label: "Out in the wild",
    kinds: [
      { id: "hills", label: "Open country" },
      { id: "meadow", label: "Meadow or garden" },
      { id: "forest", label: "Forest" },
      { id: "camp", label: "Camp" },
      { id: "jungle", label: "Jungle" },
      { id: "swamp", label: "Swamp or marsh" },
      { id: "mountains", label: "Mountains" },
      { id: "tundra", label: "Snow and ice" },
      { id: "desert", label: "Desert" },
      { id: "canyon", label: "Canyon or mesa" },
      { id: "volcano", label: "Volcano" },
      { id: "cave", label: "Cave" },
    ],
  },
  {
    label: "By the water",
    kinds: [
      { id: "shore", label: "Cliffs and coast" },
      { id: "beach", label: "Beach" },
      { id: "harbor", label: "Harbour" },
      { id: "sea", label: "Open sea" },
      { id: "lake", label: "Lake" },
      { id: "river", label: "River and bridge" },
    ],
  },
  {
    label: "Pools and baths",
    kinds: [
      { id: "pool", label: "Pool, outside" },
      { id: "indoorpool", label: "Indoor pool" },
      { id: "hotspring", label: "Hot spring" },
    ],
  },
  {
    label: "Where people live",
    kinds: [
      { id: "village", label: "Village" },
      { id: "road", label: "On the road" },
      { id: "street", label: "Old town street" },
      { id: "market", label: "Market" },
      { id: "rooftops", label: "Rooftops" },
      { id: "city", label: "Modern city" },
      { id: "castle", label: "Castle" },
      { id: "temple", label: "Temple or church" },
      { id: "ruins", label: "Ruins" },
      { id: "graveyard", label: "Graveyard" },
    ],
  },
  {
    label: "Gathering rooms",
    kinds: [
      { id: "living", label: "Living room" },
      { id: "dining", label: "Dining room" },
      { id: "den", label: "Den or family room" },
    ],
  },
  {
    label: "Leisure rooms",
    kinds: [
      { id: "hometheater", label: "Home theater" },
      { id: "homelibrary", label: "Home library" },
    ],
  },
  {
    label: "Private rooms",
    kinds: [
      { id: "bedroom", label: "Bedroom" },
      { id: "masterbedroom", label: "Master bedroom" },
      { id: "nursery", label: "Nursery" },
      { id: "bathroom", label: "Bathroom" },
    ],
  },
  {
    label: "Between rooms",
    kinds: [
      { id: "foyer", label: "Foyer or entry" },
      { id: "hallway", label: "Hallway" },
      { id: "staircase", label: "Staircase" },
    ],
  },
  {
    label: "Working rooms",
    kinds: [
      { id: "homekitchen", label: "Kitchen" },
      { id: "homeoffice", label: "Home office" },
      { id: "laundryroom", label: "Laundry room" },
      { id: "basement", label: "Basement" },
      { id: "garage", label: "Garage" },
      { id: "attic", label: "Attic" },
    ],
  },
  {
    label: "Whole homes",
    kinds: [
      { id: "cabin", label: "Log cabin" },
      { id: "treehouse", label: "Treehouse" },
      { id: "tent", label: "Inside a tent" },
    ],
  },
  {
    label: "At the door",
    kinds: [{ id: "porch", label: "Front porch" }],
  },
  {
    label: "Old halls and keeps",
    kinds: [
      { id: "kitchen", label: "Hearth kitchen" },
      { id: "study", label: "Study" },
      { id: "library", label: "Library" },
      { id: "hall", label: "Great hall" },
      { id: "chapel", label: "Chapel or nave" },
      { id: "greenhouse", label: "Greenhouse" },
      { id: "cellar", label: "Cellar" },
      { id: "dungeon", label: "Dungeon or cell" },
      { id: "alchemy", label: "Wizard's tower" },
      { id: "stable", label: "Stable or barn" },
    ],
  },
  {
    label: "Indoors, out and about",
    kinds: [
      { id: "tavern", label: "Tavern or bar" },
      { id: "cafe", label: "Café or diner" },
      { id: "shop", label: "Shop or apothecary" },
      { id: "forge", label: "Forge or workshop" },
      { id: "office", label: "Office" },
      { id: "classroom", label: "Classroom" },
      { id: "lab", label: "Laboratory" },
      { id: "hospital", label: "Hospital room" },
      { id: "laundromat", label: "Laundromat" },
      { id: "gallery", label: "Gallery or museum" },
      { id: "theater", label: "Theatre or cinema" },
      { id: "club", label: "Nightclub" },
      { id: "casino", label: "Casino" },
      { id: "arcade", label: "Arcade" },
      { id: "studio", label: "Recording studio" },
      { id: "shrine", label: "Dojo or teahouse" },
      { id: "aquarium", label: "Aquarium" },
      { id: "observatory", label: "Observatory" },
    ],
  },
  {
    label: "On the move",
    kinds: [
      { id: "car", label: "In a car" },
      { id: "train", label: "Train carriage" },
      { id: "plane", label: "Aeroplane" },
      { id: "deck", label: "On deck" },
      { id: "shipcabin", label: "Ship's cabin" },
      { id: "submarine", label: "Submarine" },
    ],
  },
  {
    label: "Beyond",
    kinds: [
      { id: "starship", label: "Starship bridge" },
      { id: "space", label: "Space" },
    ],
  },
] as const;
export type Place = (typeof PLACE_GROUPS)[number]["kinds"][number]["id"];
export const PLACES = PLACE_GROUPS.flatMap((g) => g.kinds as readonly { id: Place; label: string }[]);
export const isPlace = (s: string | null | undefined): s is Place => PLACES.some((p) => p.id === s);

/** Words that name someone's home. Strict, or it would catch opera house, warehouse and coffee house. */
const HOME_WORDS = String.raw`apartment|\bflat\b|\bcondo|(?:'s|\bthe|\bmy|\bour|\bhis|\bher|\btheir) (?:house|home|place)\b|\bat home\b|\b(?:old|new|big|little|small|empty|family|safe|country|summer|winter|beach|lake|haunted|guest|town|row|frat) house\b|\bmansion|\bvillas?\b|townhouse|rowhouse|bungalow|\bduplex|penthouse|\bbedsit`;
const HOME = new RegExp(String.raw`${HOME_WORDS}|\bmanor|^home$|^house$`);

/**
 * The parts of a building that say little by themselves: a hallway takes after whatever it's in, so
 * a hospital corridor is the hospital and a castle's is its hall. Alone, they're somewhere indoors.
 */
const IN_BETWEEN = /dining room|supper room|breakfast (?:nook|room)|\bnook\b|banquette|foyer|entry ?way|entrance hall|vestibule|hallway|corridor|\bpassage(?:way)?\b|\bstair(?:s|case|well|way)?\b|\bupstairs\b|\bdownstairs\b|\bthe landing\b|mud ?room|boot room|walk-in|\bclosets?\b|wardrobe|crawl ?space|\bporch\b|verandah?|\bstoop\b|\bgym(?:nasium)?\b|workout room|exercise room/;

// Most specific first; the last part of the place is read before the rest ("Winterfell › the godswood" is a forest).
const RULES: [Place, RegExp][] = [
  ["submarine", /submarine|u-boat|submersible|bathysphere/],
  ["starship", /starship|spaceship|space station|airlock|hangar bay|cockpit|bridge of the|med ?bay|engine room|\bshuttle\b/],
  ["space", /\bspace\b|\borbit|nebula|asteroid/],
  ["observatory", /observator|planetarium|telescope/],
  ["shore", /lighthouse|lamp room|lantern room/],
  ["hospital", /hospital|infirmary|\bclinic|\bward\b|sickroom|operating (?:room|theatre)|\bicu\b|emergency room/],
  ["plane", /\b(?:aero|air)?planes?\b|airliner|\bjet\b|in-flight|mid-flight|(?:first|business|economy) class|aircraft|\bflight\b/],
  ["train", /\btrain\b|railway|\bcarriage\b|compartment|\btram\b|dining car|sleeper car|subway car/],
  ["shipcabin", /captain's (?:quarters|cabin)|ship's cabin|below ?decks?|\bgalley\b|\bthe hold\b|stateroom|\bberth\b|houseboat|narrowboat/],
  ["car", /\b(?:car|truck|van|taxi|cab|limo|limousine|jeep|sedan|pickup|suv|bus|minivan)\b(?! park| stop| station| depot| garage)|back ?seat|(?:driver|passenger)'?s? seat|behind the wheel/],
  ["aquarium", /aquarium|oceanarium|fish tank|sea life/],
  ["deck", /\bdeck\b|aboard|crow's nest|\bmast\b|\b(?:ship|boat|galleon|vessel|frigate|schooner|ferry|yacht|raft|sloop)s?\b/],
  ["hotspring", /hot ?springs?|\bonsen|thermal (?:pool|spring|bath)|geothermal/],
  ["tavern", /pool (?:hall|table|room)|billiard/],
  ["indoorpool", /indoor pool|natatorium|swimming baths|(?:leisure|aquatic) cent|covered pool/],
  ["pool", /swimming|\bpool ?(?:side|deck|house)\b|\bpools?\b|\blido\b/],
  ["bathroom", /bathroom|\bbaths?\b|bathtub|\btub\b|shower|washroom|restroom|lavatory|toilet|\bloo\b|en ?suite|powder room|bathhouse|sauna|\bspa\b/],
  ["treehouse", /tree ?house|tree fort/],
  ["tent", /\btents?\b|pavilion|\byurt|marquee/],
  ["camp", /\bcamp|encampment|bivouac|campfire|battlefield|war ?camp|\bsiege\b|front line/],
  ["chapel", /chapel|\bnave\b|\bpews?\b|\baltar\b|sanctum|inside the (?:church|temple|cathedral|sept)/],
  ["greenhouse", /greenhouse|conservatory|orangery|glasshouse|hothouse|sunroom|sun ?porch|solarium/],
  ["basement", /basement|boiler room|root cellar/],
  ["cellar", /cellar|wine vault|storeroom|undercroft|larder|panic room|safe room|secret room|hidden room/],
  ["kitchen", /scullery|castle kitchen|\bkitchens\b/],
  ["homekitchen", /kitchen|pantry/],
  ["laundryroom", /laundry room|utility room/],
  ["hometheater", /home (?:theat(?:er|re)|cinema)|media room|screening room/],
  ["homelibrary", /home library/],
  ["homeoffice", /home office/],
  ["living", /home bar|wet bar/],
  ["alchemy", /alchem|wizard|\bmage'?s?\b|sorcer|witch'?s? (?:hut|cottage|house)|potion|enchanter|arcane|spell ?room/],
  ["garage", /(?<!parking )\bgarage|carport/],
  ["forge", /\bforge|smithy|blacksmith|foundry|workshop/],
  ["shrine", /\bdojo|teahouse|tea house|tatami|ryokan|shoji|zen garden|tea ceremony/],
  ["laundromat", /laundr|launderette|wash house/],
  ["club", /nightclub|night club|\bclub\b|disco|\braves?\b|karaoke|dance floor/],
  ["casino", /casino|gambling|card room|poker room|betting|\bslots\b/],
  ["arcade", /arcade|game room|games room|pinball|bowling/],
  ["studio", /(?:recording|music|sound|radio|tv|film) studio|radio station|sound booth|broadcast|\bon air\b|rehearsal room|podcast/],
  ["theater", /theatre|theater|\bstage\b|backstage|opera|auditorium|cinema|movie|concert hall|playhouse|green room/],
  ["gallery", /galler|museum|exhibit/],
  ["cafe", /caf[eé]|coffee|\bdiner\b|restaurant|bistro|tea ?(?:room|shop)|food court|bakery/],
  ["shop", /\bshop\b|\bstore\b|apothecary|emporium|boutique|pharmacy|chandler|\bpawn/],
  ["dungeon", /dungeon|\bcells?\b|prison|gaol|\bjail|oubliette|crypt|torture|\bbrig\b/],
  ["lab", /laborator|\blabs?\b|clean room|server room|control room|research station|\bmorgue/],
  ["classroom", /classroom|lecture hall|schoolroom|homeroom|seminar room|\bschool\b|\bclass\b/],
  ["office", /office|cubicle|boardroom|meeting room|conference room|headquarters|precinct|newsroom|reception|bullpen|police station/],
  ["living", IN_BETWEEN],
  ["library", /librar|archive|scriptorium|bookshop|bookstore|reading room/],
  ["study", /\bstudy\b|\bsolar\b/],
  ["hall", /throne|great hall|\bhall\b|ballroom|council|audience chamber|banquet|feast/],
  ["tavern", /tavern|\binn\b|\bbar\b|\bpub\b|saloon|alehouse|canteen|brewery|speakeasy/],
  ["stable", /stables?\b|hayloft|\bbarn\b|horse stall|kennel|tack room|\bcoop\b/],
  ["attic", /\battic|garret|\bloft\b/],
  ["den", /family room|\bden\b|\btv room|\bsnug\b/],
  ["cabin", /\bcabin|log house|\blodge\b|chalet|\bhut\b|\bshack\b|\btrailers?\b(?! park)|mobile home|\brv\b|\bcamper\b/],
  ["living", new RegExp(String.raw`living ?room|lounge room|sitting room|front room|drawing room|great room|rec room|rumpus room|(?:music|piano|craft|sewing|hobby|trophy|gun) room|play ?room|parlou?r|\bsofa|\bcouch|${HOME_WORDS}`)],
  ["masterbedroom", /(?:master|primary) (?:bedroom|suite|room)/],
  ["nursery", /nursery|baby'?s room/],
  ["bedroom", /bedroom|\bbed\b|chamber|quarters|\broom\b|bunk|dormitor|\bdorm\b|\bsuite\b/],
  ["cave", /\bcaves?\b|cavern|grotto|\bmines?\b|tunnel|underground|burrow|catacomb/],
  ["volcano", /volcan|\blava\b|magma|caldera|ashland/],
  ["graveyard", /grave|cemetery|\btomb|barrow|mausoleum|churchyard|necropolis/],
  ["ruins", /\bruin|rubble|crumbl|abandoned|forgotten/],
  ["temple", /temple|shrine|cathedral|church|\bsept\b|abbey|monastery|sanctuary|priory/],
  ["castle", /castle|\bkeep\b|\bhold\b|fortress|citadel|palace|stronghold|winterfell|king's landing|red keep|riverrun|eyrie|storm's end|dragonstone|highgarden|casterly|castle black|\bmanor|\bfort\b/],
  ["harbor", /harbou?r|\bport\b|\bdocks?\b|\bpier\b|wharf|\bquay|marina|shipyard/],
  ["sea", /at sea|open sea|ocean|voyage|high seas|the waves/],
  ["beach", /beach|tropic|lagoon|\bpalms?\b|\breef\b|island|sandbar/],
  ["shore", /\bcliffs?\b|shore|coast|\bcove\b|seaside|headland|shingle|\bbay\b|\bsea\b/],
  ["lake", /\blakes?\b|\bloch\b|\bpond\b|\bmere\b|\btarn\b|reservoir/],
  ["river", /\brivers?\b|stream|creek|brook|\bford\b|bridge|canal|waterfall|\bfalls\b/],
  ["swamp", /swamp|marsh|\bbog\b|\bfen\b|bayou|\bmire\b|wetland/],
  ["jungle", /jungle|rainforest/],
  ["tundra", /tundra|snowfield|glacier|\bice\b|frozen|arctic|north of the wall|taiga|icefield/],
  ["mountains", /mountain|\bpeaks?\b|summit|\bpass\b|\balps?\b|\bridge\b|\bcrags?\b|highland|\bvale\b|\bmount\b/],
  ["canyon", /canyon|\bmesas?\b|gorge|ravine|badlands|\bbuttes?\b|\bbluffs?\b/],
  ["desert", /desert|\bdunes?\b|\bsands?\b|wasteland|oasis|dorne|steppe/],
  ["market", /market|bazaar|\bfair\b|\bsquare\b|plaza|\bstalls?\b|souk|festival/],
  ["rooftops", /rooftop|\broofs?\b|belfry|balcony|terrace|parapet|clock ?tower|bell tower/],
  ["city", /downtown|skyscraper|\bmetro\b|subway|neon|highway|tower block|skyline|avenue|hotel|campus|\bmall\b|parking|car park|station|lobby|elevator/],
  ["street", /street|alley|\blane\b|\btown\b|\bcity\b|quarter|district|borough|\bslums?\b/],
  ["village", /village|hamlet|\bfarm|homestead|cottage|\bcroft|\bmill\b/],
  ["road", /\broads?\b|\bpath\b|\btrail\b|\btrack\b|caravan|wagon|crossroad|kingsroad|on the way|journey/],
  ["meadow", /garden|meadow|\bfields?\b|courtyard|\bpark\b|glade|orchard|\blawn|\bpatio\b|back ?yard|front ?yard/],
  ["forest", /forest|\bwoods?\b|\bpines?\b|\bgrove|thicket|\bcopse|godswood|weirwood|wolfswood/],
];

/** Somewhere old-world: its kitchen has a hearth and its office is a study. */
const OLD_WORLD = /castle|\bkeep\b|\bhold\b|fortress|citadel|palace|stronghold|winterfell|king's landing|red keep|riverrun|eyrie|storm's end|dragonstone|highgarden|casterly|castle black|\bmanor|\bfort\b|abbey|monastery|priory|\binn\b|tavern|\bsept\b|village|hamlet|\bcroft/;
export const OLDER: Partial<Record<Place, Place>> = { homekitchen: "kitchen", office: "study", homeoffice: "study", garage: "stable", laundryroom: "kitchen", hometheater: "hall", basement: "cellar" };

/** A public kind of place, when the word for it comes inside someone's home: the home bar, not a pub. */
const HOMELY: Partial<Record<Place, Place>> = { theater: "hometheater", library: "homelibrary", office: "homeoffice", arcade: "living", tavern: "living", laundromat: "laundryroom", hospital: "bedroom", hall: "hallway", deck: "porch" };
/** A home can have these for real. */
const STAYS_GRAND = /ballroom|throne|banquet|great hall/;

/** Kinds with no indoors for a hallway or a staircase to take after. */
const OUTSIDE = new Set<Place>([...PLACE_GROUPS[0].kinds, ...PLACE_GROUPS[1].kinds].map((k) => k.id));
for (const k of ["village", "road", "street", "market", "rooftops", "city", "ruins", "graveyard", "pool", "hotspring", "deck", "space"] as const) OUTSIDE.add(k);

/** Between rooms with their own painting. */
const BETWEEN: [Place, RegExp][] = [
  ["dining", /dining room|supper room/],
  ["foyer", /foyer|entry ?way|entrance hall|vestibule/],
  ["hallway", /hallway|corridor|\bpassage(?:way)?\b|\bupstairs\b|\bdownstairs\b/],
  ["staircase", /\bstair(?:s|case|well|way)?\b|\bthe landing\b/],
  ["porch", /\bporch\b|verandah?|\bstoop\b/],
];
/** What surrounds a between room without giving it a look of its own. */
const STAYS_ITSELF = new Set<Place>(["living", "bedroom", "masterbedroom", "castle", "temple", "den", "homekitchen"]);

function read(parts: string[]): Place | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!;
    for (const [k, re] of RULES) {
      if (!re.test(part)) continue;
      if (re === IN_BETWEEN) {
        const own = BETWEEN.find(([, w]) => w.test(part))?.[0];
        const around = read([...parts.slice(0, i), part.replace(IN_BETWEEN, "")]);
        // Painted in its own right, it stays itself in a house or a castle, dressed to suit.
        if (own) return around && !OUTSIDE.has(around) && !STAYS_ITSELF.has(around) ? around : own;
        if (around === "castle" || around === "temple") return "hall";
        return !around || OUTSIDE.has(around) ? "living" : around;
      }
      const old = OLDER[k];
      if (old && parts.some((p) => OLD_WORLD.test(p))) return old;
      const homely = HOMELY[k];
      if (homely && !STAYS_GRAND.test(part) && parts.slice(0, i).some((p) => HOME.test(p))) return homely;
      return k;
    }
  }
  return null;
}

export function readPlace(path: string[] | null | undefined): Place {
  return read((path ?? []).map((p) => p.toLowerCase())) ?? "hills";
}

/** Homes that aren't in HOME: the reader treats their rooms as its own, but a house is a house. */
const ALSO_A_HOUSE = /\bcottage|farmhouse|\bcabin|\bshack|\btrailers?\b(?! park)|\bdorm\b|houseboat/;
const HUMBLE = /apartment|\bflat\b|\bcondo|\btrailers?\b(?! park)|\bdorm\b|\bshack|\bbedsit/;
const GRAND = /\bmansion|\bvillas?\b|penthouse|\bestate\b/;

/**
 * The home a place is in (the nearest part of its path that names one), or null. `styles` is your
 * "This house is…" correction. A home's own word beats its surroundings: an apartment in Greenwich
 * Village isn't old-world, though a village is.
 */
export function readHome(path: string[] | null | undefined, styles?: Record<string, string> | null): Home | null {
  const parts = (path ?? []).map((p) => p.toLowerCase().trim());
  const inward = [...parts].reverse();
  const house = inward.find((p) => HOME.test(p) || ALSO_A_HOUSE.test(p)) ?? inward.find((p) => OLD_WORLD.test(p));
  if (!house) return null;
  const own = styles?.[house];
  if (own && HOME_STYLES.some((s) => s.id === own)) return { house, style: own as HomeStyle };
  const style: HomeStyle = GRAND.test(house) ? "grand" : HUMBLE.test(house) ? "humble" : parts.some((p) => OLD_WORLD.test(p)) ? "old" : parts.some((p) => GRAND.test(p)) ? "grand" : parts.some((p) => HUMBLE.test(p)) ? "humble" : "modern";
  return { house, style };
}

const pickOf = <T>(r: () => number, a: readonly T[]): T => a[(r() * a.length) | 0]!;

const PALETTES: Record<HomeStyle, { wall: RGB[]; trim: RGB[]; floor: RGB[] }> = {
  modern: {
    wall: PLASTER,
    trim: [[236, 232, 224], [210, 204, 196], [70, 60, 54]],
    floor: [[150, 110, 76], [120, 90, 66], [180, 150, 110], [120, 120, 124]],
  },
  humble: {
    wall: [[196, 186, 166], [170, 176, 160], [184, 170, 160], [160, 168, 176]],
    trim: [[206, 200, 188], [150, 124, 100]],
    floor: [[130, 118, 100], [110, 100, 92]],
  },
  grand: {
    wall: [[120, 60, 66], [60, 84, 92], [196, 176, 130], [90, 110, 90]],
    trim: [[232, 222, 196], [176, 146, 90]],
    floor: [[104, 62, 42], [190, 180, 165]],
  },
  old: {
    wall: [[176, 164, 142], [150, 138, 122], [168, 150, 124]],
    trim: [[84, 58, 42], [60, 44, 34]],
    floor: [[110, 100, 92], [84, 62, 46]],
  },
};

/** A home's colours, the same from any of its rooms. */
export function dressHome(home: Home): HomeDress {
  const r = rand(seedOf(home.house));
  const p = PALETTES[home.style];
  const fabric = pickOf(r, FABRIC);
  return { ...home, wall: pickOf(r, p.wall), trim: pickOf(r, p.trim), floor: pickOf(r, p.floor), fabric, soft: mix(fabric, [120, 120, 130], 0.45) };
}
