import { all, parseJson } from "../db/db";
import { type ChatSettings, mustChat } from "../services/chats";
import { currentMembers, groupKey, groupsInText, kindOfGroup } from "./groups";
import { familySurname } from "./whois";
import { castFactions, castKey, currentFold } from "./store";
import type { Group, GroupKind, WorldState } from "./types";

/**
 * docs/30 Part 1: one faction list. Yours (cast_factions), the lore's and the story's groups (the fold's
 * `groups`), and the engine's (clocks, standing, subplots), put together for the Story page, the note
 * and the engine; plus the groups Mea thinks it has spotted but hasn't made factions of.
 */

export type GroupsMode = "auto" | "ask" | "off";

export interface FactionView {
  key: string;
  /** The row on the Story page, once there is one (yours, or one you edited). */
  id: string | null;
  name: string;
  aliases: string[];
  kind: GroupKind;
  description?: string;
  color?: string;
  source: "you" | "lore" | "story" | "engine";
  /** Mea found it (the story, the lore or the engine), and it has no row of yours yet. */
  found: boolean;
  /** You've looked at it ("Looks right", or edited it). */
  seen: boolean;
  members: { name: string; role?: string; since: number; left?: number; dead: boolean; why?: string }[];
  /** What the group as a whole was told, newest first. */
  facts: { text: string; seq: number; members: string[] }[];
  anchor?: string;
  standing: { clocks: { name: string; cur: number; max: number }[]; rep: { who: string; score: number }[]; relations: { with: string; score: number }[] };
  mentions: number;
  /** In how many messages the story's text names it. */
  prose: number;
  firstSeq: number;
  lastSeq: number;
}

export interface GroupCandidate {
  key: string;
  name: string;
  kind: GroupKind;
  members: string[];
  /** Messages with a tracker line naming it, and messages whose text names it. */
  mentions: number;
  prose: number;
  firstSeq: number;
  lastSeq: number;
}

/** A candidate with nobody named in it that hasn't come up in this many messages fades. */
const FADE = 200;

// ---------- the story's text ----------

const proseCache = new Map<string, Map<string, { at: number; seq: number; names: { key: string; name: string }[] }>>();

/** docs/30 1.2: capitalised groups named in the story's messages, read once per message (and again when it changes). */
function proseGroups(chatId: string, st: WorldState): Map<string, { name: string; seqs: number[] }> {
  const rows = all<{ id: string; seq: number; updated_at: number; content: string }>(
    `SELECT m.id, m.seq, MAX(m.updated_at, s.updated_at) AS updated_at, s.content FROM messages m JOIN swipes s ON s.message_id = m.id AND s.idx = m.active_swipe
     WHERE m.chat_id = ? AND m.deleted_at IS NULL AND m.role != 'system'`,
    chatId,
  );
  const people = new Set(Object.values(st.chars).flatMap((c) => [c.name, ...c.aliases].map(castKey)));
  const places = new Set(Object.values(st.places).flatMap((p) => [p.name, ...(p.aliases ?? [])].map(groupKey)));
  const skip = (name: string) => people.has(castKey(name)) || people.has(castKey(name.replace(/^the\s+/i, ""))) || places.has(groupKey(name));
  const cache = proseCache.get(chatId) ?? new Map();
  const live = new Set<string>();
  for (const r of rows) {
    live.add(r.id);
    const hit = cache.get(r.id);
    if (hit && hit.at === r.updated_at && hit.seq === r.seq) continue;
    const found = groupsInText([{ seq: r.seq, text: r.content }], () => false);
    cache.set(r.id, { at: r.updated_at, seq: r.seq, names: [...found.entries()].map(([key, v]) => ({ key, name: v.name })) });
  }
  for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
  proseCache.set(chatId, cache);
  if (proseCache.size > 20) proseCache.delete(proseCache.keys().next().value!);
  const out = new Map<string, { name: string; seqs: number[] }>();
  for (const { seq, names } of cache.values())
    for (const { key, name } of names) {
      if (skip(name)) continue;
      const cur = out.get(key);
      if (cur) cur.seqs.push(seq);
      else out.set(key, { name, seqs: [seq] });
    }
  return out;
}

// ---------- the list ----------

export function groupsSettings(chatId: string): { mode: GroupsMode; seen: string[]; not: string[] } {
  const g = parseJson<ChatSettings>(mustChat(chatId).settings, {}).groups ?? {};
  return { mode: g.mode ?? "auto", seen: g.seen ?? [], not: g.not ?? [] };
}

