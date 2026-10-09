/**
 * Preferences that belong to one device, not to Mea as a whole: what suits the phone in your
 * pocket isn't what suits the PC at home. Kept in this browser's storage.
 */

export interface DevicePrefs {
  /** QOL-04: local spell and grammar check in the composer. */
  spellcheck: boolean;
  /** UI-20: blur avatars, previews and notification text. */
  discreet: boolean;
  /** MOB-09: a tiny vibration on send and swipe (Android). */
  haptics: boolean;
  /** UI-24: small delights (sparkles, heart pops, page turns). */
  delights: boolean;
  /** MOB-11: lock the app after this many minutes in the background (0 = when it's hidden). */
  lockAfter: number;
  /** UI-15: reading mode. */
  readSize: number;
  readWidth: number;
  readTheme: "app" | "paper" | "night";
}

const KEY = "mea.prefs";
const defaults: DevicePrefs = { spellcheck: false, discreet: false, haptics: true, delights: true, lockAfter: 5, readSize: 1.15, readWidth: 38, readTheme: "app" };

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
