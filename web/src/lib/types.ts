import type { StoryFontId, UiFontId } from "./fonts";

export type Role = "system" | "user" | "assistant";
export type ChatMode = "companion" | "narrator";

export interface CardData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  group_only_greetings: string[];
  tags: string[];
  creator: string;
  character_version: string;
  nickname?: string;
  extensions: Record<string, unknown>;
  [k: string]: unknown;
}

export interface CharacterSummary {
  id: string;
  name: string;
  avatarId: string | null;
  tags: string[];
  folder: string | null;
  favorite: boolean;
  palette: string[];
  creatorNotes: string;
  chatCount: number;
  lastUsedAt: number | null;
  updatedAt: number;
  createdAt: number;
}

export interface TokenCounts {
  fields: Record<string, number>;
  permanent: number;
  temporary: number;
}

export interface Character {
  id: string;
  name: string;
  card: CardData;
  avatarId: string | null;
  gallery: string[];
  tags: string[];
  folder: string | null;
  favorite: boolean;
  defaultPersonaId: string | null;
  mode: ChatMode | null;
  palette: string[];
  lorebooks: { id: string; name: string }[];
  settings: CharacterSettings;
  tokens: TokenCounts;
  versionCount: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface PersonaData {
  pronouns: string;
  description: string;
  appearance: string;
  personality: string;
  background: string;
}

export interface Persona {
  id: string;
  name: string;
  data: PersonaData;
  avatarId: string | null;
  isDefault: boolean;
  lorebooks?: { id: string; name: string }[];
}

/** UI-08: per-chat ambience. */
export interface Ambience {
  accent?: boolean;
  imageId?: string | null;
  blur?: number;
  dim?: number;
  vignette?: boolean;
  panel?: number;
}

export interface ChatSettings {
  authorsNote?: { content: string; depth: number; role: Role };
  profileId?: string | null;
  presetId?: string | null;
  trackers?: Partial<TrackerConfig>;
  world?: Partial<WorldConfig>;
  story?: { genre?: string; tone?: string; pov?: string; tense?: string; style?: string; intensity?: string; language?: string };
  length?: "short" | "normal" | "long" | null;
  pacing?: "slow" | "normal" | "fast" | null;
  ooc?: { id: string; text: string }[];
  cue?: string | null;
  guidance?: { active?: string[]; once?: string[] };
  director?: boolean;
  modelOverride?: { connectionId: string; modelId: string } | null;
  truths?: string[];
  controls?: ControlValues;
  variantId?: string | null;
  personaVariantId?: string | null;
  /** Phase 5: this chat's own guard settings over the global ones. */
  guards?: Partial<GuardsConfig>;
  /** STEER-01 / STEER-03 (null = the global default). */
  advisor?: boolean | null;
  editor?: "off" | "flagged" | "every" | null;
  /** STEER-04 */
  /** UI-08 */
  ambience?: Ambience;
  style?: StyleProfile;
}

export interface Chat {
  id: string;
  characterId: string | null;
  personaId: string | null;
  title: string;
  mode: ChatMode;
  settings: ChatSettings;
  messageCount: number;
  createdAt: number;
  lastMessageAt: number | null;
  archivedAt: number | null;
  /** LIB-04: you named it yourself, so the Story So Far won't. */
  titleLocked?: boolean;
  coverImageId?: string | null;
}

export interface ChatListItem extends Chat {
  /** LIB-06 */
  collections?: string[];
  characterName: string | null;
  avatarId: string | null;
  lastText: string;
  lastRole: string | null;
}

export interface SwipeInfo {
  idx: number;
  content: string;
  status: string;
  error: string | null;
  meta: Record<string, any>;
}

export interface Message {
  id: string;
  chatId: string;
  seq: number;
  role: Role;
  name: string | null;
  hidden: boolean;
  bookmarked: boolean;
  activeSwipe: number;
  swipeCount: number;
  content: string;
  reasoning: string | null;
  status: "done" | "streaming" | "error" | "stopped";
  error: string | null;
  meta: Record<string, any>;
  swipes?: SwipeInfo[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatDetail {
  chat: Chat;
  character?: { id: string; name: string; avatarId: string | null; palette: string[]; mode: ChatMode | null; tags: string[] };
  persona?: { id: string; name: string; avatarId: string | null };
  lorebooks: { id: string; name: string }[];
  active: { generationId: string; chatId: string; messageId: string; swipeIdx: number; text: string; reasoning: string }[];
  /** CHAR-06 / PER-05 */
  variants?: { id: string; name: string; note: string }[];
  personaVariants?: { id: string; name: string; note: string }[];
  /** PROMPT-06: what applies when the chat leaves a choice empty. */
  defaults?: { from: { preset: "chat" | "character" | "global"; profile: "chat" | "character" | "global"; authorsNote: "chat" | "character" | null }; presetId: string | null; profileId: string | null; characterControls: ControlValues; characterStyle?: StyleProfile | null };
  /** SUM-20: messages up to this seq reach the model through memory, not word for word. */
  memory?: { evictedThrough: number };
}

export type LorePosition = "before_char" | "after_char" | "an_top" | "an_bottom" | "depth" | "ex_top" | "ex_bottom";

export interface LoreEntry {
  id: string;
  uid: number;
  comment: string;
  keys: string[];
  secondaryKeys: string[];
  logic: "and_any" | "not_all" | "not_any" | "and_all";
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
  extra: Record<string, unknown>;
}

export interface LorebookSettings {
  scanDepth?: number;
  tokenBudget?: number;
  recursive?: boolean;
  caseSensitive?: boolean;
  matchWholeWords?: boolean;
  /** LORE-05 */
  semantic?: boolean;
  /** LORE-12 */
  chronicleFor?: string;
}

export interface LoreLink {
  type: "global" | "character" | "persona" | "chat";
  id: string;
}

export interface LorebookSummary {
  id: string;
  name: string;
  description: string;
  settings: LorebookSettings;
  entryCount: number;
  links: LoreLink[];
  updatedAt: number;
}

export interface Lorebook {
  id: string;
  name: string;
  description: string;
  settings: LorebookSettings;
  links: LoreLink[];
  entries: LoreEntry[];
}

export interface LoreTrace {
  id: string;
  bookName: string;
  comment: string;
  status: "active" | "inactive";
  reason: string;
  level?: number;
  tokens?: number;
  position?: LorePosition;
  order: number;
}

export type BlockKind =
  | "text"
  | "character"
  | "description"
  | "personality"
  | "scenario"
  | "persona"
  | "examples"
  | "lore_before"
  | "lore_after"
  | "history"
  | "authors_note"
  | "post_history"
  | "memory_story"
  | "memory_recall"
  | "controls";

export interface PromptBlock {
  id: string;
  name: string;
  kind: BlockKind;
  enabled: boolean;
  role: Role;
  position: "inline" | "depth";
  depth?: number;
  content?: string;
  /** Sent only while this holds on the story state, e.g. "mode = conflict". */
  when?: string;
}

export interface Preset {
  id?: string;
  name: string;
  mode: "simple" | "advanced";
  blocks: PromptBlock[];
  samplers: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    min_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    repetition_penalty?: number;
    max_tokens?: number;
    seed?: number;
    stop?: string[];
  };
  impersonationPrompt: string;
  expandPrompt: string;
  continuePrompt: string;
  prefill: string;
  simple: { length: "short" | "normal" | "long"; style: string };
  importNotes?: string[];
  controls: PresetControl[];
  /** Sent when you send nothing and the last message is already a reply. */
  waitPrompt?: string;
  /** "mea" on Mea's own installed preset. */
  builtin?: string;
}

/** PROMPT-07: a friendly switch a preset exposes. */
export interface PresetControl {
  id: string;
  label: string;
  help: string;
  type: "toggle" | "choice" | "text";
  default: boolean | string;
  /** Toggle: the instruction while on. Text: the instruction, with {{value}} for what you typed. */
  text: string;
  options: { value: string; label: string; text: string }[];
  /** Listed under "More" in the chat panel. */
  advanced?: boolean;
}
export type ControlValues = Record<string, boolean | string>;

/** PROMPT-06 / CHAR-07 / CHAR-14: per-character settings. */
export interface CharacterSettings {
  notes?: string;
  sourceUrl?: string;
  presetId?: string | null;
  profileId?: string | null;
  authorsNote?: { content: string; depth: number; role: "system" | "user" | "assistant" } | null;
  story?: Partial<Record<"genre" | "tone" | "pov" | "tense" | "style" | "intensity" | "language", string>>;
  truths?: string[];
  controls?: ControlValues;
  voice?: { kept: { id: string; situation: string; cue: string; line: string }[] };
  /** CON-03: your own re-anchor text. */
  anchor?: string;
  /** STEER-04: the default style profile for this character's chats. */
  style?: StyleProfile;
}

/** PROMPT-08 */
export interface RegexScript {
  id: string;
  name: string;
  find: string;
  replace: string;
  targets: ("ai" | "user")[];
  mode: "display" | "prompt" | "persistent";
  enabled: boolean;
  characterIds: string[];
}

/** PROMPT-09 */
export interface PromptSet {
  id: string;
  name: string;
  overrides: Record<string, { mode: "append" | "replace"; text: string }>;
}

export interface Connection {
  id: string;
  name: string;
  kind: "nanogpt" | "openai" | "mock";
  baseUrl: string;
  billing: "subscription" | "paygo" | "unknown";
  hasKey: boolean;
  keyMask: string | null;
  modelCount: number;
  lastSyncAt: number | null;
  lastError: string | null;
  format?: "openai" | "anthropic";
}

export interface ModelInfo {
  connectionId: string;
  id: string;
  name: string;
  contextLength: number | null;
  maxOutput: number | null;
  capabilities: Record<string, any>;
  pricing: Record<string, any>;
  subscription: boolean;
  starred: boolean;
  learnedContext?: number | null;
  calibration?: number | null;
  cacheProbe?: CacheProbe | null;
}

export interface ProfileParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  max_tokens?: number;
  reasoning_effort?: string;
  hide_reasoning?: boolean;
  context_target?: number;
  cache?: "auto" | "off";
  prefill?: string;
}

export interface Profile {
  id: string;
  name: string;
  connectionId: string | null;
  modelId: string | null;
  params: ProfileParams;
}

export interface QuotaWindow {
  used: number | null;
  limit: number | null;
  remaining: number | null;
  percentUsed: number | null;
  resetAt: number | null;
}

export interface Quota {
  active: boolean;
  daily: QuotaWindow | null;
  weekly: QuotaWindow | null;
  recommendedMode: string | null;
  fetchedAt: number;
}

/** UI-16 / UI-19 */
export interface Typography {
  uiFont: UiFontId;
  lineHeight: number;
  paragraphSpacing: number;
  width: number;
  dialogueColor: string | null;
  dyslexic: boolean;
}

export interface LivingPage {
  voices: "ink" | "ribbon" | "halo" | "off";
  artifacts: boolean;
  window: boolean;
  thoughts: "never" | "drawer" | "always";
}

export interface Settings {
  "routing.story": string | null;
  "appearance.theme": "system" | "light" | "dark" | "lantern" | "wildflower" | "overprint" | "citadel" | "marquee";
  /** Day or night for the themes that have both (Wildflower, Overprint, Citadel, Marquee). */
  "appearance.themeMode": "system" | "day" | "night";
  "appearance.chatStyle": "cards" | "book" | "bubbles";
  "appearance.fontScale": number;
  "appearance.storyFont": StoryFontId;
  /** LORE-15: underline lore terms in messages. */
  "appearance.glossary": boolean;
  "appearance.typography"?: Typography;
  "appearance.living"?: LivingPage;
  "chat.enterToSend": boolean;
  "chat.defaultPresetId": string | null;
  "backup.hourlyKeep": number;
  "backup.dailyKeep": number;
  "onboarding.done": boolean;
  "lore.defaults": { scanDepth: number; tokenBudget: number; recursive: boolean; maxRecursion: number; caseSensitive: boolean; matchWholeWords: boolean };
  "routing.tasks": { summarizer: string | null; helper: string | null; tracker: string | null; world: string | null };
  "routing.fallbacks": { story: string[]; summarizer: string[]; helper: string[]; tracker: string[]; world: string[] };
  "routing.timeouts": { story: number; summarizer: number; helper: number; tracker: number; world: number };
  "routing.embeddings": { connectionId: string | null; model: string; dims: number };
  "memory.config": MemoryConfig;
  "quota.degradeAt": number;
  "trackers.defaults": Partial<TrackerConfig>;
  "world.defaults": { mode: WorldConfig["mode"]; director: WorldConfig["director"]; telling: WorldConfig["telling"]; seeding: WorldConfig["seeding"]; fates: WorldConfig["fates"]; view: WorldConfig["view"]; step: number };
  "chat.guidance": GuidanceChip[];
  "chat.banned": { list: { phrase: string; replace?: string }[]; action: "flag" | "regenerate" | "replace"; remind: boolean };
  "chat.cutoff": "continue" | "trim" | "off";
  "chat.retry": { empty: boolean; refusal: boolean; serverErrors: boolean };
  "regex.scripts": RegexScript[];
  "prompts.sets": PromptSet[];
  "prompts.active": string | null;
  "guards.config": GuardsConfig;
  "steer.config": SteerConfig;
  "privacy.requestLog": { bodiesDays: number; rowsDays: number; fileLog: boolean; fileDays: number };
}

// ---------- Phase 5: steering ----------

export interface SteerConfig {
  advisor: boolean;
  advisorMemory: number;
  advisorWait: number;
  editor: "off" | "flagged" | "every";
  editorApply: "suggest" | "auto";
  recapAfterHours: number;
}

export interface StyleProfile {
  guide?: string;
  banned?: string[];
  actions?: "asterisks" | "plain" | "any";
  quotes?: "straight" | "curly" | "any";
  dialogue?: string;
}

export interface AdvisorPlan {
  direction: string;
  beats: string[];
  threads: string[];
  reminders: string[];
  avoid: string[];
}

export interface EditSuggestion {
  status: "proposed" | "applied" | "dismissed";
  text: string;
  notes: string[];
  original: string;
  at: number;
}

export interface Moment {
  tag: string;
  text: string;
  seq?: number;
}

export interface RebuildEstimate {
  messages: number;
  storyTokens: number;
  scenes: number;
  chapters: number;
  arcs: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  quotaShare: number | null;
}

export interface RebuildProgress {
  startedAt: number | null;
  estimate: RebuildEstimate | null;
  segmentedThrough: number;
  lastSeq: number;
  scenes: { total: number; ready: number; failed: number };
  working: boolean;
  paused: boolean;
  done: boolean;
}

// ---------- Phase 5: accuracy guards ----------

export interface GuardsConfig {
  anchor: "auto" | "always" | "off";
  anchorAfter: number;
  anchorDepth: number;
  pov: boolean;
  tense: boolean;
  puppet: boolean;
  puppetAction: "flag" | "trim" | "regenerate";
  names: "off" | "flag" | "fix";
  drift: boolean;
  driftEvery: number;
  driftThreshold: number;
  timeline: boolean;
  maxJumpHours: number;
}

export interface DriftReading {
  id: string;
  seq: number;
  score: number;
  drifting: boolean;
  reasons: string[];
  semantic: number | null;
  style: number;
  samples: number;
  replies: number;
  at: number;
}

export interface GuardsView {
  config: GuardsConfig;
  own: Partial<GuardsConfig>;
  anchor: { active: boolean; strong: boolean; text: string };
  drift: { history: DriftReading[]; samples: number; source: "voice lab" | "examples" | "both" | "none" };
}

export interface InboxItem {
  key: string;
  kind: "summary" | "journal" | "chronicle" | "merge" | "disputed" | "world";
  chatId: string;
  chatTitle: string;
  title: string;
  why: string;
  before: string | null;
  after: string;
  editable: boolean;
  createdAt: number;
  link: string;
}

export interface NameEntry {
  name: string;
  kind: string;
  source: "card" | "persona" | "entity" | "tracker" | "lore";
  hint?: string;
}

export interface BlockTrace {
  id: string;
  name: string;
  kind: string;
  role: string;
  tokens: number;
  included: boolean;
  note?: string;
  depth?: number;
}

export interface PromptTrace {
  /** PERF-10: how long building the prompt took, by part. */
  timing?: { totalMs: number; trackersMs: number; retrievalMs: number; loreMs: number; advisorMs: number; assemblyMs: number };
  blocks: BlockTrace[];
  history: { included: number; total: number; tokens: number; dropped: number; evicted?: number; filtered?: number };
  lore: LoreTrace[];
  budget: { contextTarget: number; reserve: number; fixed: number; history: number; total: number; memory?: number; recall?: number; lore?: number; ratio?: number; effectiveTarget?: number };
  memory?: MemoryTrace;
}

export type MeaEvent =
  | { type: "gen.start"; chatId: string; messageId: string; swipeIdx: number; generationId: string }
  | { type: "gen.delta"; chatId: string; messageId: string; generationId: string; text: string; reasoning?: string; reset?: boolean }
  | { type: "gen.end"; chatId: string; messageId: string; generationId: string; status: string; error?: string }
  | { type: "message.changed"; chatId: string; messageId: string }
  | { type: "chat.changed"; chatId: string }
  | { type: "jobs.activity"; running: number; queued: number }
  | { type: "quota.changed" }
  | { type: "memory.changed"; chatId: string }
  | { type: "continuity.changed"; chatId: string; messageId: string }
  | { type: "trackers.changed"; chatId: string; running?: boolean }
  | { type: "draft.changed"; chatId: string; device: string | null }
  | { type: "library.changed"; what: "characters" | "personas" | "lorebooks" | "presets" | "connections" }
  | { type: "studio.changed"; draftId: string }
  | { type: "creator.changed"; draftId: string }
  | { type: "inbox.changed" }
  | { type: "import.progress"; chatId: string; done: number; total: number; label: string }
  | { type: "reconnected" };

// ---------- Phase 1: memory ----------

export type SummaryLevel = "scene" | "chapter" | "arc" | "story";
export type SummaryState = "pending" | "building" | "ready" | "stale" | "review" | "error";

export interface Verification {
  verdict: "ok" | "minor" | "major";
  unsupported: { claim: string; reason: string }[];
  omissions: { what: string; seq?: number }[];
  repaired?: boolean;
  skipped?: string;
}

export interface Summary {
  id: string;
  level: SummaryLevel;
  startSeq: number;
  endSeq: number | null;
  closed: boolean;
  boundary: string | null;
  manual: boolean;
  title: string;
  content: string;
  data: Record<string, any>;
  state: SummaryState;
  error: string | null;
  verification: Verification | null;
  userEdited: boolean;
  importance: number | null;
  tokens: number;
  sourceTokens: number;
  storyTime: string | null;
  proposal: { title: string; content: string; data: Record<string, any>; at: number } | null;
  builtAt: number | null;
  updatedAt: number;
}

export type AtomType = "event" | "fact" | "trait" | "preference" | "promise" | "secret" | "quote" | "plan" | "relationship";
export const ATOM_TYPES: AtomType[] = ["event", "fact", "trait", "preference", "promise", "secret", "quote", "plan", "relationship"];

export interface Atom {
  id: string;
  sceneId: string | null;
  type: AtomType;
  content: string;
  entities: string[];
  importance: number;
  emotions: string[];
  storyTime: string | null;
  knownBy: string[];
  status: "active" | "superseded" | "resolved" | "disputed";
  supersededBy: string | null;
  confidence: number;
  pinned: boolean;
  userEdited: boolean;
  stale: boolean;
  minSeq: number | null;
  maxSeq: number | null;
  tokens: number;
  sources?: { messageId: string; seq: number }[];
  createdAt: number;
  updatedAt: number;
  /** MEM-19 */
  recallCount?: number;
  refCount?: number;
  /** MEM-30, MEM-31 */
  ledger?: { status: string; by?: string; to?: string; markedBy?: string } | null;
}

export interface UsageRef {
  generationId: string;
  slot: string;
  at: number;
  messageId: string | null;
  seq: number | null;
}

export interface CoverageRow {
  id: string;
  level: SummaryLevel;
  title: string;
  startSeq: number;
  endSeq: number | null;
  closed: boolean;
  state: SummaryState;
  manual: boolean;
  userEdited: boolean;
  tokens: number;
}

export interface EmbeddingStatus {
  enabled: boolean;
  model: string;
  dims: number;
  byModel: { model: string; dims: number; n: number }[];
  total: number;
  current: number;
  mismatched: number;
  missing: number;
}

export interface MemoryOverview {
  enabled: boolean;
  paused: boolean;
  onEdit: "auto" | "ask";
  firstSeq: number;
  lastSeq: number;
  segmentedThrough: number;
  evictedThrough: number;
  coverage: CoverageRow[];
  gaps: { startSeq: number; endSeq: number; reason: string }[];
  stats: {
    scenes: number;
    chapters: number;
    arcs: number;
    hasStory: boolean;
    summarizedSourceTokens: number;
    sceneSummaryTokens: number;
    telescopeTokens: number;
    lastPromptMemoryTokens: number | null;
    /** SUM-16 */
    messages?: number;
    storyTokens?: number;
    memoryTokens?: number;
    atoms: number;
    pinned: number;
    stale: number;
    review: number;
    errors: number;
    edited: number;
  };
  atomCounts: { type: string; status: string; n: number }[];
  jobs: { kind: string; status: string; n: number }[];
  embeddings: EmbeddingStatus;
}

export interface Boundary {
  id: string;
  level: "scene" | "chapter";
  startSeq: number;
  title: string;
  state: SummaryState;
  manual: boolean;
  boundary: string | null;
  storyTime: string | null;
}

export interface RecallItem {
  ownerType: "memory" | "summary" | "entity" | "quote" | "journal";
  id: string;
  type: string;
  content: string;
  slot: "pinned" | "entity" | "recent" | "relevant" | "serendipity" | "deep";
  score: number;
  reasons: string[];
  tokens: number;
  seq: number | null;
  when?: string | null;
  where?: string | null;
  who?: string[];
  confirmed?: boolean;
  disputed?: boolean;
}

export interface MemoryTrace {
  enabled: boolean;
  evictedThrough: number;
  window: { messages: number; tokens: number; budget: number; target: number; moved: "kept" | "advanced" | "restored"; unsafe: boolean };
  gaps: { startSeq: number; endSeq: number; reason: string }[];
  telescope: { id: string; level: SummaryLevel; title: string; startSeq: number; endSeq: number; tokens: number; state: string }[];
  telescopeTokens: number;
  telescopeBudget: number;
  dropped: number;
  recall: RecallItem[];
  recallTokens: number;
  recallBudget: number;
  query: string;
  vector: boolean;
  queries?: { label: string; weight: number; vector: boolean }[];
  stats?: { candidates: number; filteredPov: number; signaled: number; queries: string[]; librarian: "used" | "none"; deep: number; entities: string[]; diversity: number };
  pov?: string | null;
  format?: MemoryConfig["format"];
  index?: { coverage: number; vectors: number; of: number };
  journalTokens?: number;
}

export interface MemoryConfig {
  enabled: boolean;
  sceneTokenCap: number;
  pauseHours: number;
  lag: number;
  boundaryCheck: boolean;
  scenesPerChapter: number;
  chaptersPerArc: number;
  verify: boolean;
  autoRepair: boolean;
  onEdit: "auto" | "ask";
  budget: { summaries: number; recall: number };
  slots: { recent: number; relevant: number; serendipity: number };
  filterDepth: number;
  lowWater: number;
  cacheTtl: "5m" | "1h";
  profile: "light" | "balanced" | "deep" | "custom";
  pov: "auto" | "character" | "narrator";
  format: "prose" | "attributed" | "clinical" | "minimal";
  rewriteQuery: boolean;
  diversity: number;
  entityRecall: boolean;
  reinforcement: boolean;
  deepSearch: boolean;
  librarian: boolean;
  journals: boolean;
  consolidate: boolean;
  continuity: boolean;
  leakGuard: "auto" | "on" | "off";
  checkerModel: boolean;
  chronicle: boolean;
  /** SUM-10 */
  compression: { scene: Compression; chapter: Compression; arc: Compression; story: Compression };
  /** SUM-11 */
  moments: boolean;
  /** SUM-17 */
  voice: { tense: "past" | "present"; person: "third" | "first"; register: "record" | "storybook" };
}
export type Compression = "tight" | "balanced" | "detailed";

// ---------- Phase 3 ----------

export type EntityKind = "person" | "place" | "object" | "group" | "concept";
export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  aliases: string[];
  description: string;
  status: "active" | "dead" | "missing" | "gone" | "unknown";
  facts: string[];
  firstSeq: number | null;
  lastSeq: number | null;
  mentions: number;
  userEdited: boolean;
  mergedInto: string | null;
  isUser: boolean;
  isMain: boolean;
  path: string[] | null;
  holder: string | null;
  sources: string[];
  descSource: string | null;
  updatedAt: number;
}
export type CodexEntity = Omit<Entity, "facts"> & { card: string; facts: number; journal: boolean };
export interface Journal {
  id: string;
  name: string;
  content: string;
  throughSeq: number;
  userEdited: boolean;
  proposal: { content: string; throughSeq: number; at: number } | null;
  tokens: number;
  updatedAt: number;
}
export interface PromiseEntry {
  key: string;
  source: "tracker" | "memory";
  who: string | null;
  whom: string | null;
  what: string;
  status: "pending" | "kept" | "broken";
  due: string | null;
  seq: number | null;
  messageId: string | null;
  kind: "promise" | "debt";
  memoryIds: string[];
  markedBy: string | null;
}
export interface SecretEntry {
  key: string;
  source: "tracker" | "memory";
  statement: string;
  keepers: string[];
  hiddenFrom: string[];
  knows: { name: string; status: string }[];
  revealed: { to: string[]; seq: number | null; how: string | null; messageId: string | null }[];
  truth: string | null;
  seq: number | null;
  messageId: string | null;
  memoryIds: string[];
}
export interface Citation {
  ref: string;
  type: "tracker" | "memory" | "lore" | "card" | "message";
  label: string;
  id?: string;
  messageId?: string | null;
  seq?: number | null;
}
export interface ContinuityIssue {
  id: string;
  kind: "trait" | "dead" | "name" | "time" | "place" | "fact" | "leak" | "pov" | "tense" | "puppet" | "timeline";
  severity: "minor" | "major";
  claim: string;
  conflict: string;
  citations: Citation[];
  fix: string;
  canon?: { memory: string; wrong?: string; trackerLine?: string };
  by: "rules" | "model";
  dismissed?: boolean;
}
export interface ContinuityFlag {
  id: string;
  messageId: string;
  swipeIdx: number;
  status: "open" | "clean" | "resolved";
  issues: ContinuityIssue[];
  open: number;
  updatedAt: number;
}
export interface ArchiveCitation {
  n: number;
  type: string;
  label: string;
  excerpt: string;
  messageId: string | null;
  seq: number | null;
  ownerId: string | null;
}
export interface ArchiveAnswer {
  id: string;
  question: string;
  answer: string;
  citations: ArchiveCitation[];
  sources: ArchiveCitation[];
  confidence: "sure" | "likely" | "unknown";
  createdAt: number;
}
export interface GraphEdge {
  from: string;
  to: string;
  label: string;
  strength: number;
  kind: "bond" | "memory" | "holds";
  history: { seq: number; strength: number }[];
  fromName?: string;
  toName?: string;
}
export interface CodexScene {
  id: string;
  title: string;
  startSeq: number;
  endSeq: number | null;
  storyTime: string | null;
  state: string;
  summary: string;
}
export interface Codex {
  story: { title: string; summary: string; throughSeq: number | null } | null;
  cast: CodexEntity[];
  places: CodexEntity[];
  objects: CodexEntity[];
  groups: CodexEntity[];
  concepts: CodexEntity[];
  timeline: (CodexScene & { scenes: CodexScene[] })[];
  unfiled: CodexScene[];
  threads: { tracked: { id: string; title: string; status: string; latest: string | null; openedSeq: number; lastSeq: number }[]; fromRecords: string[] };
  calendar: { title: string; when: string; who: string[] }[];
  milestones: { text: string; seq: number }[];
  relationships: GraphEdge[];
  promises: number;
  secrets: number;
}
export interface CodexPage {
  entity: Entity;
  card: string;
  facts: Atom[];
  appearances: { id: string; title: string; startSeq: number; endSeq: number | null; storyTime: string | null }[];
  ties: (GraphEdge & { other: string; direction: "in" | "out" })[];
  journal: Journal | null;
  lore: { id: string; bookId: string; bookName: string; title: string; content: string }[];
}
export interface QuizQuestion {
  id: string;
  question: string;
  answer: string;
  atomId: string;
  retrieved?: boolean;
  rank?: number | null;
  given?: string;
  correct?: boolean | null;
}
export interface QuizRun {
  id: string;
  settings: Record<string, unknown>;
  questions: QuizQuestion[];
  retrieval: number | null;
  answers: number | null;
  score: number | null;
  createdAt: number;
}
export interface ChronicleProposal {
  id: string;
  entityId: string | null;
  name: string;
  entry: { comment: string; keys: string[]; content: string; extra: Record<string, unknown> };
  status: string;
  createdAt: number;
}
export interface LoreHealthIssue {
  kind: string;
  severity: "info" | "warn";
  entries: string[];
  message: string;
}
export interface LoreHealth {
  bookId: string;
  entries: number;
  issues: LoreHealthIssue[];
  cost: { constantTokens: number; totalTokens: number; budget: number; averageTriggeredTokens: number; top: { id: string; title: string; tokens: number; hits: number; constant: boolean }[] };
}
export interface LorePreview {
  id: string;
  bookId: string;
  bookName: string;
  title: string;
  reason: string;
  tokens: number;
  type: string | null;
}
export interface GlossaryTerm {
  term: string;
  entryId: string;
  bookId: string;
  title: string;
  type: string | null;
  snippet: string;
}
export interface Collection {
  id: string;
  name: string;
  builtin: string | null;
  sort: number;
  count: number;
}
export interface StoryStats {
  messages: number;
  yourMessages: number;
  words: number;
  yourWords: number;
  characterWords: number;
  swipes: number;
  tokens: { prompt: number; completion: number; cached: number; requests: number };
  cost: number;
  minutesSpent: number;
  daysActive: number;
  longestStreak: number;
  firstAt: number | null;
  lastAt: number | null;
  memories: number;
  scenes: number;
}
export interface GlobalHit {
  kind: "message" | "character" | "lore" | "memory" | "summary";
  id: string;
  title: string;
  snippet: string;
  chatId: string | null;
  chatTitle: string | null;
  link: string;
  seq?: number | null;
}

