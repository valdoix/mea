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
  | "post_history";

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
  history: { included: number; total: number; tokens: number; dropped: number };
  lore: LoreTrace[];
  budget: { contextTarget: number; reserve: number; fixed: number; history: number; total: number };
}

export type MeaEvent =
  | { type: "gen.start"; chatId: string; messageId: string; swipeIdx: number; generationId: string }
  | { type: "gen.delta"; chatId: string; messageId: string; generationId: string; text: string; reasoning?: string }
  | { type: "gen.end"; chatId: string; messageId: string; generationId: string; status: string; error?: string }
  | { type: "message.changed"; chatId: string; messageId: string }
  | { type: "chat.changed"; chatId: string }
  | { type: "jobs.activity"; running: number; queued: number }
  | { type: "quota.changed" }
  | { type: "library.changed"; what: "characters" | "personas" | "lorebooks" | "presets" | "connections" }
  | { type: "reconnected" };
