import { Database, type SQLQueryBindings } from "bun:sqlite";
import { join } from "node:path";
import { paths } from "../config";
import { migrations } from "./migrations";

let current: Database | null = null;
/** "memory" while the database runs decrypted in memory (SEC-05); "file" otherwise. */
let mode: "file" | "memory" = "file";
export const dbMode = () => mode;
/** Goes up each time a database is opened, so in-memory caches of the last one (M20 fold snapshots) can tell. */
let generation = 0;
export const dbGeneration = () => generation;

export function db(): Database {
  if (!current) throw new Error("Database is not open");
  return current;
}

export const now = () => Date.now();

/** Opens (or creates) the database, tunes it (PERF-04), and applies pending migrations (ARCH-07). */
export function openDb(file: string = paths.db, opts: { backupDir?: string; /** Tests: stop after this migration (an older schema). */ upTo?: number } = {}): Database {
  closeDb();
  const database = new Database(file, { create: true, strict: true });
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA temp_store = MEMORY");
  database.exec("PRAGMA cache_size = -16000");
  // The write-ahead log shrinks back to this after a checkpoint, so one big write doesn't keep it huge.
  database.exec("PRAGMA journal_size_limit = 67108864");
  current = database;
  generation++;
  mode = "file";
  migrate(database, file === ":memory:" ? undefined : (opts.backupDir ?? paths.backups), undefined, opts.upTo);
  return database;
}

/**
 * Opens a database from its bytes, in memory (SEC-05: the decrypted vault). Migrations still run;
 * their safety backup goes through `backup` (encrypted) instead of a plain file.
 */
export function openDbFromBytes(bytes: Uint8Array, opts: { backup?: (name: string) => void } = {}): Database {
  closeDb();
  // A snapshot of a WAL-mode file says so in its header (bytes 18–19 = 2); in memory it must be
  // the rollback journal (1), or SQLite tries to open a WAL file that can't exist.
  if (bytes[18] === 2 || bytes[19] === 2) {
    bytes = Uint8Array.from(bytes);
    bytes[18] = 1;
    bytes[19] = 1;
  }
  const database = Database.deserialize(bytes, { strict: true });
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA temp_store = MEMORY");
  current = database;
  generation++;
  mode = "memory";
  migrate(database, undefined, opts.backup);
  return database;
}

export function closeDb() {
  if (current) {
    try {
      current.exec("PRAGMA optimize");
    } catch {
      // ignore
    }
    current.close();
    current = null;
    health = null;
  }
}

function migrate(database: Database, backupDir?: string, backupFn?: (name: string) => void, upTo = Infinity) {
  database.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  const applied = new Set(database.query<{ id: number }, []>("SELECT id FROM _migrations").all().map((r) => r.id));
  const pending = migrations.filter((m) => !applied.has(m.id) && m.id <= upTo).sort((a, b) => a.id - b.id);
  if (pending.length === 0) return;

  // Back up an existing database before changing its schema.
  if (applied.size > 0 && backupFn) backupFn(`pre-migration-${pending[0]!.id}`);
  else if (applied.size > 0 && backupDir) {
    const target = join(backupDir, `pre-migration-${pending[0]!.id}-${Date.now()}.db`);
    database.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  }

  // Each migration is all or nothing: its SQL, its code steps (table rebuilds, backfills), and its record.
  for (const m of pending) {
    database.transaction(() => {
      if (m.sql) database.exec(m.sql);
      m.up?.(database);
      database.query("INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)").run(m.id, m.name, now());
    })();
  }
}

export interface DbHealth {
  ok: boolean;
  checkedAt: number;
  /** What quick_check reported, when it wasn't "ok" (the first few lines). */
  problems: string[];
  /** Rebuilding the indexes cleared the problems. */
  repaired: boolean;
}
let health: DbHealth | null = null;
/** The last health check of the open database, or null before the first one. */
export const dbHealth = () => health;

function quickCheck(database: Database): string[] {
  return database
    .query<Record<string, string>, []>("PRAGMA quick_check")
    .all()
    .map((r) => String(Object.values(r)[0] ?? ""))
    .filter((v) => v && v !== "ok");
}

/**
 * Checks the open database for damage (borrowed from Lumiverse's self-healing, the review of
 * 2026-10-12): at startup and once a day. Damage confined to indexes is repaired by rebuilding
 * them; anything else is reported (a status tile points to Backups & data) and left for you to
 * decide, never "fixed" by throwing data away.
 */
export function checkDb(): DbHealth {
  const database = db();
  let problems: string[];
  try {
    problems = quickCheck(database);
  } catch (e) {
    problems = [`quick_check failed: ${(e as Error).message}`];
  }
  let repaired = false;
  if (problems.length) {
    console.error(`[mea] the database check found ${problems.length} problem(s): ${problems.slice(0, 3).join("; ")}`);
    try {
      database.exec("REINDEX");
      problems = quickCheck(database);
      repaired = problems.length === 0;
      if (repaired) console.error("[mea] rebuilding the indexes repaired the database");
    } catch (e) {
      problems.push(`REINDEX failed: ${(e as Error).message}`);
    }
  }
  health = { ok: problems.length === 0, checkedAt: now(), problems: problems.slice(0, 20), repaired };
  return health;
}

/** Routine upkeep: fresh query statistics, and the write-ahead log folded back into the file. */
export function tidyDb() {
  const database = db();
  database.exec("PRAGMA optimize");
  if (mode === "file") database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
}

export function one<T>(sql: string, ...params: SQLQueryBindings[]): T | undefined {
  return (db().query(sql).get(...params) as T | null) ?? undefined;
}

export function all<T>(sql: string, ...params: SQLQueryBindings[]): T[] {
  return db().query(sql).all(...params) as T[];
}

export function run(sql: string, ...params: SQLQueryBindings[]) {
  return db().query(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  return db().transaction(fn)();
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const toJson = (value: unknown) => JSON.stringify(value ?? null);

export const newId = () => crypto.randomUUID();