export interface Planner {
  measured: boolean;
  turns: number;
  swipes: number;
  swipeRatio: number;
  avgStoryPrompt: number;
  features: { task: string; kind: string; perTurn: number }[];
  perTurn: number;
  turnsPerDay: number | null;
  turnsLeftThisWeek: number | null;
  turnsLeftToday: number | null;
  calibration: { cachedWeight: number | null; samples: number; updatedAt: number | null };
  pacing: { ahead: boolean; usedShare: number; elapsedShare: number; resetAt: number | null } | null;
  state: { known: boolean; used: number | null; exhausted: boolean; resetAt: number | null; window: string | null; degradeAt: number; shed: string[] };
  scenarios: { target: number; turnsPerDay: number }[];
}

export interface RequestRow {
  id: string;
  chatId: string | null;
  chatTitle: string | null;
  kind: string;
  task: string;
  model: string | null;
  billing: string;
  estPromptTokens: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  cost: number | null;
  status: string;
  error: string | null;
  startedAt: number;
  ttftMs: number | null;
  durationMs: number | null;
}

export interface JobRow {
  id: string;
  kind: string;
  status: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAfter: number;
  lastError: string | null;
  chatId: string | null;
  payload: Record<string, any>;
  meta: Record<string, any>;
  inputTokens: number;
  outputTokens: number;
  createdAt: number;
  updatedAt: number;
}

