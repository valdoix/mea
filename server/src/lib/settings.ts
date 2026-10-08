import { now, one, parseJson, run } from "../db/db";

/** Typed app settings with defaults. Stored as JSON per key. */
export interface Settings {
  /** Profile used for story generation (CONN-03). */
  "routing.story": string | null;
  "appearance.theme": "system" | "light" | "dark";
  "appearance.chatStyle": "cards" | "book" | "bubbles";
  "appearance.fontScale": number;
  "appearance.storyFont": "lora" | "literata" | "nunito";
  "chat.enterToSend": boolean;
  "chat.defaultPresetId": string | null;
  "backup.hourlyKeep": number;
  "backup.dailyKeep": number;
  "push.vapid": { publicKey: string; privateKey: string } | null;
  "onboarding.done": boolean;
  "lore.defaults": { scanDepth: number; tokenBudget: number; recursive: boolean; maxRecursion: number; caseSensitive: boolean; matchWholeWords: boolean };
  "quota.cache": unknown;
  /** Helper task routing (CONN-03): profile ids; null falls back to the story profile. */
  "routing.tasks": { summarizer: string | null; helper: string | null; tracker: string | null; world: string | null };
  /** Fallback chains per task (CONN-05): profile ids tried in order. */
  "routing.fallbacks": { story: string[]; summarizer: string[]; helper: string[]; tracker: string[]; world: string[] };
  /** Timeouts per task in seconds. Story: time to the first token. */
  "routing.timeouts": { story: number; summarizer: number; helper: number; tracker: number; world: number };
  /** Embeddings (MEM-11, ARCH-12): pay-as-you-go key, text-embedding-3-large @1024 by default. */
  "routing.embeddings": { connectionId: string | null; model: string; dims: number };
  "memory.config": MemoryConfig;
  /** Shed optional helpers above this share of the quota (CONN-20). */
  "quota.degradeAt": number;
  /** Measured share of cached input tokens that counts toward the quota (CONN-22). */
  "quota.calibration": { cachedWeight: number | null; samples: number; updatedAt: number | null };
  /** Off-machine backup copy (DATA-08). */
  "backup.mirror": { dir: string; encrypt: boolean; keep: number; lastAt: number | null; lastError: string | null; secretId: string | null };
  /** Tracker defaults for every chat (TRK-08); a character's and a chat's own settings win. */
  "trackers.defaults": TrackerDefaults;
  /** World simulation defaults (sim/). */
  "world.defaults": WorldDefaults;
  /** CHAT-11: reusable guidance chips. */
  "chat.guidance": GuidanceChip[];
  /** CHAT-19: phrases you never want to read. */
  "chat.banned": { list: { phrase: string; replace?: string }[]; action: "flag" | "regenerate" | "replace"; remind: boolean };
  /** CHAT-14: a reply cut off by the length limit. */
  "chat.cutoff": "continue" | "trim" | "off";
  /** CONN-09: retry empty replies, refusals and server errors. */
  "chat.retry": { empty: boolean; refusal: boolean; serverErrors: boolean };
}

export interface TrackerDefaults {
  mode?: "helper" | "inline" | "off";
  cadence?: "every" | "everyN" | "scene" | "manual";
  everyN?: number;
  gate?: boolean;
  sections?: Record<string, boolean>;
  romance?: "off" | "slow" | "measured" | "fast" | "established";
  sealed?: boolean;
  strictness?: "strict" | "lenient";
  limits?: boolean;
  budget?: number;
  quietAfter?: number;
  nudges?: boolean;
}

export interface WorldDefaults {
  mode: "off" | "quiet" | "living" | "restless";
  director: "steady" | "rising" | "chaotic" | "gentle";
  telling: "model" | "engine";
  seeding: "auto" | "ask" | "off";
  fates: "page" | "ask" | "allow";
  view: "director" | "surprise";
  step: number;
}

export interface GuidanceChip {
  id: string;
  name: string;
  text: string;
  /** once: used for the next reply only; persistent: stays on until switched off. */
  mode: "once" | "persistent";
  /** Switch on by itself for these characters, or when a tracker condition holds (TRK-12). */
  auto?: { characterIds?: string[]; when?: string };
}

export interface MemoryConfig {
  enabled: boolean;
  /** Close a scene once it holds this many tokens (MEM-03). */
  sceneTokenCap: number;
  /** A real-world pause this long starts a new scene. */
  pauseHours: number;
  /** The newest K messages are never segmented or summarized (SUM-06). */
  lag: number;
  /** Ask the helper model to confirm weak scene-break signals. */
  boundaryCheck: boolean;
  scenesPerChapter: number;
  chaptersPerArc: number;
  /** SUM-12 verification pass, with one automatic repair when it finds problems. */
  verify: boolean;
  autoRepair: boolean;
  /** MEM-10: rebuild stale memory automatically, or wait for you to review. */
  onEdit: "auto" | "ask";
  /** Shares of the prompt target (CTX-01). */
  budget: { summaries: number; recall: number };
  /** Recall budget split (MEM-12). */
  slots: { recent: number; relevant: number; serendipity: number };
  /** Strip markup and reasoning from messages older than this depth (CTX-07). */
  filterDepth: number;
  /** When history overflows, evict down to this share of its budget (CTX-05). */
  lowWater: number;
  /** Explicit cache TTL for paid Claude routes (CONN-12). */
  cacheTtl: "5m" | "1h";
}

