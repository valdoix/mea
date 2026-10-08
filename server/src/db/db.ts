import { Database, type SQLQueryBindings } from "bun:sqlite";
import { join } from "node:path";
import { paths } from "../config";
import { migrations } from "./migrations";

let current: Database | null = null;
/** "memory" while the database runs decrypted in memory (SEC-05); "file" otherwise. */
let mode: "file" | "memory" = "file";
export const dbMode = () => mode;

export function db(): Database {
  if (!current) throw new Error("Database is not open");
  return current;
}

export const now = () => Date.now();

/** Opens (or creates) the database, tunes it (PERF-04), and applies pending migrations (ARCH-07). */
export function openDb(file: string = paths.db, opts: { backupDir?: string } = {}): Database {
  closeDb();
  const database = new Database(file, { create: true, strict: true });
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA temp_store = MEMORY");
  database.exec("PRAGMA cache_size = -16000");
  current = database;
  mode = "file";
  migrate(database, file === ":memory:" ? undefined : (opts.backupDir ?? paths.backups));
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
  }
}

function migrate(database: Database, backupDir?: string, backupFn?: (name: string) => void) {
  database.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  const applied = new Set(database.query<{ id: number }, []>("SELECT id FROM _migrations").all().map((r) => r.id));
  const pending = migrations.filter((m) => !applied.has(m.id)).sort((a, b) => a.id - b.id);
  if (pending.length === 0) return;

  // Back up an existing database before changing its schema.
  if (applied.size > 0 && backupFn) backupFn(`pre-migration-${pending[0]!.id}`);
  else if (applied.size > 0 && backupDir) {
    const target = join(backupDir, `pre-migration-${pending[0]!.id}-${Date.now()}.db`);
    database.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  }

  for (const m of pending) {
    database.transaction(() => {
      database.exec(m.sql);
      database.query("INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)").run(m.id, m.name, now());
    })();
  }
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