function standingOf(st: WorldState, names: string[]): FactionView["standing"] {
  const keys = new Set(names.map(groupKey));
  const is = (x: string | undefined) => Boolean(x && keys.has(groupKey(x)));
  const nameOf = (id: string) => st.chars[id]?.name ?? id;
  return {
    clocks: Object.values(st.clocks)
      .filter((c) => is(c.faction))
      .map((c) => ({ name: c.name, cur: c.cur, max: c.max })),
    rep: Object.values(st.rep)
      .filter((r) => is(r.group) && r.score)
      .map((r) => ({ who: nameOf(r.who), score: r.score })),
    relations: Object.entries(st.sim?.factionRel ?? {}).flatMap(([k, v]) => {
      const [a, b] = k.split("|");
      return is(a) ? [{ with: b!, score: v }] : is(b) ? [{ with: a!, score: v }] : [];
    }),
  };
}

/** The engine's groups: faction clocks, reputations, groups leading subplots, and their relations. */
function engineNames(st: WorldState): string[] {
  return [
    ...Object.values(st.clocks).map((k) => k.faction),
    ...Object.values(st.rep).map((r) => r.group),
    ...Object.values(st.sim?.arcs ?? {})
      .filter((a) => a.lead.startsWith("faction:"))
      .map((a) => a.leadName),
    ...Object.keys(st.sim?.factionRel ?? {}).flatMap((k) => k.split("|")),
  ].filter((x): x is string => Boolean(x?.trim()));
}

/**
 * docs/30 1.1–1.2: every faction the story has, and the groups Mea thinks it has spotted. `prose` reads
 * the story's text too (the Story page); the note and the engine leave it out.
 */
