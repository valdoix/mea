import { mustChat } from "../services/chats";
import { currentNotes, PlaceBook, placeKey } from "../trackers/places";
import { itemsAt } from "../trackers/belongings";
import type { Place, WorldState } from "../trackers/types";
import { categoryOf, loreTitle } from "./format";
import { scanEntriesFor } from "./service";
import { createDraft, mutate } from "./studio";

/**
 * docs/30 2.7: the story's places and the lore's location entries. An entry is a place's when its title
 * names the place (or one of its other names), or, for a building, a town or an area, when one of its
 * keys does: a "kitchen" key isn't every kitchen. A place visited often with no entry gets an offer to
 * write one in the Lore Studio, never written by itself.
 */

export interface PlaceLore {
  bookId: string;
  bookName: string;
  entryId: string;
  title: string;
}

/** Visits to a place and to everything in it, at which a place with no entry offers one. */
export const OFFER_AT = 5;

const TAG = /^(?:locations?|places?|setting|area|building|town|city)\s*:\s*/i;
const BIG = new Set(["town", "district", "building", "home", "street", "outdoors"]);

/** The location entries in this chat's lore, by the names they go by. */
function locationEntries(chatId: string) {
  const chat = mustChat(chatId);
  return scanEntriesFor({ characterId: chat.character_id, personaId: chat.persona_id, chatId })
    .filter((e) => e.enabled && (categoryOf(e) === "location" || TAG.test(loreTitle(e))))
    .map((e) => ({ bookId: e.bookId, bookName: e.bookName, entryId: e.id, title: loreTitle(e), name: placeKey(loreTitle(e).replace(TAG, "")), keys: e.keys.map(placeKey) }));
}

/** Each place's lore entry, when it has one (place id → entry). */
export function placeLore(chatId: string, st: WorldState): Map<string, PlaceLore> {
  return matchLore(st, locationEntries(chatId));
}

/** The matching itself, over entries already read (title names, and keys for a big place). */
export function matchLore(st: WorldState, entries: { bookId: string; bookName: string; entryId: string; title: string; name: string; keys: string[] }[]): Map<string, PlaceLore> {
  const out = new Map<string, PlaceLore>();
  if (!entries.length) return out;
  const book = new PlaceBook(st);
  for (const p of book.all()) {
    const names = book.names(p).map(placeKey);
    const hit = entries.find((e) => names.includes(e.name)) ?? (BIG.has(p.kind ?? "") ? entries.find((e) => e.keys.some((k) => names.includes(k))) : undefined);
    if (hit) out.set(p.id, { bookId: hit.bookId, bookName: hit.bookName, entryId: hit.entryId, title: hit.title });
  }
  // A title the tree takes for a building by its own rules ("The Winters House" for the Winters Residence, a typo of a town).
  for (const e of entries) {
    if ([...out.values()].some((x) => x.entryId === e.entryId)) continue;
    const p = book.resolve([e.title.replace(TAG, "").replace(/^the\s+/i, "")], { create: false })?.place;
    if (p && BIG.has(p.kind ?? "") && !out.has(p.id)) out.set(p.id, { bookId: e.bookId, bookName: e.bookName, entryId: e.entryId, title: e.title });
  }
  return out;
}

/** Visits to a place and to everything in it. */
export function visitsWithin(book: PlaceBook, p: Place) {
  return p.visits + book.under(p, 6).reduce((n, x) => n + x.visits, 0);
}

/**
 * docs/30 2.7: a Lore Studio draft with one location entry planned for this place, from what the story
 * knows of it (its path, other names, who lives there, what it looks like, what's kept there). It opens
 * at the plan: nothing is written until you write it there.
 */
export function placeEntryDraft(chatId: string, st: WorldState, placeId: string) {
  const book = new PlaceBook(st);
  const p = book.get(placeId);
  if (!p) return null;
  const nameOf = (id: string) => st.chars[id]?.name ?? id;
  const facts = [
    `Where: ${book.path(p).join(" › ")}${p.address ? ` (on ${p.address})` : ""}`,
    p.aliases?.length ? `Also called: ${p.aliases.join(", ")}` : "",
    p.owner ? `Whose: ${nameOf(p.owner)}` : "",
    p.residents?.length ? `Who lives here: ${p.residents.map(nameOf).join(", ")}` : "",
    currentNotes(p).length ? `What it looks like now: ${currentNotes(p).map((n) => n.text).join("; ")}` : "",
    book.under(p, 1).length ? `In it: ${book.under(p, 1).map((x) => x.name).join(", ")}` : "",
    itemsAt(st, p).length ? `Kept here: ${itemsAt(st, p).map((i) => i.name).join(", ")}` : "",
  ].filter(Boolean);
  const title = `Location: ${p.name}`;
  const d = createDraft({ kind: "idea", title, text: facts.join("\n") });
  return mutate(d.id, (cur) => {
    cur.overview = `A location entry for ${p.name}, from the story.`;
    cur.options.overview = false;
    cur.items = [
      {
        id: crypto.randomUUID(),
        title,
        type: "location",
        pitch: facts.join(". "),
        parent: "",
        folder: "",
        source: facts.join("\n"),
        constant: false,
        keep: true,
        status: "planned" as const,
        error: "",
        entry: null,
        previous: null,
        steer: "",
        savedEntryId: null,
        basis: "",
        research: null,
        links: {},
        category: "location",
        action: "write" as const,
        targetEntryId: null,
        versionSource: null,
        about: [],
      },
    ];
    cur.stage = "plan";
    cur.planVersions = [{ n: 1, at: Date.now(), why: `a location entry for ${p.name}, from the story`, items: cur.items.map((i) => ({ id: i.id, title: i.title, category: i.category, pitch: i.pitch, keep: i.keep, action: i.action })) }];
  });
}
