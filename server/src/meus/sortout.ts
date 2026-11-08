import { now, run } from "../db/db";
import { notPeopleNow, placesWithSeveralNames } from "../accuracy/casthealth";
import { factionBook } from "../trackers/factions";
import { currentMembers, groupKey } from "../trackers/groups";
import { PlaceBook, type PlaceProfile, placeKey } from "../trackers/places";
import { castFactions, castKey, type CastFaction, deleteCastFaction, foldConfigFor, invalidate, placeProfiles, saveCastFaction, savePlaceProfile } from "../trackers/store";
import type { GroupKind, Place, WorldState } from "../trackers/types";

/**
 * docs/30 4.3: Meus sorts out the cast's groups and the story's places. Factions (make one, merge two,
 * add or take out a member) and places (merge, move under, rename, "not a place"), each as a change on
 * the card that Undo takes back. Pure checks here; changes.ts proposes and applies them.
 */

const KINDS: GroupKind[] = ["family", "household", "circle", "organisation", "side"];

export const SORT_OUT_KINDS = [
  '{"kind": "faction", "action": "make", "name": "…", "group_kind": "family|household|circle|organisation|side", "members": ["<cast name>"], "aliases": ["other names"]} makes a faction (or keeps one Mea found as yours); {"kind": "faction", "action": "merge", "from": "<faction>", "into": "<faction>"} two factions that are one group; {"kind": "faction", "action": "member", "name": "<faction>", "add": ["<cast name>"], "remove": ["<cast name>"], "role": "…"} someone joins or leaves;',
  '{"kind": "place", "action": "merge|move|rename|not_place", "id": "<place id or path>", "into": "<place id or path: for merge, the same place; for move, the place it goes under>", "name": "<for rename>"} sorts out the place tree (merge: two places that are one; move: it belongs under another; not_place: a phrase that got into the tree and isn\'t a place).',
].join(" ");

// ---------- the brief ----------

/** The groups and the place tree, for Meus's brief: what "sort out the cast and places" works from. */
export function groupsAndPlacesBrief(chatId: string, st: WorldState): string {
  const L: string[] = [];
  const book = factionBook(chatId, { st });
  if (book.factions.length || book.suggested.length) {
    L.push("FACTIONS (name · kind · whose · members):");
    for (const f of book.factions.slice(0, 30))
      L.push(`- ${f.name}${f.aliases.length ? ` (also: ${f.aliases.slice(0, 4).join(", ")})` : ""} · ${f.kind} · ${f.found ? `found in the ${f.source}` : "yours"} · ${f.members.filter((m) => m.left == null).map((m) => m.name).join(", ") || "no members known"}`);
    for (const g of book.suggested.slice(0, 8)) L.push(`- (Mea thinks this is a group, not a faction yet) ${g.name} · ${g.kind} · ${g.members.join(", ") || "nobody named"}`);
  }
  const pb = new PlaceBook(st);
  const shown = pb
    .all()
    .filter((p) => p.kind !== "spot" && p.kind !== "vehicle")
    .sort((a, b) => b.lastSeq - a.lastSeq)
    .slice(0, 60);
  if (shown.length) {
    L.push("PLACES (path [id] · kind · also called · lives here):");
    for (const p of shown.sort((a, b) => pb.path(a).join(" › ").localeCompare(pb.path(b).join(" › "))))
      L.push(`- ${pb.path(p).join(" › ")} [${p.id}] · ${p.kind ?? "?"}${p.aliases?.length ? ` · also ${p.aliases.slice(0, 4).join(", ")}` : ""}${p.residents?.length ? ` · lives here: ${p.residents.map((id) => st.chars[id]?.name ?? id).join(", ")}` : ""}`);
  }
  const fc = foldConfigFor(chatId);
  const notPeople = notPeopleNow(st, { factions: (fc.factions ?? []).flatMap((f) => [f.name, ...(f.aliases ?? [])]), people: fc.people });
  const drift = placesWithSeveralNames(st);
  if (notPeople.length || drift.length) {
    L.push("STORY HEALTH SAYS:");
    for (const x of notPeople) L.push(`- ${x.name} is in the cast but reads as ${x.as === "field" ? "a field name" : `a ${x.as}`}`);
    for (const d of drift) for (const x of d.names) L.push(`- ${d.building} has ${x.name} more than once: ${x.paths.join(" / ")}`);
  }
  return L.join("\n");
}

// ---------- factions ----------

export interface FactionPlan {
  action: "make" | "merge";
  /** The row this writes (an existing one's id, or null for a new one), and what it holds after. */
  id: string | null;
  next: Omit<CastFaction, "id">;
  /** For merge: the row of the faction folded in, which goes (null when it had none). */
  dropId?: string | null;
}

