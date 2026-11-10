import { all } from "../db/db";
import { kindOf, PlaceBook } from "../trackers/places";
import type { Place, WorldState } from "../trackers/types";
import { isCrowdShape, isGroupShape, NOT_A_NAME, orgKind, FIELD_WORD } from "../trackers/whois";

/**
 * docs/33 Part 11: what the cast sync does with a name before it becomes a page. The tracker's own
 * cast was tidied by docs/30 and docs/32; what was left came from memories and scene records, which
 * name whatever a sentence mentions. In one story that made people of Sunnydale High, Winters
 * Holdings, Powell (a street), Li Shang and Mulan (a film), Tennyson, "unchanged" and "Co.", kept
 * "Gabriel's father" apart from Jonathan, and 455 places for about forty real ones.
 */

const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export type NotPerson = "group" | "place" | "concept" | "drop" | null;

/**
 * A name a memory or a scene record gave as a person that isn't one, by its shape and by what the
 * story already knows: a ledger word, an organisation, a school, a crowd, a known group, or the
 * first word of a street the story has ("Powell" of Powell Street).
 */
export function notPersonName(name: string, known: { places: string[]; groups: string[] }): NotPerson {
  const n = name.replace(/\s+/g, " ").trim();
  if (FIELD_WORD.test(n) || NOT_A_NAME.test(n) || /^\p{Ll}+$/u.test(n) && !/^(?:mom|dad|mum|grandma|grandpa)$/.test(n)) return "drop";
  const org = orgKind(n);
  if (org) return org;
  if (isGroupShape(n) || isCrowdShape(n)) return "group";
  const k = key(n).replace(/^the /, "");
  if (known.groups.some((g) => key(g).replace(/^the /, "") === k)) return "group";
  for (const p of known.places) {
    const pk = key(p);
    if (pk === k) return "place";
    // One word, and a street or a building of the story starts with it.
    if (!k.includes(" ") && pk.startsWith(`${k} `) && ["street", "building", "outdoors"].includes(kindOf(p))) return "place";
  }
  return null;
}

const MEDIA = /\b(?:movies?|films?|cartoons?|disney|dvds?|vhs|shortlist|poems?|poets?|poetry|novels?|songs?|albums?|lyrics?|episodes?|sitcoms?|musicals?|soundtrack|playlist|video ?games?|rom-?coms?)\b/i;

/**
 * Someone the story only talks about as part of a film, a book or a poem (Mulan, Tennyson): at
 * least half the few live memories that name them are about one (one of up to three), or name someone already found to be
 * (`also`: Li Shang, who is only ever mentioned with Mulan). A reference, not a person who could
 * walk in. Never said of someone the trackers have had in a scene.
 */
export function mediaOnly(chatId: string, name: string, also: string[] = []): boolean {
  const rows = all<{ content: string }>(
    `SELECT m.content FROM memories_fts f JOIN memories m ON m.id = f.id
     WHERE memories_fts MATCH ? AND f.chat_id = ? AND m.deleted_at IS NULL AND m.status != 'superseded' LIMIT 12`,
    `"${name.replaceAll('"', "")}"`,
    chatId,
  );
  const others = also.filter((n) => n !== name).map((n) => new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "iu"));
  const about = rows.filter((r) => MEDIA.test(r.content) || others.some((re) => re.test(r.content))).length;
  // Only someone the story barely mentions: Joyce's album doesn't make Joyce a song.
  return rows.length > 0 && rows.length <= MEDIA_MAX && about > 0 && (about * 2 >= rows.length || rows.length <= 3);
}

/** More memories than this, and they are somebody. */
const MEDIA_MAX = 6;

const KIN: Record<string, string[]> = {
  mother: ["mother", "mom", "mum", "mama", "mommy"],
  father: ["father", "dad", "papa", "daddy"],
  grandfather: ["grandfather", "grandpa", "granddad"],
  grandmother: ["grandmother", "grandma", "gran", "nana"],
  sister: ["sister", "sis"],
  brother: ["brother", "bro"],
  uncle: ["uncle"],
  aunt: ["aunt", "auntie"],
  cousin: ["cousin"],
  wife: ["wife"],
  husband: ["husband"],
  son: ["son"],
  daughter: ["daughter"],
  nanny: ["nanny"],
  watcher: ["watcher"],
  boss: ["boss"],
};
const KIN_OF = new Map(Object.entries(KIN).flatMap(([k, ws]) => ws.map((w) => [w, k] as const)));

