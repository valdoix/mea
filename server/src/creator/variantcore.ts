import { newId } from "../db/db";
import type { VersionKind } from "../services/linked";

/**
 * The variant studio's data (docs/14, part 2), kept free of the creator's own imports so creator.ts
 * can read it. A version draft carries its original, its premise, what stays true (anchors), the
 * map from the original's world to the version's, and the original's bible to mark sections against.
 */

export type RowType = "self" | "person" | "place" | "group" | "thing" | "event" | "idea";
export const ROW_TYPES: RowType[] = ["self", "person", "place", "group", "thing", "event", "idea"];
/** Open: nobody has decided yet. Kept: the same here. Changed: `to` is what it becomes. Dropped: it doesn't exist here. New: only in the version. */
export type RowState = "open" | "kept" | "changed" | "dropped" | "new";
export const ROW_STATES: RowState[] = ["open", "kept", "changed", "dropped", "new"];

export interface MapRow {
  id: string;
  type: RowType;
  /** The name in the original ("" for a new row). */
  from: string;
  /** What it is in the version ("" when kept or dropped). */
  to: string;
  state: RowState;
  note: string;
  /** Where the row came from: the card, a lorebook, you, or Mea's suggestion for a new one. */
  source: "card" | "lore" | "you" | "mea";
}

export interface Anchor {
  id: string;
  text: string;
  /** Ticked: it holds in this version. Mea suggests; you decide. */
  kept: boolean;
  from: "mea" | "you";
}

export type Mark = "kept" | "changed" | "new";

export interface VariantPlan {
  originKind: "character" | "persona";
  originId: string;
  originName: string;
  kind: VersionKind;
  label: string;
  premise: string;
  anchors: Anchor[];
  map: MapRow[];
  /** The map has been read from the original at least once. */
  mapBuilt: boolean;
  /** The original's bible, when the creator made it: sections are marked against it. */
  originBible: { key: string; label: string; text: string }[] | null;
  /** The writer's marks, used when there's no original bible to compare with. */
  marks: Record<string, Mark>;
  /** Three takes on the premise ("Show me directions"). */
  directions: string[];
}

export const KIND_LABEL: Record<VersionKind, string> = { au: "alternate universe", era: "another era", skip: "time skip", whatif: "what if" };

export function newVariant(input: { originKind: VariantPlan["originKind"]; originId: string; originName: string; kind?: VersionKind | null; label?: string; premise?: string; originBible?: VariantPlan["originBible"] }): VariantPlan {
  return {
    originKind: input.originKind,
    originId: input.originId,
    originName: input.originName,
    kind: input.kind ?? "au",
    label: input.label?.trim() ?? "",
    premise: input.premise?.trim() ?? "",
    anchors: [],
    map: [],
    mapBuilt: false,
    originBible: input.originBible?.length ? input.originBible : null,
    marks: {},
    directions: [],
  };
}

export const newRow = (r: Partial<MapRow> & Pick<MapRow, "from">): MapRow => ({ id: newId(), type: "thing", to: "", state: "open", note: "", source: "you", ...r });

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Adds rows whose name isn't on the map yet (case and spacing don't count). */
export function mergeRows(map: MapRow[], rows: MapRow[]) {
  const have = new Set(map.map((r) => norm(r.from || r.to)));
  const out = [...map];
  for (const r of rows) {
    const k = norm(r.from || r.to);
    if (!k || have.has(k)) continue;
    have.add(k);
    out.push(r);
  }
  return out;
}

/** The map as every step reads it. */
function mapLines(map: MapRow[]) {
  return map
    .map((r) => {
      const what = r.type === "self" ? "this person" : r.type;
      if (r.state === "kept") return `- ${what}: ${r.from} → the same in this version${r.note ? ` (${r.note})` : ""}`;
      if (r.state === "changed") return `- ${what}: ${r.from} → ${r.to}${r.note ? ` (${r.note})` : ""}`;
      if (r.state === "dropped") return `- ${what}: ${r.from} → DOES NOT EXIST in this version${r.note ? ` (${r.note})` : ""}`;
      if (r.state === "new") return `- ${what}, only in this version: ${r.to || r.from}${r.note ? ` (${r.note})` : ""}`;
      return `- ${what}: ${r.from} → not decided yet (keep it only if the premise allows; otherwise translate it in the spirit of the map)`;
    })
    .join("\n");
}

