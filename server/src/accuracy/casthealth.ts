import { groupKey } from "../trackers/groups";
import { PlaceBook, placeKey } from "../trackers/places";
import type { WorldState } from "../trackers/types";
import { FIELD_WORD, isGroupShape, looksLikePlace } from "../trackers/whois";

/**
 * docs/30 4.2: two rows of Story health about the cast and the places. "Not people" counts cast
 * entries the fold's routing (0.2) would now send somewhere else: a group, a faction, a place, a field
 * name. It should stay at 0; anything else is a new pattern. "Places with several names" counts rooms
 * that drifted inside one building: two places of the same name under different parts of one house.
 */

export interface NotPeopleRow {
  name: string;
  as: "group" | "faction" | "place" | "field";
}

/** Cast entries that aren't people, by the fold's own tests, unless you said they are. */
export function notPeopleNow(st: WorldState, o: { factions?: string[]; people?: string[] } = {}): NotPeopleRow[] {
  const yours = new Set((o.people ?? []).map((n) => n.trim().toLowerCase()));
  const factions = new Set([...(o.factions ?? []), ...Object.values(st.groups ?? {}).filter((g) => g.adopted).flatMap((g) => [g.name, ...(g.aliases ?? [])])].map(groupKey));
  const places = new Set(Object.values(st.places).flatMap((p) => [p.name, ...(p.aliases ?? [])]).map(placeKey));
  const out: NotPeopleRow[] = [];
  for (const c of Object.values(st.chars)) {
    if (c.isUser || c.isMain || yours.has(c.name.trim().toLowerCase())) continue;
    const n = c.name.trim();
    if (FIELD_WORD.test(n)) out.push({ name: n, as: "field" });
    else if (factions.has(groupKey(n))) out.push({ name: n, as: "faction" });
    else if (isGroupShape(n)) out.push({ name: n, as: "group" });
    else if (places.has(placeKey(n)) || looksLikePlace(n)) out.push({ name: n, as: "place" });
  }
  return out;
}

/** docs/32 4.3: names Mea read as someone else (or nobody) that you haven't looked at yet. */
export function rereadNow(st: WorldState, seen: string[] = []): { name: string; as: string | null }[] {
  const ok = new Set(seen.map((n) => n.trim().toLowerCase()));
  return Object.values(st.reread ?? {})
    .filter((n) => !ok.has(n.name.toLowerCase()))
    .map((n) => ({ name: n.name, as: n.as }));
}

export interface DriftRow {
  building: string;
  /** A name written for two places or more in it, and how many. */
  names: { name: string; count: number; paths: string[] }[];
}

/** Rooms of one building that share a name: the same kitchen made twice under different parts of the house. */
export function placesWithSeveralNames(st: WorldState): DriftRow[] {
  const book = new PlaceBook(st);
  const out: DriftRow[] = [];
  for (const b of book.all().filter((p) => p.kind === "home" || p.kind === "building")) {
    // Only this building's own rooms: a house inside it (a guest house) counts for itself.
    const inside = book.under(b, 6).filter((x) => book.buildingOf(x)?.id === b.id && x.kind !== "spot");
    const by = new Map<string, typeof inside>();
    for (const x of inside) by.set(placeKey(x.name), [...(by.get(placeKey(x.name)) ?? []), x]);
    const names = [...by.values()].filter((xs) => xs.length > 1).map((xs) => ({ name: xs[0]!.name, count: xs.length, paths: xs.map((x) => book.path(x).slice(book.path(b).length).join(" › ")) }));
    if (names.length) out.push({ building: b.name, names });
  }
  return out.sort((a, b) => b.names.length - a.names.length);
}
