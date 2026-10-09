import { statfsSync, statSync } from "node:fs";
import { GLOBAL_ID, promptSetSchema, SERVICE_PROMPTS, servicePromptFor } from "../lib/prompts";
import { regexScriptSchema } from "../lib/regex";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { restoreStash, stash } from "../services/undo";
import { streamSSE } from "hono/streaming";
import QRCode from "qrcode";
import { z } from "zod";
import { config, paths } from "../config";
import { all, one, parseJson } from "../db/db";
import { type MeaEvent, subscribe } from "../lib/events";
import { badRequest, body, must } from "../lib/http";
import { clientKeys, getClientSettings, guardsSchema, type MemoryConfig, type Settings, setSetting, steerSchema } from "../lib/settings";
import { normalizeMemoryConfig } from "../memory/profiles";
import { defaultPreset, importStPreset, presetSchema } from "../prompt/preset";
import { createPairingCode, DEVICE_COOKIE, deviceForToken, isTrustedLocal, listDevices, redeemPairingCode, revokeDevice } from "../services/auth";
import { createBackup, lastBackupAt, listBackups, restoreBackup } from "../services/backup";
import { mirrorBackup, mirrorSettings, updateMirror } from "../services/mirror";
import { cachedQuota, listConnections } from "../services/connections";
import { exportLibraryZip } from "../services/export";
import { jobStats } from "../services/jobs";
import { dropPresence, reportPresence } from "../services/presence";
import { createPreset, deletePreset, getPreset, listPresets, restoreMeaPreset, updatePreset } from "../services/presets";
import { publicVapidKey, removeSubscription, saveSubscription, sendPush, subscriptionCount } from "../services/push";
import { tailscaleStatus } from "../services/tailscale";
import { listTrash, purgeTrash } from "../services/trash";
import { getSetting } from "../lib/settings";

export const system = new Hono<{ Variables: { deviceId: string | null } }>();
const startedAt = Date.now();

// ---------- Settings ----------

/** Settings with structure that's checked before it's stored. */
const SETTING_SCHEMAS: Record<string, z.ZodType> = {
  "regex.scripts": z.array(regexScriptSchema).max(200),
  "prompts.sets": z.array(promptSetSchema).max(20),
  "prompts.active": z.string().nullable(),
  "guards.config": guardsSchema.partial(),
  "steer.config": steerSchema.partial(),
  "appearance.typography": z.object({
    uiFont: z.enum(["nunito", "system", "inter", "atkinson", "lexend"]),
    lineHeight: z.number().min(1.2).max(2.4),
    paragraphSpacing: z.number().min(0).max(2),
    width: z.number().min(26).max(80),
    dialogueColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
    dyslexic: z.boolean(),
  }),
  "appearance.storyFont": z.enum(["newsreader", "lora", "literata", "ebgaramond", "cormorant", "crimson", "sourceserif", "merriweather", "alegreya", "spectral", "nunito", "inter", "atkinson", "lexend"]),
  "appearance.living": z.object({ voices: z.enum(["ink", "ribbon", "halo", "off"]), artifacts: z.boolean(), window: z.boolean(), thoughts: z.enum(["never", "drawer", "always"]) }),
  "privacy.requestLog": z.object({ bodiesDays: z.number().int().min(1).max(3650), rowsDays: z.number().int().min(0).max(36500), fileLog: z.boolean(), fileDays: z.number().int().min(1).max(3650) }),
};

system.get("/settings", (c) => c.json(getClientSettings()));

system.put("/settings", async (c) => {
  const input = await body(c, z.record(z.string(), z.unknown()));
  for (const [k, v] of Object.entries(input)) {
    if (!clientKeys.includes(k as keyof Settings)) throw badRequest(`Unknown setting "${k}"`);
    const schema = SETTING_SCHEMAS[k];
    if (schema && !schema.safeParse(v).success) throw badRequest(`Invalid value for "${k}"`, z.treeifyError(schema.safeParse(v).error!));
    // MEM-44: saving memory settings by hand keeps the profile label honest ("custom" when changed).
    const value = k === "memory.config" && v && typeof v === "object" ? normalizeMemoryConfig(v as MemoryConfig) : v;
    setSetting(k as keyof Settings, value as never);
  }
  return c.json(getClientSettings());
});

/**
 * PROMPT-09: the helper prompts you can add to or replace, each with the last system prompt Mea
 * actually sent for it (so you can see what you're changing).
 */