const findFaction = (chatId: string, st: WorldState, name: string) => {
  const k = groupKey(name);
  return factionBook(chatId, { st }).factions.find((f) => groupKey(f.name) === k || f.aliases.some((a) => groupKey(a) === k));
};

/** A faction to make (or Mea's found one to keep as yours, with these members). */
export function planMake(chatId: string, st: WorldState, o: { name: string; kind?: string; members: string[]; aliases: string[] }): FactionPlan | string {
  const name = o.name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) return "a faction needs a name";
  if (Object.values(st.chars).some((c) => castKey(c.name) === castKey(name))) return `${name} is a person in the cast`;
  const people = new Map(Object.values(st.chars).map((c) => [castKey(c.name), c.name]));
  const members = o.members.map((m) => people.get(castKey(m))).filter((m): m is string => Boolean(m));
  if (o.members.length && !members.length) return "none of those members are in the cast";
  const found = findFaction(chatId, st, name);
  const row = found?.id ? castFactions(chatId).find((f) => f.id === found.id) : undefined;
  const kind = KINDS.includes(o.kind as GroupKind) ? (o.kind as GroupKind) : (row?.kind ?? found?.kind);
  const had = row?.members ?? (found?.members ?? []).filter((m) => m.left == null).map((m) => ({ name: m.name, ...(m.role ? { role: m.role } : {}) }));
  const all = [...had, ...members.filter((m) => !had.some((h) => castKey(h.name) === castKey(m))).map((m) => ({ name: m }))];
  const aliases = [...new Set([...(row?.aliases ?? found?.aliases ?? []), ...o.aliases.map((a) => a.trim()).filter((a) => a && groupKey(a) !== groupKey(name))])];
  return { action: "make", id: row?.id ?? null, next: { name: row?.name ?? found?.name ?? name, members: all, ...(aliases.length ? { aliases } : {}), ...(kind ? { kind } : {}), ...(row?.description ? { description: row.description } : {}), ...(row?.color ? { color: row.color } : {}), source: row?.source ?? (found && found.source !== "you" ? found.source : "you") } };
}

/** Two factions that are one group: `from`'s names and members go to `into`, and `from`'s own row goes. */
export function planMerge(chatId: string, st: WorldState, from: string, into: string): FactionPlan | string {
  const a = findFaction(chatId, st, from);
  const b = findFaction(chatId, st, into);
  if (!a) return `there's no faction called ${from}`;
  if (!b) return `there's no faction called ${into}`;
  if (a.key === b.key) return `${from} and ${into} are already one faction`;
  const rows = castFactions(chatId);
  const rb = b.id ? rows.find((f) => f.id === b.id) : undefined;
  const members = [...(rb?.members ?? b.members.filter((m) => m.left == null).map((m) => ({ name: m.name, ...(m.role ? { role: m.role } : {}) })))];
  for (const m of a.members.filter((x) => x.left == null)) if (!members.some((x) => castKey(x.name) === castKey(m.name))) members.push({ name: m.name, ...(m.role ? { role: m.role } : {}) });
  const aliases = [...new Set([...(rb?.aliases ?? b.aliases), a.name, ...a.aliases].filter((n) => groupKey(n) !== groupKey(b.name)))];
  return { action: "merge", id: rb?.id ?? null, dropId: a.id, next: { name: b.name, members, aliases, ...(rb?.kind ?? b.kind ? { kind: rb?.kind ?? b.kind } : {}), ...(rb?.description ? { description: rb.description } : {}), ...(rb?.color ? { color: rb.color } : {}), source: rb?.source ?? (b.source === "you" ? "you" : b.source) } };
}

/** The member lines for someone joining or leaving (ledger lines, so Undo and rewinds take them back). */
export function memberLines(chatId: string, st: WorldState, o: { name: string; add: string[]; remove: string[]; role?: string; why?: string }): string[] | string {
  const f = findFaction(chatId, st, o.name);
  const group = f?.name ?? Object.values(st.groups ?? {}).find((g) => groupKey(g.name) === groupKey(o.name))?.name;
  if (!group) return `there's no faction called ${o.name}`;
  const people = new Map(Object.values(st.chars).map((c) => [castKey(c.name), c.name]));
  const now = new Set((f?.members ?? []).filter((m) => m.left == null).map((m) => castKey(m.name)));
  const g = Object.values(st.groups ?? {}).find((x) => groupKey(x.name) === groupKey(group));
  if (g) for (const m of currentMembers(g)) now.add(castKey(m.name));
  const why = o.why ? ` — ${o.why}` : "";
  const lines: string[] = [];
  for (const n of o.add) {
    const who = people.get(castKey(n));
    if (who && !now.has(castKey(who))) lines.push(`member ${group}: + ${who}${o.role ? ` | ${o.role}` : ""}${why}`);
  }
  for (const n of o.remove) {
    const who = people.get(castKey(n));
    if (who && now.has(castKey(who))) lines.push(`member ${group}: - ${who}${why}`);
  }
  return lines.length ? lines : "nobody to add or take out";
}

