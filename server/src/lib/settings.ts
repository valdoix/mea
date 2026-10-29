import { z } from "zod";
import { now, one, parseJson, run } from "../db/db";
import type { PromptSet } from "./prompts";
import type { RegexScript } from "./regex";

/** Story fonts (web/src/lib/fonts.ts lists them with their faces). */
export type StoryFont = "theme" | "newsreader" | "lora" | "literata" | "ebgaramond" | "cormorant" | "crimson" | "sourceserif" | "merriweather" | "alegreya" | "spectral" | "nunito" | "inter" | "atkinson" | "lexend";

export interface LivingPage {
  /** How dialogue shows who is speaking. */
  voices: "ink" | "blocks" | "chips" | "tint" | "script" | "ribbon" | "halo" | "off";
  /** Letters, texts and clippings drawn as objects. */
  artifacts: boolean;
  /** The visuals a model designs itself (<vtk>) drawn too; off shows their words. */
  freeform?: boolean;
  /** The painted window of time, weather and place. */
  window: boolean;
  /** Private thoughts under replies. */
  thoughts: "never" | "drawer" | "always";
  /** Each reply's plan: in a folded drawer or always open (planning itself is always on). */
  plan?: "drawer" | "always";
}

/** Typed app settings with defaults. Stored as JSON per key. */
export interface Settings {
  /** Profile used for story generation (CONN-03). */
  "routing.story": string | null;
  "appearance.theme": "lantern" | "wildflower" | "overprint" | "citadel" | "marquee" | "sugarrush" | "arcade" | "noir" | "rosewater" | "meringue" | "menagerie";
  /** J3: the soundtrack on YouTube Music (the token never goes to the browser). */
  "music.config": Record<string, unknown> | null;
  /** J3: songs found for your preferred artists, mood-tagged, by artist. */
  "music.taste": Record<string, unknown> | null;
  /** J3: songs you removed from the library yourself (a lookup never adds them back). */
  "music.removed": string[] | null;
  /** J2: your own colours for each room, by day and by night (CSS token → colour). */
  "appearance.colors": Record<string, { day?: Record<string, string>; night?: Record<string, string> }>;
  /** Day or night for the themes that have both (Wildflower, Overprint, Citadel, Marquee). */
  "appearance.themeMode": "system" | "day" | "night";
  "appearance.chatStyle": "cards" | "book" | "bubbles";
  "appearance.fontScale": number;
  "appearance.storyFont": StoryFont;
  /** LORE-15: underline lore terms in messages. */
  "appearance.glossary": boolean;
  /** UI-16 / UI-19: line height, paragraph spacing, text width, dialogue color, UI font, dyslexia-friendly font. */
  "appearance.typography": Typography;
  /** The living page: speaker colours, in-story artifacts, the scene window, private thoughts. */
  "appearance.living": LivingPage;
  "chat.enterToSend": boolean;
  "chat.defaultPresetId": string | null;
  /** The version of Mea's own preset last installed (0 = never). */
  "presets.meaVersion": number;
  "backup.hourlyKeep": number;
  "backup.dailyKeep": number;
  "push.vapid": { publicKey: string; privateKey: string } | null;
  "onboarding.done": boolean;
  "lore.defaults": { scanDepth: number; tokenBudget: number; recursive: boolean; maxRecursion: number; caseSensitive: boolean; matchWholeWords: boolean };
  "quota.cache": unknown;
  /** Helper task routing (CONN-03): profile ids; null falls back to the story profile. */
  "routing.tasks": { summarizer: string | null; helper: string | null; tracker: string | null; world: string | null; assistant?: string | null; planner?: string | null; /** The Lore Studio (unset: the memory summaries' profile, per call's task). */ studio?: string | null };
  /** Fallback chains per task (CONN-05): profile ids tried in order. */
  "routing.fallbacks": { story: string[]; summarizer: string[]; helper: string[]; tracker: string[]; world: string[]; assistant?: string[]; planner?: string[] };
  /** Timeouts per task in seconds. Story: time to the first token. */
  "routing.timeouts": { story: number; summarizer: number; helper: number; tracker: number; world: number; assistant?: number; planner?: number };
  /** Embeddings (MEM-11, ARCH-12): pay-as-you-go key, text-embedding-3-large @1024 by default. */
  "routing.embeddings": { connectionId: string | null; model: string; dims: number };
  "memory.config": MemoryConfig;
  /** Shed optional helpers above this share of the quota (CONN-20). */
  "quota.degradeAt": number;
  /** H2: warn when one chat's background calls pass this share of the day's quota. */
  "quota.chatShare": number;
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
  /** PROMPT-08: regex scripts for display, the prompt, or the stored text. */
  "regex.scripts": RegexScript[];
  /** PROMPT-09: helper prompt sets, and the one in use (null: Mea's defaults). */
  "prompts.sets": PromptSet[];
  "prompts.active": string | null;
  /** Phase 5 accuracy guards (CON-03…05, CON-10, CON-12). A chat's own `guards` settings win. */
  "guards.config": GuardsConfig;
  /** Phase 5 steering (STEER-01…03) and the "previously on" card (SUM-15). A chat's own switches win. */
  "steer.config": SteerConfig;
  /** F1: Session Zero's "my usual" answers (null until saved). */
  "setup.usual": import("../services/setup").SetupAnswers | null;
  /** SEC-06: how long the local request log keeps what. */
  "privacy.requestLog": { bodiesDays: number; rowsDays: number; fileLog: boolean; fileDays: number };
  /** How much the creators do in one go and how warm the model runs (null: Mea's default). */
  "creator.tuning": CreatorTuning;
}

