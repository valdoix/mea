import { all, newId, parseJson } from "../db/db";
import { badRequest, notFound } from "../lib/http";
import { variantPlanOf } from "../creator/creator";
import { shortHash } from "../creator/smarts";
import { findLeaks, type MapRow, newVariant, type RowType, type VariantPlan } from "../creator/variantcore";
import { getCard } from "../services/characters";
import { type LinkKind, linkInfo } from "../services/linked";
import { getPersona } from "../services/personas";
import { ensureWorldBook, getUniverse } from "../services/universes";
import { type EntryExtra, extraOf } from "./activate";
import { firstSentences } from "./ingest";
import { getLorebook, linkedBooks, unlinkLorebook } from "./service";
import { commitDraft, createDraft, mustDraft, mutate, type StudioDraft, type StudioItem, type VersionLore } from "./studio";

/**
 * A version's own lorebook (docs/14, part 3). Every entry in the original's lorebooks goes through
 * the version's map: kept entries are copied (and remember where from), changed ones are planned to
 * be written through the map, dropped ones are left out, and the map's new rows become new entries.
 * It saves into two books linked to the version: its own (people, things, events) and its world's
 * (places, groups, ideas, rules), which part 4 hands to a shared universe.
 */

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** "Dad, the county sheriff" → "Dad": the name part of what a row becomes. */
export const shortName = (to: string) => (to.split(/,|\s[—–-]\s/)[0] ?? to).trim().slice(0, 80) || to.trim().slice(0, 80);

const TYPE_OF_ROW: Partial<Record<RowType, NonNullable<EntryExtra["type"]>>> = { person: "character", place: "location", group: "faction", thing: "item", event: "event", idea: "concept" };
const WORLD_TYPES = new Set(["location", "faction", "concept", "rule"]);
/** Places, groups, ideas and rules belong to the version's world; people, things and events to the version. */
export const isWorldItem = (it: Pick<StudioItem, "type">) => Boolean(it.type && WORLD_TYPES.has(it.type));

/** The plan the version was made with (the variant studio's draft), or a bare one for a version copied by hand. */
function planFor(kind: LinkKind, id: string, origin: { id: string; name: string }, link: NonNullable<ReturnType<typeof linkInfo>>): VariantPlan {
  const made = variantPlanOf(kind, id);
  if (made) return made;
  const plan = newVariant({ originKind: kind, originId: origin.id, originName: origin.name, kind: link.kind, label: link.label, premise: link.label ? `${link.label}.` : "" });
  plan.anchors = link.anchors.map((text) => ({ id: newId(), text, kept: true, from: "you" }));
  return plan;
}

function versionText(kind: LinkKind, id: string) {
  if (kind === "character") {
    const c = getCard(id);
    if (!c) throw notFound("Character not found");
    return { name: c.name, text: [`CHARACTER: ${c.name}`, c.description && `Description: ${c.description.slice(0, 4000)}`, c.personality && `Personality: ${c.personality}`, c.scenario && `Scenario: ${c.scenario.slice(0, 1500)}`].filter(Boolean).join("\n\n") };
  }
  const p = getPersona(id);
  if (!p) throw notFound("Persona not found");
  return { name: p.name, text: [`PERSONA (the user's character): ${p.name}`, p.data.description && `Description: ${p.data.description}`, p.data.background && `Background: ${p.data.background}`].filter(Boolean).join("\n\n") };
}

const rowFor = (map: MapRow[], title: string, keys: string[]) => map.find((r) => r.from && norm(r.from) === norm(title)) ?? map.find((r) => r.from && keys.some((k) => norm(k) === norm(r.from)));

function item(p: Partial<StudioItem> & Pick<StudioItem, "title">): StudioItem {
  return {
    id: newId(),
    type: null,
    pitch: "",
    parent: "",
    folder: "",
    source: "",
    constant: false,
    keep: true,
    status: "planned",
    error: "",
    entry: null,
    previous: null,
    steer: "",
    savedEntryId: null,
    basis: "",
    research: null,
    links: {},
    category: null,
    action: "write",
    targetEntryId: null,
    versionSource: null,
    ...p,
  };
}