export interface CacheProbe {
  verified: boolean;
  format: string;
  firstWrite: number;
  secondRead: number;
  hitRate: number;
  at: number;
  error?: string;
}

// ---------- Phase 2: trackers ----------

export type Tier = "spot" | "peri" | "off";

export interface TrackerCharacter {
  id: string;
  name: string;
  aliases: string[];
  isUser: boolean;
  isMain: boolean;
  firstSeq: number;
  lastSeq: number;
  tier?: Tier;
  activity?: string;
  place?: string;
  mood?: { name: string; v?: number; a?: number; d?: number; prev?: string; seq: number };
  meters: Partial<Record<"health" | "fatigue" | "hunger" | "thirst" | "pain" | "intox" | "composure" | "arousal" | "stress", number>>;
  flags: string[];
  injuries: { where: string; severity: 1 | 2 | 3 | 4; treated: boolean; since: number | null; worst: number }[];
  conditions: { kind: string; text: string; since: number | null; until: number | null }[];
  look?: string;
  traits: { kind: string; text: string; by: "user" | "model" | "card"; seq: number }[];
  drives: { want?: string; fear?: string; need?: string; tactic?: string };
  mask?: { shown?: string; felt?: string; tell?: string };
  thoughts?: { text: string; seq: number };
  journal: { text: string; seq: number; at: string | null }[];
  dead?: boolean;
  stamina: string;
}

