import { all, newId, now, one, parseJson, run, tx } from "../db/db";
import { badRequest, notFound } from "../lib/http";
import { publish } from "../lib/events";
import type { AtomRow } from "./atoms";
import { castProfiles, currentFold } from "../trackers/store";
import { memState } from "./store";

/**
 * The entity graph (MEM-26): people, places, objects, groups and concepts the story knows,
 * each with aliases (MEM-28), a description, a status, and first/last seen. It is fed from
 * three sources and never loses anything:
 *   - the tracker's world state (people, places, items, factions, bonds over time),
 *   - memory atoms (the entities each one names),
 *   - scene records (participants and locations).
 * Your edits win (MEM-27): fields you changed are never rewritten by a sync.
 */

export type EntityKind = "person" | "place" | "object" | "group" | "concept";
export const ENTITY_KINDS: EntityKind[] = ["person", "place", "object", "group", "concept"];
export type EntityStatus = "active" | "dead" | "missing" | "gone" | "unknown";

export interface EntityRow {
  id: string;
  chat_id: string;
  kind: EntityKind;
  name: string;
  aliases: string;
  description: string;
  status: EntityStatus;
  facts: string;
  data: string;
  first_seq: number | null;
  last_seq: number | null;
  mentions: number;
  user_edited: number;
  merged_into: string | null;
  created_at: number;
  updated_at: number;
}

export interface EntityData {
  isUser?: boolean;
  isMain?: boolean;
  /** Place hierarchy (world › region › city › building). */
  path?: string[];
  holder?: string;
  /** Where the description came from, when it wasn't you. */
  descSource?: "tracker" | "cast" | "lore" | "consolidation";
  /** Aliases you removed: a sync won't add them back. */
  removed?: string[];
  /** Which sources know this entity. */
  sources?: string[];
  /** Fields you edited (description, kind, status, name). */
  locked?: string[];
}

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]s\b/g, "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Titles and articles that don't make a name different ("Captain Mira" is Mira). */
const TITLES = new Set(["the", "a", "an", "old", "young", "lady", "lord", "sir", "dame", "mr", "mrs", "ms", "miss", "dr", "doctor", "captain", "capt", "master", "mistress", "father", "mother", "brother", "sister", "aunt", "uncle", "king", "queen", "prince", "princess"]);
export const core = (s: string) => norm(s).split(" ").filter((w) => !TITLES.has(w)).join(" ");

export function entityOut(r: EntityRow) {
  const data = parseJson<EntityData>(r.data, {});
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    aliases: parseJson<string[]>(r.aliases, []),
    description: r.description,
    status: r.status,
    facts: parseJson<string[]>(r.facts, []),
    firstSeq: r.first_seq,
    lastSeq: r.last_seq,
    mentions: r.mentions,
    userEdited: Boolean(r.user_edited),
    mergedInto: r.merged_into,
    isUser: Boolean(data.isUser),
    isMain: Boolean(data.isMain),
    path: data.path ?? null,
    holder: data.holder ?? null,
    sources: data.sources ?? [],
    descSource: r.user_edited && (data.locked ?? []).includes("description") ? "you" : (data.descSource ?? null),
    updatedAt: r.updated_at,
  };
}
export type EntityOut = ReturnType<typeof entityOut>;

export function getEntityRow(id: string) {
  return one<EntityRow>("SELECT * FROM entities WHERE id = ?", id);
}

function liveRows(chatId: string) {
  return all<EntityRow>("SELECT * FROM entities WHERE chat_id = ? AND merged_into IS NULL ORDER BY mentions DESC, name", chatId);
}

