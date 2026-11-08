import type { Character, Place, WorldState } from "./types";

/**
 * docs/30 Part 2: the places tracker. A place is a node in a tree (town › building › room › spot),
 * known by its own name and any others it has been written as ("Gabriel's House" for the Winters
 * Residence). Every path the tracker writes (a move, an item put down, a room, a note) is matched
 * against the tree here before anything new is made, so one house stays one house.
 */

/** Your edits to a place (place_profiles), kept through every refold. */
export interface PlaceProfile {
  /** Its name, as you want it shown. */
  name?: string;
  /** More names it goes by. */
  aliases?: string[];
  kind?: string;
  /** Merged into another place (its id): everything written for this one goes there. */
  into?: string;
  /** A phrase that got into the tree by mistake: paths through it skip it. */
  notPlace?: boolean;
  /** Names that are NOT this place, though they look like it ("Not the same place"). */
  notSame?: string[];
}

export type PlaceKind = "town" | "district" | "street" | "building" | "home" | "floor" | "room" | "spot" | "vehicle" | "outdoors";

const low = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
/** The name to compare by: no "the", no possessive apostrophe slips ("Buffys bedroom"). */
export const placeKey = (s: string) => low(s).replace(/^the /, "").replace(/'/g, "");
const FLOOR_LEAD = /^(?:(?:down|up)stairs|(?:ground|first|second|third|top|upper|lower|main)[- ]floor)\s+/i;
const FLOOR = /^(?:(?:down|up)stairs|(?:ground|first|second|third|top|upper|lower|main)[- ]floor)$/i;
const unfloored = (s: string) => placeKey(s.replace(FLOOR_LEAD, ""));

const HOME = /\b(?:house|home|place|residence|apartment|flat|mansion|manor|cottage|cabin|condo|estate|townhouse|bungalow|dorm)$/i;
const BUILDING =
  /\b(?:school|high|college|university|mall|store|shop|boutique|diner|restaurant|cafe|café|bar|pub|club|hotel|motel|inn|hospital|clinic|church|chapel|library|station|warehouse|parlou?r|gym|office|offices|museum|theatre|theater|cinema|bank|market|supermarket|bakery|salon|studio|precinct|factory|barn|shed|the bronze)$/i;
const STREET = /\b(?:drive|street|st|road|rd|avenue|ave|lane|boulevard|blvd|way|court|crescent|alley)$/i;
const ROOM =
  /\b(?:kitchen|kitchenette|pantry|bedroom|bathroom|room|hallway|hall|corridor|foyer|landing|stairs|stairwell|staircase|porch|patio|balcony|terrace|deck|garage|driveway|basement|cellar|attic|loft|closet|office|study|den|nursery|shower|en-suite|ensuite|pool|lobby|food court|atrium|aisle|section|fitting room|counter area|back room|yard|backyard|garden|crypt)$/i;
const SPOT =
  /\b(?:bed|couch|sofa|table|counter|sink|fridge|fridge door|stove|oven|desk|chair|seat|seats|bench|door|doorway|window|curb|booth|stool|bar stool|tub|bathtub|mirror|wall|corner|fence|gate|steps|step|rug|shelf|shelves|racks|rack|entrance|exit|spot)$/i;
const VEHICLE = /\b(?:car|bmw|truck|van|bus|cab|taxi|jeep|suv|sedan|motorcycle|bike|boat|ship|train|plane|limo|front seats?|back seats?|passenger seat|passenger cabin)\b/i;
const OUTDOORS = /\b(?:cemetery|graveyard|park|woods|forest|wilderness|clearing|beach|field|hills|lake|river|parking lot|lot|street|streets|road|square|plaza)$/i;
/** "driving to Revello Drive", "moving toward chain-link fence": a trip, and where it ends. */
const TRAVEL = /^(?:driving|heading|walking|running|riding|on the way|en route|moving|going|headed|pulling out)\s+(?:back\s+)?(?:to|toward|towards|into|for)\s+(.+)$/i;

/** What kind of place a name is, from its last words. */
export function kindOf(name: string, depth = 1): PlaceKind {
  const n = low(name).replace(/\s*\([^)]*\)\s*$/, "");
  if (FLOOR.test(n)) return "floor";
  if (VEHICLE.test(n)) return "vehicle";
  if (/'s\s+.*\b(?:house|home|place|apartment|flat)$/.test(n) || HOME.test(n)) return "home";
  if (SPOT.test(n) && !ROOM.test(n)) return "spot";
  if (ROOM.test(n)) return "room";
  if (BUILDING.test(n)) return "building";
  if (STREET.test(n)) return "street";
  if (OUTDOORS.test(n)) return "outdoors";
  return depth === 0 ? "town" : "district";
}
const isBuilding = (k?: string) => k === "home" || k === "building";

/**
 * One part of a path as written, tidied: "(pulling out of the drop-off lane)" and other bracketed
 * notes go, "at the counter" loses its "at", and a trip ("driving to Revello Drive") becomes where it ends.
 */
export function cleanSegment(s: string): string {
  let t = s.replace(/[“”"]/g, "").trim();
  // "Kitchen → Gabriel's BMW", "stairs → Buffy's Bedroom": where it ended up.
  t = t.split(/\s*(?:→|->|=>|⟶)\s*/).filter((x) => x.trim()).at(-1) ?? "";
  t = t.replace(/\s*\([^)]*\)?\s*/g, " ").trim();
  // What follows a comma describes it: "kitchen table, center", "driveway, BMW".
  t = t.split(",")[0]!.trim();
  t = t.replace(/^(?:at|in|on|inside|outside of|into)\s+/i, "");
  const trip = t.match(TRAVEL) ?? t.match(/^(?:the\s+)?(?:road|way|drive|walk|ride|path)\s+(?:back\s+)?(?:to|toward|towards)\s+(.+)$/i) ?? t.match(/^.+?\s+(?:toward|towards|approaching|heading to|en route to)\s+(.+)$/i);
  if (trip) t = trip[1]!.trim();
  return t.replace(/[.;:]+$/, "").trim();
}

/** "Sunnydale › Winters Residence" (or with > » /) → its parts, tidied. Floors in the middle go: a house's rooms aren't kept by floor. */
export function pathParts(raw: string | string[]): string[] {
  const parts = (Array.isArray(raw) ? raw : raw.split(/\s*(?:›|>|»|\/)\s*/)).map(cleanSegment).filter(Boolean);
  return parts.filter((p, i) => !(FLOOR.test(p) && i < parts.length - 1));
}

function lev1(a: string, b: string) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const r = (x: string, y: string) => x === y;
  return r(a.slice(i + 1), b.slice(i + 1)) || r(a.slice(i + 1), b.slice(i)) || r(a.slice(i), b.slice(i + 1)) ? 1 : 2;
}

const slugOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "x";

export interface Resolved {
  place: Place;
  chain: Place[];
  /** Names matched by a guess (an owner, a surname, a typo, an address), for the change chips. */
  guessed: { written: string; place: Place; why: string }[];
  created: Place[];
}

/** The place tree over a world state. Cheap to make: it reads and writes the state's own places. */
export class PlaceBook {
  constructor(
    private st: WorldState,
    private o: { profiles?: Record<string, PlaceProfile>; findChar?: (name: string) => Character | undefined } = {},
  ) {}

  all() {
    return Object.values(this.st.places);
  }
  get(id: string | undefined) {
    return id ? this.st.places[id] : undefined;
  }
  private profile(p: Place) {
    return this.o.profiles?.[p.id];
  }
  names(p: Place): string[] {
    return [p.name, ...(p.aliases ?? []), ...(this.profile(p)?.aliases ?? [])];
  }
  parentOf(p: Place) {
    return this.get(p.parent);
  }
  chainOf(p: Place): Place[] {
    const out: Place[] = [];
    for (let c: Place | undefined = p, i = 0; c && i < 12; c = this.parentOf(c), i++) out.unshift(c);
    return out;
  }
  /** Everything under a place, nearest first. */
  under(p: Place, depth = 5): Place[] {
    const out: Place[] = [];
    let level = [p];
    for (let d = 0; d < depth && level.length; d++) {
      const next = this.all().filter((x) => x.parent && level.some((l) => l.id === x.parent));
      out.push(...next);
      level = next;
    }
    return out;
  }
  isUnder(p: Place, top: Place) {
    return this.chainOf(p).some((x) => x.id === top.id);
  }
  /** The building or home a place is in (or is). */
  buildingOf(p: Place | undefined): Place | undefined {
    return p && [...this.chainOf(p)].reverse().find((x) => isBuilding(x.kind));
  }
  townOf(p: Place | undefined) {
    return p ? this.chainOf(p)[0] : undefined;
  }
  /** Where the scene is now. */
  here(): Place | undefined {
    return this.get(this.st.placeId) ?? (this.st.place.length ? this.resolve(this.st.place, { create: false })?.place : undefined);
  }
  path(p: Place) {
    return this.chainOf(p).map((x) => x.name);
  }

  /** You said this name isn't this place ("Not the same place"). */
  private refused(p: Place, seg: string) {
    return (this.profile(p)?.notSame ?? []).some((n) => placeKey(n) === placeKey(seg));
  }

  /** How well a written name fits a place: 3 by name or another name, 2 without a floor word, 1 one letter off. */
  private fit(p: Place, seg: string): number {
    if (this.profile(p)?.notPlace) return 0;
    const k = placeKey(seg);
    if ((this.profile(p)?.notSame ?? []).some((n) => placeKey(n) === k)) return 0;
    const names = this.names(p).map(placeKey);
    if (names.includes(k)) return 3;
    const uk = unfloored(seg);
    if (names.some((n) => unfloored(n) === uk)) return 2;
    // "warded house" for "Gabriel's warded house": a home's name without whose it is (never a room: Buffy's bedroom isn't Dawn's).
    if (isBuilding(p.kind) && HOME.test(k) && this.names(p).some((n) => /^[^']+'s? /.test(low(n)) && placeKey(low(n).replace(/^[^']+'s? /, "")) === k)) return 2;
    // One letter off, but never a number ("Room 12" isn't "Room 13").
    if (k.length >= 5 && !/\d/.test(k) && names.some((n) => n.length >= 5 && lev1(n, k) <= 1)) return 1;
    return 0;
  }

  /** Nearest first: inside `under` (or, for the first part, around where the scene is), then the town, then anywhere. */
  private find(seg: string, under: Place | undefined, first: boolean): { p: Place; why?: string } | undefined {
    const here = this.get(this.st.placeId);
    const pools: Place[][] = under
      ? [this.all().filter((x) => x.parent === under.id), this.under(under)]
      : first
        ? [
            ...(here ? [this.chainOf(here).reverse().flatMap((a) => [a, ...this.under(a, 2)])] : []),
            ...(here ? [this.under(this.townOf(here)!), [this.townOf(here)!]] : []),
            this.all().filter((x) => !x.parent),
            this.all(),
          ]
        : [];
    // A building is the same building however the town's districts were written ("Sunnydale › Hills › Winters Residence").
    const town = under ? this.townOf(under) : undefined;
    if (under && town && isBuilding(kindOf(seg))) pools.push(this.under(town));
    for (const want of [3, 2, 1]) {
      for (const [i, pool] of pools.entries()) {
        const hits = pool.filter((p) => this.fit(p, seg) === want);
        // Anywhere at all, it has to be the only one by that name.
        const anywhere = !under && first && i === pools.length - 1;
        if (hits.length === 1 || (hits.length > 1 && !anywhere)) return { p: hits[0]!, why: want === 1 ? "one letter off" : undefined };
      }
    }
    // "Gabriel's House", "Gabriel's warded house": the home of someone by that name, or of their family.
    const POSS = /^(.+?)(?:'s|s')\s+(?:.*\s)?(?:house|home|place|apartment|flat|residence|mansion|manor)$/;
    const home = low(seg).match(POSS);
    const surname = (s: string) => low(s).split(" ").at(-1) ?? "";
    const scope = town ? this.under(town) : under ? this.under(under) : this.all();
    const homes = scope.filter((p) => p.kind === "home" && !this.refused(p, seg));
    if (home && this.o.findChar) {
      const c = this.o.findChar(home[1]!);
      if (c) {
        const theirs = homes.filter(
          (p) =>
            p.owner === c.id ||
            (c.name.includes(" ") && low(p.name).split(" ")[0] === surname(c.name)) ||
            // "Gabriel's warded house" and "Gabriel Winters' House" are one home.
            this.names(p).some((n) => {
              const m = low(n).match(POSS);
              return Boolean(m && this.o.findChar!(m[1]!)?.id === c.id);
            }),
        );
        if (theirs.length === 1) return { p: theirs[0]!, why: `${c.name}'s home` };
      }
    }
    if (HOME.test(low(seg)) && !home) {
      const fam = low(seg).split(" ")[0]!;
      // "Winters House" for the Winters Residence: a home by the same family name, in the same town.
      const same = homes.filter((p) => low(p.name).split(" ")[0] === fam && low(p.name) !== low(seg));
      if (same.length === 1) return { p: same[0]!, why: "the same family's home" };
      // "Winters Residence" for "Gabriel's warded house", when Gabriel is a Winters.
      const theirs = homes.filter((p) =>
        this.names(p).some((n) => {
          const m = low(n).match(POSS);
          const c = m && this.o.findChar?.(m[1]!);
          return Boolean(c && c.name.includes(" ") && surname(c.name) === fam);
        }),
      );
      if (theirs.length === 1) return { p: theirs[0]!, why: "the same family's home" };
    }
    return undefined;
  }

  /** A new place under `parent`, named as written. */
  private make(seg: string, parent: Place | undefined, seq: number): Place {
    const path = [...(parent ? this.path(parent) : []), seg];
    let id = slugOf(path.join(" "));
    for (let i = 2; this.st.places[id]; i++) id = `${slugOf(path.join(" "))}-${i}`;
    const merged = this.o.profiles?.[id]?.into;
    if (merged && this.st.places[merged]) return this.st.places[merged]!;
    const p: Place = { id, name: this.o.profiles?.[id]?.name ?? seg, path, visits: 0, lastSeq: seq, kind: this.o.profiles?.[id]?.kind ?? kindOf(seg, path.length - 1), ...(parent ? { parent: parent.id } : {}), source: "story" };
    this.st.places[id] = p;
    return p;
  }

  /** Where a new first part goes when nothing knows it: a room in the scene's building, a spot in the scene's room, anything else in its town. */
  private context(seg: string, parts: number): Place | undefined {
    const here = this.get(this.st.placeId);
    if (!here) return undefined;
    const k = kindOf(seg);
    // A path written from its top ("The Crossroads Inn › the common room") is where it says; only a bare name, or one that starts with a room, is placed by the scene.
    if (parts >= 2 && !["room", "spot", "floor"].includes(k)) return undefined;
    // A long path that starts somewhere new ("Canadian wilderness › clearing › cabin") starts its own tree; a street or a building is in the scene's town.
    // A name with no place word in it ("Saltpans") may be another town as much as a part of this one.
    if (k === "town" || k === "district" || (parts >= 3 && k === "outdoors")) return undefined;
    if (k === "spot") return here.kind === "room" || here.kind === "vehicle" ? here : (this.buildingOf(here) ?? here);
    if (k === "room" || k === "floor") return this.buildingOf(here) ?? (here.kind === "room" || here.kind === "spot" ? this.parentOf(here) : here);
    const town = this.townOf(here);
    return town && town.id !== here.id ? town : town?.kind === "town" ? town : undefined;
  }

  /**
   * The place a path names, matched part by part against the tree. With `create`, parts nothing
   * knows are made (under the deepest part that matched, or where the scene is); without, a path
   * that doesn't fully match gives undefined.
   */
  resolve(raw: string | string[], opts: { create: boolean; seq?: number; /** Items and keeps: put things in the tree, never start a new one. */ noNewTop?: boolean }): Resolved | undefined {
    const parts = pathParts(raw);
    if (!parts.length) return undefined;
    // "Sunnydale hills" is Sunnydale's hills, when Sunnydale is a town the story knows ("Sunnydale Mall" and "Pyke Docks" are names).
    const split = this.leadSplit(parts[0]!);
    if (split) parts.splice(0, 1, ...split);
    const seq = opts.seq ?? 0;
    const guessed: Resolved["guessed"] = [];
    const created: Place[] = [];
    let under: Place | undefined;
    let address: string | undefined;
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]!;
      // A street before a building is its address ("Revello Drive › Summers Residence"); before a room, the house at that address.
      if (kindOf(seg) === "street" && i + 1 < parts.length) {
        const next = parts[i + 1]!;
        const atAddress = this.all().filter((p) => p.address && placeKey(p.address) === placeKey(seg) && (!under || this.isUnder(p, under)));
        if (isBuilding(kindOf(next))) {
          address = seg;
          continue;
        }
        if (atAddress.length === 1 && ["room", "spot", "floor"].includes(kindOf(next))) {
          under = atAddress[0]!;
          guessed.push({ written: seg, place: under, why: `the house on ${seg}` });
          continue;
        }
      }
      // "Sunnydale Mall › Food Court › Sunnydale Mall": a part naming a place it's already in is that place.
      const above = under ? this.chainOf(under).find((x) => this.fit(x, seg) === 3) : undefined;
      if (above) {
        under = above;
        continue;
      }
      const hit = this.find(seg, under, !under);
      let p = hit?.p;
      if (p && this.profile(p)?.into) p = this.get(this.profile(p)!.into) ?? p;
      if (p && this.profile(p)?.notPlace) continue;
      if (!p) {
        if (!opts.create) return undefined;
        const parent = under ?? this.context(seg, parts.length - i + (address ? 1 : 0));
        if (!parent && opts.noNewTop) return undefined;
        p = this.make(seg, parent, seq);
        created.push(p);
      } else if (hit?.why || this.fit(p, seg) < 3) {
        // Known by another name now ("Gabriel's House", "downstairs kitchen"), and why it's taken for this place.
        if (!this.names(p).some((n) => placeKey(n) === placeKey(seg))) {
          if (opts.create) p.aliases = [...(p.aliases ?? []), seg];
          guessed.push({ written: seg, place: p, why: hit?.why ?? "the same room" });
        }
      }
      if (address && isBuilding(p.kind)) {
        if (opts.create && !p.address) p.address = address;
        address = undefined;
      }
      if (opts.create) this.count(p, seg);
      under = p;
    }
    if (!under) return undefined;
    // The stored path follows the tree, so a place moved under a house reads as being in it.
    under.path = this.path(under);
    return { place: under, chain: this.chainOf(under), guessed, created };
  }

  /** "Sunnydale hills" → ["Sunnydale", "hills"]: a known town's name, then the outdoors of it. */
  private leadSplit(seg: string, self?: Place): [string, string] | undefined {
    if (this.all().some((p) => p.id !== self?.id && this.fit(p, seg) === 3)) return undefined;
    for (const t of this.all().filter((p) => !p.parent && p.id !== self?.id)) {
      const n = this.names(t).find((x) => placeKey(seg).startsWith(`${placeKey(x)} `));
      if (!n) continue;
      const rest = seg.slice(n.length).trim();
      if (rest && kindOf(rest) === "outdoors") return [t.name, rest];
    }
    return undefined;
  }

  /**
   * docs/30 2.2: one place written two ways that only later turned out to be one ("Gabriel's House"
   * before the Winters Residence was named): `from` folds into `into`, its rooms with it (a room by
   * the same name is one room), and what pointed at it now points at `into`.
   */
  absorb(into: Place, from: Place) {
    if (into.id === from.id || this.isUnder(into, from)) return;
    const st = this.st;
    into.aliases = [...new Set([...(into.aliases ?? []), ...this.names(from)].filter((n) => placeKey(n) !== placeKey(into.name)))];
    into.visits += from.visits;
    into.lastSeq = Math.max(into.lastSeq, from.lastSeq);
    into.owner ??= from.owner;
    if (from.residents?.length) into.residents = [...new Set([...(into.residents ?? []), ...from.residents])];
    if (from.guessed?.length) into.guessed = [...new Set([...(into.guessed ?? []), ...from.guessed])].filter((id) => !(into.residents ?? []).includes(id) || from.guessed!.includes(id));
    into.address ??= from.address;
    if (from.notes?.length) into.notes = [...(into.notes ?? []), ...from.notes].sort((a, b) => a.seq - b.seq);
    for (const [n, k] of Object.entries(from.written ?? {})) (into.written ??= {})[n] = (into.written[n] ?? 0) + k;
    for (const child of this.all().filter((x) => x.parent === from.id)) {
      const twin = this.all().find((x) => x.parent === into.id && this.names(x).some((n) => this.fit(child, n) >= 2));
      if (twin) this.absorb(twin, child);
      else child.parent = into.id;
    }
    delete st.places[from.id];
    if (st.placeId === from.id) st.placeId = into.id;
    for (const i of Object.values(st.items)) if (i.placeId === from.id) i.placeId = into.id;
    for (const x of [into, ...this.under(into, 8)]) x.path = this.path(x);
    if (st.placeId) st.place = this.path(st.places[st.placeId]!);
  }

  /** Two homes of one family: by an owner's name ("Gabriel's …" for a Winters) or the family's own ("Winters House"). */
  private family(p: Place): Set<string> {
    const out = new Set<string>();
    for (const n of this.names(p)) {
      const m = low(n).match(/^(.+?)(?:'s|s')\s+(?:.*\s)?(?:house|home|place|apartment|flat|residence|mansion|manor)$/);
      const c = m ? this.o.findChar?.(m[1]!) : undefined;
      if (c?.name.includes(" ")) out.add(low(c.name).split(" ").at(-1)!);
      else if (!m && HOME.test(low(n))) out.add(low(n).split(" ")[0]!);
    }
    if (p.owner) {
      const c = this.st.chars[p.owner];
      if (c?.name.includes(" ")) out.add(low(c.name).split(" ").at(-1)!);
    }
    return out;
  }

  /**
   * After a move: homes of the same family that were made apart fold into this one (in the same town,
   * or made at the top before the town was known), and a street that turned out to be a home's
   * address gives the home its rooms.
   */
  settle(p: Place, cameFrom?: Place) {
    // A shop or a house written from its own name ("Grocery Store › Produce Aisle") is in the town the story came from.
    const top = this.townOf(p);
    const fromTown = this.townOf(cameFrom);
    // Only into a town of buildings (Sunnydale), not a castle with halls (Harrenhal): the Crossroads Inn is on the road.
    const ofBuildings = fromTown && this.all().some((x) => x.parent === fromTown.id && ["building", "home", "street"].includes(x.kind ?? ""));
    if (top && fromTown && ofBuildings && top.id !== fromTown.id && ["building", "home", "street"].includes(top.kind ?? "") && ["town", "district"].includes(fromTown.kind ?? "")) {
      const twin = this.all().find((x) => x.parent === fromTown.id && this.fit(x, top.name) >= 2);
      if (twin) this.absorb(twin, top);
      else {
        top.parent = fromTown.id;
        for (const x of [top, ...this.under(top, 8)]) x.path = this.path(x);
      }
      if (this.st.placeId) this.st.place = this.path(this.st.places[this.st.placeId]!);
    }
    const town = this.townOf(this.st.places[p.id] ? p : (this.get(this.st.placeId) ?? p));
    if (p.kind === "home") {
      const fam = this.family(p);
      if (fam.size)
        // Homes by their names: a hallway a room line called someone's "home" isn't a house.
        for (const h of this.all().filter((x) => x.kind === "home" && kindOf(x.name) === "home" && x.id !== p.id && !this.isUnder(p, x) && (!x.parent || this.townOf(x)?.id === town?.id)))
          if (this.st.places[h.id] && !this.names(h).some((n) => this.refused(p, n)) && !this.names(p).some((n) => this.refused(h, n)) && ([...this.family(h)].some((f) => fam.has(f)) || this.fit(p, h.name) >= 2)) this.absorb(p, h);
    }
    if (p.address) {
      const street = this.all().find((x) => x.kind === "street" && !this.isUnder(p, x) && placeKey(x.name) === placeKey(p.address!));
      if (street) {
        for (const child of this.all().filter((x) => x.parent === street.id && ["room", "spot", "floor"].includes(x.kind ?? ""))) {
          const twin = this.all().find((x) => x.parent === p.id && this.fit(x, child.name) >= 2);
          if (twin) this.absorb(twin, child);
          else child.parent = p.id;
        }
        if (!street.parent && town && town.id !== street.id) street.parent = town.id;
        for (const x of [street, ...this.under(street, 8)]) x.path = this.path(x);
      }
    }
    // "Sunnydale hills" made before Sunnydale was the town's name: its hills now.
    if (town)
      for (const t of this.all().filter((x) => !x.parent && x.id !== town.id)) {
        if (!this.st.places[t.id]) continue;
        const split = this.leadSplit(t.name, t);
        if (!split || this.fit(town, split[0]) < 3) continue;
        const twin = this.all().find((x) => x.parent === town.id && this.fit(x, split[1]) >= 2);
        t.name = split[1];
        if (twin) this.absorb(twin, t);
        else t.parent = town.id;
        for (const x of [t, ...this.under(t, 8)]) if (this.st.places[x.id]) x.path = this.path(x);
      }
  }

  /**
   * How often each name was written for a place: the one written most is its name ("Sunnydale",
   * however often the first line said "Sunnyvale"), unless you named it yourself.
   */
  private count(p: Place, seg: string) {
    const w = (p.written ??= {});
    w[seg] = (w[seg] ?? 0) + 1;
    if (this.profile(p)?.name) return;
    const best = Object.entries(w).sort((a, b) => b[1] - a[1])[0]![0];
    if (best === p.name || (w[best] ?? 0) <= (w[p.name] ?? 0)) return;
    p.aliases = [...new Set([...(p.aliases ?? []).filter((a) => a !== best), p.name])];
    p.name = best;
    for (const x of [p, ...this.under(p, 8)]) x.path = this.path(x);
  }

  // ---------- notes (docs/30 2.3) ----------

  /**
   * A note about a place, by what it's about ("fridge"): a newer note about the same thing makes the
   * older one history. A note that starts with another room of the same building ("living room
   * dartboard wall…") is that room's.
   */
  addNote(p: Place, text: string, seq: number): { place: Place; added: boolean } {
    const building = this.buildingOf(p);
    let place = p;
    let body = text.trim();
    if (building) {
      const lowText = placeKey(body);
      const others = [building, ...this.under(building)].filter((x) => x.id !== p.id);
      const named = others
        .flatMap((x) => this.names(x).map((n) => ({ x, n: placeKey(n) })))
        .filter(({ n }) => n.length >= 4 && lowText.startsWith(`${n} `))
        .sort((a, b) => b.n.length - a.n.length)[0];
      if (named && named.x.kind !== "home" && named.x.kind !== "building") {
        place = named.x;
        body = body.slice(named.n.length).trim();
      }
    }
    if (!body) return { place, added: false };
    const notes = (place.notes ??= []);
    if (notes.some((n) => !n.past && placeKey(n.text) === placeKey(body))) return { place, added: false };
    const feature = featureOf(body);
    for (const n of notes) if (!n.past && feature && n.feature === feature) n.past = true;
    notes.push({ text: body, seq, ...(feature ? { feature } : {}) });
    if (notes.length > 20) notes.splice(0, notes.length - 20);
    return { place, added: true };
  }
}

const LEAD = /^(?:the|a|an|her|his|their|our|my|its|new|old)\s+/i;
/** What a note is about: its first word ("fridge bears…", "fridge archive now…" are both the fridge). */
export function featureOf(text: string): string | undefined {
  let t = low(text);
  for (let i = 0; i < 3; i++) t = t.replace(LEAD, "");
  const w = t.match(/^[\p{L}'-]+/u)?.[0];
  return w && w.length >= 3 ? w.replace(/'s$/, "") : undefined;
}

/** The current notes of a place (not the ones a newer note replaced), newest first. */
export const currentNotes = (p: Place) => (p.notes ?? []).filter((n) => !n.past).reverse();

/**
 * docs/30 2.5: the places around the scene, by the names the tree knows them by, for the tracker's
 * prompt: the rooms of the building the scene is in, the town's usual places (most visited), and the
 * places visited last (one for each building). Writing these names keeps one place one place before 2.2 has to clean up.
 */
export function knownPlaces(st: WorldState, o: { rooms?: number; usual?: number; recent?: number } = {}): { here?: string; rooms: string[]; town?: string; usual: string[]; recent: string[] } {
  const book = new PlaceBook(st);
  const here = book.here();
  const building = book.buildingOf(here);
  const town = book.townOf(here);
  const rooms = building
    ? book
        .under(building, 1)
                .sort((a, b) => b.visits - a.visits || b.lastSeq - a.lastSeq)
        .slice(0, o.rooms ?? 12)
        .map((p) => p.name)
    : [];
  // Visits to a place and everything in it: the mall is usual when the food court is.
  const visits = new Map<string, number>();
  const all = (p: Place) => visits.get(p.id) ?? visits.set(p.id, p.visits + book.under(p, 4).reduce((t, x) => t + x.visits, 0)).get(p.id)!;
  const usual = town
    ? book
        .under(town, 2)
        .filter((p) => p.id !== building?.id && ["building", "home", "street", "outdoors", "district"].includes(p.kind ?? "") && all(p) > 0)
        // An area ("hills") only when nothing in it is a building of its own: the buildings say where it is.
        .filter((p) => isBuilding(p.kind) || !book.under(p, 1).some((x) => isBuilding(x.kind)))
        .sort((a, b) => all(b) - all(a) || b.lastSeq - a.lastSeq)
        .slice(0, o.usual ?? 8)
        .map((p) => book.path(p).slice(1).join(" › "))
    : [];
  const shown = new Set([...(building ? [building.id, ...book.under(building, 1).map((p) => p.id)] : [])]);
  const recent = book
    .all()
    .filter((p) => p.visits > 0 && p.id !== here?.id && !shown.has(p.id))
    .sort((a, b) => b.lastSeq - a.lastSeq)
    // One for each building: the room last visited in it.
    .filter((p, i, xs) => {
      const b = book.buildingOf(p)?.id;
      return !b || xs.findIndex((x) => book.buildingOf(x)?.id === b) === i;
    })
    .slice(0, o.recent ?? 5)
    .map((p) => book.path(p).join(" › "));
  return { ...(building ? { here: book.path(building).join(" › ") } : {}), rooms, ...(town ? { town: town.name } : {}), usual, recent };
}

/** The tracker's line for known places, or null when the story has none yet. */
export function knownPlacesLine(st: WorldState): string | null {
  const k = knownPlaces(st);
  const bits: string[] = [];
  if (k.here && k.rooms.length) bits.push(`${k.here}: ${k.rooms.join(", ")}`);
  if (k.town && k.usual.length) bits.push(`in ${k.town}: ${k.usual.join(", ")}`);
  if (k.recent.length) bits.push(`lately: ${k.recent.join("; ")}`);
  return bits.length ? `known places (write places by these names; add a new part only for a new place): ${bits.join(" · ")}` : null;
}