export interface TrackerBond {
  from: string;
  to: string;
  axes: Partial<Record<string, number>>;
  label?: string;
  tags: string[];
  history: { axis: string; from: number; to: number; delta: number; cause?: string; seq: number }[];
}

export interface TrackerState {
  time: { minutes: number; form: "date" | "day" } | null;
  weather: { now: string; prev?: string; seq: number } | null;
  place: string[];
  sceneNo: number;
  sceneTitle?: string;
  mode?: string;
  chars: Record<string, TrackerCharacter>;
  bonds: Record<string, TrackerBond>;
  ladders: Record<string, { from: string; to: string; tier: number; evidence?: string; seq: number; history: { tier: number; evidence?: string; seq: number }[] }>;
  facts: Record<string, { key: string; statement: string; truth: string; secret?: { keepers: string[]; from: string[] }; stances: Record<string, { status: string; route?: string; seq: number; set?: boolean }>; firstSeq: number; lastSeq: number }>;
  items: Record<string, { id: string; name: string; holder?: string; owner?: string; where?: string; condition?: string; gone?: boolean; gift?: string; custody: { from?: string; to?: string; how?: string; seq: number }[]; lastSeq: number }>;
  threads: Record<string, { id: string; title: string; kind?: string; status: "open" | "stalled" | "resolved"; latest?: string; blocker?: string; openedSeq: number; lastSeq: number; history: { op: string; detail?: string; seq: number }[] }>;
  obligations: Record<string, { id: string; kind: "owe" | "promise"; who: string; whom?: string; what: string; status: string; due?: { minutes: number | null; text: string }; seq: number }>;
  deadlines: Record<string, { id: string; title: string; at: number | null; text: string; done: boolean; seq: number }>;
  plants: Record<string, { id: string; text: string; payoff?: string; seq: number; scene: number; paidSeq?: number }>;
  clues: { id: string; text: string; pointsTo?: string; reliability?: string; seq: number }[];
  gauges: Record<string, { name: string; cur: number; max: number; cause?: string; history: { v: number; seq: number }[] }>;
  clocks: Record<string, { faction: string; name: string; cur: number; max: number; history: { v: number; seq: number }[] }>;
  rep: Record<string, { who: string; group: string; score: number; tags: string[] }>;
  calendar: Record<string, { id: string; title: string; kind: string; when: string; at: number | null; who: string[]; done?: boolean; seq: number }>;
  motifs: Record<string, { id: string; text: string; who?: string; firstSeq: number; lastSeq: number; uses: number }>;
  milestones: { text: string; who: string[]; seq: number; at: string | null }[];
  places: Record<string, { id: string; name: string; path: string[]; visits: number; lastSeq: number }>;
  custom: Record<string, Record<string, unknown>>;
  locks: string[];
  sim: SimState;
  lastSeq: number;
}

