import { categoryOf, loreTitle } from "./format";
import { scanEntriesFor } from "./service";

/**
 * The factions a chat's lore names: entries titled "Faction: …" (or "Group:", "Organisation:"), and
 * entries of the faction or family kind, for the fold (docs/30 0.1): a name here is a group, never a
 * person. The engine's own list (`knownFactions`) reads the same titles but leaves families out, so a
 * family doesn't start faction subplots.
 */
export function loreFactionNames(scope: { characterId?: string | null; personaId?: string | null; chatId?: string | null }): string[] {
  return loreFactions(scope).map((f) => f.name);
}

/** docs/30 1.4: the same, with the entry's kind (a family entry is a family) and its "Members" field. */
export function loreFactions(scope: { characterId?: string | null; personaId?: string | null; chatId?: string | null }): { name: string; category: "faction" | "family"; members: string[]; home?: string }[] {
  const out: { name: string; category: "faction" | "family"; members: string[]; home?: string }[] = [];
  for (const e of scanEntriesFor(scope)) {
    if (!e.enabled) continue;
    const title = loreTitle(e);
    const tagged = title.match(/^(?:factions?|organi[sz]ations?|groups?|famil(?:y|ies)|houses?)\s*:\s*(.+)$/i)?.[1];
    const cat = /^famil/i.test(title) ? "family" : categoryOf(e);
    const name = tagged?.trim() || ((cat === "faction" || cat === "family") && title ? title : "");
    if (!name) continue;
    // docs/30 2.4: a family's "Home" field is where its members live.
    const home = e.content.match(/^\s*(?:home|lives? (?:at|in)|residence)\s*[:=]\s*(.+)$/im)?.[1]?.replace(/\([^)]*\)/g, "").split(/[.;]/)[0]?.trim();
    out.push({ name, category: cat === "family" ? "family" : "faction", members: loreMembers(e.content), ...(home ? { home } : {}) });
  }
  return out;
}

/** "Members: Gabriel Winters, Eleanor Winters": the names a lore entry lists. */
function loreMembers(content: string): string[] {
  const m = content.match(/^\s*(?:members?|people|who)\s*[:=]\s*(.+)$/im)?.[1];
  if (!m) return [];
  return m
    .replace(/\([^)]*\)/g, "")
    .split(/\s*(?:,|;|·|\band\b)\s*/i)
    .map((x) => x.trim().replace(/[.]$/, ""))
    .filter((x) => /^\p{Lu}[\p{L}'.-]*(?:\s+\p{Lu}[\p{L}'.-]*){0,3}$/u.test(x))
    .slice(0, 40);
}