/** What every creator step needs to know about a version: what it is, what stays true, and the map. */
export function variantBlock(v: VariantPlan | null | undefined, opts: { original?: boolean } = {}) {
  if (!v) return "";
  const anchors = v.anchors.filter((a) => a.kept && a.text.trim());
  return [
    `THIS IS A VERSION of ${v.originName}: ${KIND_LABEL[v.kind]}${v.label ? ` ("${v.label}")` : ""}. The original stays as it is; everything you write is for the version. The same person at the core, moved into the premise below.`,
    v.premise.trim() ? `THE PREMISE (canon for the version; it outranks the original wherever they disagree):\n${v.premise.trim()}` : "",
    anchors.length ? `WHAT STAYS TRUE in every version (keep each one visible):\n${anchors.map((a) => `- ${a.text.trim()}`).join("\n")}` : "",
    v.map.length ? `THE MAP from the original's world to this version's. Follow it exactly: use the version's names, and never use an original name the map changed or dropped.\n${mapLines(v.map)}` : "",
    opts.original !== false && v.originBible?.length ? `THE ORIGINAL'S BIBLE (reference: what the version keeps, translates or drops):\n${v.originBible.filter((b) => b.text.trim()).map((b) => `## ${b.label}\n${b.text.trim()}`).join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface Leak {
  /** The original name that slipped through. */
  term: string;
  /** What it is in this version ("" when it was dropped). */
  to: string;
  state: "changed" | "dropped";
  /** Where: "bible" or "field". */
  where: "bible" | "field";
  key: string;
  label: string;
}

/**
 * Original names the map changed or dropped that still appear in the version's text: rules only, free.
 * A name that's part of its own translation ("Arya" → "Arya Stark") never counts.
 */
export function findLeaks(map: MapRow[], texts: { where: Leak["where"]; key: string; label: string; text: string }[]): Leak[] {
  const out: Leak[] = [];
  for (const r of map) {
    if (r.state !== "changed" && r.state !== "dropped") continue;
    const term = r.from.trim();
    if (term.length < 3 || r.type === "self") continue;
    if (r.state === "changed" && (!r.to.trim() || norm(r.to) === norm(term))) continue;
    // Names are matched as written ("Rose" the person, not "rose" the verb); an all-lowercase one in any case.
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(term)}(?=$|[^\\p{L}\\p{N}])`, /\p{Lu}/u.test(term) ? "u" : "iu");
    if (r.state === "changed" && re.test(r.to)) continue;
    for (const t of texts) if (t.text && re.test(t.text)) out.push({ term, to: r.state === "changed" ? r.to.trim() : "", state: r.state, where: t.where, key: t.key, label: t.label });
  }
  return out;
}

/** The steer that fixes a leak: use the version's name, or take out what doesn't exist here. */
export const leakSteer = (l: Leak) => (l.state === "changed" ? `In this version "${l.term}" is "${l.to}": use that, and keep everything else.` : `"${l.term}" doesn't exist in this version: take it out or replace it with something from this version's world, and keep everything else.`);

/** Each bible section against the original: the same text is kept, a section the original lacks is new, the rest changed. */
export function marksOf(v: VariantPlan, bible: { key: string; text: string }[]): Record<string, Mark> {
  if (!v.originBible) return Object.fromEntries(bible.map((b) => [b.key, v.marks[b.key] ?? "changed"]));
  const out: Record<string, Mark> = {};
  for (const b of bible) {
    const was = v.originBible.find((o) => o.key === b.key)?.text.trim() ?? "";
    out[b.key] = !was ? "new" : was === b.text.trim() ? "kept" : "changed";
  }
  return out;
}