/** Name and alias → entity, for one chat. Merged entities resolve to the one they became. */
export class Resolver {
  private byName = new Map<string, EntityRow>();
  private byCore = new Map<string, EntityRow>();
  readonly rows: EntityRow[];
  constructor(rows: EntityRow[]) {
    this.rows = rows;
    for (const r of rows) {
      for (const n of [r.name, ...parseJson<string[]>(r.aliases, [])]) {
        const k = norm(n);
        if (k && !this.byName.has(k)) this.byName.set(k, r);
        const c = core(n);
        if (c && c.length >= 3 && !this.byCore.has(c)) this.byCore.set(c, r);
      }
    }
  }
  find(name: string): EntityRow | undefined {
    const k = norm(name);
    if (!k) return undefined;
    return this.byName.get(k) ?? this.byCore.get(core(name));
  }
  /** Every name and alias an entity goes by. */
  namesOf(r: EntityRow) {
    return [r.name, ...parseJson<string[]>(r.aliases, [])];
  }
  /** Entities named in a text, longest names first so "Old Tom" wins over "Tom". */
  mentionedIn(text: string, opts: { minLength?: number } = {}) {
    const hay = ` ${norm(text)} `;
    const found = new Map<string, EntityRow>();
    const names = this.rows.flatMap((r) => this.namesOf(r).map((n) => ({ n: norm(n), r }))).filter((x) => x.n.length >= (opts.minLength ?? 3));
    names.sort((a, b) => b.n.length - a.n.length);
    for (const { n, r } of names) if (!found.has(r.id) && hay.includes(` ${n} `)) found.set(r.id, r);
    return [...found.values()];
  }
}

export function resolver(chatId: string) {
  syncEntities(chatId);
  return new Resolver(liveRows(chatId));
}

// ---------- sync ----------

const PLACE_WORDS =
  /\b(street|road|lane|square|harbou?r|port|dock|docks|pier|house|home|inn|tavern|bar|pub|castle|keep|tower|lighthouse|city|town|village|room|hall|chamber|kitchen|cellar|forest|woods|wood|island|isle|shore|beach|cave|cavern|mountain|hill|valley|river|lake|sea|bay|temple|church|chapel|shrine|market|shop|store|school|academy|library|garden|park|bridge|gate|camp|ship|station|hospital|office|palace|manor|farm|mill|cove|cliff|ruins?)\b/i;
const OBJECT_WORDS = /\b(letter|key|locket|ring|sword|blade|knife|book|map|lantern|lamp|lens|box|coin|necklace|amulet|dagger|gun|pistol|bottle|journal|diary|logbook|photo|photograph|note|scroll|crown|cloak|coat|phone|car|boat)\b/i;
const GROUP_WORDS = /\b(guild|order|council|army|crew|gang|clan|house of|family|court|company|church of|brotherhood|sisterhood|syndicate|cult|police|guard|watch)\b/i;

/** A guess at what kind of thing a bare name is. */
export function guessKind(name: string): EntityKind {
  if (GROUP_WORDS.test(name)) return "group";
  if (PLACE_WORDS.test(name)) return "place";
  if (OBJECT_WORDS.test(name)) return "object";
  if (/^[A-Z][\p{L}'’-]+(?: [A-Z][\p{L}'’-]+){0,2}$/u.test(name.trim())) return "person";
  return name.trim().split(/\s+/).length <= 3 && /^the /i.test(name) ? "object" : "concept";
}

interface Seen {
  name: string;
  kind: EntityKind;
  aliases: Set<string>;
  first: number | null;
  last: number | null;
  mentions: number;
  status?: EntityStatus;
  description?: string;
  descSource?: EntityData["descSource"];
  data: EntityData;
  sources: Set<string>;
  /** Strong sources (tracker, scene cast) create an entity on sight; atoms need two mentions. */
  strong: boolean;
}

const synced = new Map<string, string>();

type TrackerState = import("../trackers/types").WorldState;
function trackerStateOf(chatId: string): { state: TrackerState; stamp: string } | null {
  try {
    const f = currentFold(chatId);
    return { state: f.result.state, stamp: f.version };
  } catch {
    return null;
  }
}
function castOf(chatId: string) {
  return Object.fromEntries(Object.values(castProfiles(chatId)).map((p) => [p.name, p as { description?: string }]));
}

