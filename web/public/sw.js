/* Mea service worker: app shell caching, image cache, offline reading (ARCH-11), and push notifications (MOB-05, MOB-06). */
const SHELL = "mea-shell-v2";
const IMAGES = "mea-images-v1";
const API = "mea-api-v1";
const API_MAX = 400;

// ARCH-11 / MOB-13: what Mea needs to open and read recent chats without the server.
const READABLE = [
  /^\/api\/(whoami|settings|connections|profiles|characters|moments|notes|personas|presets|lorebooks)$/,
  /^\/api\/chats$/,
  /^\/api\/chats\/[^/]+$/,
  /^\/api\/chats\/[^/]+\/(messages|boundaries|continuity|glossary|names|highlights|continue|extras)$/,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then(async (c) => {
        await c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/badge-96.png"]);
        // The first screen's scripts and styles, so the app opens offline even before they were fetched once.
        try {
          const html = await (await c.match("/")).text();
          const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
          await c.addAll([...new Set(assets)]);
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Character images are immutable: cache-first.
  if (url.pathname.startsWith("/api/images/") && !url.pathname.endsWith("/info")) {
    event.respondWith(
      caches.open(IMAGES).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
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

  // Navigations: network first, cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/")),
    );
  }
});

// UI-20: the page tells us when discreet mode is on; notifications then say nothing about the story.
const PREFS = "mea-prefs";
let prefsMemo = null;
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "prefs") {
    prefsMemo = { discreet: Boolean(event.data.discreet), offline: event.data.offline !== false };
    const work = [caches.open(PREFS).then((c) => c.put("/__prefs", new Response(JSON.stringify(prefsMemo))))];
    // ARCH-11: no offline copies wanted on this device: drop the ones already kept.
    if (!prefsMemo.offline) work.push(caches.delete(API));
    event.waitUntil(Promise.all(work));
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