/** The creators' knobs: writing vs judging temperature, and the caps on extra questions and proposals. */
export interface CreatorTuning {
  writeTemp: number | null;
  judgeTemp: number | null;
  deepenCap: number | null;
  peopleCount: number | null;
  namedTarget: number | null;
}

export interface Typography {
  uiFont: "nunito" | "system" | "inter" | "atkinson" | "lexend";
  lineHeight: number;
  paragraphSpacing: number;
  /** The story column's width, in rem. */
  width: number;
  /** null = the theme's dialogue color. */
  dialogueColor: string | null;
  dyslexic: boolean;
}
export const defaultTypography: Typography = { uiFont: "nunito", lineHeight: 1.7, paragraphSpacing: 0.75, width: 46, dialogueColor: null, dyslexic: false };

export interface SteerConfig {
  /** STEER-01: a private plan before each reply, written while you type. Default for chats that don't choose. */
  advisor: boolean;
  /** STEER-02: how many of its own earlier plans the advisor sees. */
  advisorMemory: number;
  /** At most this many seconds of waiting for a plan that isn't ready when you send (0 = never wait). */
  advisorWait: number;
  /** STEER-03: the post-pass editor. "flagged" runs only when the guards found something. */
  editor: "off" | "flagged" | "every";
  /** Show the editor's fixes as a diff to accept, or apply them (with undo). */
  editorApply: "suggest" | "auto";
  /** SUM-15: show a "previously on…" card when you come back after this many hours (0 = off). */
  recapAfterHours: number;
  /** D2: the adaptive craft coach (three habits to avoid, one technique to try). */
  craft: boolean;
}

export const defaultSteer: SteerConfig = { advisor: false, advisorMemory: 3, advisorWait: 6, editor: "off", editorApply: "suggest", recapAfterHours: 6, craft: true };

export const steerSchema = z.object({
  advisor: z.boolean(),
  advisorMemory: z.number().int().min(0).max(10),
  advisorWait: z.number().min(0).max(60),
  editor: z.enum(["off", "flagged", "every"]),
  editorApply: z.enum(["suggest", "auto"]),
  recapAfterHours: z.number().min(0).max(24 * 60),
  craft: z.boolean(),
});

/** SUM-10: how much each summary level keeps. */
export type Compression = "tight" | "balanced" | "detailed";

export interface GuardsConfig {
  /** CON-03: a short reminder of who the character is, near the end of the prompt. auto = once the chat is long, or while the voice drifts. */
  anchor: "auto" | "always" | "off";
  /** In auto mode, the re-anchor starts at this many messages. */
  anchorAfter: number;
  /** Messages from the end where the re-anchor goes. */
  anchorDepth: number;
  /** CON-04: point of view, tense, and the model writing for you. */
  pov: boolean;
  tense: boolean;
  puppet: boolean;
  /** What happens when a reply writes your character's words or actions: a note, cut the end, or one automatic retry. */
  puppetAction: "flag" | "trim" | "regenerate";
  /** CON-05: misspelled names, flagged or corrected in the stored reply. */
  names: "off" | "flag" | "fix";
  /** CON-10: compare the character's recent lines with their voice samples every N replies. */
  drift: boolean;
  driftEvery: number;
  /** 0–1: above this the voice counts as drifting, and the re-anchor gets stronger. */
  driftThreshold: number;
  /** CON-12: impossible time jumps against the story clock. */
  timeline: boolean;
  /** A forward jump bigger than this, with nothing in the reply saying time passed, is flagged. */
  maxJumpHours: number;
  /** P1: checks in the slip registry switched off (id → false); missing means on. */
  slips: Record<string, boolean>;
  /** A1: suggest lessons from the takes you swipe past and the replies you edit. */
  lessons: "off" | "rules" | "model";
}

