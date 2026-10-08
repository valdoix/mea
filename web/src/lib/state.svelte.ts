import { get, put } from "./api";
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
  dark: document.documentElement.dataset.theme === "dark",
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
  const theme = s?.["appearance.theme"] ?? (localStorage.getItem("mea.theme") as Settings["appearance.theme"]) ?? "system";
  const dark = theme === "dark" || (theme === "system" && darkQuery.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  app.dark = dark;
  try {
    localStorage.setItem("mea.theme", theme);
  } catch {
    // storage may be unavailable
  }
  if (s) {
    root.dataset.storyFont = s["appearance.storyFont"];
    root.style.setProperty("--scale", String(s["appearance.fontScale"] || 1));
  }
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#231E2A" : "#FBF6F1"));
}
