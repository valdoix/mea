/** A tiny History-API router (no dependencies). */

export type RouteName =
  | "home"
  | "chat"
  | "memory"
  | "story"
  | "world"
  | "codex"
  | "search"
  | "character"
  | "personas"
  | "lorebooks"
  | "lorebook"
  | "studio"
  | "creator"
  | "presets"
  | "preset"
  | "settings"
  | "trash"
  | "inbox"
  | "notebook"
  | "read"
  | "pair"
  | "welcome"
  | "notfound";

const table: [RegExp, RouteName, string[]][] = [
  [/^\/$/, "home", []],
  [/^\/chat\/([^/]+)$/, "chat", ["id"]],
  [/^\/chat\/([^/]+)\/memory$/, "memory", ["id"]],
  [/^\/chat\/([^/]+)\/story$/, "story", ["id"]],
  [/^\/chat\/([^/]+)\/world$/, "world", ["id"]],
  [/^\/chat\/([^/]+)\/codex$/, "codex", ["id"]],
  [/^\/chat\/([^/]+)\/read$/, "read", ["id"]],
  [/^\/search$/, "search", []],
  [/^\/character\/([^/]+)$/, "character", ["id"]],
  [/^\/personas(?:\/([^/]+))?$/, "personas", ["id"]],
  [/^\/lorebooks$/, "lorebooks", []],
  [/^\/lorebooks\/([^/]+)$/, "lorebook", ["id"]],
  [/^\/lore-studio(?:\/([^/]+))?$/, "studio", ["id"]],
  [/^\/creator(?:\/([^/]+))?$/, "creator", ["id"]],
  [/^\/presets$/, "presets", []],
  [/^\/presets\/([^/]+)$/, "preset", ["id"]],
  [/^\/settings(?:\/([^/]+))?$/, "settings", ["tab"]],
  [/^\/trash$/, "trash", []],
  [/^\/inbox$/, "inbox", []],
  [/^\/notebook$/, "notebook", []],
  [/^\/pair$/, "pair", []],
  [/^\/welcome$/, "welcome", []],
];

function resolve(path: string) {
  for (const [re, name, keys] of table) {
    const m = path.match(re);
    if (m) {
      const params: Record<string, string> = {};
      keys.forEach((k, i) => {
        if (m[i + 1]) params[k] = decodeURIComponent(m[i + 1]!);
      });
      return { name, params };
    }
  }
  return { name: "notfound" as RouteName, params: {} };
}

const initial = resolve(location.pathname);
export const route = $state({ path: location.pathname, name: initial.name, params: initial.params, query: Object.fromEntries(new URLSearchParams(location.search)) as Record<string, string> });

function update() {
  const r = resolve(location.pathname);
  route.path = location.pathname;
  route.name = r.name;
  route.params = r.params;
  route.query = Object.fromEntries(new URLSearchParams(location.search));
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  if (path === location.pathname + location.search) return;
  history[opts.replace ? "replaceState" : "pushState"]({}, "", path);
  update();
  window.scrollTo?.(0, 0);
}

export function back(fallback = "/") {
  if (history.state && history.length > 1) history.back();
  else navigate(fallback);
}

window.addEventListener("popstate", update);

const inShell = /\bMeaApp\//.test(navigator.userAgent) || "__TAURI_INTERNALS__" in window;

// Intercept same-origin <a href> clicks so links don't reload the page.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as HTMLElement).closest?.("a");
  if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
  // L15: a link to another site (`https://…` or `//host`) opens beside Mea instead of replacing it.
  // The desktop and Android apps already send other sites to the system browser (and own their links).
  if (/^https?:$/.test(a.protocol) && a.origin !== location.origin) {
    if (!inShell) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    return;
  }
  const href = a.getAttribute("href");
  if (!href || !href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/")) return;
  e.preventDefault();
  navigate(href);
});