system.get("/prompts/service", (c) => {
  const samples = new Map<string, { text: string; at: number }>();
  for (const r of all<{ kind: string; request: string; started_at: number }>("SELECT kind, request, started_at FROM generations WHERE task != 'story' ORDER BY started_at DESC LIMIT 800")) {
    const id = servicePromptFor(r.kind)?.id;
    if (!id || samples.has(id)) continue;
    const req = parseJson<{ messages?: { role: string; content: string }[] }>(r.request, {});
    const text = req.messages?.find((m) => m.role === "system")?.content;
    if (text) samples.set(id, { text, at: r.started_at });
  }
  return c.json({ globalId: GLOBAL_ID, prompts: SERVICE_PROMPTS.map(({ match: _m, ...p }) => ({ ...p, sample: samples.get(p.id) ?? null })) });
});

// ---------- Presets (PROMPT-01..05) ----------

system.get("/presets", (c) => c.json({ presets: listPresets(), defaultId: getSetting("chat.defaultPresetId") }));
system.get("/presets/:id", (c) => c.json(must(getPreset(c.req.param("id")), "Preset not found")));
system.post("/presets", async (c) => {
  const input = await body(c, z.object({ preset: presetSchema.optional(), name: z.string().optional() }));
  const preset = input.preset ?? { ...defaultPreset(), name: input.name || "New preset" };
  return c.json(getPreset(createPreset(preset)), 201);
});
system.put("/presets/:id", async (c) => {
  const preset = await body(c, presetSchema);
  must(updatePreset(c.req.param("id"), preset) || undefined, "Preset not found");
  return c.json(getPreset(c.req.param("id")));
});
system.delete("/presets/:id", (c) => {
  const undo = stash("Preset", [{ table: "presets", where: "id = ?", params: [c.req.param("id")] }], "presets");
  deletePreset(c.req.param("id"));
  return c.json({ ok: true, undo });
});

/** QOL-05: puts back what a delete removed, within 15 minutes. */
system.post("/undo/:token", (c) => c.json(restoreStash(c.req.param("token"))));
system.post("/presets/import", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("No file");
  const preset = importStPreset(JSON.parse(await file.text()), file.name.replace(/\.json$/i, ""));
  return c.json(getPreset(createPreset(preset)), 201);
});
system.get("/presets-default", (c) => c.json(defaultPreset()));
/** Puts Mea's own preset back as shipped (or reinstalls it). */
system.post("/presets-mea/restore", (c) => c.json(getPreset(restoreMeaPreset())));

// ---------- Live events (ARCH-06) ----------

