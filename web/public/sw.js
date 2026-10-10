/* Mea service worker: app shell caching, image cache, offline reading (ARCH-11), and push notifications (MOB-05, MOB-06). */
const SHELL = "mea-shell-v3";
const IMAGES = "mea-images-v2";
const API = "mea-api-v1";
const PREFS = "mea-prefs";
const API_MAX = 400;
const IMAGES_MAX = 600;

// ARCH-11 / MOB-13: what Mea needs to open and read recent chats without the server.
const READABLE = [
  /^\/api\/(whoami|settings|connections|profiles|characters|moments|notes|personas|presets|lorebooks)$/,
  /^\/api\/chats$/,
  /^\/api\/chats\/[^/]+$/,
  /^\/api\/chats\/[^/]+\/(messages|boundaries|continuity|glossary|names|highlights|continue|extras)$/,
];

/** The build's own scripts and styles named in a page of HTML. */
const assetsIn = (html) => [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];

/** M40: only a real page of the app is kept as the offline shell (never a tunnel's error page). */
const isShell = (res) => res && res.ok && res.type === "basic" && (res.headers.get("Content-Type") || "").includes("text/html");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then(async (c) => {
        await c.addAll(["/", "/theme.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/badge-96.png"]);
        // The first screen's scripts and styles, so the app opens offline even before they were fetched once.
        try {
          await c.addAll(assetsIn(await (await c.match("/")).text()));
        } catch {
          // best effort
        }
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== IMAGES && k !== API && k !== PREFS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** M40: a new build's page drops the old build's scripts and styles from the cache. */
async function keepShell(res) {
  const cache = await caches.open(SHELL);
  const html = await res.text();
  const old = await cache.match("/");
  const changed = !old || (await old.text()) !== html;
  await cache.put("/", new Response(html, { status: res.status, statusText: res.statusText, headers: res.headers }));
  if (!changed) return;
  const keep = new Set(assetsIn(html));
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/assets/") && !keep.has(path)) await cache.delete(req);
  }
}

// M40: images are kept most-recently-used first, up to IMAGES_MAX. A hit is moved to the back of the
// line once per worker lifetime (re-putting it), and the oldest are dropped when the cache grows.
const touched = new Set();
async function trimImages(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - IMAGES_MAX))) await cache.delete(k);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Character images: cache-first.
  if (url.pathname.startsWith("/api/images/") && !url.pathname.endsWith("/info")) {
    event.respondWith(
      caches.open(IMAGES).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) {
          if (!touched.has(req.url)) {
            touched.add(req.url);
            event.waitUntil(cache.put(req, hit.clone()).catch(() => {}));
          }
          return hit;
        }
        const res = await fetch(req);
        // M40: a size asked for but not made yet comes back as the original (X-Has-Thumb: 0). That
        // stand-in isn't kept, so the thumbnail is seen once it exists.
        const standIn = res.headers.get("X-Has-Thumb") === "0" && (url.searchParams.has("size") || url.searchParams.has("thumb"));
        if (res.ok && !standIn) {
          touched.add(req.url);
          event.waitUntil(cache.put(req, res.clone()).then(() => trimImages(cache)).catch(() => {}));
        }
        return res;
      }),
    );
    return;
  }
  // Reading endpoints: network first; the saved copy (marked as such) when Mea can't be reached.
  if (READABLE.some((re) => re.test(url.pathname))) {
    event.respondWith(
      fetch(req)
        .then(async (res) => {
          if (res.ok && (await prefs()).offline !== false) {
            const copy = res.clone();
            event.waitUntil(
              caches.open(API).then(async (c) => {
                await c.put(req, copy);
                const keys = await c.keys();
                for (const k of keys.slice(0, Math.max(0, keys.length - API_MAX))) await c.delete(k);
              }),
            );
          }
          return res;
        })
        .catch(async () => {
          const hit = await (await caches.open(API)).match(req);
          if (!hit) throw new Error("offline");
          const headers = new Headers(hit.headers);
          headers.set("X-Mea-Offline", "1");
          return new Response(hit.body, { status: hit.status, headers });
        }),
    );
    return;
  }
  if (url.pathname.startsWith("/api/")) return;

  // Hashed build assets and fonts: cache-first.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  // The pre-paint theme script: network first, the saved copy offline.
  if (url.pathname === "/theme.js") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            event.waitUntil(caches.open(SHELL).then((c) => c.put("/theme.js", copy)));
          }
          return res;
        })
        .catch(async () => (await caches.match("/theme.js")) || Response.error()),
    );
    return;
  }

  // Navigations: network first, cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (isShell(res)) event.waitUntil(keepShell(res.clone()).catch(() => {}));
          return res;
        })
        .catch(async () => (await caches.match("/")) || Response.error()),
    );
  }
});

// UI-20: the page tells us when discreet mode is on; notifications then say nothing about the story.
let prefsMemo = null;
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "prefs") {
    prefsMemo = { discreet: Boolean(event.data.discreet), offline: event.data.offline !== false };
    const work = [caches.open(PREFS).then((c) => c.put("/__prefs", new Response(JSON.stringify(prefsMemo))))];
    // ARCH-11: no offline copies wanted on this device: drop the ones already kept.
    if (!prefsMemo.offline) work.push(caches.delete(API));
    event.waitUntil(Promise.all(work));
  }
  // M7: this device was unpaired or revoked: the saved chats and images go with it.
  if (event.data && event.data.type === "purge") {
    touched.clear();
    event.waitUntil(Promise.all([caches.delete(API), caches.delete(IMAGES)]));
  }
});
async function prefs() {
  if (prefsMemo) return prefsMemo;
  try {
    const res = await (await caches.open(PREFS)).match("/__prefs");
    prefsMemo = res ? await res.json() : { discreet: false, offline: true };
  } catch {
    prefsMemo = { discreet: false, offline: true };
  }
  return prefsMemo;
}
const discreet = async () => Boolean((await prefs()).discreet);

self.addEventListener("push", (event) => {
  let data = { title: "Mea", body: "", url: "/", tag: undefined };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    discreet().then((quiet) => self.registration.showNotification(quiet ? "Mea" : data.title, {
      body: quiet ? "Something new is waiting" : data.body,
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url: data.url },
    })),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.postMessage({ type: "navigate", url });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
