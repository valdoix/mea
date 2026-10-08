export type LorePosition = "before_char" | "after_char" | "an_top" | "an_bottom" | "depth" | "ex_top" | "ex_bottom";
export type LoreLogic = "and_any" | "not_all" | "not_any" | "and_all";
export type Role = "system" | "user" | "assistant";

/** A lorebook entry. Field names follow SillyTavern semantics (LORE-01). */
export interface LoreEntry {
  uid: number;
  comment: string;
  keys: string[];
  secondaryKeys: string[];
  logic: LoreLogic;
  content: string;
  enabled: boolean;
  constant: boolean;
  order: number;
  position: LorePosition;
  depth: number;
  role: Role;
  probability: number;
  useProbability: boolean;
  scanDepth: number | null;
  caseSensitive: boolean | null;
  matchWholeWords: boolean | null;
  excludeRecursion: boolean;
  preventRecursion: boolean;
  delayUntilRecursion: boolean;
  group: string;
  groupOverride: boolean;
  groupWeight: number;
  useGroupScoring: boolean | null;
  sticky: number;
  cooldown: number;
  delay: number;
  /** Unknown fields from imports, preserved for export. */
  extra: Record<string, unknown>;
}

export interface LorebookSettings {
  scanDepth?: number;
  tokenBudget?: number;
  recursive?: boolean;
  caseSensitive?: boolean;
  matchWholeWords?: boolean;
}

export function defaultEntry(partial: Partial<LoreEntry> = {}): LoreEntry {
  return {
    uid: 0,
    comment: "",
    keys: [],
    secondaryKeys: [],
    logic: "and_any",
    content: "",
    enabled: true,
    constant: false,
    order: 100,
    position: "before_char",
    depth: 4,
    role: "system",
    probability: 100,
    useProbability: true,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    group: "",
    groupOverride: false,
    groupWeight: 100,
    useGroupScoring: null,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    extra: {},
    ...partial,
  };
}
