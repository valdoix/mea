import { join, normalize } from "node:path";
import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { config } from "./config";
import { embeddedAsset, hasEmbeddedAssets } from "./lib/embedded";
import { HttpError } from "./lib/http";
import { chats } from "./routes/chats";
import { library } from "./routes/library";
import { lore } from "./routes/lore";
import { memory } from "./routes/memory";
import { models } from "./routes/models";
import { system } from "./routes/system";
import { trackers } from "./routes/trackers";
import { world } from "./routes/world";
import { tools } from "./routes/tools";
import { knowledge } from "./routes/knowledge";
import { accuracy } from "./routes/accuracy";
import { stories } from "./routes/stories";
import { studio } from "./routes/studio";
import { creator } from "./routes/creator";
import { cardtools } from "./routes/cardtools";
import { steer } from "./routes/steer";
import { meus } from "./routes/meus";
import { lessons } from "./routes/lessons";
import { offpage } from "./routes/offpage";
import { setup } from "./routes/setup";
import "./services/chatcost";
import { data } from "./routes/data";
import { vault } from "./routes/vault";
import { isLocked } from "./lib/vault";
import { DEVICE_COOKIE, deviceForToken, isTrustedLocal, noteDeviceSeen } from "./services/auth";
import { importFile } from "./services/importer";

type Env = { Variables: { deviceId: string | null } };

const PUBLIC_API = new Set(["/api/pair", "/api/whoami", "/api/ping", "/api/vault/status", "/api/vault/unlock"]);

export function createApp() {
  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, details: err.details }, err.status as ContentfulStatusCode);
    console.error("[mea] unhandled error:", err);
    return c.json({ error: "Something went wrong on the server." }, 500);
  });

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
  });

  // SEC-05: while the encrypted database is locked, only the unlock screen's calls are answered.
  app.use("/api/*", async (c, next) => {
    if (!isLocked()) return next();
    const p = c.req.path;
    if (p === "/api/vault/status" || p === "/api/vault/unlock" || p === "/api/ping") return next();
    if (p === "/api/whoami") return c.json({ locked: true, local: false, authorized: false, device: null });
    return c.json({ error: "Mea is locked. Enter the passphrase to open it.", code: "locked" }, 423);
  });

  // Auth (SEC-02): the host machine is trusted; other devices need a paired cookie.
  app.use("/api/*", async (c, next) => {
    // Reject cross-site writes (cookie auth + JSON API).
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && !sameSite(c)) return c.json({ error: "Cross-site request blocked" }, 403);
    if (PUBLIC_API.has(c.req.path)) return next();
    if (isTrustedLocal(c)) {
      c.set("deviceId", null);
      return next();
    }
    const device = deviceForToken(getCookie(c, DEVICE_COOKIE));
    if (!device) return c.json({ error: "This device isn't paired with Mea yet.", code: "unpaired" }, 401);
    c.set("deviceId", device.id);
    noteDeviceSeen(device.id, c);
    // SEC-08: a paired device can't do what can't be undone from the device itself, or what would hand
    // the stored API key to another server. Those stay on the host computer.
    if (await hostOnly(c, device.id)) return c.json({ error: "This can only be done on the computer Mea runs on.", code: "host_only" }, 403);
    return next();
  });

  app.get("/api/ping", (c) => c.json({ ok: true, app: "mea" }));
  app.route("/api", library);
  app.route("/api", lore);
  app.route("/api", studio);
  app.route("/api", creator);
  app.route("/api", cardtools);
  app.route("/api", chats);
  app.route("/api", memory);
  app.route("/api", models);
  app.route("/api", system);
  app.route("/api", trackers);
  app.route("/api", world);
  app.route("/api", tools);
  app.route("/api", knowledge);
  app.route("/api", accuracy);
  app.route("/api", stories);
  app.route("/api", steer);
  app.route("/api", meus);
  app.route("/api", lessons);
  app.route("/api", offpage);
  app.route("/api", setup);
  app.route("/api", data);
  app.route("/api", vault);
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  // Android share sheet → import a card (MOB-05). Same auth as the API.
  app.post("/share-target", async (c) => {
    if (isLocked()) return c.redirect("/", 303);
    // SEC-09: the share sheet posts from Mea's own page; another site can't make this computer import a file.
    if (!sameSite(c)) return c.text("Cross-site request blocked", 403);
    const authorized = isTrustedLocal(c) || Boolean(deviceForToken(getCookie(c, DEVICE_COOKIE)));
    if (!authorized) return c.redirect("/pair", 303);
    const form = await c.req.formData();
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    let imported = 0;
    for (const f of files) {
      try {
        await importFile(new Uint8Array(await f.arrayBuffer()), f.name);
        imported++;
      } catch {
        // reported as a count on the home screen
      }
    }
    return c.redirect(`/?imported=${imported}&failed=${files.length - imported}`, 303);
  });

  // Static web app with SPA fallback.
  const gzipped = new Map<string, Uint8Array>();
  app.get("*", async (c) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    const safe = normalize(path).replace(/^([\\/])+/, "");
    if (safe.startsWith("..")) return c.notFound();
    if (safe && safe !== "index.html") {
      const file = webFile(safe);
      if (file && (await file.exists())) {
        const immutable = safe.startsWith("assets/") || safe.startsWith("assets\\");
        const noCache = safe === "sw.js" || safe.endsWith(".webmanifest");
        // QOL-04: the spell checker's WebAssembly is big; gzip it once and keep the result.
        if (safe.endsWith(".wasm") && /\bgzip\b/.test(c.req.header("accept-encoding") ?? "")) {
          let gz = gzipped.get(safe);
          if (!gz) gzipped.set(safe, (gz = Bun.gzipSync(new Uint8Array(await file.arrayBuffer()))));
          return new Response(gz, { headers: { "Content-Type": "application/wasm", "Content-Encoding": "gzip", Vary: "Accept-Encoding", "Cache-Control": "public, max-age=31536000, immutable" } });
        }
        return new Response(file, {
          headers: {
            "Content-Type": Bun.file(safe).type,
            "Cache-Control": immutable ? "public, max-age=31536000, immutable" : noCache ? "no-cache" : "public, max-age=3600",
          },
        });
      }
    }
    const index = webFile("index.html");
    if (index && (await index.exists())) {
      const html = await index.text();
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "Content-Security-Policy": contentPolicy(html) } });
    }
    return c.html(
      `<!doctype html><meta charset="utf-8"><title>Mea</title><body style="font-family:system-ui;background:#FBF6F1;color:#43363D;padding:3rem">
       <h1>Mea's server is running ✿</h1><p>The web app isn't built yet. Run <code>bun run build</code>, or use <code>bun run dev</code> while developing.</p></body>`,
    );
  });

  return app;
}