export interface TrackerChange {
  kind: string;
  text: string;
  subject?: string;
  reason?: string;
  tone?: "up" | "down" | "due" | "warn";
  path: string;
  from?: unknown;
  to?: unknown;
  flag?: string;
  memory?: boolean;
  source: "model" | "inline" | "user" | "init" | "timeskip" | "engine";
}

export interface TemplateField {
  key: string;
  label: string;
  type: "text" | "longtext" | "number" | "meter" | "enum" | "tags" | "boolean" | "datetime" | "duration" | "entity" | "object" | "table";
  hint?: string;
  options?: string[];
  min?: number;
  max?: number;
  visibility?: "prompt" | "ui" | "hidden";
  hud?: boolean;
  spoiler?: boolean;
  memory?: boolean;
  maxDelta?: number;
  fields?: TemplateField[];
  keyField?: string;
}

export interface TrackerTemplate {
  id: string;
  key: string;
  name: string;
  description: string;
  schema: { fields: TemplateField[] };
  builtin: boolean;
}

export type TrackerSection = "scene" | "cast" | "body" | "bonds" | "romance" | "knowledge" | "items" | "threads" | "stakes" | "calendar" | "motifs" | "persona" | "custom" | "world";

export interface TrackerConfig {
  mode: "helper" | "inline" | "off";
  cadence: "every" | "everyN" | "scene" | "manual";
  everyN: number;
  gate: boolean;
  sections: Record<TrackerSection, boolean>;
  templates: string[];
  romance: "off" | "slow" | "measured" | "fast" | "established";
  sealed: boolean;
  strictness: "strict" | "lenient";
  limits: boolean;
  budget: number;
  quietAfter: number;
  nudges: boolean;
  calendar: "gregorian" | "westeros";
  season: string;
  /** Settings the chat's preset decides through its Persona and Romance pace controls. */
  dialed?: ("sealed" | "romance")[];
}

