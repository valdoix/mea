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
export interface Ctx {
  W: number;
  H: number;
  u: number;
  F: number;
  r: () => number;
  mini: boolean;
}

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
      { id: "bathroom", label: "Bathroom" },
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
    label: "At home",
    kinds: [
      { id: "living", label: "Living room" },
      { id: "homekitchen", label: "Kitchen" },
      { id: "bedroom", label: "Bedroom" },
      { id: "attic", label: "Attic" },
      { id: "cabin", label: "Log cabin" },
      { id: "treehouse", label: "Treehouse" },
      { id: "tent", label: "Inside a tent" },
    ],
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
  ["shipcabin", /captain's (?:quarters|cabin)|ship's cabin|below ?decks?|\bgalley\b|\bthe hold\b|stateroom|\bberth\b/],
  ["car", /\b(?:car|truck|van|taxi|cab|limo|limousine|jeep|sedan|pickup|suv|bus|minivan)\b(?! park| stop| station| depot)|back ?seat|(?:driver|passenger)'?s? seat|behind the wheel/],
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
  ["greenhouse", /greenhouse|conservatory|orangery|glasshouse|hothouse|sunroom|solarium/],
  ["cellar", /cellar|basement|wine vault|storeroom|undercroft|larder/],
  ["kitchen", /scullery|castle kitchen|\bkitchens\b/],
  ["homekitchen", /kitchen|pantry/],
  ["alchemy", /alchem|wizard|\bmage'?s?\b|sorcer|witch'?s? (?:hut|cottage|house)|potion|enchanter|arcane|spell ?room/],
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
  ["library", /librar|archive|scriptorium|bookshop|bookstore|reading room/],
  ["study", /\bstudy\b|\bsolar\b/],
  ["hall", /throne|great hall|\bhall\b|ballroom|council|audience chamber|banquet|feast/],
  ["tavern", /tavern|\binn\b|\bbar\b|\bpub\b|saloon|alehouse|canteen|brewery|speakeasy/],
  ["stable", /stables?\b|hayloft|\bbarn\b|horse stall|kennel|tack room|\bcoop\b/],
  ["attic", /\battic|garret|\bloft\b/],
  ["cabin", /\bcabin|log house|\blodge\b|chalet|\bhut\b|\bshack\b/],
  ["living", /living ?room|lounge room|sitting room|family room|front room|drawing room|dining room|\bden\b|parlou?r|\bsofa|\bcouch|apartment|\bflat\b|\bcondo|(?:'s|\bthe|\bmy|\bour|\bhis|\bher|\btheir) (?:house|home|place)\b|\bat home\b/],
  ["bedroom", /bedroom|\bbed\b|chamber|quarters|\broom\b|bunk|dormitor|nursery|\bsuite\b/],
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
  ["city", /downtown|skyscraper|\bmetro\b|subway|neon|highway|tower block|skyline|avenue|hotel|campus|\bmall\b|parking|car park|station|corridor|lobby|elevator/],
  ["street", /street|alley|\blane\b|\btown\b|\bcity\b|quarter|district|borough|\bslums?\b/],
  ["village", /village|hamlet|\bfarm|homestead|cottage|\bcroft|\bmill\b/],
  ["road", /\broads?\b|\bpath\b|\btrail\b|\btrack\b|caravan|wagon|crossroad|kingsroad|on the way|journey/],
  ["meadow", /garden|meadow|\bfields?\b|courtyard|\bpark\b|glade|orchard|\blawn/],
  ["forest", /forest|\bwoods?\b|\bpines?\b|\bgrove|thicket|\bcopse|godswood|weirwood|wolfswood/],
];

/** Somewhere old-world: its kitchen has a hearth and its office is a study. */
const OLD_WORLD = /castle|\bkeep\b|\bhold\b|fortress|citadel|palace|stronghold|winterfell|king's landing|red keep|riverrun|eyrie|storm's end|dragonstone|highgarden|casterly|castle black|\bmanor|\bfort\b|abbey|monastery|priory|\binn\b|tavern|\bsept\b|village|hamlet|\bcroft/;
const OLDER: Partial<Record<Place, Place>> = { homekitchen: "kitchen", office: "study" };

export function readPlace(path: string[] | null | undefined): Place {
  const parts = (path ?? []).map((p) => p.toLowerCase());
  for (let i = parts.length - 1; i >= 0; i--)
    for (const [k, re] of RULES)
      if (re.test(parts[i]!)) {
        const old = OLDER[k];
        return old && parts.some((p) => OLD_WORLD.test(p)) ? old : k;
      }
  return "hills";
}
