import { defaultMemoryConfig, getSetting, type MemoryConfig, memoryConfig, setSetting } from "../lib/settings";

/**
 * Memory profiles (MEM-44): Light / Balanced / Deep set how often helpers run, how big the
 * memory budgets are, and which extras are on. Deep is the default. Changing any of these
 * settings yourself turns the profile into "custom" (Advanced mode exposes everything).
 */

type ProfileValues = Partial<Omit<MemoryConfig, "profile">>;

export const MEMORY_PROFILES: Record<"light" | "balanced" | "deep", { label: string; about: string; values: ProfileValues }> = {
  light: {
    label: "Light",
    about: "Scene records without checks, smaller memory budgets, no journals, librarian or deep search. Cheapest on quota.",
    values: {
      verify: false,
      autoRepair: false,
      boundaryCheck: false,
      sceneTokenCap: 8000,
      scenesPerChapter: 8,
      budget: { summaries: 0.08, recall: 0.04 },
      rewriteQuery: false,
      librarian: false,
      deepSearch: false,
      journals: false,
      consolidate: true,
      entityRecall: true,
      reinforcement: true,
      continuity: true,
      checkerModel: false,
      chronicle: false,
    },
  },
  balanced: {
    label: "Balanced",
    about: "Checked scene records, journals and deep search; the librarian and the checker's model pass stay off.",
    values: {
      verify: true,
      autoRepair: false,
      boundaryCheck: true,
      sceneTokenCap: 6000,
      scenesPerChapter: 6,
      budget: { summaries: 0.1, recall: 0.05 },
      rewriteQuery: true,
      librarian: false,
      deepSearch: true,
      journals: true,
      consolidate: true,
      entityRecall: true,
      reinforcement: true,
      continuity: true,
      checkerModel: false,
      chronicle: true,
    },
  },
  deep: {
    label: "Deep",
    about: "Everything on: verified and repaired records, librarian, rewritten queries, journals, deep search, the full continuity check.",
    values: {
      verify: true,
      autoRepair: true,
      boundaryCheck: true,
      sceneTokenCap: defaultMemoryConfig.sceneTokenCap,
      scenesPerChapter: defaultMemoryConfig.scenesPerChapter,
      budget: { ...defaultMemoryConfig.budget },
      rewriteQuery: true,
      librarian: true,
      deepSearch: true,
      journals: true,
      consolidate: true,
      entityRecall: true,
      reinforcement: true,
      continuity: true,
      checkerModel: true,
      chronicle: true,
    },
  },
};

export function applyMemoryProfile(name: keyof typeof MEMORY_PROFILES) {
  const cur = memoryConfig();
  const next: MemoryConfig = { ...cur, ...MEMORY_PROFILES[name].values, profile: name };
  setSetting("memory.config", next);
  return next;
}

/** Which profile the current settings match, if any (custom once you change one yourself). */
export function matchingProfile(cfg: MemoryConfig = memoryConfig()): MemoryConfig["profile"] {
  for (const [name, p] of Object.entries(MEMORY_PROFILES) as [keyof typeof MEMORY_PROFILES, (typeof MEMORY_PROFILES)["deep"]][]) {
    const ok = Object.entries(p.values).every(([k, v]) => JSON.stringify((cfg as unknown as Record<string, unknown>)[k]) === JSON.stringify(v));
    if (ok) return name;
  }
  return "custom";
}

/** Keeps the profile label honest when memory.config is saved from the settings page. */
export function normalizeMemoryConfig(value: MemoryConfig): MemoryConfig {
  const merged = { ...getSetting("memory.config"), ...value };
  return { ...merged, profile: matchingProfile(merged) };
}
