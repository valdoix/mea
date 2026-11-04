/**
 * Westeros for the place reader (docs/25-rooms-of-the-keep.md): where its castles are, what its
 * named places are, and what a castle's rooms are called. Each points at the nearest painting there
 * is, and moves to its own as those are painted. Names that could be anything ("the Wall", "the
 * Twins") only count in a chat on the Westeros calendar, so a modern story keeps its own.
 */
import type { Masonry, Place, RGB } from "./places";

/** The world a chat is set in, from its calendar. */
export type World = "westeros" | null;
export const worldOf = (calendar: string | null | undefined): World => (calendar === "westeros" ? "westeros" : null);

/** Castles that can't be mistaken for anything else. */
const SEATS = String.raw`harrenhal|winterfell|red keep|maegor|riverrun|eyrie|storm'?s end|dragonstone|highgarden|casterly|castle black|sunspear|hightower|deepwood motte|moat cailin|dreadfort|last hearth|eastwatch|shadow tower|summerhall|bitterbridge|greywater watch|seagard|starfall|hellholt|yronwood|runestone`;

/** Somewhere that is a castle, in its own words or by name. */
export const KEEP = new RegExp(String.raw`castle|\bkeep\b|\bhold\b|fortress|citadel|palace|stronghold|\bmanor|\bfort\b|${SEATS}`);
/** What a castle is built of, where the books say. Anywhere else is dressed pale stone. */
export const masonryOf = (house: string): Masonry => (/red keep|maegor/.test(house) ? "redstone" : /harrenhal/.test(house) ? "fused" : "ashlar");
type Cloth = [RGB, RGB];
const TARGARYEN: Cloth = [[24, 20, 24], [176, 30, 36]];
const BARATHEON: Cloth = [[210, 164, 52], [26, 22, 22]];
const LANNISTER: Cloth = [[150, 26, 34], [218, 174, 76]];
const WHENT: Cloth = [[206, 164, 60], [28, 24, 28]];

/** docs/25 §2.4: whose colours a castle flies in a given year. With no clock it's about 298 AC. */
export function flownAt(house: string, year?: number | null): { banners?: Cloth; second?: Cloth; dragon?: boolean } {
  const y = year ?? 298;
  if (/red keep|maegor/.test(house)) {
    if (y < 283) return { banners: TARGARYEN, dragon: true };
    return y < 298 ? { banners: BARATHEON } : { banners: BARATHEON, second: LANNISTER };
  }
  if (/harrenhal/.test(house)) return { banners: y < 299 ? WHENT : LANNISTER };
  return {};
}
/** A city, not a castle: it has a castle in it. */
export const KINGS_LANDING = /king'?s landing/;

const IN_THE_CITY = /king'?s landing(?!.*red keep)/;
const NO_PARENT = /^$/;

interface Named {
  kind: Place;
  /** What this part of the path says. */
  part: RegExp;
  /** What the parts before it have to say (joined with " › "). */
  within?: RegExp;
  /** Only in a Westeros chat. */
  westeros?: true;
}
const named = (kind: Place, part: RegExp, more: Omit<Named, "kind" | "part"> = {}): Named => ({ kind, part, ...more });

