import type { Database } from "bun:sqlite";

/**
 * Schema migrations. Embedded as strings so a compiled `mea.exe` carries them.
 * Never edit a shipped migration; add a new one.
 */
/**
 * M20: the triggers that keep fold_marks (migration 13). Kept here because a migration that rebuilds
 * messages or tracker_events drops their triggers and must create them again.
 */
const EVENT_MARK = (row: "new" | "old") =>
  `INSERT INTO fold_marks (chat_id, seq) SELECT ${row}.chat_id, s FROM (SELECT CASE WHEN ${row}.message_id IS NULL THEN 0 ELSE (SELECT seq FROM messages WHERE id = ${row}.message_id) END AS s) WHERE s IS NOT NULL;`;
export const FOLD_MARK_MESSAGE_TRIGGERS = /* sql */ `
CREATE TRIGGER IF NOT EXISTS fold_marks_msg_ai AFTER INSERT ON messages BEGIN
  INSERT INTO fold_marks (chat_id, seq) VALUES (new.chat_id, new.seq);
END;
CREATE TRIGGER IF NOT EXISTS fold_marks_msg_au AFTER UPDATE OF chat_id, seq, active_swipe, updated_at, deleted_at ON messages BEGIN
  INSERT INTO fold_marks (chat_id, seq) VALUES (old.chat_id, MIN(old.seq, new.seq));
  INSERT INTO fold_marks (chat_id, seq) SELECT new.chat_id, new.seq WHERE new.chat_id IS NOT old.chat_id;
END;
CREATE TRIGGER IF NOT EXISTS fold_marks_msg_ad AFTER DELETE ON messages BEGIN
  INSERT INTO fold_marks (chat_id, seq) VALUES (old.chat_id, old.seq);
END;
`;
export const FOLD_MARK_EVENT_TRIGGERS = /* sql */ `
CREATE TRIGGER IF NOT EXISTS fold_marks_ev_ai AFTER INSERT ON tracker_events BEGIN
  ${EVENT_MARK("new")}
END;
CREATE TRIGGER IF NOT EXISTS fold_marks_ev_au AFTER UPDATE ON tracker_events BEGIN
  ${EVENT_MARK("old")}
  ${EVENT_MARK("new")}
END;
CREATE TRIGGER IF NOT EXISTS fold_marks_ev_ad AFTER DELETE ON tracker_events BEGIN
  ${EVENT_MARK("old")}
END;
`;
const FOLD_MARK_TRIGGERS = FOLD_MARK_MESSAGE_TRIGGERS + FOLD_MARK_EVENT_TRIGGERS;

export interface Migration {
  id: number;
  name: string;
  sql?: string;
  /** Steps SQL alone can't say safely (checks before ALTERs, table rebuilds); runs after `sql`, in the same transaction. */
  up?: (db: Database) => void;
}