/** The plan: one item per original entry (kept, translated, or left out) and one per new row of the map. */
export function versionItems(plan: VariantPlan, books: { id: string }[]): StudioItem[] {
  const out: StudioItem[] = [];
  const byEntry = new Map<string, string>();
  const parents: [StudioItem, string][] = [];
  const covered = new Set<string>();
  for (const b of books) {
    const book = getLorebook(b.id);
    for (const e of book?.entries ?? []) {
      if (!e.content.trim()) continue;
      const x = extraOf(e) as EntryExtra & { essentials?: string; secrets?: { text: string; knownBy: string[] }[]; parent?: string; category?: StudioItem["category"] };
      const title = (e.comment || e.keys[0] || "Untitled").trim();
      const row = rowFor(plan.map, title, e.keys);
      if (row) covered.add(row.id);
      const source = { entryId: e.id, bookId: b.id, from: title, basis: shortHash(`${e.content}\n${e.keys.join(",")}`), text: e.content };
      const base = { type: x.type ?? null, category: x.category ?? null, constant: e.constant, folder: typeof x.folder === "string" ? x.folder : "" };
      const leaks = findLeaks(plan.map, [{ where: "field", key: e.id, label: title, text: [e.content, ...e.keys].join("\n") }]);
      let it: StudioItem;
      if (row?.state === "dropped") it = item({ ...base, title, pitch: "Not in this version: the map drops it.", keep: false, versionSource: { ...source, state: "changed" } });
      else if (row?.state === "kept" && !leaks.length)
        it = item({
          ...base,
          title,
          status: "drafted",
          entry: { content: e.content, keys: e.keys, aliases: x.aliases ?? [], essentials: x.essentials || firstSentences(e.content), secrets: x.secrets ?? [] },
          versionSource: { ...source, state: "kept" },
        });
      else {
        const to = row?.state === "changed" && row.to.trim() ? row.to.trim() : "";
        it = item({
          ...base,
          title: to ? shortName(to) : title,
          pitch: to ? `${to}${row?.note ? ` (${row.note})` : ""}` : row?.state === "kept" ? `The same as the original, with this version's names (${[...new Set(leaks.map((l) => l.term))].join(", ")}).` : `${title}, as it is in this version.`,
          versionSource: { ...source, state: "changed" },
        });
      }
      byEntry.set(e.id, it.id);
      if (x.parent) parents.push([it, x.parent]);
      out.push(it);
    }
  }
  for (const [it, parent] of parents) it.parent = byEntry.get(parent) ?? "";
  // What the map adds: new rows, and people, places and groups it changed that had no entry of their own.
  for (const r of plan.map) {
    if (r.type === "self" || covered.has(r.id)) continue;
    const isNew = r.state === "new" && (r.to.trim() || r.from.trim());
    const changedName = r.state === "changed" && r.to.trim() && (r.type === "person" || r.type === "place" || r.type === "group");
    if (!isNew && !changedName) continue;
    const to = (r.to || r.from).trim();
    out.push(item({ title: shortName(to), type: TYPE_OF_ROW[r.type] ?? null, pitch: `${to}${r.note ? ` (${r.note})` : ""}`, versionSource: { entryId: null, bookId: null, from: isNew ? "" : r.from, state: isNew ? "new" : "changed", basis: "", text: "" } }));
  }
  return out;
}

/** Starts a version's lorebook in the Lore Studio: the plan comes from its map, kept entries already in it. */
export function createVersionLore(kind: LinkKind, id: string): StudioDraft {
  const link = linkInfo(kind, id);
  if (!link) throw notFound(kind === "character" ? "Character not found" : "Persona not found");
  if (!link.origin) throw badRequest("This isn't a version of anything");
  const plan = planFor(kind, id, link.origin, link);
  const v = versionText(kind, id);
  const books = linkedBooks(kind, link.origin.id);
  const items = versionItems(plan, books);
  // Part 4: world entries are written once, in the universe's book; what it already has isn't written again.
  const universe = getUniverse(link.universeId);
  const shared = universe?.bookId ? getLorebook(universe.bookId) : undefined;
  if (shared) {
    const have = new Set(shared.entries.flatMap((e) => [e.comment, ...e.keys]).map(norm).filter(Boolean));
    for (const it of items) if (isWorldItem(it) && it.keep && have.has(norm(it.title))) Object.assign(it, { keep: false, pitch: `Already in ${universe!.name}'s world book.` });
  }
  const label = plan.label || link.label;
  const d = createDraft({ kind: "version", refId: id, text: v.text, title: `${v.name}${label ? ` (${label})` : ""}: lore`, options: { overview: false, secrets: false, size: "complete" } });
  return mutate(d.id, (cur) => {
    cur.source.refName = v.name;
    cur.links = [{ type: kind, id }];
    cur.version = { kind, id, name: v.name, originId: link.origin!.id, originName: link.origin!.name, plan, companionBookId: null, worldBookId: null } satisfies VersionLore;
    cur.items = items;
    cur.stage = items.some((i) => i.keep && !i.entry) ? "plan" : "review";
  });
}

