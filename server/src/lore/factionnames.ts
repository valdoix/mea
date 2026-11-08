import { categoryOf, loreTitle } from "./format";
import { scanEntriesFor } from "./service";

/**
 * The factions a chat's lore names: entries titled "Faction: …" (or "Group:", "Organisation:"), and
 * entries of the faction or family kind, for the fold (docs/30 0.1): a name here is a group, never a
 * person. The engine's own list (`knownFactions`) reads the same titles but leaves families out, so a
 * family doesn't start faction subplots.
 */
export function loreFactionNames(scope: { characterId?: string | null; personaId?: string | null; chatId?: string | null }): string[] {
  const names: string[] = [];
  for (const e of scanEntriesFor(scope)) {
    if (!e.enabled) continue;
    const title = loreTitle(e);
    const tagged = title.match(/^(?:factions?|organi[sz]ations?|groups?)\s*:\s*(.+)$/i)?.[1];
    if (tagged) names.push(tagged.trim());
    else if ((categoryOf(e) === "faction" || categoryOf(e) === "family") && title) names.push(title);
  }
  return names;
}