/**
 * The names a role stands for: "Gabriel's mother, Jonathan's wife" → "gabriel mother", "gabriel mom",
 * "gabriel mum", "jonathan wife"… (keyed as the cast keys names, possessives folded). Only roles of
 * the shape "<Someone>'s <kin word>": "the heir apparent" names nobody.
 */
export function roleKeys(role: string): string[] {
  const out: string[] = [];
  for (const part of role.split(/\s*[,;]\s*|\s+and\s+/)) {
    const m = part.trim().match(/^([\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*)?)['’]s?\s+(?:younger |older |little |big |late |step)?(\p{L}+)$/u);
    const kin = m && KIN_OF.get(m[2]!.toLowerCase());
    if (!m || !kin) continue;
    const who = key(m[1]!);
    for (const w of KIN[kin]!) out.push(`${who} ${w}`, `${who.split(" ")[0]} ${w}`);
  }
  return [...new Set(out)];
}

/** A place a scene record or a memory wrote, read against the tracker's own places. */
export type PlaceAs = { place: Place } | { name: string } | null;

const INSIDE = new Set(["room", "spot", "floor", "vehicle"]);
const TAIL = /\s*(?:—|–| - |:|;)\s*.*$/;
const FLOOR_WORD = /\b(?:upstairs|downstairs|up the stairs)\b/gi;

/**
 * "Summers kitchen, 1630 Revello Drive", "Kitchen of the hills house", "Gabriel's kitchen (darkening)",
 * "1630 Revello Drive — hallway and stairs": the tracker place it means, when the tracker has it; a
 * cleaned name when it's somewhere the tracker never was; null for what isn't a place of its own
 * (a seat, a counter, "hallway" with no house, a trip). Never read by where the scene is now: a
 * scene record's "front porch" is its own scene's porch, which this can't know.
 */
export function placeAs(book: PlaceBook, st: WorldState, written: string): PlaceAs {
  const bare = written.replace(/[“”"]/g, "").replace(/\s*\([^)]*\)?/g, " ").replace(/\s+/g, " ").trim();
  if (!bare || /→|->|=>/.test(bare) || /^(?:moving|driving|heading|walking|beside|near|toward|towards|on the way|en route)\b/i.test(bare) || /\b(?:en route|drive to|on the way) /i.test(bare)) return null;
  const tries: string[][] = [];
  const add = (...parts: string[]) => {
    const p = parts.map((x) => x.replace(FLOOR_WORD, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
    if (p.length) tries.push(p);
  };
  // "<room>, <building>" and "<building> — <room>": both ways round.
  const two = bare.split(/\s*(?:,|—|–| - )\s*/).filter(Boolean);
  if (two.length >= 2) {
    add(two[1]!, two[0]!);
    add(two[0]!, two[1]!);
  }
  const head = bare.replace(TAIL, "").split(",")[0]!.replace(FLOOR_WORD, " ").replace(/\s+/g, " ").trim();
  if (!head) return null;
  const of = head.match(/^(.+?)\s+(?:of|in|at|inside)\s+(?:the\s+)?(.+)$/i);
  if (of) add(of[2]!, of[1]!);
  // "<Owner>'s <room>": the room in their home. "<Owner>'s … house": their home.
  const poss = head.match(/^(.+?)(?:'s|s'|')\s+(.+)$/);
  if (poss) {
    const home = homeOf(book, st, poss[1]!);
    if (home && /\b(?:house|home|place|residence)\b/i.test(poss[2]!) && !INSIDE.has(kindOf(poss[2]!))) return { place: home };
    const room = home && INSIDE.has(kindOf(poss[2]!)) ? book.resolve([...book.path(home), poss[2]!], { create: false }) : undefined;
    if (room) return { place: room.place };
  }
  // "<Building> <room>": every tail that is a room, the shortest first ("Revello Drive" + "kitchen").
  const words = head.split(" ");
  for (let i = words.length - 1; i >= 1; i--) {
    const room = words.slice(i).join(" ");
    const building = words.slice(0, i).join(" ");
    if (INSIDE.has(kindOf(room)) && !INSIDE.has(kindOf(building))) add(building, room);
  }
  for (const parts of tries) {
    if (parts.length < 2) continue;
    const building = homeBy(book, parts[0]!) ?? only(book, parts[0]!);
    const r = building ? book.resolve([...book.path(building), ...parts.slice(1)], { create: false }) : undefined;
    if (r) return { place: r.place };
  }
  const alone = homeBy(book, head) ?? only(book, head) ?? only(book, head.replace(new RegExp(`^${townOf(book)}\\s+`, "i"), ""));
  if (alone) return { place: alone };
  // "Zapatos Dorothea shoe store": a place the story has, with what it is said after it.
  for (let i = words.length - 1; i >= 2; i--) {
    const known = only(book, words.slice(0, i).join(" "));
    if (known && kindOf(words.slice(i).join(" ")) !== "district") return { place: known };
  }
  const k = kindOf(head);
  // A seat, a counter or a bare "hallway" is somewhere inside a place, not one of its own.
  if (k === "spot" || k === "floor" || (INSIDE.has(k) && !/['’]s?\s/.test(head) && !/\p{Lu}/u.test(head.replace(/^\p{Lu}/u, "")))) return null;
  if (same(book, head) > 1) return null;
  return { name: head };
}

const townOf = (book: PlaceBook) => (book.all().find((p) => p.kind === "town")?.name ?? "\u0000").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const same = (book: PlaceBook, written: string) => book.all().filter((p) => book.names(p).some((n) => key(n).replace(/^the /, "") === key(written).replace(/^the /, ""))).length;
/** The one place of that name anywhere in the story, if there is exactly one. */
function only(book: PlaceBook, written: string): Place | undefined {
  const k = key(written).replace(/^the /, "");
  if (!k) return undefined;
  const hits = book.all().filter((p) => book.names(p).some((n) => key(n).replace(/^the /, "") === k));
  return hits.length === 1 ? hits[0] : undefined;
}

/** Homes that are houses, not a room filed as one. */
const houses = (book: PlaceBook) => book.all().filter((p) => p.kind === "home" && !book.chainOf(p).some((a) => a.id !== p.id && a.kind === "home") && key(p.name) !== "home");

/** Where someone lives: the one house they own or live in. */
function homeOf(book: PlaceBook, st: WorldState, who: string): Place | undefined {
  const w = key(who);
  const c = Object.values(st.chars).find((x) => [x.name, x.name.split(/\s+/)[0]!, ...x.aliases].some((n) => key(n) === w));
  if (!c) return undefined;
  const theirs = houses(book).filter((p) => p.owner === c.id || (p.residents ?? []).includes(c.id) || book.names(p).some((n) => key(n).startsWith(`${key(c.name.split(/\s+/)[0]!)} `) && /'s?\s/.test(n)));
  return theirs.length === 1 ? theirs[0] : undefined;
}

/**
 * A home by what people call it: "the hills house" is the one house under "hills"; "1630 Revello
 * Drive" is the house at that address; "Summers" is the one house whose name starts with it.
 */
function homeBy(book: PlaceBook, written: string): Place | undefined {
  const w = key(written).replace(/^the /, "");
  if (!w) return undefined;
  const homes = houses(book);
  const street = w.replace(/^\d+\s+/, "");
  const byAddress = homes.filter((p) => p.address && key(p.address) === street);
  if (byAddress.length === 1) return byAddress[0];
  const family = homes.filter((p) => key(p.name).split(" ")[0] === w.replace(/ (?:house|home|place|residence)$/, ""));
  if (family.length === 1) return family[0];
  const m = w.match(/^(.+?) (?:house|home|place|residence)(?: in the (.+))?$/);
  const area = m?.[2] ?? m?.[1];
  if (!area) return undefined;
  const inArea = homes.filter((p) => book.chainOf(p).some((a) => a.id !== p.id && key(a.name) === area.split(" ").at(-1)));
  return inArea.length === 1 ? inArea[0] : undefined;
}
