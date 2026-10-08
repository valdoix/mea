/**
 * Schema migrations. Embedded as strings so a compiled `mea.exe` carries them.
 * Never edit a shipped migration; add a new one.
 */
export const migrations: { id: number; name: string; sql: string }[] = [
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
];
