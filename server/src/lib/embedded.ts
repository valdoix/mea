/** Web files baked into the single-file build (ARCH-14): URL path → embedded file path. */
let assets: Record<string, string> | null = null;

export function setEmbeddedAssets(list: Record<string, string>) {
  assets = Object.keys(list).length ? list : null;
}

/** Path of an embedded web file, or null when running from source (files come from web/dist). */
export function embeddedAsset(path: string): string | null {
  return assets?.[path] ?? null;
}

export const hasEmbeddedAssets = () => assets !== null;
