import { countTokens } from "../lib/tokens";
import { essentialsOf, extraOf } from "../lore/activate";
import { CATEGORY_INFO, type Category, categoryOf } from "../lore/format";
import { isSatellite } from "../lore/mix";
import { getLorebook } from "../lore/service";
import { getDraft as getLoreDraft } from "../lore/studio";
import { expansionBlock } from "./expand";

/**
 * The world a character or persona lives in: their lorebooks (and a Lore Studio draft not saved
 * yet), condensed to essentials so every creative step stays consistent with the setting.
 */

const TYPE_ORDER = ["rule", "concept", "location", "faction", "event", "character", "item"];

/**
 * docs/17, 7.5: what a card must not contradict and the words it should use come first (ground
 * truth, what's happening now, the world's words and customs), then people, the world, time and
 * scenes. An entry with no kind goes by its Codex type, after the people.
 */
const SHELF_RANK: Record<string, number> = { ground: 0, people: 4, world: 5, time: 6, scenes: 7 };
export function shelfRank(kind: Category | null, type?: string | null, constant = false): number {
  // Always on with no kind: a rule of the world in all but name.
  if (!kind && constant) return 0;
  if (kind === "current") return 1;
  if (kind === "lexicon") return 2;
  if (kind === "customs") return 3;
  if (kind) return SHELF_RANK[CATEGORY_INFO[kind].shelf] ?? 8;
  return 4.5 + Math.max(0, TYPE_ORDER.indexOf(type ?? "")) / 10;
}

export function worldContext(opts: { bookIds?: string[]; loreDraftId?: string | null }, budget = 2500): string {
  const parts: string[] = [];
  const draft = opts.loreDraftId ? getLoreDraft(opts.loreDraftId) : undefined;
  const fromDraftBook = draft?.committedBookId;
  if (draft) {
    // Other people's satellites (a voice, a reaction) are about someone else: left out of the condensed world.
    const items = draft.items.filter((i) => i.keep && !(i.category && isSatellite(i.category))).sort((a, b) => shelfRank(a.category, a.type, a.constant) - shelfRank(b.category, b.type, b.constant));
    const lines = items.map((i) => `- ${i.title}${i.type ? ` (${i.type})` : ""}: ${i.entry?.essentials || i.pitch || ""}`.trimEnd());
    parts.push([`WORLD: ${draft.title}`, draft.overview.trim(), expansionBlock(draft.expansion, "CONCEPT"), lines.join("\n")].filter(Boolean).join("\n"));
  }
  for (const id of opts.bookIds ?? []) {
    if (id === fromDraftBook) continue;
    const book = getLorebook(id);
    if (!book || book.deletedAt) continue;
    const entries = book.entries
      .filter((e) => e.enabled && e.content.trim() && !((k) => k && isSatellite(k))(categoryOf(e)))
      .sort((a, b) => shelfRank(categoryOf(a), extraOf(a).type, a.constant) - shelfRank(categoryOf(b), extraOf(b).type, b.constant) || Number(b.constant) - Number(a.constant));
    const lines = entries.map((e) => (e.constant ? `- ${e.comment || "Always true"}: ${e.content.replace(/\s+/g, " ").slice(0, 700)}` : `- ${e.comment || e.keys[0] || "Untitled"}${extraOf(e).type ? ` (${extraOf(e).type})` : ""}: ${essentialsOf(e)}`));
    parts.push([`LOREBOOK: ${book.name}`, book.description.trim(), lines.join("\n")].filter(Boolean).join("\n"));
  }
  // Keep whole lines, in order, until the budget is spent.
  const text = parts.join("\n\n");
  if (countTokens(text) <= budget) return text;
  const kept: string[] = [];
  let used = 0;
  for (const line of text.split("\n")) {
    const n = countTokens(line) + 1;
    if (used + n > budget) break;
    kept.push(line);
    used += n;
  }
  return `${kept.join("\n")}\n[…more lore not shown]`;
}
