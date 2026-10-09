import { join, normalize } from "node:path";
import { Hono } from "hono";
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
import { data } from "./routes/data";
import { vault } from "./routes/vault";
import { isLocked } from "./lib/vault";
import { DEVICE_COOKIE, deviceForToken, isTrustedLocal } from "./services/auth";
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
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const origin = c.req.header("origin");
      if (origin) {
        const allowed = new Set([c.req.header("host"), c.req.header("x-forwarded-host")].filter(Boolean));
        let originHost = "";
        try {
          originHost = new URL(origin).host;
        } catch {
          originHost = "";
        }
        if (!allowed.has(originHost)) return c.json({ error: "Cross-site request blocked" }, 403);
      }
    }
    if (PUBLIC_API.has(c.req.path)) return next();
    if (isTrustedLocal(c)) {
      c.set("deviceId", null);
      return next();
    }
    const device = deviceForToken(getCookie(c, DEVICE_COOKIE));
    if (!device) return c.json({ error: "This device isn't paired with Mea yet.", code: "unpaired" }, 401);
    c.set("deviceId", device.id);
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
  app.route("/api", data);
  app.route("/api", vault);
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  // Android share sheet → import a card (MOB-05). Same auth as the API.
  app.post("/share-target", async (c) => {
    if (isLocked()) return c.redirect("/", 303);
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
    if (index && (await index.exists())) return new Response(index, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
    return c.html(
      `<!doctype html><meta charset="utf-8"><title>Mea</title><body style="font-family:system-ui;background:#FBF6F1;color:#43363D;padding:3rem">
       <h1>Mea's server is running ✿</h1><p>The web app isn't built yet. Run <code>bun run build</code>, or use <code>bun run dev</code> while developing.</p></body>`,
    );
  });

  return app;
}

/** A web app file: embedded in mea.exe when compiled (ARCH-14), else read from web/dist. */
function webFile(path: string) {
  if (hasEmbeddedAssets()) {
    const embedded = embeddedAsset(path.replaceAll("\\", "/"));
    return embedded ? Bun.file(embedded) : null;
  }
  return Bun.file(join(config.webDist, path));
}
