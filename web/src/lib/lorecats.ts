/** I1: lore categories (mirrors server/src/lore/format.ts), for pickers. */
export const LORE_CATEGORIES = [
  { id: "timeline", label: "Timeline boundary" },
  { id: "rule", label: "Rule" },
  { id: "ooc", label: "OOC" },
  { id: "character", label: "Character" },
  { id: "relationship", label: "Relationship" },
  { id: "voice", label: "Voice" },
  { id: "current", label: "Current" },
  { id: "belief", label: "Belief" },
  { id: "secret", label: "Secret" },
  { id: "faction", label: "Faction" },
  { id: "upcoming", label: "Upcoming" },
  { id: "item", label: "Item" },
  { id: "location", label: "Location" },
  { id: "history", label: "History" },
  { id: "customs", label: "Customs" },
  { id: "scene", label: "Scene" },
] as const;
export const categoryLabel = (id: string | null | undefined) => LORE_CATEGORIES.find((c) => c.id === id)?.label ?? "";