/** Brings the entity table up to date with trackers, atoms and scene records. Cheap when nothing changed. */
export function syncEntities(chatId: string, force = false) {
  const tracker = trackerStateOf(chatId);
  const stamp = `${memState(chatId).version}:${tracker?.stamp ?? ""}`;
  if (!force && synced.get(chatId) === stamp) return false;
  synced.set(chatId, stamp);
  if (synced.size > 200) synced.delete(synced.keys().next().value!);

  const seen = new Map<string, Seen>();
  const add = (name: string, kind: EntityKind, o: Partial<Omit<Seen, "aliases" | "sources" | "data">> & { aliases?: string[]; source: string; data?: EntityData; seq?: number | null }) => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (clean.length < 2 || clean.length > 80) return;
    const key = norm(clean);
    if (!key || ["you", "i", "me", "we", "they", "he", "she", "it", "everyone", "nobody", "user", "char"].includes(key)) return;
    let s = seen.get(key);
    // Join an existing record through its aliases ("the stranger" → Kael).
    if (!s) for (const a of o.aliases ?? []) s = s ?? seen.get(norm(a));
    if (!s) {
      s = { name: clean, kind, aliases: new Set(), first: null, last: null, mentions: 0, data: {}, sources: new Set(), strong: false };
      seen.set(key, s);
    }
    for (const a of o.aliases ?? []) if (norm(a) && norm(a) !== norm(s.name)) s.aliases.add(a.trim());
    const seq = o.seq ?? o.first ?? null;
    const last = o.seq ?? o.last ?? null;
    if (seq != null) s.first = s.first == null ? seq : Math.min(s.first, seq);
    if (last != null) s.last = s.last == null ? last : Math.max(s.last, last);
    s.mentions += o.mentions ?? 1;
    if (o.status) s.status = o.status;
    if (o.description && !s.description) {
      s.description = o.description;
      s.descSource = o.descSource;
    }
    if (o.strong) s.strong = true;
    // The tracker knows kinds for sure; atoms only guess.
    if (o.strong || s.sources.size === 0) s.kind = kind;
    s.sources.add(o.source);
    Object.assign(s.data, o.data ?? {});
  };

  if (tracker) {
    const st = tracker.state;
    for (const c of Object.values(st.chars)) {
      const look = [c.look, ...c.traits.map((t) => t.text)].filter(Boolean).join("; ");
      add(c.name, "person", {
        aliases: c.aliases,
        first: c.firstSeq,
        last: c.lastSeq,
        status: c.dead ? "dead" : undefined,
        description: look ? `${c.name}: ${look}` : undefined,
        descSource: "tracker",
        source: "tracker",
        strong: true,
        data: { isUser: c.isUser || undefined, isMain: c.isMain || undefined },
      });
    }
    for (const p of Object.values(st.places)) add(p.name, "place", { last: p.lastSeq, mentions: p.visits, source: "tracker", strong: true, data: { path: p.path } });
    for (const it of Object.values(st.items)) {
      const holder = it.holder ? (st.chars[it.holder]?.name ?? it.holder) : undefined;
      add(it.name, "object", { last: it.lastSeq, status: it.gone ? "gone" : undefined, source: "tracker", strong: true, data: { holder } });
    }
    for (const r of Object.values(st.rep)) add(r.group, "group", { last: r.history.at(-1)?.seq ?? null, source: "tracker", strong: true });
    for (const k of Object.values(st.clocks)) add(k.faction, "group", { last: k.history.at(-1)?.seq ?? null, source: "tracker", strong: true });
  }

  for (const s of all<{ data: string; start_seq: number; end_seq: number | null }>("SELECT data, start_seq, end_seq FROM summaries WHERE chat_id = ? AND level = 'scene' AND state = 'ready'", chatId)) {
    const d = parseJson<{ participants?: string[]; locations?: string[] }>(s.data, {});
    for (const n of d.participants ?? []) add(n, "person", { first: s.start_seq, last: s.end_seq ?? s.start_seq, source: "scenes", strong: true });
    for (const n of d.locations ?? []) add(n, "place", { first: s.start_seq, last: s.end_seq ?? s.start_seq, source: "scenes", strong: true });
  }

  for (const a of all<Pick<AtomRow, "entities" | "min_seq" | "max_seq">>("SELECT entities, min_seq, max_seq FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status != 'superseded'", chatId)) {
    for (const n of parseJson<string[]>(a.entities, [])) add(n, guessKind(n), { first: a.min_seq, last: a.max_seq, source: "memories" });
  }

  const cast = castOf(chatId);
  for (const [name, p] of Object.entries(cast)) if (p.description) add(name, "person", { description: p.description, descSource: "cast", source: "cast", strong: true });

  const rows = all<EntityRow>("SELECT * FROM entities WHERE chat_id = ?", chatId);
  const res = new Resolver(rows.filter((r) => !r.merged_into));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const follow = (r: EntityRow | undefined) => {
    let cur = r;
    for (let i = 0; cur?.merged_into && i < 10; i++) cur = byId.get(cur.merged_into);
    return cur;
  };
  // Merged rows still answer to their old names.
  const mergedNames = new Map<string, EntityRow>();
  for (const r of rows) if (r.merged_into) for (const n of [r.name, ...parseJson<string[]>(r.aliases, [])]) mergedNames.set(norm(n), r);

  // Several names can be one entity (an old name and an alias): fold them together first.
  const groups = new Map<string, { row: EntityRow | undefined; s: Seen }>();
  for (const s of seen.values()) {
    const row = res.find(s.name) ?? [...s.aliases].map((a) => res.find(a)).find(Boolean) ?? follow(mergedNames.get(norm(s.name)));
    const key = row ? row.id : `new:${norm(s.name)}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { row, s: { ...s, aliases: new Set(s.aliases), sources: new Set(s.sources), data: { ...s.data } } });
      continue;
    }
    const m = g.s;
    if (norm(s.name) !== norm(m.name)) m.aliases.add(s.name);
    for (const a of s.aliases) m.aliases.add(a);
    if (s.first != null) m.first = m.first == null ? s.first : Math.min(m.first, s.first);
    if (s.last != null) m.last = m.last == null ? s.last : Math.max(m.last, s.last);
    m.mentions += s.mentions;
    m.status = m.status ?? s.status;
    if (!m.description && s.description) {
      m.description = s.description;
      m.descSource = s.descSource;
    }
    if (s.strong && !m.strong) m.kind = s.kind;
    m.strong = m.strong || s.strong;
    for (const x of s.sources) m.sources.add(x);
    Object.assign(m.data, s.data);
  }

  const t = now();
  let changed = false;
  tx(() => {
    for (const { row, s } of groups.values()) {
      if (!s.strong && s.mentions < 2 && !row) continue;
      if (!row) {
        const id = newId();
        run(
          `INSERT INTO entities (id, chat_id, kind, name, aliases, description, status, data, first_seq, last_seq, mentions, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          chatId,
          s.kind,
          s.name,
          JSON.stringify([...s.aliases]),
          s.description ?? "",
          s.status ?? "active",
          JSON.stringify({ ...s.data, ...(s.descSource ? { descSource: s.descSource } : {}), sources: [...s.sources] }),
          s.first,
          s.last,
          s.mentions,
          t,
          t,
        );
        changed = true;
        continue;
      }
      const data = parseJson<EntityData>(row.data, {});
      const locked = new Set(data.locked ?? []);
      const removed = new Set((data.removed ?? []).map(norm));
      const aliases = parseJson<string[]>(row.aliases, []);
      const names = new Set([row.name, ...aliases].map(norm));
      for (const a of [s.name, ...s.aliases]) if (!names.has(norm(a)) && !removed.has(norm(a))) (aliases.push(a), names.add(norm(a)));
      const desc = locked.has("description") || data.descSource === "consolidation" ? row.description : (s.description ?? row.description);
      const status = locked.has("status") ? row.status : (s.status ?? (row.status === "dead" && !s.status && data.sources?.includes("tracker") ? "active" : row.status));
      const kind = locked.has("kind") ? row.kind : s.strong ? s.kind : row.kind;
      const next = {
        aliases: JSON.stringify(aliases),
        description: desc,
        status,
        kind,
        first: s.first == null ? row.first_seq : row.first_seq == null ? s.first : Math.min(row.first_seq, s.first),
        last: s.last == null ? row.last_seq : Math.max(row.last_seq ?? 0, s.last),
        mentions: s.mentions,
        data: JSON.stringify({ ...data, ...s.data, ...(desc !== row.description && s.descSource ? { descSource: s.descSource } : {}), sources: [...new Set([...(data.sources ?? []), ...s.sources])] }),
      };
      if (
        next.aliases !== row.aliases ||
        next.description !== row.description ||
        next.status !== row.status ||
        next.kind !== row.kind ||
        next.first !== row.first_seq ||
        next.last !== row.last_seq ||
        next.mentions !== row.mentions ||
        next.data !== row.data
      ) {
        run(
          "UPDATE entities SET aliases = ?, description = ?, status = ?, kind = ?, first_seq = ?, last_seq = ?, mentions = ?, data = ?, updated_at = ? WHERE id = ?",
          next.aliases,
          next.description,
          next.status,
          next.kind,
          next.first,
          next.last,
          next.mentions,
          next.data,
          t,
          row.id,
        );
        changed = true;
      }
    }
  });
  if (changed) publish({ type: "memory.changed", chatId });
  return changed;
}