/** Rejects cross-site writes (cookie auth + JSON API): the Origin, when sent, must be this server. */
function sameSite(c: Context): boolean {
  const site = c.req.header("sec-fetch-site");
  if (site === "same-origin" || site === "none") return true;
  if (site === "cross-site") return false;
  const origin = c.req.header("origin");
  if (!origin) return true;
  const allowed = new Set([c.req.header("host"), c.req.header("x-forwarded-host")].filter(Boolean));
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = "";
  }
  return allowed.has(originHost);
}

/** SEC-08: actions a paired device can't take. A device may still revoke itself. */
async function hostOnly(c: Context, deviceId: string): Promise<boolean> {
  const p = c.req.path;
  const m = c.req.method;
  if (m === "POST" && /^\/api\/vault\/(enable|disable|passphrase)$/.test(p)) return true;
  if (m === "POST" && /^\/api\/backups\/[^/]+\/restore$/.test(p)) return true;
  if (m === "PUT" && p === "/api/backups/mirror") return true;
  if (m === "POST" && (p === "/api/trash/empty" || p === "/api/system/shutdown")) return true;
  if (m === "DELETE" && p.startsWith("/api/devices/")) return p.slice("/api/devices/".length) !== deviceId;
  // A new base URL for a saved connection would send its stored key there; it needs the key typed again.
  if (m === "PUT" && /^\/api\/connections\/[^/]+$/.test(p)) {
    const input = (await c.req.json().catch(() => null)) as { baseUrl?: unknown; apiKey?: unknown } | null;
    return Boolean(input && input.baseUrl !== undefined && !input.apiKey);
  }
  return false;
}

/** SEC-10: a Content-Security-Policy for the app page; inline scripts in index.html are allowed by hash. */
const policies = new Map<string, string>();
function contentPolicy(html: string): string {
  let policy = policies.get(html);
  if (policy) return policy;
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => `'sha256-${new Bun.CryptoHasher("sha256").update(m[1]!).digest("base64")}'`);
  policy = [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval'${hashes.length ? " " + hashes.join(" ") : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  policies.clear();
  policies.set(html, policy);
  return policy;
}

/** A web app file: embedded in mea.exe when compiled (ARCH-14), else read from web/dist. */
function webFile(path: string) {
  if (hasEmbeddedAssets()) {
    const embedded = embeddedAsset(path.replaceAll("\\", "/"));
    return embedded ? Bun.file(embedded) : null;
  }
  return Bun.file(join(config.webDist, path));
}
