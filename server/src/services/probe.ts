import { all, now, parseJson } from "../db/db";
import { getSetting } from "../lib/settings";
import type { ChatMessage } from "../prompt/assemble";
import type { CacheHint, Usage } from "../providers/types";
import { type CacheProbe, cacheModeFor, connectionFormat, getConnectionRow, providerFor, saveCacheProbe } from "./connections";
import { finishRequest, startRequest } from "./requests";

/**
 * Cache probe (CONN-24): sends the same long prefix twice and reads the usage fields to see
 * whether the route really caches, instead of assuming. ~3k input tokens per call.
 */
function probePrefix() {
  const lines: string[] = [
    "You are a meticulous archivist. The following catalogue is reference material for a caching test; it never changes between requests.",
  ];
  const rooms = ["Lantern Room", "Map Hall", "Salt Archive", "Tide Library", "Clockwork Gallery", "Glass Vault", "Ivy Reading Room", "Harbor Ledger Office"];
  for (let i = 1; i <= 110; i++) {
    const room = rooms[i % rooms.length]!;
    lines.push(`Entry ${i}: volume ${1000 + i * 7}, shelved in the ${room}, catalogued on day ${(i * 13) % 365} of year ${1800 + (i % 90)}, condition grade ${(i * 3) % 10}.`);
  }
  return lines.join("\n");
}

export async function probeCache(connectionId: string, modelId: string): Promise<CacheProbe> {
  const conn = getConnectionRow(connectionId);
  if (!conn) throw new Error("Connection not found");
  const provider = providerFor(connectionId);
  const mode = cacheModeFor(conn, modelId);
  const messages: ChatMessage[] = [
    { role: "system", content: probePrefix() },
    { role: "user", content: "Reply with the single word OK." },
  ];
  const cache: CacheHint | undefined = mode ? { mode, ttl: "5m", prefixEnd: 0, historyEnd: 0 } : undefined;
  const format = mode === "anthropic" ? "anthropic cache_control" : mode === "nanogpt" ? "NanoGPT prompt_caching" : `implicit (${connectionFormat(conn)})`;
  const once = async (): Promise<Usage | undefined> => {
    const id = startRequest({ kind: "cache-probe", task: "probe", resolved: { connection: conn, modelId, billing: conn.billing, profile: { id: "probe" } }, request: { model: modelId, messages: "(probe prefix)", cache: cache ?? null } });
    try {
      const r = await provider.stream({ model: modelId, messages, params: { max_tokens: 8, temperature: 0 }, signal: AbortSignal.timeout(90_000), cache }, () => {});
      finishRequest(id, { status: "done", usage: r.usage });
      return r.usage;
    } catch (e) {
      finishRequest(id, { status: "error", error: (e as Error).message });
      throw e;
    }
  };
  let probe: CacheProbe;
  try {
    const first = await once();
    await Bun.sleep(1500);
    const second = await once();
    const read = second?.cachedTokens ?? 0;
    probe = {
      verified: read > 0,
      format,
      firstWrite: first?.cacheWriteTokens ?? 0,
      secondRead: read,
      hitRate: second?.promptTokens ? Math.round((read / second.promptTokens) * 100) / 100 : 0,
      at: now(),
    };
  } catch (e) {
    probe = { verified: false, format, firstWrite: 0, secondRead: 0, hitRate: 0, at: now(), error: (e as Error).message.slice(0, 300) };
  }
  saveCacheProbe(connectionId, modelId, probe);
  return probe;
}

/** Profiles on paid Claude routes get probed once automatically, then weekly (CONN-24). */
export function modelsDueForProbe(): { connectionId: string; modelId: string }[] {
  const week = 7 * 24 * 3600_000;
  const seen = new Set<string>();
  const out: { connectionId: string; modelId: string }[] = [];
  const profiles = all<{ connection_id: string | null; model_id: string | null; params: string }>("SELECT connection_id, model_id, params FROM profiles WHERE connection_id IS NOT NULL AND model_id IS NOT NULL");
  for (const p of profiles) {
    const conn = getConnectionRow(p.connection_id!);
    if (!conn || !conn.secret_id) continue;
    const params = parseJson<{ cache?: "auto" | "off" }>(p.params, {});
    if (!cacheModeFor(conn, p.model_id!, params.cache)) continue;
    const key = `${conn.id}|${p.model_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = all<{ cache_probe: string | null }>("SELECT cache_probe FROM models WHERE connection_id = ? AND model_id = ?", conn.id, p.model_id!)[0];
    const last = parseJson<CacheProbe | null>(row?.cache_probe ?? null, null);
    if (!last || now() - last.at > week) out.push({ connectionId: conn.id, modelId: p.model_id! });
  }
  return out;
}

export async function runDueProbes() {
  if (getSetting("routing.story") == null) return;
  for (const m of modelsDueForProbe()) await probeCache(m.connectionId, m.modelId);
}
