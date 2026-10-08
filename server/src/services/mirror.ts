import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { paths } from "../config";
import { now } from "../db/db";
import { deleteSecret, getSecret, putSecret } from "../lib/crypto";
import { badRequest } from "../lib/http";
import { getSetting, setSetting } from "../lib/settings";

/**
 * Off-machine backup copy (DATA-08): after the daily snapshot, a copy goes to a second place
 * (a OneDrive/Google Drive-synced folder, another drive). Optionally encrypted with a passphrase.
 * API keys stay encrypted with this machine's key file, which is never copied.
 */
const MAGIC = Buffer.from("MEA1");

export function encryptBackup(data: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function decryptBackup(data: Buffer, passphrase: string): Buffer {
  if (!data.subarray(0, 4).equals(MAGIC)) throw new Error("Not an encrypted Mea backup");
  const salt = data.subarray(4, 20);
  const iv = data.subarray(20, 32);
  const tag = data.subarray(32, 48);
  const key = scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(48)), decipher.final()]);
}

export function mirrorSettings() {
  const m = getSetting("backup.mirror");
  return { dir: m.dir, encrypt: m.encrypt, keep: m.keep, lastAt: m.lastAt, lastError: m.lastError, hasPassphrase: Boolean(m.secretId && getSecret(m.secretId)) };
}

export function updateMirror(input: { dir?: string; encrypt?: boolean; keep?: number; passphrase?: string }) {
  const cur = getSetting("backup.mirror");
  const dir = input.dir !== undefined ? input.dir.trim() : cur.dir;
  if (dir && !isAbsolute(dir)) throw badRequest("Use a full folder path, like D:\\Backups\\Mea or C:\\Users\\you\\OneDrive\\Mea");
  if (dir && dir.replaceAll("\\", "/").toLowerCase().startsWith(paths.backups.replaceAll("\\", "/").toLowerCase())) throw badRequest("Pick a folder outside Mea's own backup folder");
  let secretId = cur.secretId;
  if (input.passphrase !== undefined) {
    if (input.passphrase) secretId = putSecret(input.passphrase, cur.secretId ?? undefined);
    else if (cur.secretId) {
      deleteSecret(cur.secretId);
      secretId = null;
    }
  }
  const encrypt = input.encrypt ?? cur.encrypt;
  if (encrypt && !(secretId && getSecret(secretId))) throw badRequest("Set a passphrase to encrypt the copies");
  setSetting("backup.mirror", { ...cur, dir, encrypt, keep: Math.max(1, Math.min(90, input.keep ?? cur.keep)), secretId });
  return mirrorSettings();
}

/** Copies one backup file to the mirror folder and prunes old copies. */
export function mirrorBackup(file: string) {
  const cur = getSetting("backup.mirror");
  if (!cur.dir) return null;
  try {
    mkdirSync(cur.dir, { recursive: true });
    const source = join(paths.backups, file);
    if (!existsSync(source)) throw new Error(`Backup ${file} not found`);
    let target: string;
    if (cur.encrypt) {
      const pass = getSecret(cur.secretId);
      if (!pass) throw new Error("The mirror passphrase is missing");
      target = join(cur.dir, `${basename(file)}.enc`);
      writeFileSync(target, encryptBackup(readFileSync(source), pass));
    } else {
      target = join(cur.dir, basename(file));
      copyFileSync(source, target);
    }
    const copies = readdirSync(cur.dir)
      .filter((f) => /^mea-.*\.db(\.enc)?$/.test(f))
      .map((f) => ({ f, t: statSync(join(cur.dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of copies.slice(cur.keep)) unlinkSync(join(cur.dir, old.f));
    setSetting("backup.mirror", { ...cur, lastAt: now(), lastError: null });
    return basename(target);
  } catch (e) {
    setSetting("backup.mirror", { ...cur, lastError: (e as Error).message.slice(0, 300) });
    throw e;
  }
}