// ---------- reading ----------

export function listEntities(chatId: string, f: { kind?: string; q?: string; merged?: boolean } = {}) {
  syncEntities(chatId);
  let rows = f.merged ? all<EntityRow>("SELECT * FROM entities WHERE chat_id = ? ORDER BY mentions DESC, name", chatId) : liveRows(chatId);
  if (f.kind) rows = rows.filter((r) => r.kind === f.kind);
  if (f.q?.trim()) {
    const q = norm(f.q);
    rows = rows.filter((r) => [r.name, ...parseJson<string[]>(r.aliases, [])].some((n) => norm(n).includes(q)) || norm(r.description).includes(q));
  }
  return rows.map(entityOut);
}

/** Atoms about an entity (by any of its names), most important and newest first. */
export function entityFacts(chatId: string, r: EntityRow, limit = 12) {
  const names = new Set([r.name, ...parseJson<string[]>(r.aliases, [])].map(norm));
  const res = new Resolver(liveRows(chatId));
  return all<AtomRow>("SELECT * FROM memories WHERE chat_id = ? AND deleted_at IS NULL AND status IN ('active', 'disputed') ORDER BY importance DESC, COALESCE(max_seq, 0) DESC", chatId)
    .filter((a) => parseJson<string[]>(a.entities, []).some((n) => names.has(norm(n)) || res.find(n)?.id === r.id))
    .slice(0, limit);
}

