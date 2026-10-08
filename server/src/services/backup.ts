import { copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { paths } from "../config";
import { closeDb, db, one, openDb } from "../db/db";
import { badRequest } from "../lib/http";
import { getSetting } from "../lib/settings";
import { mirrorBackup } from "./mirror";

/** Rolling SQLite snapshots (DATA-03). Images are append-only on disk, so the DB snapshot is the backup. */
export type BackupKind = "hourly" | "daily" | "manual" | "pre-restore" | "pre-migration";

const pad = (n: number) => String(n).padStart(2, "0");
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function createBackup(kind: BackupKind) {
  const file = join(paths.backups, `mea-${kind}-${stamp()}.db`);
  db().exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  return { file: basename(file), bytes: statSync(file).size };
}

export function listBackups() {
  if (!existsSync(paths.backups)) return [];
  return readdirSync(paths.backups)
    .filter((f) => f.endsWith(".db"))
    .map((f) => {
      const st = statSync(join(paths.backups, f));
      const kind = (f.match(/^(?:mea-)?(hourly|daily|manual|pre-restore|pre-migration)/)?.[1] ?? "manual") as BackupKind;
      return { file: f, kind, bytes: st.size, createdAt: st.mtimeMs };
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
  const fp = fingerprint();
  const backups = listBackups();
  const today = stamp().slice(0, 8);
  if (!backups.some((b) => b.kind === "daily" && b.file.includes(`-${today}-`))) {
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

/** Replaces the live database with a snapshot. A pre-restore backup is taken first. */
export function restoreBackup(file: string) {
  if (file.includes("/") || file.includes("\\") || !file.endsWith(".db")) throw badRequest("Invalid backup name");
  const source = join(paths.backups, file);
  if (!existsSync(source)) throw badRequest("Backup not found");
  createBackup("pre-restore");
  closeDb();
  for (const suffix of ["-wal", "-shm"]) if (existsSync(paths.db + suffix)) unlinkSync(paths.db + suffix);
  copyFileSync(source, paths.db);
  openDb(paths.db);
}

export function lastBackupAt(): number | null {
  return listBackups()[0]?.createdAt ?? null;
}
