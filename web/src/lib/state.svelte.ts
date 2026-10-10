import { get, put } from "./api";
import { applyFonts } from "./fonts";
import { isRoom, isShellTheme, loadThemeFonts, themeInfo, type ThemeId } from "./themes";
import type { Quota, Settings } from "./types";

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "ok" | "error";
  action?: { label: string; run: () => void };
}

const mobileQuery = window.matchMedia("(max-width: 760px)");

export const app = $state({
  settings: null as Settings | null,
  quota: null as Quota | null,
  activity: { running: 0, queued: 0 },
  connected: false,
  local: false,
  authorized: true,
  isMobile: mobileQuery.matches,
  toasts: [] as Toast[],
  /** Bumped when the server says library data changed, so lists refetch. */
  libraryVersion: 0,
  currentChatId: null as string | null,
  drawerOpen: false,
  devMode: false,
  dark: document.documentElement.dataset.theme !== "light" && document.documentElement.dataset.mode !== "day",
  /** The theme that's showing: Lantern (the default), one of the four rooms, or Mea Cozy light and dark. */
  theme: (document.documentElement.dataset.theme ?? "lantern") as ThemeId | "light" | "dark",
  /** Lantern and the rooms share the Lantern shell (rail, backdrop, glass); Cozy has its own. */
  shell: (document.documentElement.dataset.shell ?? "lantern") as "lantern" | "cozy",
  /** Day or night, for the rooms. */
  night: document.documentElement.dataset.mode === "night",
  /** MOB-12: smaller images and fewer prefetches (on a metered connection, or switched on by hand). */
  dataLight: false,
  /** SEC-05: the encrypted database is waiting for its passphrase. */
  locked: false,
  /** ARCH-11: what's on screen came from this device's saved copy; Mea can't be reached. */
  offlineCopy: false,
});

mobileQuery.addEventListener("change", (e) => {
  app.isMobile = e.matches;
});

let toastSeq = 0;
export function toast(message: string, opts: { kind?: Toast["kind"]; action?: Toast["action"]; timeout?: number } = {}) {
  const t: Toast = { id: ++toastSeq, message, kind: opts.kind ?? "info", action: opts.action };
  app.toasts.push(t);
  const timeout = opts.timeout ?? (opts.action ? 6500 : opts.kind === "error" ? 6000 : 3200);
  setTimeout(() => dismissToast(t.id), timeout);
  return t.id;
}

export function dismissToast(id: number) {
  const i = app.toasts.findIndex((t) => t.id === id);
  if (i >= 0) app.toasts.splice(i, 1);
}

export function errorToast(e: unknown) {
  toast(e instanceof Error ? e.message : String(e), { kind: "error" });
}

export async function loadSettings() {
  app.settings = await get<Settings>("/api/settings");
  applyAppearance();
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  if (app.settings) app.settings[key] = value;
  applyAppearance();
  app.settings = await put<Settings>("/api/settings", { [key]: value });
}

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
darkQuery.addEventListener("change", () => applyAppearance());

export function applyAppearance() {
  const s = app.settings;
  const theme = s?.["appearance.theme"] ?? (localStorage.getItem("mea.theme") as Settings["appearance.theme"]) ?? "lantern";
  const mode = s?.["appearance.themeMode"] ?? (localStorage.getItem("mea.themeMode") as Settings["appearance.themeMode"]) ?? "system";
  const shown: typeof app.theme = isShellTheme(theme) ? theme : theme === "dark" || (theme === "system" && darkQuery.matches) ? "dark" : "light";
  const night = isRoom(shown) ? mode === "night" || (mode !== "day" && darkQuery.matches) : shown !== "light";
  const dark = night;
  const root = document.documentElement;
  root.dataset.theme = shown;
  root.dataset.shell = isShellTheme(shown) ? "lantern" : "cozy";
  if (isRoom(shown)) {
    root.dataset.mode = night ? "night" : "day";
    loadThemeFonts(shown);
  } else delete root.dataset.mode;
  app.dark = dark;
  app.theme = shown;
  app.shell = isShellTheme(shown) ? "lantern" : "cozy";
  app.night = night;
  try {
    localStorage.setItem("mea.theme", theme);
    localStorage.setItem("mea.themeMode", mode);
  } catch {
    // storage may be unavailable
  }
  if (s) {
    applyFonts(root, s["appearance.storyFont"], s["appearance.typography"]?.uiFont);
    root.style.setProperty("--scale", String(s["appearance.fontScale"] || 1));
    // UI-16 / UI-19: typography
    const t = s["appearance.typography"];
    if (t) {
      root.style.setProperty("--story-lh", String(t.lineHeight));
      root.style.setProperty("--para-gap", `${t.paragraphSpacing}em`);
      root.style.setProperty("--measure", `${t.width}rem`);
      if (t.dialogueColor) root.style.setProperty("--dialogue", t.dialogueColor);
      else root.style.removeProperty("--dialogue");
      if (t.dyslexic) {
        void import("@fontsource/opendyslexic/400.css");
        void import("@fontsource/opendyslexic/700.css");
        void import("@fontsource/opendyslexic/400-italic.css");
      }
      root.toggleAttribute("data-dyslexic", t.dyslexic);
    }
  }
  const info = themeInfo(shown);
  const bar = info ? info.bar[night ? "night" : "day"] : dark ? "#231E2A" : "#FBF6F1";
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", bar));
}