export const defaultMemoryConfig: MemoryConfig = {
  enabled: true,
  sceneTokenCap: 6000,
  pauseHours: 6,
  lag: 2,
  boundaryCheck: true,
  scenesPerChapter: 6,
  chaptersPerArc: 4,
  verify: true,
  autoRepair: true,
  onEdit: "auto",
  budget: { summaries: 0.12, recall: 0.06 },
  slots: { recent: 0.35, relevant: 0.5, serendipity: 0.15 },
  filterDepth: 6,
  lowWater: 0.7,
  cacheTtl: "5m",
};

export const defaults: Settings = {
  "routing.story": null,
  "appearance.theme": "system",
  "appearance.chatStyle": "cards",
  "appearance.fontScale": 1,
  "appearance.storyFont": "lora",
  "chat.enterToSend": false,
  "chat.defaultPresetId": null,
  "backup.hourlyKeep": 24,
  "backup.dailyKeep": 14,
  "push.vapid": null,
  "onboarding.done": false,
  "lore.defaults": { scanDepth: 4, tokenBudget: 2048, recursive: true, maxRecursion: 3, caseSensitive: false, matchWholeWords: true },
  "quota.cache": null,
  "routing.tasks": { summarizer: null, helper: null, tracker: null, world: null },
  "routing.fallbacks": { story: [], summarizer: [], helper: [], tracker: [], world: [] },
  "routing.timeouts": { story: 120, summarizer: 300, helper: 90, tracker: 150, world: 180 },
  "routing.embeddings": { connectionId: null, model: "text-embedding-3-large", dims: 1024 },
  "memory.config": defaultMemoryConfig,
  "quota.degradeAt": 0.9,
  "quota.calibration": { cachedWeight: null, samples: 0, updatedAt: null },
  "backup.mirror": { dir: "", encrypt: false, keep: 14, lastAt: null, lastError: null, secretId: null },
  "trackers.defaults": {},
  "world.defaults": { mode: "living", director: "steady", telling: "model", seeding: "ask", fates: "ask", view: "director", step: 120 },
  "chat.guidance": [
    { id: "g-slow", name: "Slow down", text: "Slow the pace: stay in this moment, with detail and interiority, and don't skip ahead.", mode: "once" },
    { id: "g-dialogue", name: "More dialogue", text: "Lean on dialogue this reply; keep narration light.", mode: "once" },
    { id: "g-sensory", name: "Sensory detail", text: "Ground the reply in concrete sensory detail: sound, smell, texture, light.", mode: "persistent" },
    { id: "g-twist", name: "Complicate it", text: "Introduce a believable complication that grows out of what's already established.", mode: "once" },
    { id: "g-quiet", name: "Quiet moment", text: "Let this be a quiet, intimate moment; no new events.", mode: "once" },
  ],
  "chat.banned": {
    list: [
      { phrase: "a shiver ran down" },
      { phrase: "barely above a whisper" },
      { phrase: "ministrations" },
      { phrase: "eyes sparkling with mischief" },
      { phrase: "a mix of" },
      { phrase: "maybe, just maybe" },
      { phrase: "little did they know" },
      { phrase: "the air was thick with" },
      { phrase: "breath she didn't know she was holding" },
      { phrase: "breath he didn't know he was holding" },
      { phrase: "padded over" },
      { phrase: "smirked" },
      { phrase: "orbs" },
    ],
    action: "flag",
    remind: false,
  },
  "chat.cutoff": "continue",
  "chat.retry": { empty: true, refusal: true, serverErrors: true },
};

/** Keys the web client may read and write directly. */
export const clientKeys: (keyof Settings)[] = [
  "routing.story",
  "appearance.theme",
  "appearance.chatStyle",
  "appearance.fontScale",
  "appearance.storyFont",
  "chat.enterToSend",
  "chat.defaultPresetId",
  "backup.hourlyKeep",
  "backup.dailyKeep",
  "onboarding.done",
  "lore.defaults",
  "routing.tasks",
  "routing.fallbacks",
  "routing.timeouts",
  "routing.embeddings",
  "memory.config",
  "quota.degradeAt",
  "trackers.defaults",
  "world.defaults",
  "chat.guidance",
  "chat.banned",
  "chat.cutoff",
  "chat.retry",
];

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  const row = one<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  const value = row ? parseJson(row.value, defaults[key]) : defaults[key];
  // Object settings gain new fields over time; fill them from the defaults.
  const d = defaults[key];
  if (d && typeof d === "object" && !Array.isArray(d) && value && typeof value === "object") return { ...d, ...value } as Settings[K];
  return value;
}

export function memoryConfig(): MemoryConfig {
  const c = getSetting("memory.config");
  return { ...c, budget: { ...defaultMemoryConfig.budget, ...c.budget }, slots: { ...defaultMemoryConfig.slots, ...c.slots } };
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    JSON.stringify(value),
  );
  settingsVersion = now();
}

export let settingsVersion = now();

export function getClientSettings(): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const k of clientKeys) (out as Record<string, unknown>)[k] = getSetting(k);
  return out;
}