export interface CastProfile {
  name: string;
  description?: string;
  voice?: string;
  pinned?: boolean;
  avatarId?: string | null;
  stamina?: string;
  color?: string;
  standing?: string;
  where?: string;
  base?: string;
  routine?: string;
  role?: string;
  out?: boolean;
}

export interface StoryWhen {
  calendar: "gregorian" | "westeros";
  form: "date" | "day";
  label: string;
  date: string;
  time: string;
  short: string;
  hour: number;
  period: string;
  weekday: string | null;
  day: number | null;
  month: number | null;
  monthName: string | null;
  year: number | null;
  season: string | null;
}

export interface TrackersResponse {
  state: TrackerState;
  time: string | null;
  when: StoryWhen | null;
  hud: string;
  config: TrackerConfig;
  templates: TrackerTemplate[];
  userName: string;
  mainName: string;
  profiles: Record<string, CastProfile>;
  hasBase: boolean;
  running: boolean;
  maxSeq?: number;
}

export interface CastPerson {
  key: string;
  id: string;
  name: string;
  aliases: string[];
  /** Everything the trackers hold about them (null for someone you added who hasn't appeared). */
  char: TrackerCharacter | null;
  isMain: boolean;
  present: boolean;
  dead: boolean;
  mood: string | null;
  place: string | null;
  activity: string | null;
  look: string | null;
  traits: string[];
  wants: string | null;
  items: string[];
  regard: { label: string | null; axes: Record<string, number> } | null;
  lastSeq: number;
  firstSeq: number;
  profile: CastProfile | null;
}

