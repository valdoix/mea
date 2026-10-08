import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { all, newId, now, one, run } from "../db/db";
import { randomToken, sha256 } from "../lib/crypto";

/**
 * Device auth (ARCH-08, SEC-02). The host machine (direct localhost requests) is trusted.
 * Everything else, including requests through Tailscale Serve, needs a paired device cookie.
 */
export const DEVICE_COOKIE = "mea_device";
const PAIR_TTL_MS = 10 * 60_000;

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isTrustedLocal(c: Context): boolean {
  let address: string | undefined;
  try {
    address = getConnInfo(c).remote.address;
  } catch {
    address = undefined;
  }
  if (!address || !LOOPBACK.has(address)) return false;
  // Proxied requests (Tailscale Serve, reverse proxies) are never "local".
  const h = c.req.raw.headers;
  for (const name of ["x-forwarded-for", "x-forwarded-host", "forwarded", "tailscale-user-login", "tailscale-user-name", "x-real-ip"]) {
    if (h.has(name)) return false;
  }
  return true;
}

interface DeviceRow {
  id: string;
  name: string;
  token_hash: string;
  user_agent: string | null;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

export function deviceForToken(token: string | undefined): DeviceRow | undefined {
  if (!token) return undefined;
  const d = one<DeviceRow>("SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL", sha256(token));
  if (d && (!d.last_seen_at || now() - d.last_seen_at > 60_000)) run("UPDATE devices SET last_seen_at = ? WHERE id = ?", now(), d.id);
  return d;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createPairingCode(): { code: string; expiresAt: number } {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  const expiresAt = now() + PAIR_TTL_MS;
  run("DELETE FROM pairing_codes WHERE expires_at < ?", now());
  run("INSERT INTO pairing_codes (code_hash, expires_at, created_at) VALUES (?, ?, ?)", sha256(code), expiresAt, now());
  return { code, expiresAt };
}

/** Redeems a one-time pairing code for a long-lived device token. */
export function redeemPairingCode(code: string, name: string, userAgent: string | null): { token: string; deviceId: string } | null {
  const hash = sha256(code.trim().toUpperCase());
  const row = one<{ expires_at: number }>("SELECT expires_at FROM pairing_codes WHERE code_hash = ?", hash);
  if (!row) return null;
  run("DELETE FROM pairing_codes WHERE code_hash = ?", hash);
  if (row.expires_at < now()) return null;
  const token = randomToken(32);
  const deviceId = newId();
  run(
    "INSERT INTO devices (id, name, token_hash, user_agent, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    deviceId,
    name.trim().slice(0, 80) || "Device",
    sha256(token),
    userAgent?.slice(0, 300) ?? null,
    now(),
    now(),
  );
  return { token, deviceId };
}

export function listDevices() {
  return all<DeviceRow>("SELECT * FROM devices WHERE revoked_at IS NULL ORDER BY created_at").map((d) => ({
    id: d.id,
    name: d.name,
    userAgent: d.user_agent,
    createdAt: d.created_at,
    lastSeenAt: d.last_seen_at,
  }));
}

export function revokeDevice(id: string) {
  run("UPDATE devices SET revoked_at = ? WHERE id = ?", now(), id);
  run("DELETE FROM push_subscriptions WHERE device_id = ?", id);
}