/** One line for the prompt or the codex: who or what it is, as far as the story knows. */
export function entityCard(r: EntityRow, facts: AtomRow[] = []) {
  const aliases = parseJson<string[]>(r.aliases, []).filter((a) => norm(a) !== norm(r.name));
  const own = parseJson<string[]>(r.facts, []);
  const status = r.status !== "active" ? ` (${r.status})` : "";
  const bits = [
    `${r.name}${status}`,
    aliases.length ? `also called ${aliases.slice(0, 4).join(", ")}` : "",
    r.description.trim() && norm(r.description) !== norm(r.name) ? r.description.trim().replace(new RegExp(`^${r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`), "") : "",
  ].filter(Boolean);
  const lines = [...own, ...facts.map((f) => f.content)].slice(0, 3);
  return `${bits.join(" — ")}${lines.length ? `. ${lines.join(" ")}` : ""}`;
}

/** Relationship edges with strength over time (tracker bonds), plus relationship memories and who holds what. */
export function entityGraph(chatId: string, opts: { atSeq?: number } = {}) {
  const res = resolver(chatId);
  const nodes = res.rows.map(entityOut);
  const edges: { from: string; to: string; label: string; strength: number; kind: "bond" | "memory" | "holds"; history: { seq: number; strength: number }[] }[] = [];
  const st = trackerStateOf(chatId)?.state;
  const at = opts.atSeq ?? Infinity;
  if (st) {
    const nameOf = (id: string) => st.chars[id]?.name ?? id;
    for (const b of Object.values(st.bonds)) {
      const from = res.find(nameOf(b.from));
      const to = res.find(nameOf(b.to));
      if (!from || !to) continue;
      // Replay the bond to the scrubber's message: strength is the sum of the axes then.
      const axes: Record<string, number> = {};
      const history: { seq: number; strength: number }[] = [];
      for (const m of b.history) {
        if (m.seq > at) break;
        axes[m.axis] = m.to;
        history.push({ seq: m.seq, strength: Object.values(axes).reduce((n, v) => n + v, 0) });
      }
      const strength = history.at(-1)?.strength ?? (at === Infinity ? Object.values(b.axes).reduce((n, v) => n + (v ?? 0), 0) : 0);
      if (!history.length && at !== Infinity) continue;
      edges.push({ from: from.id, to: to.id, label: b.label ?? Object.entries(b.axes).filter(([, v]) => v).map(([k, v]) => `${k} ${v! > 0 ? "+" : ""}${v}`).join(", "), strength, kind: "bond", history });
    }
    for (const it of Object.values(st.items)) {
      if (!it.holder || it.gone) continue;
      const thing = res.find(it.name);
      const who = res.find(st.chars[it.holder]?.name ?? it.holder);
      if (thing && who) edges.push({ from: who.id, to: thing.id, label: "holds", strength: 1, kind: "holds", history: [] });
    }
  }
  // Relationship memories link the people they name.
  const pair = new Map<string, { n: number; label: string; seq: number }>();
  for (const a of all<AtomRow>("SELECT * FROM memories WHERE chat_id = ? AND type = 'relationship' AND deleted_at IS NULL AND status = 'active'", chatId)) {
    if ((a.max_seq ?? 0) > at) continue;
    const ids = [...new Set(parseJson<string[]>(a.entities, []).map((n) => res.find(n)?.id).filter((x): x is string => Boolean(x)))];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const k = [ids[i], ids[j]].sort().join("|");
        const cur = pair.get(k) ?? { n: 0, label: a.content, seq: 0 };
        cur.n++;
        if ((a.max_seq ?? 0) >= cur.seq) {
          cur.label = a.content;
          cur.seq = a.max_seq ?? 0;
        }
        pair.set(k, cur);
      }
  }
  for (const [k, v] of pair) {
    const [from, to] = k.split("|") as [string, string];
    if (edges.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from))) continue;
    edges.push({ from, to, label: v.label.slice(0, 120), strength: v.n, kind: "memory", history: [] });
  }
  return { nodes, edges };
}