export const guardsSchema = z.object({
  anchor: z.enum(["auto", "always", "off"]),
  anchorAfter: z.number().int().min(0).max(100_000),
  anchorDepth: z.number().int().min(0).max(40),
  pov: z.boolean(),
  tense: z.boolean(),
  puppet: z.boolean(),
  puppetAction: z.enum(["flag", "trim", "regenerate"]),
  names: z.enum(["off", "flag", "fix"]),
  drift: z.boolean(),
  driftEvery: z.number().int().min(1).max(100),
  driftThreshold: z.number().min(0.05).max(1),
  timeline: z.boolean(),
  maxJumpHours: z.number().min(1).max(24 * 365),
  slips: z.record(z.string().max(40), z.boolean()),
  lessons: z.enum(["off", "rules", "model"]),
});

export const defaultGuards: GuardsConfig = {
  anchor: "auto",
  anchorAfter: 30,
  anchorDepth: 3,
  pov: true,
  tense: true,
  puppet: true,
  puppetAction: "flag",
  names: "flag",
  drift: true,
  driftEvery: 6,
  driftThreshold: 0.45,
  timeline: true,
  maxJumpHours: 12,
  slips: {},
  lessons: "rules",
};

export interface TrackerDefaults {
  mode?: "helper" | "inline" | "off";
  cadence?: "every" | "everyN" | "scene" | "manual";
  everyN?: number;
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
  /** docs/21 5.3: news off the page travels on its own, waits for your word, or doesn't travel. */
  news: "auto" | "ask" | "off";
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
  /** H1: one ceiling, in tokens, for everything Mea adds to the prompt (0: automatic, from the model's room). */
  ceiling: number;
  /** H1: what goes first when space is short (lane or block ids; anything not listed is never cut). */
  cutOrder: string[];
  /** Recall budget split (MEM-12). */
  slots: { recent: number; relevant: number; serendipity: number };
  /** Strip markup and reasoning from messages older than this depth (CTX-07). */
  filterDepth: number;
  /** When history overflows, evict down to this share of its budget (CTX-05). */
  lowWater: number;
  /** Explicit cache TTL for paid Claude routes (CONN-12). */
  cacheTtl: "5m" | "1h";
  /** MEM-44: Light / Balanced / Deep presets; "custom" once you change a setting yourself. */
  profile: "light" | "balanced" | "deep" | "custom";
  /** MEM-16: whose point of view recall respects. "auto" follows the chat mode. */
  pov: "auto" | "character" | "narrator";
  /** MEM-37: how recalled memories are written into the prompt. */
  format: "prose" | "attributed" | "clinical" | "minimal";
  /** MEM-14: a helper rewrites the retrieval query during prefetch. */
  rewriteQuery: boolean;
  /** MEM-15: diversity in recall (0 = off, 1 = only diversity). */
  diversity: number;
  /** MEM-17: people and places in the scene pull in their entity card and top facts. */
  entityRecall: boolean;
  /** MEM-19: memories the replies use gain weight; unused trivia fades in ranking. */
  reinforcement: boolean;
  /** MEM-22: very old material is found through chapters, then quoted from the messages. */
  deepSearch: boolean;
  /** MEM-23: a helper filters recall candidates during prefetch. */
  librarian: boolean;
  /** MEM-29: first-person journals for the main character and important NPCs. */
  journals: boolean;
  /** MEM-42: an idle job merges duplicates, compresses trivia, refreshes entities. */
  consolidate: boolean;
  /** Reliable state 3.2: say in the prompt what card, lore and memory text the story has moved past. */
  correctOutdated: boolean;
  /** CON-02: check each reply against trackers and facts. */
  continuity: boolean;
  /** CON-06: flag secrets that a character shouldn't know. "auto" = on in Narrator mode. */
  leakGuard: "auto" | "on" | "off";
  /** CON-02 helper pass (the cheap rules always run). */
  checkerModel: boolean;
  /** LORE-12: propose Chronicle entries for people, places and things the story introduces. */
  chronicle: boolean;
  /** docs/15, part 2: propose updates to lore entries when the story changes what they describe. */
  loreKeepup: boolean;
  /** Since the card: keep a per-chat note of how the character and persona have changed since their cards were written. */
  sinceCard: boolean;
  /** docs/15, 6.1: the focus of the scene gets its full lore entry, the rest around it their essentials. */
  loreTiers: boolean;
  /** SUM-10: Tight / Balanced / Detailed per summary level. */
  compression: { scene: Compression; chapter: Compression; arc: Compression; story: Compression };
  /** SUM-11: tag dramatic moments in scene records and carry them up through every level. */
  moments: boolean;
  /** SUM-17: the voice every summary is written in. */
  voice: { tense: "past" | "present"; person: "third" | "first"; register: "record" | "storybook" };
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
  ceiling: 0,
  cutOrder: ["craft", "slips", "swipe-digest", "pressures", "promises", "style", "recall", "lessons", "advisor", "anchor", "trackers", "memory"],
  slots: { recent: 0.35, relevant: 0.5, serendipity: 0.15 },
  filterDepth: 6,
  lowWater: 0.7,
  cacheTtl: "5m",
  profile: "deep",
  pov: "auto",
  format: "prose",
  rewriteQuery: true,
  diversity: 0.3,
  entityRecall: true,
  reinforcement: true,
  deepSearch: true,
  librarian: true,
  journals: true,
  consolidate: true,
  correctOutdated: true,
  continuity: true,
  leakGuard: "auto",
  checkerModel: true,
  chronicle: true,
  loreKeepup: true,
  sinceCard: true,
  loreTiers: true,
  compression: { scene: "balanced", chapter: "balanced", arc: "balanced", story: "balanced" },
  moments: true,
  voice: { tense: "past", person: "third", register: "record" },
};