export function factionBook(chatId: string, o: { prose?: boolean; st?: WorldState } = {}): { mode: GroupsMode; factions: FactionView[]; suggested: GroupCandidate[] } {
  const st = o.st ?? currentFold(chatId).result.state;
  const set = groupsSettings(chatId);
  const seen = new Set(set.seen.map(groupKey));
  const not = new Set(set.not.map(groupKey));
  const groups = Object.values(st.groups ?? {});
  const prose = o.prose ? proseGroups(chatId, st) : new Map<string, { name: string; seqs: number[] }>();
  const dead = (name: string) => Object.values(st.chars).some((c) => c.dead && castKey(c.name) === castKey(name));
  const names = (g: { name: string; aliases?: string[] }) => [g.name, ...(g.aliases ?? [])];
  const groupFor = (ns: string[]) => {
    const keys = new Set(ns.map(groupKey));
    return groups.find((g) => names(g).some((n) => keys.has(groupKey(n))));
  };
  const proseFor = (ns: string[]) => new Set(ns.flatMap((n) => prose.get(groupKey(n))?.seqs ?? [])).size;
  const surnames = Object.values(st.chars)
    .filter((c) => c.name.includes(" "))
    .map((c) => c.name.toLowerCase().split(" ").at(-1)!);
  const taken = new Set<string>();
  const out: FactionView[] = [];
  const view = (g: Group | undefined, base: Partial<FactionView> & { name: string; source: FactionView["source"] }): FactionView => {
    const all = [...new Set([base.name, ...(base.aliases ?? []), ...(g ? names(g) : [])])];
    for (const n of all) taken.add(groupKey(n));
    const rowMembers = base.members ?? [];
    const story = (g?.members ?? []).filter((m) => !rowMembers.some((r) => castKey(r.name) === castKey(m.name)));
    const members = [...rowMembers, ...story.map((m) => ({ ...m, dead: dead(m.name) }))];
    // docs/30 1.4: a family nobody listed is the cast by its surname.
    const kind = base.kind ?? g?.kind ?? kindOfGroup(base.name, { surnames });
    if (!members.length && kind === "family") {
      const sur = familySurname(base.name);
      for (const c of Object.values(st.chars)) if (c.name.includes(" ") && sur.includes(c.name.toLowerCase().split(" ").at(-1)!)) members.push({ name: c.name, since: 0, dead: Boolean(c.dead) });
    }
    return {
      key: groupKey(base.name),
      id: base.id ?? null,
      name: base.name,
      aliases: all.filter((n) => groupKey(n) !== groupKey(base.name)),
      kind,
      ...(base.description ? { description: base.description } : {}),
      ...(base.color ? { color: base.color } : {}),
      source: base.source,
      found: !base.id,
      seen: Boolean(base.id) || seen.has(groupKey(base.name)),
      members,
      facts: [...(g?.facts ?? [])].sort((a, b) => b.seq - a.seq),
      ...(g?.anchor ? { anchor: g.anchor } : {}),
      standing: standingOf(st, all),
      mentions: g?.mentions ?? 0,
      prose: proseFor(all),
      firstSeq: g?.firstSeq ?? 0,
      lastSeq: g?.lastSeq ?? 0,
    };
  };
  // Yours first: a row on the Story page (some started as one Mea found).
  for (const f of castFactions(chatId)) {
    const g = groupFor([f.name, ...(f.aliases ?? [])]);
    const since = (name: string) => g?.members.find((m) => castKey(m.name) === castKey(name));
    out.push(
      view(g, {
        id: f.id,
        name: f.name,
        aliases: f.aliases ?? [],
        kind: f.kind,
        description: f.description,
        color: f.color,
        source: f.source ?? "you",
        members: f.members.map((m) => {
          const s = since(m.name);
          return { name: m.name, ...(m.role ? { role: m.role } : {}), since: m.since ?? s?.since ?? 0, ...(s?.left != null ? { left: s.left } : {}), dead: dead(m.name), ...(s?.why ? { why: s.why } : {}) };
        }),
      }),
    );
  }
  // The lore's and the story's, once adopted.
  const suggested: GroupCandidate[] = [];
  for (const g of groups) {
    if (names(g).some((n) => taken.has(groupKey(n)))) continue;
    if (g.adopted) {
      out.push(view(g, { name: g.name, source: g.source }));
      continue;
    }
    const key = groupKey(g.name);
    if (set.mode === "off" || not.has(key) || g.kind === "household") continue;
    const p = prose.get(key)?.seqs ?? [];
    const last = Math.max(g.lastSeq, ...p);
    // One with nobody named in it fades when it hasn't come up in a while; one with its people waits for you.
    if (!currentMembers(g).length && st.lastSeq - last > FADE) continue;
    taken.add(key);
    suggested.push({ key, name: g.name, kind: g.kind ?? kindOfGroup(g.name, { surnames }), members: currentMembers(g).map((m) => m.name), mentions: g.mentions, prose: new Set(p).size, firstSeq: g.firstSeq, lastSeq: last });
  }
  // The engine's.
  const engine = new Map<string, string>();
  for (const n of engineNames(st)) if (!taken.has(groupKey(n)) && !not.has(groupKey(n))) engine.set(groupKey(n), n);
  for (const n of engine.values()) out.push(view(undefined, { name: n, source: "engine", kind: "organisation" }));
  // Named only in the story's text, in two messages or more: Mea asks.
  if (set.mode !== "off")
    for (const [key, p] of prose) {
      if (taken.has(key) || not.has(key) || [...taken].some((t) => t.endsWith(` ${key}`))) continue;
      const seqs = [...new Set(p.seqs)];
      if (seqs.length < 2 || st.lastSeq - Math.max(...seqs) > FADE) continue;
      // "the Summerses": a family named by the cast's surname.
      const kind = kindOfGroup(p.name, { surnames });
      const members =
        kind === "family"
          ? Object.values(st.chars)
              .filter((c) => {
                const last = c.name.toLowerCase().split(" ").at(-1)!;
                return c.name.includes(" ") && [last, `${last}s`, `${last}es`].includes(key);
              })
              .map((c) => c.name)
          : [];
      suggested.push({ key, name: p.name.replace(/^the\s+/i, ""), kind, members, mentions: 0, prose: seqs.length, firstSeq: Math.min(...seqs), lastSeq: Math.max(...seqs) });
    }
  out.sort((a, b) => Number(a.found) - Number(b.found) || b.lastSeq - a.lastSeq || a.name.localeCompare(b.name));
  suggested.sort((a, b) => b.mentions + b.prose - (a.mentions + a.prose) || b.lastSeq - a.lastSeq);
  return { mode: set.mode, factions: out, suggested: suggested.slice(0, 12) };
}

/** docs/30 1.3: the factions for the note: who's in each, and what the group was told. */
export function noteFactions(chatId: string, st: WorldState): { name: string; description?: string; members: { name: string; role?: string }[]; facts: string[] }[] {
  return factionBook(chatId, { st })
    .factions.filter((f) => f.source !== "engine")
    .map((f) => ({
      name: f.name,
      ...(f.description ? { description: f.description } : {}),
      members: f.members.filter((m) => m.left == null && !m.dead).map((m) => ({ name: m.name, ...(m.role ? { role: m.role } : {}) })),
      facts: f.facts.slice(0, 2).map((x) => x.text),
    }));
}