// ---------- your changes ----------

function mustEntity(id: string) {
  const r = getEntityRow(id);
  if (!r) throw notFound("Entity not found");
  return r;
}

export function updateEntity(id: string, patch: { name?: string; kind?: EntityKind; aliases?: string[]; description?: string; status?: EntityStatus; facts?: string[] }) {
  const r = mustEntity(id);
  const data = parseJson<EntityData>(r.data, {});
  const locked = new Set(data.locked ?? []);
  for (const k of ["name", "kind", "description", "status", "facts"] as const) if (patch[k] !== undefined) locked.add(k);
  const oldAliases = parseJson<string[]>(r.aliases, []);
  let aliases = oldAliases;
  if (patch.aliases) {
    aliases = [...new Set(patch.aliases.map((a) => a.trim()).filter(Boolean))];
    const kept = new Set(aliases.map(norm));
    data.removed = [...new Set([...(data.removed ?? []), ...oldAliases.filter((a) => !kept.has(norm(a)))])];
  }
  // Renaming keeps the old name as an alias, so old memories still find it.
  if (patch.name && norm(patch.name) !== norm(r.name) && !aliases.some((a) => norm(a) === norm(r.name))) aliases = [...aliases, r.name];
  run(
    "UPDATE entities SET name = ?, kind = ?, aliases = ?, description = ?, status = ?, facts = ?, data = ?, user_edited = 1, updated_at = ? WHERE id = ?",
    patch.name?.trim() || r.name,
    patch.kind ?? r.kind,
    JSON.stringify(aliases.filter((a) => norm(a) !== norm(patch.name ?? r.name))),
    patch.description ?? r.description,
    patch.status ?? r.status,
    patch.facts ? JSON.stringify(patch.facts.map((f) => f.trim()).filter(Boolean)) : r.facts,
    JSON.stringify({ ...data, locked: [...locked] }),
    now(),
    id,
  );
  publish({ type: "memory.changed", chatId: r.chat_id });
  return entityOut(getEntityRow(id)!);
}

