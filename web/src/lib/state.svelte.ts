import { get, put } from "./api";
import { applyRoomColors } from "./roomcolors";
import { applyFonts, loadFontCatalog } from "./fonts";
import { isLayout, loadLayoutStyles, type LayoutId } from "./layouts";
import { isRoom, isShellTheme, loadThemeFonts, loadThemeStyles, themeInfo, type ThemeId } from "./themes";
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
  dark: document.documentElement.dataset.mode !== "day",
  /** The theme that's showing: Lantern (the default) or one of the rooms. */
  theme: (document.documentElement.dataset.theme ?? "lantern") as ThemeId,
  /** How chats are laid out: Classic, Folio or Stage. */
  layout: (document.documentElement.dataset.layout ?? "classic") as LayoutId,
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
/** L15: each toast's countdown, paused while the pointer or focus is on it. */
const toastTimers = new Map<number, { timer: ReturnType<typeof setTimeout> | null; left: number; since: number }>();
export function toast(message: string, opts: { kind?: Toast["kind"]; action?: Toast["action"]; timeout?: number } = {}) {
  const t: Toast = { id: ++toastSeq, message, kind: opts.kind ?? "info", action: opts.action };
  app.toasts.push(t);
  // An Undo gets 10 s: enough to notice it and reach it.
  const timeout = opts.timeout ?? (opts.action ? 10_000 : opts.kind === "error" ? 6000 : 3200);
  toastTimers.set(t.id, { timer: setTimeout(() => dismissToast(t.id), timeout), left: timeout, since: Date.now() });
  return t.id;
}

export function pauseToast(id: number) {
  const t = toastTimers.get(id);
  if (!t?.timer) return;
  clearTimeout(t.timer);
  t.timer = null;
  t.left = Math.max(0, t.left - (Date.now() - t.since));
}

export function resumeToast(id: number) {
  const t = toastTimers.get(id);
  if (!t || t.timer) return;
  t.since = Date.now();
  // Never gone the instant the pointer leaves.
  t.timer = setTimeout(() => dismissToast(id), Math.max(t.left, 1500));
}

export function dismissToast(id: number) {
  const t = toastTimers.get(id);
  if (t?.timer) clearTimeout(t.timer);
  toastTimers.delete(id);
  const i = app.toasts.findIndex((t) => t.id === id);
  if (i >= 0) app.toasts.splice(i, 1);
}

export function errorToast(e: unknown) {
  toast(e instanceof Error ? e.message : String(e), { kind: "error" });
}

export async function loadSettings() {
  app.settings = await get<Settings>("/api/settings");
  await loadFontCatalog();
  applyAppearance();
  await loadLayoutStyles(app.layout);
}

const settingWrites = new Map<string, number>();
export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  const before = app.settings ? $state.snapshot(app.settings[key]) : undefined;
  const n = (settingWrites.get(key) ?? 0) + 1;
  settingWrites.set(key, n);
  if (app.settings) app.settings[key] = value;
  applyAppearance();
  try {
    app.settings = await put<Settings>("/api/settings", { [key]: value });
  } catch (e) {
    // L1: not saved: the screen goes back to what Mea has (unless something newer was set meanwhile).
    if (app.settings && settingWrites.get(key) === n) {
      app.settings[key] = before as Settings[K];
      applyAppearance();
    }
    throw e;
  }
}

/**
 * Choosing a layout. Folio and Stage read as a book, so they start you on the Book style; Classic gets
 * back the style it had. Either way the style stays yours to change afterwards.
 */
export function setLayout(next: LayoutId) {
  const was = app.settings?.["appearance.layout"] ?? "classic";
  if (was === next) return;
  void saveSetting("appearance.layout", next);
  const style = app.settings?.["appearance.chatStyle"];
  try {
    if (was === "classic" && style) {
      localStorage.setItem("mea.classicStyle", style);
      if (style !== "book") void saveSetting("appearance.chatStyle", "book");
    } else if (next === "classic") {
      const back = localStorage.getItem("mea.classicStyle");
      if (back === "cards" || back === "book" || back === "bubbles") void saveSetting("appearance.chatStyle", back);
    }
  } catch {
    // storage unavailable: the style just stays as it is
  }
}

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
darkQuery.addEventListener("change", () => applyAppearance());

export function applyAppearance() {
  const s = app.settings;
  const theme = s?.["appearance.theme"] ?? (localStorage.getItem("mea.theme") as Settings["appearance.theme"]) ?? "lantern";
  const mode = s?.["appearance.themeMode"] ?? (localStorage.getItem("mea.themeMode") as Settings["appearance.themeMode"]) ?? "system";
  // Mea Cozy was retired; a saved "light", "dark" or "system" from it shows Lantern.
  const shown: ThemeId = isShellTheme(theme) ? theme : "lantern";
  // Lantern is always night.
  const night = isRoom(shown) ? mode === "night" || (mode !== "day" && darkQuery.matches) : true;
  const dark = night;
  const root = document.documentElement;
  root.dataset.theme = shown;
  root.dataset.shell = "lantern";
  if (isRoom(shown)) {
    root.dataset.mode = night ? "night" : "day";
    loadThemeFonts(shown);
    void loadThemeStyles(shown);
  } else delete root.dataset.mode;
  const kind = s?.["appearance.layout"] ?? localStorage.getItem("mea.layoutKind");
  const lay: LayoutId = isLayout(kind) ? kind : "classic";
  root.dataset.layout = lay;
  app.layout = lay;
  void loadLayoutStyles(lay);
  app.dark = dark;
  app.theme = shown;
  app.night = night;
  try {
    localStorage.setItem("mea.theme", theme);
    localStorage.setItem("mea.themeMode", mode);
    localStorage.setItem("mea.layoutKind", lay);
  } catch {
    // storage may be unavailable
  }
  // J2: your colours for this room, by day or by night.
  applyRoomColors(root, s?.["appearance.colors"], shown, night || dark);
  if (s) {
    applyFonts(root, s["appearance.storyFont"], s["appearance.typography"]?.uiFont, s["appearance.typography"]?.displayFont);
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
  const bar = info ? info.bar[night ? "night" : "day"] : "#0E0A18";
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", bar));
}