/**
 * Saves a version's lore: world entries into its world book, the rest into its own, both linked to
 * the version (and saving again adds to the same two). The original's books stop being linked to the
 * version, since it now has its own; the original keeps them.
 */
export function commitVersionLore(id: string) {
  const d = mustDraft(id);
  const v = d.version;
  if (!v) throw badRequest("This draft isn't a version's lore");
  const ready = d.items.filter((i) => i.keep && i.entry?.content.trim() && !i.savedEntryId);
  if (!ready.length) throw badRequest("Nothing new to save. Write some entries first.");
  const label = v.plan.label;
  const link = [{ type: v.kind, id: v.id }];
  let added = 0;
  const world = ready.filter(isWorldItem).map((i) => i.id);
  const own = ready.filter((i) => !isWorldItem(i)).map((i) => i.id);
  // In a universe, the world book is the universe's (made the first time, and linked to every member).
  const universeId = linkInfo(v.kind, v.id)?.universeId ?? null;
  let worldBookId = universeId ? null : v.worldBookId && getLorebook(v.worldBookId) ? v.worldBookId : null;
  if (universeId && ready.some(isWorldItem)) worldBookId = ensureWorldBook(universeId);
  let companionBookId = v.companionBookId && getLorebook(v.companionBookId) ? v.companionBookId : null;
  if (world.length) {
    const r = commitDraft(id, { bookId: worldBookId, name: `${label || v.name}: the world`, description: `The world of ${v.name}'s version${label ? ` (${label})` : ""}, translated from ${v.originName}'s.`, links: link, overview: false, itemIds: world });
    worldBookId = r.bookId;
    added += r.added;
  }
  if (own.length) {
    const r = commitDraft(id, { bookId: companionBookId, name: `${v.name}${label ? ` (${label})` : ""}: lore`, description: `${v.name}'s own lore in this version, translated from ${v.originName}'s.`, links: link, overview: false, itemIds: own });
    companionBookId = r.bookId;
    added += r.added;
  }
  // The version had the original's books (copied, or linked by the creator); it has its own now.
  const mine = new Set([worldBookId, companionBookId].filter(Boolean));
  const theirs = new Set(linkedBooks(v.kind, v.originId).map((b) => b.id));
  const unlinked = linkedBooks(v.kind, v.id).filter((b) => theirs.has(b.id) && !mine.has(b.id));
  for (const b of unlinked) unlinkLorebook(b.id, v.kind, v.id);
  const after = mutate(id, (cur) => {
    if (cur.version) Object.assign(cur.version, { worldBookId, companionBookId });
  });
  return { bookIds: [...mine] as string[], added, unlinked: unlinked.map((b) => b.name), draft: after };
}

/** The version's entries next to the original's, for Compare (part 1's compare gains a lore side). */
export function loreComparison(kind: LinkKind, id: string) {
  const out: { title: string; state: string; from: string; original: string; version: string }[] = [];
  for (const b of linkedBooks(kind, id)) {
    for (const e of getLorebook(b.id)?.entries ?? []) {
      const src = (e.extra as { source?: { entryId?: string | null; state?: string } }).source;
      if (!src?.state) continue;
      const orig = src.entryId ? all<{ data: string }>("SELECT data FROM lorebook_entries WHERE id = ?", src.entryId)[0] : undefined;
      const o = orig ? parseJson<{ comment?: string; content?: string }>(orig.data, {}) : {};
      out.push({ title: e.comment || e.keys[0] || "Untitled", state: src.state, from: o.comment ?? "", original: o.content ?? "", version: e.content });
    }
  }
  return out;
}
