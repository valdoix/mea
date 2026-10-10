import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { config, paths } from "../config";
import { db, dbMode, one, openDb, openDbFromBytes } from "../db/db";
import { subscribe } from "./events";
import { badRequest, HttpError } from "./http";

/**
 * Database encryption at rest (SEC-05, optional). With a passphrase set, the database lives on
 * disk only as `mea.db.enc` (AES-256-GCM, key from scrypt). When Mea starts it is locked until
 * you enter the passphrase; then the database runs in memory and is written back, encrypted,
 * every 30 seconds when something changed and when Mea stops. Backups are encrypted the same way.
 *
 * The trade-offs: after a restart Mea waits for the passphrase; if the machine loses power, up to
 * ~30 seconds of changes can be lost; a forgotten passphrase can't be recovered.
 *
 * File format: "MEA1" + salt(16) + iv(12) + tag(16) + ciphertext, the same as the off-machine
 * backup copies (DATA-08), so any encrypted file opens with the passphrase alone.
 */

const MAGIC = Buffer.from("MEA1");
export const vaultFile = join(config.dataDir, "mea.db.enc");
const KDF = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

let key: Buffer | null = null;
let salt: Buffer | null = null;
let locked = false;
let lastChanges = -1;
let timer: ReturnType<typeof setInterval> | null = null;
let onUnlock: ((bytes: Buffer) => void) | null = null;

const derive = (pass: string, s: Buffer) => scryptSync(pass.normalize("NFKC"), s, 32, KDF);

function seal(data: Uint8Array, k: Buffer, s: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, s, iv, cipher.getAuthTag(), body]);
}

/** Opens a sealed file with the key in hand, or derives one from the passphrase. Throws on a wrong one. */
function unseal(data: Buffer, pass?: string): { bytes: Buffer; key: Buffer; salt: Buffer } {
  if (!data.subarray(0, 4).equals(MAGIC)) throw new Error("Not an encrypted Mea file");
  const s = Buffer.from(data.subarray(4, 20));
  const k = key && salt && salt.equals(s) && !pass ? key : pass ? derive(pass, s) : null;
  if (!k) throw new Error("A passphrase is needed");
  const decipher = createDecipheriv("aes-256-gcm", k, data.subarray(20, 32));
  decipher.setAuthTag(data.subarray(32, 48));
  return { bytes: Buffer.concat([decipher.update(data.subarray(48)), decipher.final()]), key: k, salt: s };
}

/** Writes to a temp file, flushes it to disk, then renames it over the old one, so a power cut leaves one or the other. */
function writeAtomic(file: string, data: Uint8Array) {
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}

/** The previous good copy of the encrypted database, kept for when the newest one can't be read. */
const prevFile = () => `${vaultFile}.prev`;

const removeQuietly = (f: string) => {
  try {
    if (existsSync(f)) unlinkSync(f);
  } catch {
    // in use or gone
  }
};

export const vaultEnabled = () => existsSync(vaultFile);
export const isLocked = () => locked;
export const vaultActive = () => Boolean(key && dbMode() === "memory");

/** Startup found an encrypted database: wait for the passphrase, then hand the bytes over. */
export function lockUntilUnlocked(handler: (bytes: Buffer) => void) {
  locked = true;
  onUnlock = handler;
}

// Wrong passphrases are slowed down (scrypt already costs ~0.1 s; this caps guessing further).
// The host computer and everyone else count separately, so guesses through the tunnel never lock the host out.
const attempts: Record<"host" | "remote", number[]> = { host: [], remote: [] };
export function unlockVault(passphrase: string, fromHost = true) {
  if (!locked) return { ok: true, already: true };
  const t = Date.now();
  const tries = attempts[fromHost ? "host" : "remote"];
  while (tries.length && t - tries[0]! > 60_000) tries.shift();
  if (tries.length >= 5) throw new HttpError(429, "Too many tries. Wait a minute and try again.");
  let r: ReturnType<typeof unseal> | null = null;
  // The newest file first; if it was cut short (a power cut mid-write), the previous good copy.
  for (const f of [vaultFile, prevFile()]) {
    if (!existsSync(f)) continue;
    try {
      r = unseal(readFileSync(f), passphrase);
      if (f !== vaultFile) console.error("[mea] the encrypted database couldn't be read; opened the previous copy instead.");
      break;
    } catch {
      // wrong passphrase, or a damaged file: try the next
    }
  }
  if (!r) {
    tries.push(t);
    throw new HttpError(401, "That passphrase doesn't open Mea.");
  }
  key = r.key;
  salt = r.salt;
  locked = false;
  onUnlock?.(r.bytes);
  onUnlock = null;
  lastChanges = changes();
  // An interrupted switch can leave a plaintext copy behind; the encrypted one is current.
  for (const f of [paths.db, `${paths.db}-wal`, `${paths.db}-shm`]) removeQuietly(f);
  startVaultTimer();
  return { ok: true };
}

function changes() {
  try {
    return one<{ n: number }>("SELECT total_changes() AS n")?.n ?? 0;
  } catch {
    return -1;
  }
}