system.get("/events", (c) => {
  const clientId = c.req.query("client") || crypto.randomUUID();
  return streamSSE(c, async (stream) => {
    const queue: MeaEvent[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = subscribe((e) => {
      queue.push(e);
      wake?.();
    });
    const heartbeat = setInterval(() => {
      queue.push({ type: "jobs.activity", running: -1, queued: -1 });
      wake?.();
    }, 20_000);
    stream.onAbort(() => {
      unsubscribe();
      clearInterval(heartbeat);
      dropPresence(clientId);
      wake?.();
    });
    await stream.writeSSE({ event: "hello", data: JSON.stringify({ clientId, version: config.version }) });
    while (!stream.aborted) {
      while (queue.length) {
        const e = queue.shift()!;
        if (e.type === "jobs.activity" && e.running === -1) await stream.write(": ping\n\n");
        else await stream.writeSSE({ data: JSON.stringify(e) });
      }
      await new Promise<void>((r) => (wake = r));
      wake = null;
    }
  });
});

system.post("/presence", async (c) => {
  const input = await body(c, z.object({ clientId: z.string(), chatId: z.string().nullable(), visible: z.boolean() }));
  reportPresence(input.clientId, input.chatId, input.visible);
  return c.json({ ok: true });
});

// ---------- Devices & pairing (ARCH-08) ----------

system.get("/devices", async (c) => {
  return c.json({ devices: listDevices(), local: isTrustedLocal(c), tailscale: await tailscaleStatus() });
});

system.post("/devices/pairing", async (c) => {
  if (!isTrustedLocal(c)) throw badRequest("New devices can only be paired from the host computer");
  const { code, expiresAt } = createPairingCode();
  const ts = await tailscaleStatus();
  const base = ts.serveUrl ?? new URL(c.req.url).origin;
  const url = `${base}/pair?code=${code}`;
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#43363D", light: "#FFFDFB" } });
  return c.json({ code, url, expiresAt, qrSvg, tailscale: ts });
});

system.delete("/devices/:id", (c) => {
  revokeDevice(c.req.param("id"));
  return c.json({ ok: true });
});

/** Public: exchanges a one-time code for a device cookie. */
system.post("/pair", async (c) => {
  const input = await body(c, z.object({ code: z.string().min(4).max(32), name: z.string().max(80).default("Phone") }));
  const result = redeemPairingCode(input.code, input.name, c.req.header("user-agent") ?? null);
  if (!result) throw badRequest("That code is wrong or expired. Make a new one on the computer.");
  const secure = new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
  setCookie(c, DEVICE_COOKIE, result.token, { httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge: 400 * 24 * 3600 });
  return c.json({ ok: true, deviceId: result.deviceId });
});

system.get("/whoami", (c) => {
  const local = isTrustedLocal(c);
  const device = deviceForToken(getCookie(c, DEVICE_COOKIE));
  return c.json({ local, device: device ? { id: device.id, name: device.name } : null, authorized: local || Boolean(device) });
});

// ---------- Push (MOB-06) ----------

system.get("/push/key", (c) => c.json({ publicKey: publicVapidKey(), subscriptions: subscriptionCount() }));
system.post("/push/subscribe", async (c) => {
  const sub = await body(c, z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }));
  saveSubscription(sub, c.get("deviceId") ?? null);
  return c.json({ ok: true });
});
system.post("/push/test", async (c) => c.json({ sent: await sendPush({ title: "Mea", body: "Notifications are working ✿", url: "/", tag: "mea-test" }) }));
system.post("/push/unsubscribe", async (c) => {
  const { endpoint } = await body(c, z.object({ endpoint: z.string() }));
  removeSubscription(endpoint);
  return c.json({ ok: true });
});

// ---------- Backups & data (DATA-02, DATA-03) ----------

system.get("/backups", (c) => c.json({ backups: listBackups() }));
system.post("/backups", (c) => c.json(createBackup("manual"), 201));
system.post("/backups/:file/restore", (c) => {
  restoreBackup(c.req.param("file"));
  return c.json({ ok: true });
});

/** Off-machine copy (DATA-08). */
system.get("/backups/mirror", (c) => c.json(mirrorSettings()));
system.put("/backups/mirror", async (c) => {
  const input = await body(c, z.object({ dir: z.string().max(500).optional(), encrypt: z.boolean().optional(), keep: z.number().int().min(1).max(90).optional(), passphrase: z.string().max(200).optional() }));
  return c.json(updateMirror(input));
});
system.post("/backups/mirror/run", (c) => {
  const latest = listBackups().find((b) => b.kind === "daily") ?? listBackups()[0] ?? createBackup("manual");
  try {
    return c.json({ copied: mirrorBackup(latest.file), mirror: mirrorSettings() });
  } catch (e) {
    throw badRequest(`Couldn't copy the backup: ${(e as Error).message}`);
  }
});

system.get("/export/library", () => {
  const zip = exportLibraryZip();
  const date = new Date().toISOString().slice(0, 10);
  return new Response(zip, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="mea-library-${date}.zip"` } });
});

system.get("/trash", (c) => c.json(listTrash()));
system.post("/trash/empty", (c) => c.json({ purgedImages: purgeTrash(Date.now() + 1) }));

// ---------- Health (ARCH-15) ----------

system.get("/health", (c) => {
  let disk: { freeBytes: number; totalBytes: number } | null = null;
  try {
    const s = statfsSync(config.dataDir);
    disk = { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    disk = null;
  }
  let dbOk = true;
  try {
    one("SELECT 1");
  } catch {
    dbOk = false;
  }
  let dbBytes = 0;
  try {
    dbBytes = statSync(paths.db).size;
  } catch {
    dbBytes = 0;
  }
  return c.json({
    ok: dbOk,
    version: config.version,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    db: { ok: dbOk, bytes: dbBytes },
    disk,
    jobs: jobStats(),
    lastBackupAt: lastBackupAt(),
    quotaFetchedAt: cachedQuota()?.fetchedAt ?? null,
    connections: listConnections().map((x) => ({ name: x.name, kind: x.kind, lastError: x.lastError, lastSyncAt: x.lastSyncAt })),
    dev: config.dev,
  });
});
