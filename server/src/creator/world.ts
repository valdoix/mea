import { countTokens } from "../lib/tokens";
import { essentialsOf, extraOf } from "../lore/activate";
import { getLorebook } from "../lore/service";
import { getDraft as getLoreDraft } from "../lore/studio";
import { expansionBlock } from "./expand";

/**
 * The world a character or persona lives in: their lorebooks (and a Lore Studio draft not saved
 * yet), condensed to essentials so every creative step stays consistent with the setting.
 */

const TYPE_ORDER = ["rule", "concept", "location", "faction", "event", "character", "item"];

export function worldContext(opts: { bookIds?: string[]; loreDraftId?: string | null }, budget = 2500): string {
  const parts: string[] = [];
  const draft = opts.loreDraftId ? getLoreDraft(opts.loreDraftId) : undefined;
  const fromDraftBook = draft?.committedBookId;
  if (draft) {
    const lines = draft.items.filter((i) => i.keep).map((i) => `- ${i.title}${i.type ? ` (${i.type})` : ""}: ${i.entry?.essentials || i.pitch || ""}`.trimEnd());
    parts.push([`WORLD: ${draft.title}`, draft.overview.trim(), expansionBlock(draft.expansion, "CONCEPT"), lines.join("\n")].filter(Boolean).join("\n"));
  }
  for (const id of opts.bookIds ?? []) {
    if (id === fromDraftBook) continue;
    const book = getLorebook(id);
    if (!book || book.deletedAt) continue;
    const entries = book.entries
      .filter((e) => e.enabled && e.content.trim())
      .sort((a, b) => Number(b.constant) - Number(a.constant) || TYPE_ORDER.indexOf(extraOf(a).type ?? "") - TYPE_ORDER.indexOf(extraOf(b).type ?? ""));
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
