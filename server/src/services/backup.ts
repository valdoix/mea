import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { paths } from "../config";
import { writeFileSync, readFileSync } from "node:fs";
import { closeDb, db, dbMode, one, openDb, openDbFromBytes, run } from "../db/db";
import { openSealed, persistVault, sealSnapshot, vaultActive, vaultMigrationBackup } from "../lib/vault";
import { badRequest, HttpError } from "../lib/http";
import { getSetting } from "../lib/settings";
import { activeGenerations, stopGeneration } from "./generation";
import { sweepDeletedImages } from "./images";
import { Deferred, pauseJobs, runningJobCount } from "./jobs";
import { mirrorBackup } from "./mirror";

/**
 * Rolling SQLite snapshots (DATA-03). Images are immutable on disk; purged ones wait in images/deleted/
 * for a grace period (M36), so a restored snapshot gets its pictures back.
 */
export type BackupKind = "hourly" | "daily" | "manual" | "pre-restore" | "pre-migration";

const pad = (n: number) => String(n).padStart(2, "0");
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** A file name not taken yet: two backups in the same second get "-2", "-3"… */
function freshName(kind: BackupKind, ext: ".db" | ".db.enc") {
  const base = `mea-${kind}-${stamp()}`;
  let file = join(paths.backups, `${base}${ext}`);
  for (let i = 2; existsSync(file) || existsSync(`${file}.enc`); i++) file = join(paths.backups, `${base}-${i}${ext}`);
  return file;
}

export function createBackup(kind: BackupKind) {
  // SEC-05: with encryption on, backups are sealed too; nothing plain touches the disk.
  if (vaultActive()) {
    const file = freshName(kind, ".db.enc");
    writeFileSync(file, sealSnapshot());
    return { file: basename(file), bytes: statSync(file).size };
  }
  const file = freshName(kind, ".db");
  db().exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  return { file: basename(file), bytes: statSync(file).size };
}

