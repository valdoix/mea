import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { paths } from "../config";
import { newId, now, one, run } from "../db/db";

let masterKey: Buffer | null = null;

/** Loads or creates the 256-bit master key used to encrypt API keys at rest (CONN-04). */
export function loadMasterKey(file = paths.keyFile): Buffer {
  if (existsSync(file)) {
    const key = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
    if (key.length !== 32) throw new Error(`Master key at ${file} is invalid`);
    masterKey = key;
  } else {
    masterKey = randomBytes(32);
    writeFileSync(file, masterKey.toString("base64"), { mode: 0o600 });
  }
  return masterKey;
}

/** For tests: use an in-memory key. */
export function setMasterKey(key: Buffer) {
  masterKey = key;
}

function key(): Buffer {
  if (!masterKey) throw new Error("Master key not loaded");
  return masterKey;
}

export function encrypt(plaintext: string): { iv: Buffer; ciphertext: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { iv, ciphertext: Buffer.concat([body, cipher.getAuthTag()]) };
}

export function decrypt(iv: Uint8Array, ciphertext: Uint8Array): string {
  const buf = Buffer.from(ciphertext);
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([decipher.update(buf.subarray(0, buf.length - 16)), decipher.final()]).toString("utf8");
}

export function putSecret(value: string, id: string = newId()): string {
  const { iv, ciphertext } = encrypt(value);
  const t = now();
  run(
    `INSERT INTO secrets (id, iv, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET iv = excluded.iv, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
    id,
    iv,
    ciphertext,
    t,
    t,
  );
  return id;
}

export function getSecret(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  const row = one<{ iv: Uint8Array; ciphertext: Uint8Array }>("SELECT iv, ciphertext FROM secrets WHERE id = ?", id);
  return row ? decrypt(row.iv, row.ciphertext) : undefined;
}

export function deleteSecret(id: string) {
  run("DELETE FROM secrets WHERE id = ?", id);
}

/** Masks a key for display: never send real keys back to the client (SEC-04). */
export function maskSecret(value: string | undefined): string | null {
  if (!value) return null;
  return value.length <= 8 ? "••••" : `${value.slice(0, 3)}••••${value.slice(-4)}`;
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
