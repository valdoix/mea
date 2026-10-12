import type { LivingPage, Settings } from "./types";

/** The living page (Settings → Appearance): speaker colours, artifacts, the scene window, thoughts. */
export const LIVING_DEFAULTS: LivingPage = { voices: "ink", artifacts: true, freeform: true, window: true, thoughts: "drawer" };

export function living(settings: Settings | null | undefined): LivingPage {
  return { ...LIVING_DEFAULTS, ...(settings?.["appearance.living"] ?? {}) };
}