export const migrations: Migration[] = [
  {
    id: 1,
    name: "initial",
    sql: /* sql */ `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE secrets (
  id TEXT PRIMARY KEY,
  iv BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Provider connections (CONN-01, CONN-17). billing: subscription | paygo | unknown
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_url TEXT NOT NULL,
  secret_id TEXT REFERENCES secrets(id) ON DELETE SET NULL,
  billing TEXT NOT NULL DEFAULT 'unknown',
  extra TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Model catalog cache (CONN-06, CONN-11)
CREATE TABLE models (
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  name TEXT,
  context_length INTEGER,
  max_output INTEGER,
  capabilities TEXT NOT NULL DEFAULT '{}',
  pricing TEXT NOT NULL DEFAULT '{}',
  subscription INTEGER NOT NULL DEFAULT 0,
  starred INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (connection_id, model_id)
);

-- Connection profiles (CONN-02): model + sampler params
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  model_id TEXT,
  params TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE images (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  thumb_file TEXT,
  palette TEXT NOT NULL DEFAULT '[]',
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  avatar_id TEXT REFERENCES images(id) ON DELETE SET NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  card TEXT NOT NULL,
  avatar_id TEXT REFERENCES images(id) ON DELETE SET NULL,
  gallery TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  folder TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  default_persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
  mode TEXT,
  palette TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX characters_name ON characters(name);

CREATE TABLE character_versions (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  card TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX character_versions_char ON character_versions(character_id, created_at);

CREATE TABLE lorebooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

-- Scopes (LORE-02): target_type = global | character | persona | chat
CREATE TABLE lorebook_links (
  lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (lorebook_id, target_type, target_id)
);
CREATE INDEX lorebook_links_target ON lorebook_links(target_type, target_id);

CREATE TABLE lorebook_entries (
  id TEXT PRIMARY KEY,
  lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX lorebook_entries_book ON lorebook_entries(lorebook_id, sort);

CREATE TABLE presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
  persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'companion',
  settings TEXT NOT NULL DEFAULT '{}',
  vars TEXT NOT NULL DEFAULT '{}',
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_message_at INTEGER,
  archived_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX chats_character ON chats(character_id, last_message_at);

-- Message ledger (MEM-01). seq orders messages; swipes hold content.
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  name TEXT,
  active_swipe INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  bookmarked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX messages_chat_seq ON messages(chat_id, seq);

CREATE TABLE swipes (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'done',
  error TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (message_id, idx)
);

CREATE TABLE swipe_edits (
  id TEXT PRIMARY KEY,
  swipe_id TEXT NOT NULL REFERENCES swipes(id) ON DELETE CASCADE,
  previous TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Every model request: inspector (DBG-01) + usage (CONN-08)
CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  chat_id TEXT,
  message_id TEXT,
  swipe_id TEXT,
  kind TEXT NOT NULL,
  task TEXT NOT NULL DEFAULT 'story',
  connection_id TEXT,
  model_id TEXT,
  billing TEXT NOT NULL DEFAULT 'unknown',
  request TEXT,
  trace TEXT,
  est_prompt_tokens INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cached_tokens INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT,
  started_at INTEGER NOT NULL,
  first_token_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX generations_chat ON generations(chat_id, started_at);
CREATE INDEX generations_started ON generations(started_at);

-- Lorebook timed effects (sticky / cooldown), keyed by chat message counter
CREATE TABLE lore_state (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL,
  sticky_until INTEGER,
  cooldown_until INTEGER,
  PRIMARY KEY (chat_id, entry_id)
);

-- Devices & pairing (ARCH-08)
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE pairing_codes (
  code_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  device_id TEXT,
  endpoint TEXT NOT NULL UNIQUE,
  keys TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Persistent job queue (ARCH-03)
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX jobs_ready ON jobs(status, priority DESC, run_after);
CREATE UNIQUE INDEX jobs_dedupe ON jobs(dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');
`,
  },
  {
    id: 2,
    name: "memory core",
    sql: /* sql */ `
-- Summary hierarchy (SUM-01): scene → chapter → arc, plus one Story So Far per chat.
-- Rows at a level are ordered by start_seq; each ends where the next begins, and the last one is open.
CREATE TABLE summaries (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  start_seq INTEGER NOT NULL,
  end_seq INTEGER,
  closed INTEGER NOT NULL DEFAULT 0,
  boundary TEXT,
  manual INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  verification TEXT,
  user_edited INTEGER NOT NULL DEFAULT 0,
  importance INTEGER,
  tokens INTEGER NOT NULL DEFAULT 0,
  source_tokens INTEGER NOT NULL DEFAULT 0,
  source_hash TEXT,
  story_time TEXT,
  proposal TEXT,
  built_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX summaries_level_start ON summaries(chat_id, level, start_seq);

-- Edit history for summaries (SUM-08)
CREATE TABLE summary_versions (
  id TEXT PRIMARY KEY,
  summary_id TEXT NOT NULL REFERENCES summaries(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX summary_versions_summary ON summary_versions(summary_id, created_at);

-- Memory atoms (MEM-06). Never hard-deleted by the AI: superseded instead (MEM-07).
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  scene_id TEXT REFERENCES summaries(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  entities TEXT NOT NULL DEFAULT '[]',
  importance INTEGER NOT NULL DEFAULT 5,
  emotions TEXT NOT NULL DEFAULT '[]',
  story_time TEXT,
  known_by TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  superseded_by TEXT,
  confidence REAL NOT NULL DEFAULT 1,
  pinned INTEGER NOT NULL DEFAULT 0,
  user_edited INTEGER NOT NULL DEFAULT 0,
  stale INTEGER NOT NULL DEFAULT 0,
  min_seq INTEGER,
  max_seq INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX memories_chat ON memories(chat_id, status, max_seq);
CREATE INDEX memories_scene ON memories(scene_id);

-- Source links: every atom points back to the messages it came from (principle 2).
CREATE TABLE memory_sources (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (memory_id, message_id)
);
CREATE INDEX memory_sources_message ON memory_sources(message_id);

-- Keyword search (MEM-11). Kept in step with memories by triggers.
CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, chat_id UNINDEXED, content, entities, tokenize = 'porter unicode61');
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts (id, chat_id, content, entities) VALUES (new.id, new.chat_id, new.content, new.entities);
END;
CREATE TRIGGER memories_au AFTER UPDATE OF content, entities ON memories BEGIN
  DELETE FROM memories_fts WHERE id = old.id;
  INSERT INTO memories_fts (id, chat_id, content, entities) VALUES (new.id, new.chat_id, new.content, new.entities);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  DELETE FROM memories_fts WHERE id = old.id;
END;

CREATE VIRTUAL TABLE summaries_fts USING fts5(id UNINDEXED, chat_id UNINDEXED, title, content, tokenize = 'porter unicode61');
CREATE TRIGGER summaries_ai AFTER INSERT ON summaries BEGIN
  INSERT INTO summaries_fts (id, chat_id, title, content) VALUES (new.id, new.chat_id, new.title, new.content);
END;
CREATE TRIGGER summaries_au AFTER UPDATE OF title, content ON summaries BEGIN
  DELETE FROM summaries_fts WHERE id = old.id;
  INSERT INTO summaries_fts (id, chat_id, title, content) VALUES (new.id, new.chat_id, new.title, new.content);
END;
CREATE TRIGGER summaries_ad AFTER DELETE ON summaries BEGIN
  DELETE FROM summaries_fts WHERE id = old.id;
END;

-- Vectors (MEM-11, ARCH-12): each records the model and size that made it; keyed by content hash (PERF-07).
CREATE TABLE embeddings (
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  hash TEXT NOT NULL,
  vector BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_type, owner_id)
);
CREATE INDEX embeddings_chat ON embeddings(chat_id, model, dims);
CREATE INDEX embeddings_hash ON embeddings(hash, model, dims);

-- Which memories and summaries each reply used (MEM-39, MEM-40).
CREATE TABLE memory_usage (
  generation_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (generation_id, owner_type, owner_id)
);
CREATE INDEX memory_usage_owner ON memory_usage(owner_type, owner_id, created_at);
CREATE INDEX memory_usage_chat ON memory_usage(chat_id, created_at);

-- Quota readings over time (CONN-19, CONN-22 calibration)
CREATE TABLE quota_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at INTEGER NOT NULL,
  weekly_used INTEGER,
  weekly_limit INTEGER,
  daily_used INTEGER,
  daily_limit INTEGER
);
CREATE INDEX quota_samples_taken ON quota_samples(taken_at);

ALTER TABLE chats ADD COLUMN memory TEXT NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN story_time TEXT;
ALTER TABLE generations ADD COLUMN response TEXT;
ALTER TABLE generations ADD COLUMN profile_id TEXT;
ALTER TABLE generations ADD COLUMN cache_write_tokens INTEGER;
ALTER TABLE generations ADD COLUMN cost REAL;
ALTER TABLE generations ADD COLUMN job_id TEXT;
CREATE INDEX generations_task ON generations(task, started_at);
ALTER TABLE jobs ADD COLUMN chat_id TEXT;
ALTER TABLE jobs ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';
ALTER TABLE models ADD COLUMN learned_context INTEGER;
ALTER TABLE models ADD COLUMN calibration REAL;
ALTER TABLE models ADD COLUMN cache_probe TEXT;
`,
  },
  {
    id: 3,
    name: "trackers and world",
    sql: /* sql */ `
-- Tracker ledger events (TRK-02, TRK-04): one op per row, anchored to a message and swipe.
-- swipe_idx -1 rides every swipe of its message (your edits, the world off the page);
-- message_id NULL is the base state from the card (TRK-09).
CREATE TABLE tracker_events (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT,
  swipe_idx INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  ord INTEGER NOT NULL,
  op TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX tracker_events_chat ON tracker_events(chat_id, message_id, swipe_idx, ord);

-- Custom tracker templates (TRK-01, TRK-32).
CREATE TABLE tracker_templates (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  schema TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX tracker_templates_key ON tracker_templates(key) WHERE deleted_at IS NULL;

-- Per-chat notes about people (CHAT-26/27): portrait, description, voice, pin, stamina, standing.
CREATE TABLE cast_profiles (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  name_key TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, name_key)
);

-- Drafts that follow you between devices (CHAT-17).
CREATE TABLE drafts (
  chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  device TEXT,
  updated_at INTEGER NOT NULL
);

-- Per-character tracker defaults (TRK-32): templates, sections, romance pace.
ALTER TABLE characters ADD COLUMN trackers TEXT NOT NULL DEFAULT '{}';
`,
  },
  {
    id: 4,
    name: "retrieval, facts and accuracy",
    sql: /* sql */ `
-- Reinforcement and decay (MEM-19): how often a memory was recalled, and how often the reply used it.
ALTER TABLE memories ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN ref_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN last_recalled_seq INTEGER;
ALTER TABLE memories ADD COLUMN last_ref_seq INTEGER;
-- Promise and secret ledgers (MEM-30, MEM-31): {status, by, to, markedBy, seq}.
ALTER TABLE memories ADD COLUMN ledger TEXT;

-- Entity graph (MEM-26, MEM-28): people, places, objects, groups and concepts, with aliases.
-- A merged entity points at the one it became (merged_into); nothing is lost.
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'person',
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  facts TEXT NOT NULL DEFAULT '[]',
  data TEXT NOT NULL DEFAULT '{}',
  first_seq INTEGER,
  last_seq INTEGER,
  mentions INTEGER NOT NULL DEFAULT 0,
  user_edited INTEGER NOT NULL DEFAULT 0,
  merged_into TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX entities_chat ON entities(chat_id, merged_into, kind);

-- Character journals (MEM-29): a first-person memory per main character and important NPCs.
CREATE TABLE journals (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  through_seq INTEGER NOT NULL DEFAULT 0,
  user_edited INTEGER NOT NULL DEFAULT 0,
  proposal TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX journals_name ON journals(chat_id, name);

-- Continuity checker and knowledge-leak guard (CON-02, CON-06): issues per reply, with citations.
CREATE TABLE continuity_flags (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  swipe_idx INTEGER NOT NULL,
  issues TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (message_id, swipe_idx)
);
CREATE INDEX continuity_chat ON continuity_flags(chat_id, status);

-- Ask the Archivist (CON-07): questions and cited answers, never part of the roleplay.
CREATE TABLE archivist (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  citations TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX archivist_chat ON archivist(chat_id, created_at);

-- Memory quiz (MEM-46): a personal benchmark of the current settings.
CREATE TABLE quiz_runs (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  settings TEXT NOT NULL DEFAULT '{}',
  questions TEXT NOT NULL DEFAULT '[]',
  retrieval REAL,
  answers REAL,
  score REAL,
  created_at INTEGER NOT NULL
);

-- Which lore entries fire, for the health check (LORE-13).
CREATE TABLE lore_hits (
  entry_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (entry_id, chat_id)
);

-- Story-born lore (LORE-12): entries proposed for a chat's Chronicle book, waiting for review.
CREATE TABLE chronicle_proposals (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  entity_id TEXT,
  name TEXT NOT NULL,
  entry TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX chronicle_chat ON chronicle_proposals(chat_id, status);

-- Collections (LIB-06).
CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  builtin TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE collection_chats (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (collection_id, chat_id)
);
INSERT INTO collections (id, name, sort, builtin, created_at) VALUES
  ('col-ongoing', 'Ongoing', 0, 'ongoing', 0),
  ('col-finished', 'Finished', 1, 'finished', 0),
  ('col-favorites', 'Favorites', 2, 'favorites', 0);

-- Auto-titled chats (LIB-04): a title you set yourself is never replaced.
ALTER TABLE chats ADD COLUMN title_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN cover_image_id TEXT;

-- Global search over messages (LIB-05). External content keyed by the swipe's rowid, so a
-- streaming reply updates its own row instead of scanning the index.
CREATE VIRTUAL TABLE swipes_fts USING fts5(content, content = 'swipes', content_rowid = 'rowid', tokenize = 'porter unicode61');
INSERT INTO swipes_fts (swipes_fts) VALUES ('rebuild');
CREATE TRIGGER swipes_fts_ai AFTER INSERT ON swipes BEGIN
  INSERT INTO swipes_fts (rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER swipes_fts_au AFTER UPDATE OF content ON swipes BEGIN
  INSERT INTO swipes_fts (swipes_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO swipes_fts (rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER swipes_fts_ad AFTER DELETE ON swipes BEGIN
  INSERT INTO swipes_fts (swipes_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
`,
  },
  {
    id: 5,
    name: "creator studio",
    sql: /* sql */ `
-- The Lore Studio (Phase 4): a lorebook being planned and written, kept until you save it.
CREATE TABLE lore_drafts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`,
  },
  {
    id: 6,
    name: "character and persona creator",
    sql: /* sql */ `
-- The character and persona creator (Phase 4): an idea becoming a card, kept until you save it.
CREATE TABLE creator_drafts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`,
  },
  {
    id: 7,
    name: "card tools, variants and layered settings",
    sql: /* sql */ `
-- PROMPT-06 and CHAR-07: per-character defaults for its chats (preset, profile, author's note,
-- story settings, preset controls) plus your notes, the source link and the voice lab's kept lines.
ALTER TABLE characters ADD COLUMN settings TEXT NOT NULL DEFAULT '{}';

-- CHAR-06 / PER-05: variants (an outfit, an era, an AU) overlay a card or persona without copying it.
CREATE TABLE variants (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  overlay TEXT NOT NULL DEFAULT '{}',
  avatar_id TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX variants_owner ON variants(owner_type, owner_id);
`,
  },
  {
    id: 8,
    name: "accuracy guards",
    sql: /* sql */ `
-- CON-10: the drift detector's readings, newest last per chat.
CREATE TABLE drift_checks (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  score REAL NOT NULL,
  drifting INTEGER NOT NULL DEFAULT 0,
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX drift_checks_chat ON drift_checks(chat_id, created_at);

-- CON-09: suggestions you turned down in the review inbox (so they don't come back).
CREATE TABLE inbox_dismissed (
  key TEXT PRIMARY KEY,
  chat_id TEXT,
  created_at INTEGER NOT NULL
);
`,
  },
  {
    id: 9,
    name: "steering",
    sql: /* sql */ `
-- STEER-01 / STEER-02: the advisor's private plans, keyed by the turn they were written for.
CREATE TABLE advisor_plans (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  plan TEXT NOT NULL,
  used_at INTEGER,
  generation_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX advisor_plans_key ON advisor_plans(chat_id, key);
CREATE INDEX advisor_plans_chat ON advisor_plans(chat_id, created_at);
`,
  },
  {
    id: 10,
    name: "notebook, highlights and image sizes",
    sql: /* sql */ `
-- QOL-01: notes per chat (chat_id) and global (chat_id NULL), with [[links]] to people and lore.
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX notes_chat ON notes(chat_id, deleted_at, updated_at);

-- QOL-02: highlighted passages (bookmarks are a flag on the message).
CREATE TABLE highlights (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  text TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX highlights_chat ON highlights(chat_id, created_at);
CREATE INDEX highlights_message ON highlights(message_id);

-- PERF-08: extra thumbnail sizes, { "s": file, "l": file } (thumb_file stays the medium one).
ALTER TABLE images ADD COLUMN variants TEXT NOT NULL DEFAULT '{}';
`,
  },
  {
    id: 11,
    name: "deleted codex entries",
    sql: /* sql */ `
-- A codex entry you deleted stays as a tombstone, so a sync doesn't bring it back.
ALTER TABLE entities ADD COLUMN deleted_at INTEGER;
`,
  },
  {
    id: 12,
    name: "lookup indexes",
    sql: /* sql */ `
-- L4: swipe edits and deletes look tracker events up by message alone; the job monitor sums
-- generations by job; chat deletes and rebuilds cancel a chat's jobs.
CREATE INDEX IF NOT EXISTS tracker_events_message ON tracker_events(message_id, swipe_idx);
CREATE INDEX IF NOT EXISTS generations_job ON generations(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_chat ON jobs(chat_id, status) WHERE chat_id IS NOT NULL;
`,
  },
  {
    id: 13,
    name: "meus",
    sql: /* sql */ `
-- Meus in a chat: the conversation, the change card waiting for you, and the change sets you
-- applied (with what undoes each). One row per chat; never part of the roleplay.
CREATE TABLE meus (
  chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  turns TEXT NOT NULL DEFAULT '[]',
  proposal TEXT,
  sets TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
`,
  },
  {
    id: 14,
    name: "fold marks",
    sql: /* sql */ `
-- M20: tracker folds start from in-memory snapshots. Every change that can alter a fold (a message
-- written, edited, deleted, restored, purged or switched to another swipe; a tracker event written,
-- renumbered or removed) leaves a mark with the earliest seq it touches, whatever code path made it.
-- A snapshot at seq S stays good while no newer mark has a seq at or before S. AUTOINCREMENT: ids
-- never come back after old marks are pruned.
CREATE TABLE IF NOT EXISTS fold_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fold_marks_chat ON fold_marks(chat_id, id);
${FOLD_MARK_TRIGGERS}
`,
  },
  {
    id: 15,
    name: "memory marks",
    sql: /* sql */ `
-- M20: the entity sync reads only the memories that changed since it last ran. Every memory
-- written, deleted, or changed in what the sync reads (names, seqs, status, deletion) leaves a mark.
CREATE TABLE IF NOT EXISTS memory_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  memory_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_marks_chat ON memory_marks(chat_id, id);
CREATE TRIGGER IF NOT EXISTS memory_marks_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memory_marks (chat_id, memory_id) VALUES (new.chat_id, new.id);
END;
CREATE TRIGGER IF NOT EXISTS memory_marks_au AFTER UPDATE OF id, chat_id, entities, min_seq, max_seq, status, deleted_at, created_at ON memories BEGIN
  INSERT INTO memory_marks (chat_id, memory_id) VALUES (old.chat_id, old.id);
  INSERT INTO memory_marks (chat_id, memory_id) SELECT new.chat_id, new.id WHERE new.chat_id IS NOT old.chat_id OR new.id IS NOT old.id;
END;
CREATE TRIGGER IF NOT EXISTS memory_marks_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memory_marks (chat_id, memory_id) VALUES (old.chat_id, old.id);
END;
`,
  },
  {
    id: 16,
    name: "memory origin and lore firing message",
    up: (db) => {
      // M31: who made a memory, instead of guessing tracker-made ones from confidence 0.85, no scene and one source.
      if (!hasColumn(db, "memories", "origin")) db.exec("ALTER TABLE memories ADD COLUMN origin TEXT NOT NULL DEFAULT 'ai'");
      if (!hasColumn(db, "memories", "swipe_idx")) db.exec("ALTER TABLE memories ADD COLUMN swipe_idx INTEGER");
      // Backfill with the old heuristic: tracker memories follow the swipe their message shows.
      db.exec(`UPDATE memories SET origin = 'tracker',
          swipe_idx = (SELECT m.active_swipe FROM memory_sources s JOIN messages m ON m.id = s.message_id WHERE s.memory_id = memories.id)
        WHERE origin = 'ai' AND scene_id IS NULL AND confidence = 0.85
          AND (SELECT COUNT(*) FROM memory_sources s WHERE s.memory_id = memories.id) = 1`);
      // Memories outside any scene that you wrote or edited are yours.
      db.exec("UPDATE memories SET origin = 'user' WHERE origin = 'ai' AND scene_id IS NULL AND user_edited = 1");
      db.exec("CREATE INDEX IF NOT EXISTS memories_origin ON memories(chat_id, origin) WHERE origin != 'ai'");

      // M31/M32: the message whose reply fired a lore entry, and where it stood then, instead of inferring it from the count.
      if (!hasColumn(db, "lore_state", "fired_at")) db.exec("ALTER TABLE lore_state ADD COLUMN fired_at TEXT");
      if (!hasColumn(db, "lore_state", "fired_pos")) db.exec("ALTER TABLE lore_state ADD COLUMN fired_pos INTEGER");
      const rows = db
        .query<{ chat_id: string; entry_id: string; sticky_until: number | null; cooldown_until: number | null; data: string | null }, []>(
          "SELECT ls.chat_id, ls.entry_id, ls.sticky_until, ls.cooldown_until, e.data FROM lore_state ls LEFT JOIN lorebook_entries e ON e.id = ls.entry_id WHERE ls.fired_at IS NULL",
        )
        .all();
      const live = new Map<string, { id: string; role: string }[]>();
      const setFired = db.query("UPDATE lore_state SET fired_at = ?, fired_pos = ? WHERE chat_id = ? AND entry_id = ?");
      const drop = db.query("DELETE FROM lore_state WHERE chat_id = ? AND entry_id = ?");
      for (const r of rows) {
        let entry: { sticky?: number; cooldown?: number } = {};
        try {
          entry = r.data ? JSON.parse(r.data) : {};
        } catch {
          // a broken entry can't be timed
        }
        const sticky = Number(entry.sticky) || 0;
        const cooldown = Number(entry.cooldown) || 0;
        // The live-message count the entry fired at (as M32 inferred it).
        const count = r.sticky_until != null && sticky > 0 ? r.sticky_until - sticky : r.cooldown_until != null && cooldown > 0 ? r.cooldown_until - cooldown : null;
        let msgs = live.get(r.chat_id);
        if (!msgs) live.set(r.chat_id, (msgs = db.query<{ id: string; role: string }, [string]>("SELECT id, role FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY seq").all(r.chat_id)));
        // The reply it fired for: written right after that count (a new reply), or at it (a swipe or continue).
        const pick = count == null ? -1 : msgs[count]?.role === "assistant" ? count : msgs[count - 1]?.role === "assistant" ? count - 1 : msgs[count] ? count : count - 1;
        const m = pick >= 0 ? msgs[pick] : undefined;
        // No entry, no count, or its message is gone (rewound or deleted): the state can't hold anything back.
        if (!m) drop.run(r.chat_id, r.entry_id);
        else setFired.run(m.id, pick + 1, r.chat_id, r.entry_id);
      }
    },
  },
  {
    id: 17,
    name: "foreign keys for message and chat rows",
    up: (db) => {
      // M31: vectors go with their memory or summary in the same statement, however it's deleted
      // (a rebuild, a purge, a chat's cascade). Owners are polymorphic, so triggers instead of a foreign key.
      db.exec(`
CREATE TRIGGER IF NOT EXISTS embeddings_memory_gone AFTER DELETE ON memories BEGIN
  DELETE FROM embeddings WHERE owner_type = 'memory' AND owner_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS embeddings_summary_gone AFTER DELETE ON summaries BEGIN
  DELETE FROM embeddings WHERE owner_type = 'summary' AND owner_id = old.id;
END;`);
      // Memories made only from messages that are gone for good go too (as a purge does), unless you edited or pinned them.
      db.exec(`DELETE FROM memories WHERE user_edited = 0 AND pinned = 0
        AND EXISTS (SELECT 1 FROM memory_sources s WHERE s.memory_id = memories.id)
        AND NOT EXISTS (SELECT 1 FROM memory_sources s JOIN messages m ON m.id = s.message_id WHERE s.memory_id = memories.id)`);
      // M31: rows tied to a message go when it's purged, rows tied to a chat when it is. SQLite can't add a
      // foreign key to a table, so each is rebuilt: new table, the rows that still have a parent, swap, indexes.
      const chat = "chat_id IN (SELECT id FROM chats)";
      const message = "message_id IN (SELECT id FROM messages)";
      rebuildTable(db, "tracker_events", {
        create: `CREATE TABLE tracker_events (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  swipe_idx INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  ord INTEGER NOT NULL,
  op TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`,
        keep: `${chat} AND (message_id IS NULL OR ${message})`,
        after: `CREATE INDEX IF NOT EXISTS tracker_events_chat ON tracker_events(chat_id, message_id, swipe_idx, ord);
CREATE INDEX IF NOT EXISTS tracker_events_message ON tracker_events(message_id, swipe_idx);
${FOLD_MARK_EVENT_TRIGGERS}`,
      });
      rebuildTable(db, "memory_sources", {
        create: `CREATE TABLE memory_sources (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  PRIMARY KEY (memory_id, message_id)
)`,
        keep: `memory_id IN (SELECT id FROM memories) AND ${message}`,
        after: "CREATE INDEX IF NOT EXISTS memory_sources_message ON memory_sources(message_id);",
      });
      rebuildTable(db, "continuity_flags", {
        create: `CREATE TABLE continuity_flags (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  swipe_idx INTEGER NOT NULL,
  issues TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (message_id, swipe_idx)
)`,
        keep: `${chat} AND ${message}`,
        after: "CREATE INDEX IF NOT EXISTS continuity_chat ON continuity_flags(chat_id, status);",
      });
      rebuildTable(db, "highlights", {
        create: `CREATE TABLE highlights (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
)`,
        keep: `${chat} AND ${message}`,
        after: `CREATE INDEX IF NOT EXISTS highlights_chat ON highlights(chat_id, created_at);
CREATE INDEX IF NOT EXISTS highlights_message ON highlights(message_id);`,
      });
      rebuildTable(db, "memory_usage", {
        create: `CREATE TABLE memory_usage (
  generation_id TEXT NOT NULL,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (generation_id, owner_type, owner_id)
)`,
        keep: chat,
        after: `CREATE INDEX IF NOT EXISTS memory_usage_owner ON memory_usage(owner_type, owner_id, created_at);
CREATE INDEX IF NOT EXISTS memory_usage_chat ON memory_usage(chat_id, created_at);`,
      });
      rebuildTable(db, "lore_hits", {
        create: `CREATE TABLE lore_hits (
  entry_id TEXT NOT NULL,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  count INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (entry_id, chat_id)
)`,
        keep: chat,
        // A chat's delete finds its rows by chat.
        after: "CREATE INDEX IF NOT EXISTS lore_hits_chat ON lore_hits(chat_id);",
      });
      rebuildTable(db, "inbox_dismissed", {
        create: `CREATE TABLE inbox_dismissed (
  key TEXT PRIMARY KEY,
  chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
)`,
        keep: `chat_id IS NULL OR ${chat}`,
        after: "CREATE INDEX IF NOT EXISTS inbox_dismissed_chat ON inbox_dismissed(chat_id) WHERE chat_id IS NOT NULL;",
      });
      // Every row left must have its parent, or the migration (and its transaction) fails.
      for (const t of ["tracker_events", "memory_sources", "continuity_flags", "highlights", "memory_usage", "lore_hits", "inbox_dismissed"]) {
        const bad = db.query(`PRAGMA foreign_key_check(${t})`).all();
        if (bad.length) throw new Error(`Migration 17: ${bad.length} rows of ${t} still lack a parent`);
      }
    },
  },
  {
    id: 18,
    name: "almanac foundations",
    sql: /* sql */ `
-- Almanac plan P1. Lessons from swipes (A1): a rule the story learned from the takes you passed
-- over, for this story, this character or every story. scope: story | character | everywhere;
-- status: suggested | kept | off | rejected.
CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
  character_id TEXT REFERENCES characters(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'story',
  text TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT '',
  quote TEXT NOT NULL DEFAULT '',
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'suggested',
  strength REAL NOT NULL DEFAULT 1,
  by TEXT NOT NULL DEFAULT 'rules',
  last_broken_seq INTEGER,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX lessons_chat ON lessons(chat_id, status);
CREATE INDEX lessons_character ON lessons(character_id, status) WHERE character_id IS NOT NULL;
CREATE INDEX lessons_message ON lessons(message_id) WHERE message_id IS NOT NULL;

-- Secrets kept off the page (B1): held back from the narration itself. ref: the tracker fact key
-- (or a Codex/lore reference). status: kept | revealed.
CREATE TABLE secrets_offpage (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  ref TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,
  never_say TEXT NOT NULL DEFAULT '[]',
  hint_as TEXT NOT NULL DEFAULT '',
  hints TEXT NOT NULL DEFAULT 'rarely',
  reveal TEXT NOT NULL DEFAULT '{"when":"say"}',
  status TEXT NOT NULL DEFAULT 'kept',
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX secrets_offpage_chat ON secrets_offpage(chat_id, status);

-- Playbooks (C2): lore entries that script a future scene. status: waiting | next | held | played | not.
-- played_message_id ties "played" to a message, so swiping it away un-retires the playbook.
CREATE TABLE playbooks (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'waiting',
  played_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (chat_id, entry_id)
);

-- Calendars you build (G1), usable in any chat.
CREATE TABLE calendars_custom (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- What Mea filed from a message (a lesson, a promise, a truth, a calendar day…), shown as a chip
-- on it with Undo. kind names the feature that knows how to undo it; data holds what it needs.
CREATE TABLE filings (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'filed',
  created_at INTEGER NOT NULL
);
CREATE INDEX filings_chat ON filings(chat_id, status);
CREATE INDEX filings_message ON filings(message_id) WHERE message_id IS NOT NULL;
`,
    up: (db) => {
      // Session Zero (F1): a chat's setup answers. NULL until the setup window has been seen.
      if (!hasColumn(db, "chats", "chat_setup")) db.exec("ALTER TABLE chats ADD COLUMN chat_setup TEXT");
    },
  },
  {
    id: 19,
    name: "no playbooks",
    sql: /* sql */ `
-- Playbooks (Almanac C2) were dropped from the plan; migration 18's table was never used.
DROP TABLE IF EXISTS playbooks;
`,
  },
  {
    id: 20,
    name: "off-page rewordings",
    sql: /* sql */ `
-- B1: the helper's rewordings of memory and lore that state a secret kept off the page, keyed by
-- the text and the secrets it was reworded for, so the same block is reworded once.
CREATE TABLE offpage_cache (
  key TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX offpage_cache_chat ON offpage_cache(chat_id);
`,
  },
  {
    id: 21,
    name: "no cozy theme",
    sql: /* sql */ `
-- Mea Cozy (light, dark, and "match my device") was retired; whoever wore it moves to Lantern.
UPDATE settings SET value = '"lantern"' WHERE key = 'appearance.theme' AND value IN ('"system"', '"light"', '"dark"');
`,
  },
  {
    id: 22,
    name: "a world's people and enriching a book",
    sql: /* sql */ `
-- A lorebook's roster of people, from a name to a voiced profile (an entry) to their own card.
CREATE TABLE lore_people (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_lore_people_book ON lore_people(book_id);
-- One "enrich the entries" run per book: each entry's progress and its original text.
CREATE TABLE lore_enrich_runs (
  book_id TEXT PRIMARY KEY REFERENCES lorebooks(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`,
  },
  {
    id: 23,
    name: "linked versions and universes",
    sql: /* sql */ `
-- Linked versions (docs/14): a whole card or persona of its own (an AU, an era, a time skip, a what-if),
-- linked to the original it came from. Universes are shared settings; they're filled in by a later part.
CREATE TABLE universes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  premise TEXT NOT NULL DEFAULT '',
  kind TEXT,
  map TEXT NOT NULL DEFAULT '[]',
  book_id TEXT REFERENCES lorebooks(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
`,
    up: (db) => {
      for (const table of ["characters", "personas"]) {
        if (!hasColumn(db, table, "variant_of")) db.exec(`ALTER TABLE ${table} ADD COLUMN variant_of TEXT REFERENCES ${table}(id) ON DELETE SET NULL`);
        if (!hasColumn(db, table, "variant_kind")) db.exec(`ALTER TABLE ${table} ADD COLUMN variant_kind TEXT`);
        if (!hasColumn(db, table, "variant_label")) db.exec(`ALTER TABLE ${table} ADD COLUMN variant_label TEXT`);
        if (!hasColumn(db, table, "universe_id")) db.exec(`ALTER TABLE ${table} ADD COLUMN universe_id TEXT REFERENCES universes(id) ON DELETE SET NULL`);
        if (!hasColumn(db, table, "anchors")) db.exec(`ALTER TABLE ${table} ADD COLUMN anchors TEXT NOT NULL DEFAULT '[]'`);
        db.exec(`CREATE INDEX IF NOT EXISTS ${table}_variant_of ON ${table}(variant_of)`);
      }
      // A Look (today's variants) that sits on a version instead of the original.
      if (!hasColumn(db, "variants", "on_version_id")) db.exec("ALTER TABLE variants ADD COLUMN on_version_id TEXT");
    },
  },
  {
    id: 24,
    name: "version sync",
    sql: "",
    // docs/14, part 5: what a version's fields were written from (fingerprints of its original), and auto-sync.
    up: (db) => {
      for (const table of ["characters", "personas"]) if (!hasColumn(db, table, "version_sync")) db.exec(`ALTER TABLE ${table} ADD COLUMN version_sync TEXT NOT NULL DEFAULT '{}'`);
    },
  },
  {
    id: 25,
    name: "looks on every version",
    sql: "",
    // docs/14, part 6: an original's Look that also plays on each of its versions.
    up: (db) => {
      if (!hasColumn(db, "variants", "every_version")) db.exec("ALTER TABLE variants ADD COLUMN every_version INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    id: 26,
    name: "lore facts",
    sql: /* sql */ `
-- Living lore (docs/15, part 1): small, exact, dated statements on a lorebook entry. A canon fact
-- (chat_id NULL) holds in every chat; a story fact belongs to one chat and follows its branch
-- through the message and swipe it came from (swipe_idx -1: whichever swipe is shown).
CREATE TABLE lore_facts (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES lorebook_entries(id) ON DELETE CASCADE,
  chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
  slot TEXT,
  value TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'attribute',
  since_seq INTEGER,
  until_seq INTEGER,
  since_time INTEGER,
  until_time INTEGER,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  swipe_idx INTEGER NOT NULL DEFAULT -1,
  origin TEXT NOT NULL DEFAULT 'you',
  locked INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  superseded_by TEXT,
  -- The fact this one replaced (a chat's change to a canon fact hides it in that chat only).
  replaces TEXT,
  known_by TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX lore_facts_entry ON lore_facts(entry_id, chat_id);
CREATE INDEX lore_facts_message ON lore_facts(message_id) WHERE message_id IS NOT NULL;
`,
  },
  {
    id: 27,
    name: "lore keep-up",
    sql: /* sql */ `
-- docs/15, part 2: how far each entry has been checked against each chat's story (the last message,
-- and the newest memory read), so nothing is read twice.
CREATE TABLE lore_keepup (
  entry_id TEXT NOT NULL REFERENCES lorebook_entries(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL DEFAULT 0,
  atoms_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (entry_id, chat_id)
);
`,
    up: (db) => {
      // Update proposals live beside the Chronicle's new-entry ones: their kind, their entry, and the diff.
      if (!hasColumn(db, "chronicle_proposals", "kind")) db.exec("ALTER TABLE chronicle_proposals ADD COLUMN kind TEXT NOT NULL DEFAULT 'new'");
      if (!hasColumn(db, "chronicle_proposals", "entry_id")) db.exec("ALTER TABLE chronicle_proposals ADD COLUMN entry_id TEXT");
      if (!hasColumn(db, "chronicle_proposals", "diff")) db.exec("ALTER TABLE chronicle_proposals ADD COLUMN diff TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS chronicle_entry ON chronicle_proposals(entry_id, chat_id, kind) WHERE entry_id IS NOT NULL");
      // A story fact's source text, fingerprinted: an edit to that message marks the fact for a re-check (2.3).
      if (!hasColumn(db, "lore_facts", "basis")) db.exec("ALTER TABLE lore_facts ADD COLUMN basis TEXT");
      // A fact the story ended at a message ends on that message's branch only (swipe it away and it holds again).
      if (!hasColumn(db, "lore_facts", "until_message_id")) db.exec("ALTER TABLE lore_facts ADD COLUMN until_message_id TEXT");
      if (!hasColumn(db, "lore_facts", "until_swipe")) db.exec("ALTER TABLE lore_facts ADD COLUMN until_swipe INTEGER");
    },
  },
  {
    id: 28,
    name: "facts that wear off",
    sql: "",
    // docs/15, 5.2: how long a state is expected to last on the story's clock ("a sling, about six weeks").
    up: (db) => {
      if (!hasColumn(db, "lore_facts", "expects_minutes")) db.exec("ALTER TABLE lore_facts ADD COLUMN expects_minutes INTEGER");
    },
  },
  {
    id: 29,
    name: "canon facts and the slot quiz",
    sql: "",
    up: (db) => {
      // docs/15, 8.1: where a story fact made canon came from (its chat, message and number), kept as provenance.
      if (!hasColumn(db, "lore_facts", "source")) db.exec("ALTER TABLE lore_facts ADD COLUMN source TEXT");
      // 8.3: the quiz's score on the detail sheet, beside its memory scores.
      if (!hasColumn(db, "quiz_runs", "slots")) db.exec("ALTER TABLE quiz_runs ADD COLUMN slots REAL");
    },
  },
  {
    id: 30,
    name: "lore cut by the budget",
    sql: "",
    // Lore health tells "its keys miss" from "it matched, but the budget was full": when an entry was last cut.
    up: (db) => {
      if (!hasColumn(db, "lore_hits", "cut_at")) db.exec("ALTER TABLE lore_hits ADD COLUMN cut_at INTEGER");
    },
  },
  {
    id: 31,
    name: "depth entries aren't current",
    sql: "",
    // Since Current means "in every scene" (PR #120), the creator's depth entries (tagged Current) and
    // depth-book entries auto-sorted to Current rode every prompt. They lose the category; a Current
    // you picked yourself (sure, in a book that isn't a depth book) stays.
    up: (db) => {
      const rows = db
        .query<{ id: string; data: string; name: string; settings: string }, []>(
          `SELECT e.id, e.data, b.name, b.settings FROM lorebook_entries e JOIN lorebooks b ON b.id = e.lorebook_id WHERE e.data LIKE '%"category":"current"%'`,
        )
        .all();
      const save = db.query("UPDATE lorebook_entries SET data = ? WHERE id = ?");
      for (const r of rows) {
        let data: { extra?: Record<string, unknown> };
        let role: unknown;
        try {
          data = JSON.parse(r.data);
          role = (JSON.parse(r.settings || "{}") as { role?: unknown }).role;
        } catch {
          continue;
        }
        const x = data.extra ?? {};
        if (x.category !== "current") continue;
        const depthBook = role === "depth" || /\bdepth book$/i.test(r.name) || (/\b(dream\s*weaver|dw)\b/i.test(r.name) && /\bdepth\b/i.test(r.name));
        const guessed = typeof x.categoryConfidence === "number" && x.categoryConfidence < 1;
        if (!x.creatorDepth && !(depthBook && guessed)) continue;
        delete x.category;
        delete x.categoryConfidence;
        save.run(JSON.stringify({ ...data, extra: x }), r.id);
      }
    },
  },
  {
    id: 32,
    name: "song lyrics",
    // docs/18, 1.1: the words of the soundtrack's songs, kept on this PC. `source = 'none'` remembers
    // a miss (looked for again after a while); `sheet` is what Part 2 reads out of them.
    sql: /* sql */ `
CREATE TABLE IF NOT EXISTS song_lyrics (
  video_id   TEXT PRIMARY KEY,
  source     TEXT NOT NULL,
  timed      INTEGER NOT NULL DEFAULT 0,
  lines      TEXT NOT NULL DEFAULT '[]',
  duration   REAL,
  sheet      TEXT,
  sheet_hash TEXT,
  fetched_at INTEGER NOT NULL
);
`,
  },
  {
    id: 33,
    name: "cast factions",
    // Groups on the Story page's Cast: a house, a crew, a guild, with the people in it (by cast name).
    sql: /* sql */ `
CREATE TABLE IF NOT EXISTS cast_factions (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cast_factions_chat ON cast_factions(chat_id);
`,
  },
  {
    id: 34,
    name: "person sheets",
    // docs/21 Part 2: what the lore says about each person, read once by the model: alive or not, where, in the story's present.
    sql: /* sql */ `
CREATE TABLE IF NOT EXISTS world_sheets (
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  name_key   TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, name_key)
);
`,
  },
];

const hasColumn = (db: Database, table: string, column: string) => db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

/**
 * Rebuilds a table with a new definition (SQLite can't add constraints in place): creates it under a
 * temporary name, copies the rows `keep` selects, drops the old one, renames the new one, then runs
 * `after` (indexes and triggers, which went with the old table). Safe to run again: a half-made temp
 * table from an earlier try is dropped first, and a table already rebuilt (its definition matches) is left alone.
 */
function rebuildTable(db: Database, name: string, spec: { create: string; keep: string; after?: string }) {
  const tmp = `${name}_rebuild`;
  const current = db.query<{ sql: string }, [string]>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.sql;
  const squash = (s: string) => s.replace(/\s+/g, " ").replace(/"/g, "").trim();
  if (current && squash(current) === squash(spec.create)) {
    if (spec.after) db.exec(spec.after);
    return;
  }
  db.exec(`DROP TABLE IF EXISTS ${tmp}`);
  db.exec(spec.create.replace(`CREATE TABLE ${name} (`, `CREATE TABLE ${tmp} (`));
  const newCols = db.query<{ name: string }, []>(`PRAGMA table_info(${tmp})`).all().map((c) => c.name);
  const oldCols = db.query<{ name: string }, []>(`PRAGMA table_info(${name})`).all().map((c) => c.name);
  const lost = oldCols.filter((c) => !newCols.includes(c));
  if (lost.length) throw new Error(`Rebuilding ${name} would lose columns: ${lost.join(", ")}`);
  const cols = newCols.filter((c) => oldCols.includes(c)).join(", ");
  db.exec(`INSERT INTO ${tmp} (${cols}) SELECT ${cols} FROM ${name} WHERE ${spec.keep}`);
  db.exec(`DROP TABLE ${name}`);
  db.exec(`ALTER TABLE ${tmp} RENAME TO ${name}`);
  if (spec.after) db.exec(spec.after);
}
