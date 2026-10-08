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
  "routing.tasks": { summarizer: string | null; helper: string | null };
  "routing.fallbacks": { story: string[]; summarizer: string[]; helper: string[] };
  "routing.timeouts": { story: number; summarizer: number; helper: number };
  "routing.embeddings": { connectionId: string | null; model: string; dims: number };
  "memory.config": MemoryConfig;
  "quota.degradeAt": number;
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
