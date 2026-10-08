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
}

export interface ChatListItem extends Chat {
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
  | "memory_recall";

export interface PromptBlock {
  id: string;
  name: string;
  kind: BlockKind;
  enabled: boolean;
  role: Role;
  position: "inline" | "depth";
  depth?: number;
  content?: string;
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

export interface Settings {
  "routing.story": string | null;
  "appearance.theme": "system" | "light" | "dark";
  "appearance.chatStyle": "cards" | "book" | "bubbles";
  "appearance.fontScale": number;
  "appearance.storyFont": "lora" | "literata" | "nunito";
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
  | { type: "trackers.changed"; chatId: string; running?: boolean }
  | { type: "draft.changed"; chatId: string; device: string | null }
  | { type: "library.changed"; what: "characters" | "personas" | "lorebooks" | "presets" | "connections" }
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
  ownerType: "memory" | "summary";
  id: string;
  type: string;
  content: string;
  slot: "pinned" | "recent" | "relevant" | "serendipity";
  score: number;
  reasons: string[];
  tokens: number;
  seq: number | null;
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

export interface TrackersResponse {
  state: TrackerState;
  time: string | null;
  hud: string;
  config: TrackerConfig;
  templates: TrackerTemplate[];
  userName: string;
  mainName: string;
  profiles: Record<string, CastProfile>;
  hasBase: boolean;
  running: boolean;
}

export interface CastPerson {
  key: string;
  id: string;
  name: string;
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
