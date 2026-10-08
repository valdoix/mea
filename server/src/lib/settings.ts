import { now, one, parseJson, run } from "../db/db";

/** Typed app settings with defaults. Stored as JSON per key. */
export interface Settings {
  /** Profile used for story generation (CONN-03). */
  "routing.story": string | null;
  "appearance.theme": "system" | "light" | "dark";
  "appearance.chatStyle": "cards" | "book" | "bubbles";
  "appearance.fontScale": number;
  "appearance.storyFont": "lora" | "literata" | "nunito";
  "chat.enterToSend": boolean;
  "chat.defaultPresetId": string | null;
  "backup.hourlyKeep": number;
  "backup.dailyKeep": number;
  "push.vapid": { publicKey: string; privateKey: string } | null;
  "onboarding.done": boolean;
  "lore.defaults": { scanDepth: number; tokenBudget: number; recursive: boolean; maxRecursion: number; caseSensitive: boolean; matchWholeWords: boolean };
  "quota.cache": unknown;
}

export const defaults: Settings = {
  "routing.story": null,
  "appearance.theme": "system",
  "appearance.chatStyle": "cards",
  "appearance.fontScale": 1,
  "appearance.storyFont": "lora",
  "chat.enterToSend": false,
  "chat.defaultPresetId": null,
  "backup.hourlyKeep": 24,
  "backup.dailyKeep": 14,
  "push.vapid": null,
  "onboarding.done": false,
  "lore.defaults": { scanDepth: 4, tokenBudget: 2048, recursive: true, maxRecursion: 3, caseSensitive: false, matchWholeWords: true },
  "quota.cache": null,
};

/** Keys the web client may read and write directly. */
export const clientKeys: (keyof Settings)[] = [
  "routing.story",
  "appearance.theme",
  "appearance.chatStyle",
  "appearance.fontScale",
  "appearance.storyFont",
  "chat.enterToSend",
  "chat.defaultPresetId",
  "backup.hourlyKeep",
  "backup.dailyKeep",
  "onboarding.done",
  "lore.defaults",
];

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  const row = one<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  return row ? parseJson(row.value, defaults[key]) : defaults[key];
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    JSON.stringify(value),
  );
  settingsVersion = now();
}

export let settingsVersion = now();

export function getClientSettings(): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const k of clientKeys) (out as Record<string, unknown>)[k] = getSetting(k);
  return out;
}
