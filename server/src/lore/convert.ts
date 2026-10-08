import type { CardBook, CardBookEntry } from "../cards/card";
import { defaultEntry, type LoreEntry, type LoreLogic, type LorePosition, type LorebookSettings, type Role } from "./types";

/** SillyTavern numeric codes. */
const ST_POSITIONS: LorePosition[] = ["before_char", "after_char", "an_top", "an_bottom", "depth", "ex_top", "ex_bottom"];
const ST_LOGIC: LoreLogic[] = ["and_any", "not_all", "not_any", "and_all"];
const ST_ROLES: Role[] = ["system", "user", "assistant"];

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").map((s) => s.trim()).filter(Boolean) : typeof v === "string" && v.trim() ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const nullableBool = (v: unknown) => (typeof v === "boolean" ? v : null);
const nullableNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const ST_KNOWN = new Set([
  "uid", "key", "keysecondary", "comment", "content", "constant", "selective", "selectiveLogic", "order", "position",
  "disable", "excludeRecursion", "preventRecursion", "delayUntilRecursion", "probability", "useProbability", "depth",
  "group", "groupOverride", "groupWeight", "scanDepth", "caseSensitive", "matchWholeWords", "useGroupScoring",
  "role", "sticky", "cooldown", "delay", "displayIndex",
]);

/** Converts one SillyTavern World Info entry. */
export function fromStEntry(raw: unknown, fallbackUid: number): LoreEntry {
  const e = obj(raw);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) if (!ST_KNOWN.has(k)) extra[k] = v;
  return defaultEntry({
    uid: num(e.uid, fallbackUid),
    comment: typeof e.comment === "string" ? e.comment : "",
    keys: strArr(e.key),
    secondaryKeys: strArr(e.keysecondary),
    logic: ST_LOGIC[num(e.selectiveLogic, 0)] ?? "and_any",
    content: typeof e.content === "string" ? e.content : "",
    enabled: !bool(e.disable, false),
    constant: bool(e.constant, false),
    order: num(e.order, 100),
    position: ST_POSITIONS[num(e.position, 0)] ?? "before_char",
    depth: num(e.depth, 4),
    role: ST_ROLES[num(e.role, 0)] ?? "system",
    probability: num(e.probability, 100),
    useProbability: bool(e.useProbability, true),
    scanDepth: nullableNum(e.scanDepth),
    caseSensitive: nullableBool(e.caseSensitive),
    matchWholeWords: nullableBool(e.matchWholeWords),
    excludeRecursion: bool(e.excludeRecursion, false),
    preventRecursion: bool(e.preventRecursion, false),
    delayUntilRecursion: Boolean(e.delayUntilRecursion),
    group: typeof e.group === "string" ? e.group : "",
    groupOverride: bool(e.groupOverride, false),
    groupWeight: num(e.groupWeight, 100),
    useGroupScoring: nullableBool(e.useGroupScoring),
    sticky: num(e.sticky, 0),
    cooldown: num(e.cooldown, 0),
    delay: num(e.delay, 0),
    extra,
  });
}

export function toStEntry(e: LoreEntry, displayIndex: number) {
  return {
    ...e.extra,
    uid: e.uid,
    key: e.keys,
    keysecondary: e.secondaryKeys,
    comment: e.comment,
    content: e.content,
    constant: e.constant,
    selective: e.secondaryKeys.length > 0,
    selectiveLogic: Math.max(0, ST_LOGIC.indexOf(e.logic)),
    order: e.order,
    position: Math.max(0, ST_POSITIONS.indexOf(e.position)),
    disable: !e.enabled,
    excludeRecursion: e.excludeRecursion,
    preventRecursion: e.preventRecursion,
    delayUntilRecursion: e.delayUntilRecursion,
    probability: e.probability,
    useProbability: e.useProbability,
    depth: e.depth,
    group: e.group,
    groupOverride: e.groupOverride,
    groupWeight: e.groupWeight,
    scanDepth: e.scanDepth,
    caseSensitive: e.caseSensitive,
    matchWholeWords: e.matchWholeWords,
    useGroupScoring: e.useGroupScoring,
    role: Math.max(0, ST_ROLES.indexOf(e.role)),
    sticky: e.sticky,
    cooldown: e.cooldown,
    delay: e.delay,
    displayIndex,
  };
}

export interface ImportedBook {
  name: string;
  description: string;
  settings: LorebookSettings;
  entries: LoreEntry[];
}

/** Detects and converts a SillyTavern World Info file or a V2 character_book. */
export function importLorebook(json: unknown, fallbackName = "Imported lorebook"): ImportedBook {
  const root = obj(json);
  if (Array.isArray(root.entries)) return fromCardBook(root as unknown as CardBook, fallbackName);
  const entriesObj = obj(root.entries);
  const list = Object.values(entriesObj);
  if (!list.length && !("entries" in root)) throw new Error("Not a lorebook file");
  const entries = list.map((e, i) => fromStEntry(e, i)).sort((a, b) => num(a.extra.displayIndex, a.uid) - num(b.extra.displayIndex, b.uid));
  return {
    name: typeof root.name === "string" && root.name ? root.name : fallbackName,
    description: typeof root.description === "string" ? root.description : "",
    settings: {},
    entries,
  };
}

export function exportStWorldInfo(name: string, description: string, entries: LoreEntry[]) {
  const out: Record<string, unknown> = {};
  entries.forEach((e, i) => {
    out[String(e.uid)] = toStEntry(e, i);
  });
  return { name, description, entries: out };
}