/** One-click merge (MEM-28): the others become aliases of the first; nothing is deleted. */
export function mergeEntities(keepId: string, ids: string[]) {
  const keep = mustEntity(keepId);
  const others = ids.filter((i) => i !== keepId).map(mustEntity);
  if (!others.length) throw badRequest("Pick at least one other entity to merge");
  if (others.some((o) => o.chat_id !== keep.chat_id)) throw badRequest("Entities belong to different chats");
  tx(() => {
    const aliases = new Set(parseJson<string[]>(keep.aliases, []));
    const facts = new Set(parseJson<string[]>(keep.facts, []));
    let first = keep.first_seq;
    let last = keep.last_seq;
    let mentions = keep.mentions;
    let description = keep.description;
    for (const o of others) {
      aliases.add(o.name);
      for (const a of parseJson<string[]>(o.aliases, [])) aliases.add(a);
      for (const f of parseJson<string[]>(o.facts, [])) facts.add(f);
      if (o.first_seq != null) first = first == null ? o.first_seq : Math.min(first, o.first_seq);
      if (o.last_seq != null) last = last == null ? o.last_seq : Math.max(last, o.last_seq);
      mentions += o.mentions;
      if (!description.trim()) description = o.description;
      run("UPDATE entities SET merged_into = ?, updated_at = ? WHERE id = ? OR merged_into = ?", keep.id, now(), o.id, o.id);
    }
    const final = [...aliases].filter((a) => norm(a) !== norm(keep.name));
    run(
      "UPDATE entities SET aliases = ?, facts = ?, first_seq = ?, last_seq = ?, mentions = ?, description = ?, user_edited = 1, updated_at = ? WHERE id = ?",
      JSON.stringify(final),
      JSON.stringify([...facts]),
      first,
      last,
      mentions,
      description,
      now(),
      keep.id,
    );
  });
  synced.delete(keep.chat_id);
  publish({ type: "memory.changed", chatId: keep.chat_id });
  return entityOut(getEntityRow(keep.id)!);
}

/** Undo a merge: the entity stands on its own again. */
export function unmergeEntity(id: string) {
  const r = mustEntity(id);
  if (!r.merged_into) return entityOut(r);
  const into = getEntityRow(r.merged_into);
  run("UPDATE entities SET merged_into = NULL, updated_at = ? WHERE id = ?", now(), id);
  if (into) {
    const drop = new Set([r.name, ...parseJson<string[]>(r.aliases, [])].map(norm));
    const kept = parseJson<string[]>(into.aliases, []).filter((a) => !drop.has(norm(a)));
    run("UPDATE entities SET aliases = ?, updated_at = ? WHERE id = ?", JSON.stringify(kept), now(), into.id);
  }
  synced.delete(r.chat_id);
  publish({ type: "memory.changed", chatId: r.chat_id });
  return entityOut(getEntityRow(id)!);
}

export function createEntity(chatId: string, input: { name: string; kind?: EntityKind; aliases?: string[]; description?: string }) {
  const id = newId();
  const t = now();
  run(
    "INSERT INTO entities (id, chat_id, kind, name, aliases, description, status, data, user_edited, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 1, ?, ?)",
    id,
    chatId,
    input.kind ?? guessKind(input.name),
    input.name.trim(),
    JSON.stringify(input.aliases ?? []),
    input.description ?? "",
    JSON.stringify({ locked: ["name", "kind", "description"], sources: ["you"] }),
    t,
    t,
  );
  publish({ type: "memory.changed", chatId });
  return entityOut(getEntityRow(id)!);
}

function lev(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

/** Likely duplicates for one-click merge (MEM-28): same name under a title, a name inside a longer one, a typo. */
export function duplicateSuggestions(chatId: string) {
  const rows = resolver(chatId).rows;
  const out: { keep: EntityOut; merge: EntityOut; reason: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!;
      const b = rows[j]!;
      if (a.kind !== b.kind && !(a.kind === "concept" || b.kind === "concept")) continue;
      const ca = core(a.name);
      const cb = core(b.name);
      if (!ca || !cb) continue;
      let reason = "";
      if (ca === cb) reason = "same name";
      else if (a.kind === "person" && b.kind === "person" && (ca.split(" ").includes(cb) || cb.split(" ").includes(ca)) && Math.min(ca.length, cb.length) >= 3) reason = "one name inside the other";
      else if (ca.length >= 5 && cb.length >= 5 && lev(ca, cb) === 1) reason = "looks like a typo";
      if (!reason) continue;
      const key = [a.id, b.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const [keep, merge] = a.mentions >= b.mentions ? [a, b] : [b, a];
      out.push({ keep: entityOut(keep), merge: entityOut(merge), reason });
    }
  return out.slice(0, 40);
}