export function listBackups() {
  if (!existsSync(paths.backups)) return [];
  return readdirSync(paths.backups)
    .filter((f) => f.endsWith(".db") || f.endsWith(".db.enc"))
    .map((f) => {
      const st = statSync(join(paths.backups, f));
      const kind = (f.match(/^(?:mea-)?(hourly|daily|manual|pre-restore|pre-migration)/)?.[1] ?? "manual") as BackupKind;
      return { file: f, kind, bytes: st.size, createdAt: st.mtimeMs, encrypted: f.endsWith(".enc") };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function pruneBackups() {
  const keep: Record<BackupKind, number> = {
    hourly: getSetting("backup.hourlyKeep"),
    daily: getSetting("backup.dailyKeep"),
    manual: 30,
    "pre-restore": 5,
    "pre-migration": 5,
  };
  const seen: Record<string, number> = {};
  for (const b of listBackups()) {
    seen[b.kind] = (seen[b.kind] ?? 0) + 1;
    if (seen[b.kind]! > keep[b.kind]) unlinkSync(join(paths.backups, b.file));
  }
}

let lastFingerprint = "";

function fingerprint() {
  const r = one<Record<string, number | null>>(`SELECT
    (SELECT MAX(updated_at) FROM swipes) a, (SELECT MAX(updated_at) FROM messages) b, (SELECT MAX(updated_at) FROM characters) c,
    (SELECT MAX(updated_at) FROM chats) d, (SELECT MAX(updated_at) FROM lorebooks) e, (SELECT MAX(updated_at) FROM personas) f,
    (SELECT MAX(updated_at) FROM presets) g, (SELECT COUNT(*) FROM messages) h`);
  return JSON.stringify(r);
}

/** Hourly job: snapshot only if something changed; one daily snapshot per day. */
export function scheduledBackup() {
  // L5: a snapshot blocks the server for a moment, so it waits until no reply is streaming.
  if (activeGenerations().length) throw new Deferred("waiting for replies to finish", 2 * 60_000);
  const fp = fingerprint();
  const backups = listBackups();
  const today = stamp().slice(0, 8);
  const hasDaily = backups.some((b) => b.kind === "daily" && b.file.includes(`-${today}-`));
  // L5: right after a restart, a snapshot from the last hour will do; the next run takes a fresh one.
  if (hasDaily && !lastFingerprint && backups[0] && Date.now() - backups[0].createdAt < 50 * 60_000) return;
  if (!hasDaily) {
    const daily = createBackup("daily");
    // DATA-08: the daily snapshot also goes off this machine. A failure is shown in settings.
    try {
      mirrorBackup(daily.file);
    } catch (e) {
      console.error("[mea] backup mirror failed:", (e as Error).message);
    }
  } else if (fp !== lastFingerprint) createBackup("hourly");
  lastFingerprint = fp;
  pruneBackups();
}

const DAMAGED = "That backup is damaged or isn't a Mea database, so nothing was changed";

/** H11: a candidate must pass quick_check and be a Mea database (it has `_migrations`). */
function checkCandidate(database: Database) {
  try {
    const rows = database.query<Record<string, string>, []>("PRAGMA quick_check").all();
    const ok = rows.length === 1 && Object.values(rows[0]!)[0] === "ok";
    const mea = database.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_migrations'").get();
    if (!ok || !mea) throw new Error("bad");
  } catch {
    throw badRequest(DAMAGED);
  } finally {
    database.close();
  }
}

/** H11: replies streaming at the time of the snapshot, or running jobs in it, are marked as interrupted (as at startup). */
function recoverRestored() {
  run(`UPDATE swipes SET
         status = CASE WHEN TRIM(content) = '' THEN 'error' ELSE 'stopped' END,
         error = CASE WHEN TRIM(content) = '' THEN 'Mea restarted while this reply was being written. Swipe to try again.' ELSE error END
       WHERE status = 'streaming'`);
  run("UPDATE generations SET status = 'error', error = 'interrupted by restart' WHERE status = 'running'");
  run("UPDATE jobs SET status = 'queued' WHERE status = 'running'");
  // M36: images the snapshot still uses come back from images/deleted/.
  try {
    sweepDeletedImages();
  } catch (e) {
    console.error("[mea] couldn't bring back purged images:", (e as Error).message);
  }
}

const removeSidecars = (file: string) => {
  for (const suffix of ["-wal", "-shm", "-journal"]) if (existsSync(file + suffix)) unlinkSync(file + suffix);
};

let resumeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Replaces the live database with a snapshot. A pre-restore backup is taken first.
 * H11: the candidate is checked before anything changes; nothing may be writing while the database is
 * swapped; the file goes in by rename; and if the result won't open, the pre-restore snapshot goes back.
 */
export function restoreBackup(file: string) {
  if (file.includes("/") || file.includes("\\") || !(file.endsWith(".db") || file.endsWith(".db.enc"))) throw badRequest("Invalid backup name");
  const source = join(paths.backups, file);
  if (!existsSync(source)) throw badRequest("Backup not found");
  const memory = dbMode() === "memory";
  if (!memory && file.endsWith(".enc")) throw badRequest("That backup is encrypted; turn encryption on (with its passphrase) to restore it");

  // Check the candidate first.
  let bytes: Buffer | null = null;
  const temp = `${paths.db}.restore-${process.pid}.tmp`;
  if (memory) {
    try {
      bytes = file.endsWith(".enc") ? openSealed(readFileSync(source)) : readFileSync(source);
    } catch {
      throw badRequest("That backup was sealed with another passphrase");
    }
    let candidate: Database;
    try {
      // As in openDbFromBytes: an in-memory copy can't use WAL, so mark it rollback-journal.
      const copy = Uint8Array.from(bytes);
      if (copy[18] === 2 || copy[19] === 2) copy[18] = copy[19] = 1;
      candidate = Database.deserialize(copy, { readonly: true });
    } catch {
      throw badRequest(DAMAGED);
    }
    checkCandidate(candidate);
  } else {
    copyFileSync(source, temp);
    try {
      let candidate: Database;
      try {
        candidate = new Database(temp, { readonly: true });
      } catch {
        throw badRequest(DAMAGED);
      }
      checkCandidate(candidate);
    } catch (e) {
      removeSidecars(temp);
      if (existsSync(temp)) unlinkSync(temp);
      throw e;
    } finally {
      removeSidecars(temp);
    }
  }

  // Nothing may write into the database while it's swapped: hold new jobs, stop streaming replies.
  pauseJobs(true);
  if (resumeTimer) clearTimeout(resumeTimer);
  const streaming = activeGenerations();
  if (streaming.length || runningJobCount()) {
    for (const g of streaming) stopGeneration(g.generationId);
    // Jobs stay held for a while so a retry finds them finished.
    resumeTimer = setTimeout(() => pauseJobs(false), 60_000);
    if (!memory && existsSync(temp)) unlinkSync(temp);
    throw new HttpError(409, streaming.length ? "A reply was being written; it has been stopped. Try the restore again in a moment." : "Background work is finishing up. Try the restore again in a few seconds.");
  }

  try {
    const pre = createBackup("pre-restore");
    if (memory) {
      // SEC-05: the snapshot replaces the in-memory database, and is saved (encrypted) at once.
      const previous = db().serialize();
      try {
        openDbFromBytes(bytes!, { backup: vaultMigrationBackup });
      } catch (e) {
        openDbFromBytes(previous, { backup: vaultMigrationBackup });
        throw new HttpError(500, `That backup couldn't be opened (${(e as Error).message}); nothing was changed`);
      }
      recoverRestored();
      persistVault(true);
      return;
    }
    closeDb();
    removeSidecars(paths.db);
    renameSync(temp, paths.db);
    try {
      openDb(paths.db);
    } catch (e) {
      // Put the pre-restore snapshot back the same way.
      closeDb();
      removeSidecars(paths.db);
      copyFileSync(join(paths.backups, pre.file), temp);
      renameSync(temp, paths.db);
      openDb(paths.db);
      throw new HttpError(500, `That backup couldn't be opened (${(e as Error).message}); Mea is back as it was`);
    }
    recoverRestored();
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
    pauseJobs(false);
  }
}

export function lastBackupAt(): number | null {
  return listBackups()[0]?.createdAt ?? null;
}