/** V2 character_book → entries. ST stores its extra fields in entry.extensions. */
export function fromCardBook(book: CardBook, fallbackName = "Character lore"): ImportedBook {
  const entries = (book.entries ?? []).map((raw: CardBookEntry, i) => {
    const ext = obj(raw.extensions);
    const stPos = typeof ext.position === "number" ? ST_POSITIONS[ext.position] : undefined;
    const known = new Set(["keys", "secondary_keys", "content", "enabled", "insertion_order", "constant", "selective", "position", "case_sensitive", "name", "comment", "id", "extensions", "priority", "use_regex"]);
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) if (!known.has(k)) extra[k] = v;
    const extKnown = new Set(["position", "depth", "role", "probability", "useProbability", "group", "group_override", "group_weight", "selectiveLogic", "exclude_recursion", "prevent_recursion", "delay_until_recursion", "scan_depth", "match_whole_words", "use_group_scoring", "case_sensitive", "sticky", "cooldown", "delay", "display_index", "weight"]);
    const extExtra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ext)) if (!extKnown.has(k)) extExtra[k] = v;
    if (Object.keys(extExtra).length) extra.extensions = extExtra;
    return defaultEntry({
      uid: typeof raw.id === "number" ? raw.id : i,
      comment: (typeof raw.comment === "string" && raw.comment) || (typeof raw.name === "string" ? raw.name : ""),
      keys: strArr(raw.keys),
      secondaryKeys: strArr(raw.secondary_keys),
      logic: ST_LOGIC[num(ext.selectiveLogic, 0)] ?? "and_any",
      content: typeof raw.content === "string" ? raw.content : "",
      enabled: raw.enabled !== false,
      constant: Boolean(raw.constant),
      order: num(raw.insertion_order, 100),
      position: stPos ?? (raw.position === "after_char" ? "after_char" : "before_char"),
      depth: num(ext.depth, 4),
      role: ST_ROLES[num(ext.role, 0)] ?? "system",
      probability: num(ext.probability, 100),
      useProbability: bool(ext.useProbability, true),
      scanDepth: nullableNum(ext.scan_depth),
      caseSensitive: nullableBool(raw.case_sensitive ?? ext.case_sensitive),
      matchWholeWords: nullableBool(ext.match_whole_words),
      excludeRecursion: bool(ext.exclude_recursion, false),
      preventRecursion: bool(ext.prevent_recursion, false),
      delayUntilRecursion: Boolean(ext.delay_until_recursion),
      group: typeof ext.group === "string" ? ext.group : "",
      groupOverride: bool(ext.group_override, false),
      groupWeight: num(ext.group_weight ?? ext.weight, 100),
      useGroupScoring: nullableBool(ext.use_group_scoring),
      sticky: num(ext.sticky, 0),
      cooldown: num(ext.cooldown, 0),
      delay: num(ext.delay, 0),
      extra,
    });
  });
  const settings: LorebookSettings = {};
  if (typeof book.scan_depth === "number") settings.scanDepth = book.scan_depth;
  if (typeof book.token_budget === "number") settings.tokenBudget = book.token_budget;
  if (typeof book.recursive_scanning === "boolean") settings.recursive = book.recursive_scanning;
  return { name: (typeof book.name === "string" && book.name) || fallbackName, description: typeof book.description === "string" ? book.description : "", settings, entries };
}

export function toCardBook(name: string, description: string, settings: LorebookSettings, entries: LoreEntry[]): CardBook {
  return {
    name,
    description,
    ...(settings.scanDepth != null ? { scan_depth: settings.scanDepth } : {}),
    ...(settings.tokenBudget != null ? { token_budget: settings.tokenBudget } : {}),
    ...(settings.recursive != null ? { recursive_scanning: settings.recursive } : {}),
    extensions: {},
    entries: entries.map((e, i) => {
      const { extensions: extraExt, ...extraRest } = e.extra as { extensions?: Record<string, unknown> };
      return {
        ...extraRest,
        id: e.uid,
        keys: e.keys,
        secondary_keys: e.secondaryKeys,
        comment: e.comment,
        content: e.content,
        constant: e.constant,
        selective: e.secondaryKeys.length > 0,
        insertion_order: e.order,
        enabled: e.enabled,
        position: e.position === "after_char" ? "after_char" : "before_char",
        ...(e.caseSensitive != null ? { case_sensitive: e.caseSensitive } : {}),
        extensions: {
          ...(extraExt ?? {}),
          position: Math.max(0, ST_POSITIONS.indexOf(e.position)),
          depth: e.depth,
          role: Math.max(0, ST_ROLES.indexOf(e.role)),
          probability: e.probability,
          useProbability: e.useProbability,
          selectiveLogic: Math.max(0, ST_LOGIC.indexOf(e.logic)),
          group: e.group,
          group_override: e.groupOverride,
          group_weight: e.groupWeight,
          exclude_recursion: e.excludeRecursion,
          prevent_recursion: e.preventRecursion,
          delay_until_recursion: e.delayUntilRecursion,
          scan_depth: e.scanDepth,
          match_whole_words: e.matchWholeWords,
          use_group_scoring: e.useGroupScoring,
          sticky: e.sticky,
          cooldown: e.cooldown,
          delay: e.delay,
          display_index: i,
        },
      };
    }),
  };
}