/** Writes a faction plan; returns what puts it back. */
export function applyFactionPlan(chatId: string, p: FactionPlan): { id: string; row: CastFaction | null }[] {
  const rows = castFactions(chatId);
  const undo: { id: string; row: CastFaction | null }[] = [];
  const prev = p.id ? (rows.find((f) => f.id === p.id) ?? null) : null;
  const saved = saveCastFaction(chatId, p.id, p.next);
  undo.push({ id: saved.id, row: prev });
  if (p.dropId) {
    const gone = rows.find((f) => f.id === p.dropId) ?? null;
    if (gone) {
      deleteCastFaction(chatId, gone.id);
      undo.push({ id: gone.id, row: gone });
    }
  }
  return undo;
}

/** Puts a faction row back as it was (or takes it out, when there wasn't one). */
export function restoreFaction(chatId: string, id: string, row: CastFaction | null) {
  if (!row) return deleteCastFaction(chatId, id);
  const { id: _, name, ...data } = row;
  // The same id back, so the person sheet's toggles still point at it.
  run(
    "INSERT INTO cast_factions (id, chat_id, name, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at",
    id,
    chatId,
    name,
    JSON.stringify(data),
    now(),
  );
  invalidate(chatId);
}

// ---------- places ----------

export interface PlacePlan {
  placeId: string;
  patch: PlaceProfile;
  label: string;
  before: string;
  after: string;
}

/** A place by its id, or by a path the tree knows. */
export function findPlace(st: WorldState, ref: string): Place | undefined {
  const book = new PlaceBook(st);
  if (st.places[ref]) return st.places[ref];
  const hit = book.resolve(ref, { create: false })?.place;
  if (hit) return hit;
  const k = placeKey(ref);
  const named = book.all().filter((p) => book.names(p).some((n) => placeKey(n) === k));
  return named.length === 1 ? named[0] : undefined;
}

export function planPlace(chatId: string, st: WorldState, o: { action: string; id: string; into?: string; name?: string }): PlacePlan | string {
  const book = new PlaceBook(st);
  const p = findPlace(st, o.id);
  if (!p) return `there's no place ${o.id}`;
  const path = book.path(p).join(" › ");
  const prof = placeProfiles(chatId)[p.id] ?? {};
  if (o.action === "rename") {
    const name = (o.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!name || name === p.name) return "a rename needs a new name";
    return { placeId: p.id, patch: { name, aliases: [...new Set([...(prof.aliases ?? []), p.name])] }, label: `Place · rename ${p.name}`, before: path, after: [...book.path(p).slice(0, -1), name].join(" › ") };
  }
  if (o.action === "not_place") return { placeId: p.id, patch: { notPlace: true, name: p.name }, label: `Place · ${p.name} isn't a place`, before: path, after: `${book.path(p).slice(0, -1).join(" › ") || "(the top)"}, without ${p.name}` };
  const to = o.into ? findPlace(st, o.into) : undefined;
  if (!to) return `there's no place ${o.into ?? ""}`;
  if (to.id === p.id) return "that's the same place";
  if (o.action === "merge") {
    if (book.isUnder(to, p)) return `${to.name} is inside ${p.name}: move it instead`;
    return { placeId: p.id, patch: { into: to.id }, label: `Place · ${p.name} is ${to.name}`, before: path, after: book.path(to).join(" › ") };
  }
  if (o.action === "move") {
    if (book.isUnder(to, p)) return `${to.name} is inside ${p.name}`;
    return { placeId: p.id, patch: { parent: to.id }, label: `Place · move ${p.name} under ${to.name}`, before: path, after: [...book.path(to), p.name].join(" › ") };
  }
  return `places can be merged, moved, renamed or marked not a place, not "${o.action}"`;
}

/** Writes a place plan; returns the profile it replaced (null when there was none). */
export function applyPlacePlan(chatId: string, p: PlacePlan): PlaceProfile | null {
  const prev = placeProfiles(chatId)[p.placeId] ?? null;
  savePlaceProfile(chatId, p.placeId, p.patch);
  return prev;
}

/** Puts a place's edits back exactly as they were. */
export function restorePlace(chatId: string, placeId: string, prev: PlaceProfile | null) {
  run("DELETE FROM place_profiles WHERE chat_id = ? AND place_id = ?", chatId, placeId);
  // An empty edit writes nothing, and still tells the fold the place changed.
  savePlaceProfile(chatId, placeId, prev ?? {});
}
