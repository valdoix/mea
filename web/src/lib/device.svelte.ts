/**
 * Preferences that belong to one device, not to Mea as a whole: what suits the phone in your
 * pocket isn't what suits the PC at home. Kept in this browser's storage.
 */

export interface DevicePrefs {
  /** ARCH-11: keep copies of recent chats on this device to read offline. */
  offline: boolean;
  /** QOL-04: local spell and grammar check in the composer. */
  spellcheck: boolean;
  /** UI-20: blur avatars, previews and notification text. */
  discreet: boolean;
  /** MOB-09: a tiny vibration on send and swipe (Android). */
  haptics: boolean;
  /** UI-24: small delights (sparkles, heart pops, page turns). */
  delights: boolean;
  /** MOB-12: smaller images and fewer prefetches. "auto" follows data saver and cellular connections. */
  dataLight: "auto" | "on" | "off";
  /** MOB-11: lock the app after this many minutes in the background (0 = when it's hidden). */
  lockAfter: number;
  /** UI-15: reading mode. */
  readSize: number;
  readWidth: number;
  readTheme: "app" | "paper" | "night";
  /** Lantern: how wide the chat boxes are, in rem (0 = the reading width from Appearance, 100 = the whole window). */
  chatWidth: number;
  /** Lantern: portrait size beside each message, a preset or "custom" (then portraitPx). */
  portrait: PortraitSize;
  /** The portrait's width in px when portrait is "custom". */
  portraitPx: number;
  /** Lantern: the frame around each portrait on cards; "room" keeps the room's own. */
  portraitFrame: PortraitFrame;
  /** Lantern: how much room inside each message box. */
  boxPadding: "snug" | "cozy" | "airy";
  /** Lantern: drifting fireflies and a whisper of film grain behind everything. */
  fireflies: boolean;
  grain: boolean;
  /** J1: a drawn plate at each new scene. */
  plates: boolean;
}

export type PortraitFrame = "room" | "holo" | "polaroid" | "cameo";
export type PortraitSize = "small" | "large" | "grand" | "towering" | "custom";
/** Portrait widths in px for the presets, and the custom slider's range. */
export const PORTRAIT_PRESETS = { small: 56, large: 76, grand: 104, towering: 150 } as const;
export const PORTRAIT_RANGE = { min: 48, max: 260 } as const;

const KEY = "mea.prefs";
const defaults: DevicePrefs = { offline: true, dataLight: "auto", spellcheck: false, discreet: false, haptics: true, delights: true, lockAfter: 5, readSize: 1.15, readWidth: 38, readTheme: "app", chatWidth: 0, portrait: "large", portraitPx: 140, portraitFrame: "room", boxPadding: "cozy", fireflies: true, grain: true, plates: true };

function read(): DevicePrefs {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...defaults };
  }
}

export const device = $state<DevicePrefs>(read());

export function setDevice<K extends keyof DevicePrefs>(key: K, value: DevicePrefs[K]) {
  device[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(device));
  } catch {
    // private mode: the choice lasts until the tab closes
  }
}

/** MOB-09: a short buzz, if this device can and you want it. */
export function buzz(ms = 10) {
  if (device.haptics) navigator.vibrate?.(ms);
}

interface NetInfo extends EventTarget {
  saveData?: boolean;
  type?: string;
  effectiveType?: string;
}

/** MOB-12: is this a connection to be careful with? */
export function meteredConnection() {
  const c = (navigator as Navigator & { connection?: NetInfo }).connection;
  if (!c) return false;
  // Mea on this machine costs no data. And effectiveType is a throughput guess that says "3g" on
  // plenty of desktop links, which halved every image; only the really slow guesses count.
  if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return false;
  return Boolean(c.saveData) || c.type === "cellular" || ["slow-2g", "2g"].includes(c.effectiveType ?? "");
}
export function onConnectionChange(fn: () => void) {
  const c = (navigator as Navigator & { connection?: NetInfo }).connection;
  c?.addEventListener("change", fn);
  return () => c?.removeEventListener("change", fn);
}

/** Running inside the Mea Android app (mobile/), which identifies itself in the user agent. */
export const inApp = typeof navigator !== "undefined" && /\bMeaApp\//.test(navigator.userAgent);
/** The app's own start page, where the Mea address is set. */
export const appSetupUrl = "https://localhost/?setup";

/** How wide the portrait beside each message is on a wide screen, in px. */
export function portraitWidth(p: Pick<DevicePrefs, "portrait" | "portraitPx"> = device) {
  if (p.portrait === "custom") return Math.round(Math.min(PORTRAIT_RANGE.max, Math.max(PORTRAIT_RANGE.min, Number(p.portraitPx) || 140)));
  return PORTRAIT_PRESETS[p.portrait] ?? PORTRAIT_PRESETS.large;
}
