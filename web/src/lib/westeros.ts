/**
 * Westeros for the place reader (docs/25-rooms-of-the-keep.md): where its castles are, what its
 * named places are, and what a castle's rooms are called. Each points at the nearest painting there
 * is, and moves to its own as those are painted. Names that could be anything ("the Wall", "the
 * Twins") only count in a chat on the Westeros calendar, so a modern story keeps its own.
 */
import type { Masonry, Place } from "./places";

/** The world a chat is set in, from its calendar. */
export type World = "westeros" | null;
export const worldOf = (calendar: string | null | undefined): World => (calendar === "westeros" ? "westeros" : null);

/** Castles that can't be mistaken for anything else. */
const SEATS = String.raw`harrenhal|winterfell|red keep|maegor|riverrun|eyrie|storm'?s end|dragonstone|highgarden|casterly|castle black|sunspear|hightower|deepwood motte|moat cailin|dreadfort|last hearth|eastwatch|shadow tower|summerhall|bitterbridge|greywater watch|seagard|starfall|hellholt|yronwood|runestone`;

/** Somewhere that is a castle, in its own words or by name. */
export const KEEP = new RegExp(String.raw`castle|\bkeep\b|\bhold\b|fortress|citadel|palace|stronghold|\bmanor|\bfort\b|${SEATS}`);
/** What a castle is built of, where the books say. Anywhere else is dressed pale stone. */
export const masonryOf = (house: string): Masonry => (/red keep|maegor/.test(house) ? "redstone" : /harrenhal/.test(house) ? "fused" : "ashlar");
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
  named("ruins", /kingspyre|wailing tower|tower of (?:dread|ghosts)|widow'?s tower|flowstone/),
  named("ruins", /bear ?pit|\bsept\b/, { within: /harrenhal/ }),
  named("lake", /gods?'? eye/),
  named("forest", /isle of faces/),
  // The Red Keep
  named("castle", /maegor'?s/),
  named("hallway", /traitor'?s walk/),
  named("staircase", /serpentine/),
  named("parlor", /maidenvault/),
  named("cellar", /dragon skulls?|skull cellar/),
  named("study", /tower of the hand|hand'?s (?:solar|tower|chambers?)|white sword|round room/),
  // King's Landing
  named("chapel", /inside the great sept/),
  named("temple", /great sept|sept of (?:baelor|remembrance)|visenya'?s hill/),
  named("ruins", /dragon ?pit|rhaenys'?s hill/),
  named("castle", /aegon'?s (?:high )?hill/),
  named("river", /blackwater (?:rush|river)/),
  named("street", /flea ?bottom/),
  named("street", /\bgates?\b/, { within: IN_THE_CITY }),
  // A sept in a castle is a room in it; on its own, it's a building.
  named("chapel", /\bsept\b/, { within: KEEP }),
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
  ["alchemy", /maester(?!'?s? office)/],
  ["attic", /rookery|ravenry|servants'? (?:quarters|cells|loft)|maids'? (?:quarters|rooms?)/],
  ["stable", /\bmews\b|falconry/],
  ["parlor", /ladies'? (?:solar|gallery)|lady'?s solar/],
  ["study", /\bsolar\b|map room|war room|counting ?(?:room|house)|treasury/],
  ["dining", /council/],
  ["hall", /minstrels?'? gallery/],
  ["masterbedroom", /apartments?\b|(?:lord|lady|king|queen|prince|princess)'?s? (?:chambers?|bed ?chamber|rooms?)|royal chambers?|great chamber/],
  ["bedroom", /guest (?:house|chambers?)/],
  ["hallway", /ante-?chamber|outer chamber|covered (?:bridge|walk)/],
  ["rooftops", /battlements?|ramparts?|wall ?walk|parapet|merlons?|^(?:the )?(?:curtain |outer |inner |castle )?walls?$/],
  ["castle", /gate ?house|\bgates?\b|portcullis|draw ?bridge|postern|sally port|barbican/],
  ["camp", /(?:training|practice|drill|tilt) ?yard|\blists\b|tourney|joust/],
  ["street", /courtyard|\bbailey\b|\byard\b|\bward\b|^(?:the )?well$/],
  ["forge", /armou?ry|weapons? (?:store|room)/],
  ["tavern", /guard ?(?:room|hall|quarters)|barracks/],
  ["kitchen", /bake ?house/],
  ["cellar", /buttery|brew ?house|granary|cistern|garderobe|\bvault\b/],
  ["greenhouse", /glass gardens?/],
  ["hotspring", /hot pools?/],
];

/** A tower in a castle with nothing else to say for itself: up under its roof. */
export const KEEP_TOWER = /\btowers?\b|\bturrets?\b/;