// ---------- Phase 2: the world off the page ----------

export type ArcKind =
  | "pursuit" | "scheme" | "rivalry" | "revenge" | "courtship" | "rift" | "reconcile" | "debt" | "secret" | "decline" | "recovery"
  | "investigation" | "threat" | "return" | "duty" | "ambition" | "protect" | "life" | "loss" | "faction";
export type ArcStage = "hook" | "rising" | "reversal" | "crisis" | "climax" | "aftermath";

export interface ArcBeat {
  at: number;
  roll: [number, number];
  mod: number;
  why: string[];
  result: "win" | "cost" | "loss";
  stage: ArcStage;
  twist?: string;
  text: string;
  told: "template" | "model";
  seq: number;
}

export interface Arc {
  id: string;
  kind: ArcKind;
  lead: string;
  leadName: string;
  cast: string[];
  target?: string;
  premise: string;
  want: string;
  fear: string;
  grounds: string[];
  secrecy: "public" | "private" | "secret";
  clock: { cur: number; max: number };
  tally: { win: number; cost: number; loss: number };
  heat: number;
  stage: ArcStage;
  beats: ArcBeat[];
  nextAt: number;
  status: "running" | "held" | "crossed" | "resolved" | "dropped" | "fate";
  by: "engine" | "player";
  locked?: boolean;
  push?: boolean;
  bringIn?: boolean;
  foreshadowed?: boolean;
  place?: string[];
  ending?: { result: string; text: string; at: number; seq: number };
  fate?: { result: string; text: string; at: number };
  createdAt: number;
}

export interface Arrival {
  id: string;
  arc?: string;
  route: "carrier" | "signal" | "ambient" | "trace" | "entrance" | "omen";
  text: string;
  carrier?: string;
  to?: string;
  place?: string[];
  medium?: string;
  at: number;
  until: number | null;
  status: "pending" | "offered" | "used" | "expired";
  offers: number;
  maxOffers: number;
}

export interface SimProposal {
  id: string;
  kind: ArcKind;
  lead: string;
  leadName: string;
  cast: string[];
  premise: string;
  want: string;
  fear: string;
  grounds: string[];
  secrecy: string;
  why: string;
  at: number;
}

export interface SimState {
  lastTickAt: number | null;
  tension: { at: number; value: number; target: number }[];
  arcs: Record<string, Arc>;
  arrivals: Record<string, Arrival>;
  proposals: Record<string, SimProposal>;
  news: { at: number; fact: string; statement: string; from: string; to: string; medium: string; distorted?: string }[];
  incidents: { at: number; text: string; place?: string[] }[];
  ticks: number;
}

export interface WorldConfig {
  mode: "off" | "quiet" | "living" | "restless";
  director: "steady" | "rising" | "chaotic" | "gentle";
  telling: "model" | "engine";
  seeding: "auto" | "ask" | "off";
  fates: "page" | "ask" | "allow";
  view: "director" | "surprise";
  climate: string;
  latitude: number;
  tech: "modern" | "historic" | "fantasy" | "future";
  genres: string[];
  step: number;
}

export interface WorldPerson {
  id: string;
  name: string;
  ring: "onstage" | "offstage" | "unmet";
  standing: string;
  where: string | null;
  reach: string;
  travel: number | null;
  ties: { id: string; name: string; strength: number }[];
  flag: string | null;
  arcs: string[];
}

export interface WorldViewData {
  config: WorldConfig;
  personalities: Record<string, { label: string; about: string }>;
  modes: string[];
  kinds: Record<string, { label: string; clock: number; hostile: boolean }>;
  time: string | null;
  sky: { line: string; weather: { text: string; tempC: number; level: number }; season: string; sunrise: string | null; sunset: string | null; moon: string; forecast: { minutes: number; text: string; tempC: number }[] } | null;
  arcs: Arc[];
  arrivals: Arrival[];
  proposals: SimProposal[];
  news: SimState["news"];
  incidents: SimState["incidents"];
  tension: SimState["tension"];
  lastTickAt: string | null;
  ticks: number;
  people: WorldPerson[];
  town: string;
}

export interface GuidanceChip {
  id: string;
  name: string;
  text: string;
  mode: "once" | "persistent";
  auto?: { characterIds?: string[]; when?: string };
}

export interface SearchResult {
  messageId: string;
  chatId: string;
  chatTitle: string;
  characterName: string | null;
  seq: number;
  role: string;
  name: string | null;
  createdAt: number;
  snippet: string;
  match: { start: number; length: number };
}