/** Writes the in-memory database back to disk, encrypted, if anything changed (or when forced). */
export function persistVault(force = false) {
  if (!vaultActive()) return false;
  const n = changes();
  if (!force && n === lastChanges) return false;
  if (existsSync(vaultFile)) copyFileSync(vaultFile, prevFile());
  writeAtomic(vaultFile, seal(db().serialize(), key!, salt!));
  lastChanges = n;
  return true;
}

// SEC-05: a finished reply is saved within a few seconds, not only on the 30-second timer.
let soon: ReturnType<typeof setTimeout> | null = null;
subscribe((e) => {
  if (e.type !== "gen.end" || !vaultActive() || soon) return;
  soon = setTimeout(() => {
    soon = null;
    try {
      persistVault();
    } catch (err) {
      console.error("[mea] couldn't save the encrypted database:", (err as Error).message);
    }
  }, 3000);
});

export function startVaultTimer() {
  stopVaultTimer();
  timer = setInterval(() => {
    try {
      persistVault();
    } catch (e) {
      console.error("[mea] couldn't save the encrypted database:", (e as Error).message);
    }
  }, 30_000);
}
export function stopVaultTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Encrypts a snapshot of the live database (backups while the vault is on). */
export function sealSnapshot(): Buffer {
  if (!vaultActive()) throw new Error("The vault isn't open");
  return seal(db().serialize(), key!, salt!);
}

/** Opens an encrypted backup with the vault's key (or a passphrase, for an older one). */
export function openSealed(data: Buffer, pass?: string): Buffer {
  return unseal(data, pass).bytes;
}

/** The pre-migration backup when the database runs in memory. */
export function vaultMigrationBackup(name: string) {
  if (!vaultActive()) return;
  writeFileSync(join(paths.backups, `${name}-${Date.now()}.db.enc`), seal(db().serialize(), key!, salt!));
}

function checkPassphrase(pass: string) {
  if (!key || !salt) throw badRequest("The vault isn't open");
  const k = derive(pass, salt);
  if (!timingSafeEqual(k, key)) throw new HttpError(401, "That isn't the current passphrase.");
}

const backupFiles = (ext: ".db" | ".db.enc") => readdirSync(paths.backups).filter((f) => f.endsWith(ext) && (ext === ".db.enc" || !f.endsWith(".enc")));

/** Turns encryption on: the live database and every plaintext backup are encrypted; plaintext copies are removed. */
export function enableVault(passphrase: string) {
  if (vaultEnabled()) throw badRequest("Encryption is already on");
  if (passphrase.length < 8) throw badRequest("Use a passphrase of at least 8 characters");
  if (dbMode() !== "file") throw badRequest("The database isn't a file");
  db().exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const bytes = db().serialize();
  salt = randomBytes(16);
  key = derive(passphrase, salt);
  writeAtomic(vaultFile, seal(bytes, key, salt));
  openDbFromBytes(bytes, { backup: vaultMigrationBackup });
  for (const f of [paths.db, `${paths.db}-wal`, `${paths.db}-shm`]) removeQuietly(f);
  let converted = 0;
  for (const f of backupFiles(".db")) {
    const p = join(paths.backups, f);
    writeAtomic(`${p}.enc`, seal(readFileSync(p), key, salt));
    removeQuietly(p);
    converted++;
  }
  lastChanges = changes();
  startVaultTimer();
  return { ok: true, backupsEncrypted: converted };
}

/** Turns encryption off again: the database and its backups go back to plain files. */
export function disableVault(passphrase: string) {
  checkPassphrase(passphrase);
  persistVault(true);
  stopVaultTimer();
  const bytes = db().serialize();
  writeAtomic(paths.db, bytes);
  removeQuietly(vaultFile);
  removeQuietly(prevFile());
  for (const f of backupFiles(".db.enc")) {
    const p = join(paths.backups, f);
    try {
      writeAtomic(p.replace(/\.enc$/, ""), unseal(readFileSync(p)).bytes);
      removeQuietly(p);
    } catch {
      // sealed with an older passphrase: left as it is
    }
  }
  key = null;
  salt = null;
  openDb(paths.db);
  return { ok: true };
}

/** A new passphrase: the database and the backups are sealed again with it. */
export function changeVaultPassphrase(current: string, next: string) {
  if (next.length < 8) throw badRequest("Use a passphrase of at least 8 characters");
  checkPassphrase(current);
  const oldKey = key!;
  const oldSalt = salt!;
  salt = randomBytes(16);
  key = derive(next, salt);
  persistVault(true);
  // The previous copy is sealed with the old passphrase; it mustn't outlive the change.
  removeQuietly(prevFile());
  for (const f of backupFiles(".db.enc")) {
    const p = join(paths.backups, f);
    try {
      const data = readFileSync(p);
      const s = Buffer.from(data.subarray(4, 20));
      if (!s.equals(oldSalt)) continue;
      const decipher = createDecipheriv("aes-256-gcm", oldKey, data.subarray(20, 32));
      decipher.setAuthTag(data.subarray(32, 48));
      writeAtomic(p, seal(Buffer.concat([decipher.update(data.subarray(48)), decipher.final()]), key, salt));
    } catch {
      // leave it
    }
  }
  return { ok: true };
}

/** For tests: forget the key as if Mea had restarted. */
export function resetVaultState() {
  stopVaultTimer();
  key = null;
  salt = null;
  locked = false;
  onUnlock = null;
  attempts.host.length = 0;
  attempts.remote.length = 0;
}
