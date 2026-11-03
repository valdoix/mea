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
export interface Scene {
  draw(g: CanvasRenderingContext2D, E: Env): void;
  /** Indoors: the sky and weather show only through `win`; `draw` furnishes the room over them. */
  room?: { win: Path2D; draw(g: CanvasRenderingContext2D, E: Env): void };
  /** Paints its own sky and has no weather (space, or a room looking out on it). */
  space?: boolean;
}

export const PLACE_GROUPS = [
  {
    label: "Out in the wild",
    kinds: [
      { id: "hills", label: "Open country" },
      { id: "meadow", label: "Meadow or garden" },
      { id: "forest", label: "Forest" },
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
    label: "Indoors",
    kinds: [
      { id: "bedroom", label: "Bedroom" },
      { id: "kitchen", label: "Kitchen" },
      { id: "study", label: "Study or office" },
      { id: "library", label: "Library" },
      { id: "hall", label: "Great hall" },
      { id: "chapel", label: "Chapel or nave" },
      { id: "greenhouse", label: "Greenhouse" },
      { id: "cellar", label: "Cellar" },
      { id: "dungeon", label: "Dungeon or cell" },
    ],
  },
  {
    label: "Indoors, out and about",
    kinds: [
      { id: "tavern", label: "Tavern or bar" },
      { id: "cafe", label: "Café or diner" },
      { id: "shop", label: "Shop or apothecary" },
      { id: "forge", label: "Forge or workshop" },
      { id: "hospital", label: "Hospital room" },
      { id: "train", label: "Train carriage" },
      { id: "shipcabin", label: "Ship's cabin" },
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
  ["starship", /starship|spaceship|space station|airlock|hangar bay|cockpit|bridge of the|med ?bay|engine room|\bshuttle\b/],
  ["space", /\bspace\b|\borbit|nebula|asteroid/],
  ["shore", /lighthouse|lamp room|lantern room/],
  ["hospital", /hospital|infirmary|\bclinic|\bward\b|sickroom|operating (?:room|theatre)/],
  ["train", /\btrain\b|railway|\bcarriage\b|compartment|\btram\b|dining car|sleeper car/],
  ["shipcabin", /captain's (?:quarters|cabin)|ship's cabin|below ?decks?|\bgalley\b|\bthe hold\b|stateroom/],
  ["chapel", /chapel|\bnave\b|\bpews?\b|\baltar\b|sanctum|inside the (?:church|temple|cathedral|sept)/],
  ["greenhouse", /greenhouse|conservatory|orangery|glasshouse|hothouse/],
  ["cellar", /cellar|basement|wine vault|storeroom|undercroft/],
  ["kitchen", /kitchen|scullery|pantry/],
  ["forge", /\bforge|smithy|blacksmith|foundry|workshop/],
  ["cafe", /caf[eé]|coffee|\bdiner\b|restaurant|bistro|tea ?(?:house|room|shop)|food court|bakery/],
  ["shop", /\bshop\b|\bstore\b|apothecary|emporium|boutique|pharmacy|chandler|\bpawn/],
  ["dungeon", /dungeon|\bcells?\b|prison|gaol|\bjail|oubliette|crypt|torture|\bbrig\b/],
  ["library", /librar|archive|scriptorium|bookshop|bookstore|reading room/],
  ["study", /\bstudy\b|office|laborator|\blab\b|classroom|precinct|headquarters/],
  ["hall", /throne|great hall|\bhall\b|ballroom|council|audience chamber|banquet|feast/],
  ["tavern", /tavern|\binn\b|\bbar\b|\bpub\b|saloon|alehouse|\bclub\b|canteen|brewery/],
  ["bedroom", /bedroom|\bbed\b|chamber|quarters|\broom\b|bunk|attic|apartment|\bflat\b|\bsuite\b|dormitor|nursery/],
  ["cave", /\bcaves?\b|cavern|grotto|\bmines?\b|tunnel|underground|burrow|catacomb/],
  ["volcano", /volcan|\blava\b|magma|caldera|ashland/],
  ["graveyard", /grave|cemetery|\btomb|barrow|mausoleum|churchyard|necropolis/],
  ["ruins", /\bruin|rubble|crumbl|abandoned|forgotten/],
  ["temple", /temple|shrine|cathedral|church|\bsept\b|abbey|monastery|sanctuary|priory/],
  ["castle", /castle|\bkeep\b|\bhold\b|fortress|citadel|palace|stronghold|winterfell|king's landing|red keep|riverrun|eyrie|storm's end|dragonstone|highgarden|casterly|castle black|\bmanor|\bfort\b/],
  ["harbor", /harbou?r|\bport\b|\bdocks?\b|\bpier\b|wharf|\bquay|marina|shipyard/],
  ["sea", /\bdeck\b|aboard|\bship\b|galleon|vessel|at sea|open sea|ocean|voyage|\bmast\b|crow's nest/],
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
  ["city", /downtown|skyscraper|\bmetro\b|subway|neon|highway|tower block|skyline|avenue|hotel|campus|\bmall\b|parking|station|corridor|lobby|elevator/],
  ["street", /street|alley|\blane\b|\btown\b|\bcity\b|quarter|district|borough|\bslums?\b/],
  ["village", /village|hamlet|\bfarm|homestead|cottage|\bcroft|\bmill\b|\bbarn\b/],
  ["road", /\broads?\b|\bpath\b|\btrail\b|\btrack\b|caravan|wagon|crossroad|kingsroad|on the way|journey/],
  ["meadow", /garden|meadow|\bfields?\b|courtyard|\bpark\b|glade|orchard|\blawn/],
  ["forest", /forest|\bwoods?\b|\bpines?\b|\bgrove|\bcabin|\bcamp\b|wolfswood|thicket|\bcopse|godswood|weirwood/],
];

export function readPlace(path: string[] | null | undefined): Place {
  const parts = (path ?? []).map((p) => p.toLowerCase());
  for (let i = parts.length - 1; i >= 0; i--) for (const [k, re] of RULES) if (re.test(parts[i]!)) return k;
  return "hills";
}

