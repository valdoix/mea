import type { Character, Item, Place, WorldState } from "./types";

/**
 * Belongings and rooms (Almanac plan E2): places have owners and kinds, people have rooms, and
 * things live somewhere. Pure helpers over the folded state: the fold, the note and the routes
 * all read them.
 */

const low = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const last = (s: string) => low(s.split(/\s*(?:›|>|»|\/)\s*/).at(-1) ?? s);

/** What's at a place: items whose holder names it (in full, or by its last part). */
export function itemsAt(st: WorldState, p: Place): Item[] {
  const name = low(p.name);
  const full = low(p.path.join(" › "));
  return Object.values(st.items).filter((i) => !i.gone && i.holder?.startsWith("place:") && (last(i.holder.slice(6)) === name || low(i.holder.slice(6)) === full));
}

/** The known place the story is in now (the same place written in full or by its last part). */
export function placeNow(st: WorldState): Place | undefined {
  if (!st.place.length) return undefined;
  const full = low(st.place.join(" › "));
  const all = Object.values(st.places);
  return all.find((p) => low(p.path.join(" › ")) === full) ?? all.find((p) => p.owner && low(p.name) === low(st.place.at(-1)!));
}

/** "Since you were last here": what came and went, against what was here when you left. */
export function changedSince(st: WorldState, p: Place): { came: Item[]; went: Item[] } {
  if (!p.seen) return { came: [], went: [] };
  const now = itemsAt(st, p);
  const seen = new Set(p.seen);
  return { came: now.filter((i) => !seen.has(i.id)), went: p.seen.map((id) => st.items[id]).filter((i): i is Item => Boolean(i) && !now.includes(i!)) };
}

/** The note's line for the room the scene is in, when it's someone's. */
export function roomLine(st: WorldState, nameOf: (id: string) => string): string | null {
  const p = placeNow(st);
  if (!p?.owner) return null;
  const owner = st.chars[p.owner];
  if (!owner) return null;
  const here = itemsAt(st, p);
  const mine = here.filter((i) => i.owner === p.owner).map((i) => i.name);
  const { came, went } = changedSince(st, p);
  const bits = [`${nameOf(p.owner)}'s ${p.kind ?? "room"}`];
  if (mine.length) bits.push(`${owner.isUser ? "they keep" : `${owner.name} keeps`} here: ${mine.slice(0, 6).join(", ")}`);
  const diff = [...came.map((i) => `new: ${i.name}`), ...went.map((i) => `gone: ${i.name}`)];
  if (diff.length) bits.push(`since last time: ${diff.slice(0, 4).join(", ")}`);
  return `ROOM: ${bits.join(" · ")}`;
}

/** Gifts lost recently, when the giver is in the scene: they'd notice. */
export function lostGiftLines(st: WorldState, seq: number, nameOf: (id: string) => string): string[] {
  const here = new Set(Object.values(st.chars).filter((c) => c.tier === "spot" || c.tier === "peri").map((c) => c.name.toLowerCase()));
  return Object.values(st.items)
    .filter((i) => i.lostGift != null && seq - i.lostGift <= 60 && i.gift && here.has(i.gift.toLowerCase()) && i.owner)
    .map((i) => `${i.gift} gave ${nameOf(i.owner!)} ${i.name}; it's gone now, and ${i.gift} may notice`);
}

/** One person's rooms and belongings, with each item's history (the Story page). */
export function belongingsOf(st: WorldState, c: Character) {
  const nameOf = (id?: string) => (!id ? "" : id.startsWith("place:") ? id.slice(6) : (st.chars[id]?.name ?? id));
  const rooms = Object.values(st.places)
    .filter((p) => p.owner === c.id)
    .map((p) => ({ id: p.id, name: p.name, path: p.path.join(" › "), kind: p.kind ?? "room", items: itemsAt(st, p).map((i) => i.name) }));
  const items = Object.values(st.items)
    .filter((i) => i.owner === c.id || i.holder === c.id)
    .map((i) => ({
      id: i.id,
      name: i.name,
      mine: i.owner === c.id,
      holder: nameOf(i.holder),
      held: i.holder === c.id,
      gone: Boolean(i.gone),
      gift: i.gift ?? null,
      condition: i.condition ?? null,
      history: i.custody.slice(-12).map((h) => ({ from: nameOf(h.from), to: nameOf(h.to), how: h.how ?? null, seq: h.seq, at: h.at ?? null, time: h.time ?? null })),
    }));
  return { rooms, items };
}