export const defaults: Settings = {
  "routing.story": null,
  "appearance.theme": "lantern",
  "appearance.colors": {},
  "music.config": null,
  "music.taste": null,
  "music.removed": null,
  "appearance.themeMode": "system",
  "appearance.chatStyle": "cards",
  "appearance.fontScale": 1,
  "appearance.storyFont": "newsreader",
  "appearance.glossary": true,
  "appearance.typography": defaultTypography,
  "appearance.living": { voices: "ink", artifacts: true, freeform: true, window: true, thoughts: "drawer" },
  "chat.enterToSend": false,
  "chat.defaultPresetId": null,
  "presets.meaVersion": 0,
  "backup.hourlyKeep": 24,
  "backup.dailyKeep": 14,
  "push.vapid": null,
  "onboarding.done": false,
  "lore.defaults": { scanDepth: 4, tokenBudget: 2048, recursive: true, maxRecursion: 3, caseSensitive: false, matchWholeWords: true },
  "quota.cache": null,
  "routing.tasks": { summarizer: null, helper: null, tracker: null, world: null, assistant: null },
  "routing.fallbacks": { story: [], summarizer: [], helper: [], tracker: [], world: [], assistant: [] },
  "routing.timeouts": { story: 120, summarizer: 300, helper: 90, tracker: 150, world: 180, assistant: 300, planner: 60 },
  "routing.embeddings": { connectionId: null, model: "text-embedding-3-large", dims: 1024 },
  "memory.config": defaultMemoryConfig,
  "quota.degradeAt": 0.9,
  "quota.chatShare": 0.25,
  "quota.calibration": { cachedWeight: null, samples: 0, updatedAt: null },
  "backup.mirror": { dir: "", encrypt: true, keep: 14, lastAt: null, lastError: null, secretId: null },
  "trackers.defaults": {},
  "world.defaults": { mode: "living", director: "steady", telling: "model", seeding: "ask", fates: "ask", news: "ask", view: "director", step: 120 },
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
  "regex.scripts": [],
  "prompts.sets": [],
  "prompts.active": null,
  "guards.config": defaultGuards,
  "steer.config": defaultSteer,
  "setup.usual": null,
  "privacy.requestLog": { bodiesDays: 30, rowsDays: 0, fileLog: true, fileDays: 14 },
  "creator.tuning": { writeTemp: null, judgeTemp: null, deepenCap: null, peopleCount: null, namedTarget: null },
};

/** Keys the web client may read and write directly. */
export const clientKeys: (keyof Settings)[] = [
  "regex.scripts",
  "prompts.sets",
  "prompts.active",
  "routing.story",
  "appearance.theme",
  "appearance.colors",
  "appearance.themeMode",
  "appearance.chatStyle",
  "appearance.fontScale",
  "appearance.storyFont",
  "appearance.glossary",
  "appearance.typography",
  "appearance.living",
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
  "quota.chatShare",
  "trackers.defaults",
  "world.defaults",
  "chat.guidance",
  "chat.banned",
  "chat.cutoff",
  "chat.retry",
  "guards.config",
  "steer.config",
  "privacy.requestLog",
  "creator.tuning",
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
  return {
    ...defaultMemoryConfig,
    ...c,
    budget: { ...defaultMemoryConfig.budget, ...c.budget },
    slots: { ...defaultMemoryConfig.slots, ...c.slots },
    compression: { ...defaultMemoryConfig.compression, ...c.compression },
    voice: { ...defaultMemoryConfig.voice, ...c.voice },
  };
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
