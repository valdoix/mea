import { all } from "../db/db";
import { getSecret } from "./crypto";

/**
 * Redaction for the local request log (SEC-06). Mea never sends keys in a body, but providers
 * sometimes echo a key back in an error, and a pasted prompt could hold one. Every stored key,
 * plus anything shaped like a key, is replaced before a request, response or error is saved.
 */

let known: string[] = [];
let loadedAt = 0;

function knownKeys() {
  if (Date.now() - loadedAt > 60_000) {
    try {
      known = all<{ id: string }>("SELECT id FROM secrets")
        .map((r) => getSecret(r.id) ?? "")
        .filter((k) => k.length >= 8)
        .sort((a, b) => b.length - a.length);
    } catch {
      known = [];
    }
    loadedAt = Date.now();
  }
  return known;
}

/** Forget the cached keys (after one is added or changed). */
export function refreshRedaction() {
  loadedAt = 0;
}

const PATTERNS: [RegExp, string][] = [
  [/\b(sk|pk|rk)-(?:[A-Za-z]+-)?[A-Za-z0-9_-]{16,}\b/g, "[redacted key]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g, "Bearer [redacted]"],
  [/("(?:api[_-]?key|x-api-key|authorization|access[_-]?token|password)"\s*:\s*")[^"]+(")/gi, "$1[redacted]$2"],
];

export function redact(text: string): string;
export function redact(text: string | null | undefined): string | null | undefined;
export function redact(text: string | null | undefined) {
  if (!text) return text;
  let out = text;
  for (const k of knownKeys()) if (out.includes(k)) out = out.split(k).join("[redacted key]");
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}