/** Most specific first. */
export const NAMED: Named[] = [
  // Harrenhal
  named("hundredhearths", /hundred hearths/),
  named("meltedtower", /kingspyre|wailing tower|tower of (?:dread|ghosts)|widow'?s tower/),
  named("meltedtower", /\btowers?\b/, { within: /harrenhal/ }),
  named("flowstoneyard", /flowstone/),
  named("bearpit", /bear ?pit/, { within: /harrenhal/ }),
  named("ruinsept", /\bsept\b/, { within: /harrenhal/ }),
  named("lake", /gods?'? eye/),
  named("forest", /isle of faces/),
  // The Red Keep
  named("holdfast", /maegor'?s/),
  named("ballroom", /queen'?s ballroom/),
  named("hallway", /traitor'?s walk/),
  named("staircase", /serpentine/),
  named("ladysolar", /maidenvault/),
  named("skullcellar", /dragon skulls?|skull cellar/),
  named("roundroom", /white sword|round room/),
  named("solar", /tower of the hand|hand'?s (?:solar|tower|chambers?)/),
  named("godswood", /godswood|heart tree|weirwood/),
  // King's Landing
  named("greatsept", /inside the great sept/),
  named("septsteps", /\bsteps\b|plaza|statue/, { within: /great sept/ }),
  named("greatsept", /./, { within: /great sept/ }),
  named("septsteps", /great sept|sept of baelor|statue of baelor|visenya'?s hill/),
  named("temple", /sept of remembrance/),
  named("dragonpit", /dragon ?pit|rhaenys'?s hill/),
  named("castle", /aegon'?s (?:high )?hill/),
  named("river", /blackwater (?:rush|river)/),
  named("fleabottom", /flea ?bottom|pot ?shop/),
  named("gatehouse", /\bgates?\b/, { within: IN_THE_CITY }),
  // A sept in a castle is a room in it; on its own, it's a building.
  named("sept", /\bsept\b/, { within: KEEP }),
  // Elsewhere
  named("tundra", /^(?:the |atop the |top of the )?wall$/, { within: /castle black|shadow tower|eastwatch/ }),
  named("tundra", /^(?:the |atop the |top of the )?wall$/, { within: NO_PARENT, westeros: true }),
  named("castle", /^(?:the )?twins$|^pyke$|^(?:the )?rock$|^ashford$|^oldstones$|^karhold$|^horn hill$|great pyramid/, { westeros: true }),
  named("temple", /house of black and white/),
  named("village", /barrowton/),
  named("street", /lannisport|oldtown|gulltown|maidenpool|duskendale|braavos|pentos|volantis|meereen|astapor|yunkai|qarth/),
  named("rooftops", KINGS_LANDING),
];

/** Rooms of a castle, by their castle names. Only read in or near one, or in a Westeros chat. */
export const KEEP_ROOMS: [Place, RegExp][] = [
  ["throneroom", /\bthrone\b/],
  ["ballroom", /ballroom/],
  ["maester", /maester(?!'?s? office)/],
  ["rookery", /rookery|ravenry/],
  ["servantsloft", /servants'? (?:quarters|cells|loft)|maids'? (?:quarters|rooms?)/],
  ["bathchamber", /\bbaths?\b|bath ?house|bath chamber/],
  ["stable", /\bmews\b|falconry/],
  ["ladysolar", /ladies'? (?:solar|gallery)|lady'?s solar/],
  ["solar", /\bsolar\b/],
  ["countingroom", /counting ?(?:room|house)|treasury|master of coin/],
  ["study", /map room|war room/],
  ["councilroom", /council/],
  ["hall", /minstrels?'? gallery/],
  ["masterbedroom", /apartments?\b|(?:lord|lady|king|queen|prince|princess)'?s? (?:chambers?|bed ?chamber|rooms?)|royal chambers?|great chamber/],
  ["bedroom", /guest (?:house|chambers?)/],
  ["hallway", /ante-?chamber|outer chamber|covered (?:bridge|walk)/],
  ["battlements", /battlements?|ramparts?|wall ?walk|parapet|merlons?|^(?:the )?(?:curtain |outer |inner |castle |city )?walls?$/],
  ["gatehouse", /gate ?house|\bgates?\b|portcullis|draw ?bridge|postern|sally port|barbican/],
  ["trainingyard", /(?:training|practice|drill) ?yard/],
  ["tiltyard", /tilt ?yard|\blists\b|tourney|joust/],
  ["bailey", /courtyard|\bbailey\b|\byard\b|\bward\b|^(?:the )?well$/],
  ["armory", /armou?ry|weapons? (?:store|room)/],
  ["guardroom", /guard ?(?:room|hall|quarters)|barracks/],
  ["kitchen", /bake ?house/],
  ["buttery", /buttery|brew ?house/],
  ["cellar", /granary|cistern|garderobe|\bvault\b/],
  ["greenhouse", /glass gardens?/],
  ["hotspring", /hot pools?/],
];

/** A tower in a castle with nothing else to say for itself: up under its roof. */
export const KEEP_TOWER = /\btowers?\b|\bturrets?\b/;
