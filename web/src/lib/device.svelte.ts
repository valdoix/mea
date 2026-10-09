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
  /** Lantern: portrait size beside each message. */
  portrait: "small" | "large" | "grand";
  /** Lantern: how much room inside each message box. */
  boxPadding: "snug" | "cozy" | "airy";
  /** Lantern: drifting fireflies and a whisper of film grain behind everything. */
  fireflies: boolean;
  grain: boolean;
}

const KEY = "mea.prefs";
const defaults: DevicePrefs = { offline: true, dataLight: "auto", spellcheck: false, discreet: false, haptics: true, delights: true, lockAfter: 5, readSize: 1.15, readWidth: 38, readTheme: "app", chatWidth: 0, portrait: "large", boxPadding: "cozy", fireflies: true, grain: true };

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
  return Boolean(c.saveData) || c.type === "cellular" || ["slow-2g", "2g", "3g"].includes(c.effectiveType ?? "");
}
export function onConnectionChange(fn: () => void) {
  const c = (navigator as Navigator & { connection?: NetInfo }).connection;
  c?.addEventListener("change", fn);
  return () => c?.removeEventListener("change", fn);
}