// ---------- Phase 4: the Lore Studio ----------

export type LoreType = "character" | "location" | "item" | "faction" | "concept" | "event" | "rule";
export type StudioSourceKind = "idea" | "character" | "persona" | "document" | "book";
export type StudioStage = "start" | "questions" | "plan" | "review" | "done";

export interface StudioOptions {
  size: "small" | "medium" | "large" | "complete";
  length: "lean" | "standard" | "rich";
  types: LoreType[];
  tone: string;
  style: string;
  secrets: boolean;
  faithful: boolean;
  overview: boolean;
}

export interface StudioEntry {
  content: string;
  keys: string[];
  aliases: string[];
  essentials: string;
  secrets: { text: string; knownBy: string[] }[];
}

export interface StudioItem {
  id: string;
  title: string;
  type: LoreType | null;
  pitch: string;
  parent: string;
  folder: string;
  source: string;
  constant: boolean;
  keep: boolean;
  status: "planned" | "queued" | "writing" | "drafted" | "error";
  error: string;
  entry: StudioEntry | null;
  previous: StudioEntry | null;
  steer: string;
  savedEntryId: string | null;
  basis: string;
  research: { title: string; url: string; text: string } | null;
  links: { creatorDraftId?: string; characterId?: string; personaId?: string };
}

/** The co-writer (both studios): the conversation, and the changes it proposes. */
export interface ChatTurn {
  role: "user" | "mea";
  text: string;
  at: number;
  sources?: { title: string; url: string }[];
}

/** Canon gathered from the web (the source's wiki, Wikipedia, pasted links), distilled into a brief. */
export interface Research {
  basedOn: string;
  at: number;
  wikis: { name: string; api: string; base: string; kind: string }[];
  sources: { title: string; url: string; kind: string; chars: number }[];
  names: string[];
  brief: string;
}
export interface ProposedChange {
  id: string;
  kind: string;
  target: string;
  label: string;
  before: string;
  after: string;
  steer?: string;
  data?: Record<string, unknown>;
}
export interface Proposal {
  id: string;
  message: string;
  reply: string;
  changes: ProposedChange[];
  at: number;
}

export interface CensusEntry {
  name: string;
  type: LoreType | null;
  tier: "core" | "supporting" | "minor";
  note: string;
}

export interface CritiqueIssue {
  id: string;
  kind: string;
  items: string[];
  problem: string;
  fix: string;
  add: { title: string; type: LoreType | null; pitch: string } | null;
}

export interface StudioDraft {
  id: string;
  title: string;
  stage: StudioStage;
  source: { kind: StudioSourceKind; text: string; refId: string | null; refName: string; fileName: string };
  options: StudioOptions;
  readback: { understood: string; missing: string[] } | null;
  questions: { id: string; q: string; why: string; answer: string; suggestions: string[] }[];
  directions: { title: string; pitch: string }[];
  expansion: Expansion | null;
  overview: string;
  items: StudioItem[];
  targetBookId: string | null;
  links: { type: "global" | "character" | "persona" | "chat"; id: string }[];
  committedBookId: string | null;
  consistency: { items: string[]; problem: string; fix: string }[] | null;
  basedOn: string;
  census: CensusEntry[] | null;
  critique: CritiqueIssue[] | null;
  chat: ChatTurn[];
  proposal: Proposal | null;
  research: Research | null;
  createdAt: number;
  updatedAt: number;
}

export interface StudioDraftSummary {
  id: string;
  title: string;
  stage: StudioStage;
  kind: StudioSourceKind;
  refName: string;
  items: number;
  drafted: number;
  writing: number;
  committedBookId: string | null;
  updatedAt: number;
}

export interface StudioIssue {
  kind: string;
  severity: "info" | "warn";
  message: string;
}

export interface StudioReview {
  issues: Record<string, StudioIssue[]>;
  tokens: Record<string, number>;
  /** Entries written before their sources changed, with what changed. */
  stale: Record<string, string[]>;
  cost: { entries: number; totalTokens: number; alwaysOnTokens: number; averageTokens: number };
}

// ---------- Phase 4: expand my idea, the character and persona creator ----------

export interface ExpansionSection {
  id: string;
  heading: string;
  text: string;
}

export interface Expansion {
  sections: ExpansionSection[];
  use: boolean;
  steer: string;
}

export interface ExpansionPatch {
  sections?: { id: string; heading?: string; text?: string }[];
  use?: boolean;
  remove?: string[];
}

export type CreatorKind = "character" | "persona";
export type CreatorStage = "idea" | "questions" | "bible" | "write" | "done";

export interface CreatorOptions {
  pov: "first" | "second" | "third";
  tense: "present" | "past";
  length: "lean" | "standard" | "rich";
  tone: string;
  style: string;
  mode: "companion" | "narrator";
  greetings: number;
}

export interface CardField {
  key: string;
  label: string;
  value: string;
  status: "empty" | "queued" | "writing" | "done" | "error";
  error: string;
  previous: string | null;
  steer: string;
  basis: string;
}

export interface CreatorDraft {
  id: string;
  kind: CreatorKind;
  name: string;
  stage: CreatorStage;
  idea: string;
  expansion: Expansion | null;
  options: CreatorOptions;
  worldBookIds: string[];
  loreDraftId: string | null;
  origin: { loreDraftId?: string; loreItemId?: string; fromDraftId?: string } | null;
  baseId: string | null;
  readback: { understood: string; missing: string[] } | null;
  questions: { id: string; q: string; why: string; answer: string; suggestions: string[] }[];
  bible: { key: string; label: string; text: string }[];
  bibleCheck: { section: string; problem: string; fix: string }[] | null;
  fields: CardField[];
  savedId: string | null;
  companionLoreDraftId: string | null;
  basedOn: string;
  fieldCheck: { id: string; field: string; problem: string; fix: string }[] | null;
  chat: ChatTurn[];
  proposal: Proposal | null;
  research: Research | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreatorDraftSummary {
  id: string;
  kind: CreatorKind;
  name: string;
  stage: CreatorStage;
  written: number;
  fields: number;
  writing: number;
  savedId: string | null;
  updatedAt: number;
}

export interface CreatorReview {
  issues: Record<string, StudioIssue[]>;
  tokens: Record<string, number>;
  stale: Record<string, string[]>;
  cost: { permanent: number; greeting: number; examples: number };
}
