import type { Provider } from "./types";

/**
 * Image generation (docs/28 Part 1). NanoGPT's image models are all pay-as-you-go, so they only
 * ever run on a pay-as-you-go connection, one tap at a time. Parameters differ per model, so a
 * request is built from the model's own catalog entry, never from a fixed list.
 */

export interface ImageModelInfo {
  id: string;
  name: string;
  description?: string;
  /** NanoGPT's shelf: "Featured", "New", "image", "More", "Tools". */
  category?: string;
  tags: string[];
  /** USD per image, by size key (a size, an aspect ratio, "1k", "auto"…), as the catalog lists them. */
  prices: Record<string, number>;
  /** The price is per use, not fixed (e.g. Nano Banana 2.1's "actual_usage"): the table is a guide. */
  estimated?: boolean;
  capabilities: { generate: boolean; edit: boolean; inpainting: boolean; nsfw: boolean };
  /** Sizes the model takes (`resolutions`), and aspect ratios when it takes them separately. */
  sizes: string[];
  aspectRatios: string[];
  /** Most pictures per request. */
  maxImages: number;
  /** Most reference images per request (0: text only). */
  maxInputImages: number;
  maxPromptChars: number | null;
}

export interface ImageReference {
  mime: string;
  bytes: Uint8Array;
}

export interface ImageRequest {
  model: string;
  prompt: string;
  n?: number;
  /** A size key from the model's prices or sizes ("1024x1024", "1k", "16:9"). */
  size?: string;
  /** For models that take the aspect ratio separately from the resolution. */
  aspectRatio?: string;
  seed?: number;
  references?: ImageReference[];
  signal?: AbortSignal;
}

export interface ImageResult {
  images: Uint8Array[];
  /** USD, as the provider reported it. */
  cost: number | null;
  /** The body sent, with reference images shortened (never keys). */
  sentBody: Record<string, unknown>;
}

export interface ImageProvider {
  listImageModels(): Promise<ImageModelInfo[]>;
  generateImage(req: ImageRequest): Promise<ImageResult>;
}

export const isImageProvider = (p: Provider): p is Provider & ImageProvider => typeof (p as Partial<ImageProvider>).generateImage === "function";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
/** A parameter given as a list, as an enum `{ values }`, or as a range `{ max }`. */
const listOf = (v: unknown): string[] => (Array.isArray(v) ? strs(v) : v && typeof v === "object" ? strs((v as { values?: unknown }).values) : []);
const maxOf = (v: unknown): number | null => num(v) ?? (v && typeof v === "object" ? (num((v as { max?: unknown }).max) ?? num((v as { max_items?: unknown }).max_items)) : null);

/** One entry of `GET /api/v1/images/models`. */
export function toImageModel(m: Record<string, any>): ImageModelInfo {
  const sp = (m.supported_parameters ?? {}) as Record<string, unknown>;
  const caps = (m.capabilities ?? {}) as Record<string, unknown>;
  const prices: Record<string, number> = {};
  for (const [k, v] of Object.entries((m.pricing?.per_image ?? {}) as Record<string, unknown>)) {
    const p = num(v);
    if (p != null) prices[k] = p;
  }
  const inputs = (m.architecture?.input_modalities ?? []) as unknown[];
  const maxInput = maxOf(sp.max_input_images) ?? maxOf(sp.input_image_constraints) ?? (caps.image_to_image ? 1 : 0);
  return {
    id: String(m.id),
    name: String(m.name ?? m.id),
    description: typeof m.description === "string" ? m.description.slice(0, 400) : undefined,
    category: typeof m.category === "string" ? m.category : undefined,
    tags: strs(m.tags).slice(0, 20),
    prices,
    estimated: m.pricing?.billing === "actual_usage" || undefined,
    capabilities: {
      generate: caps.image_generation !== false,
      edit: Boolean(caps.image_to_image) || inputs.includes("image"),
      inpainting: Boolean(caps.inpainting),
      nsfw: Boolean(caps.nsfw),
    },
    sizes: listOf(sp.resolutions).length ? listOf(sp.resolutions) : listOf(sp.resolution),
    aspectRatios: listOf(sp.aspect_ratio),
    maxImages: Math.max(1, maxOf(sp.max_images) ?? maxOf(sp.max_output_images) ?? maxOf(sp.n) ?? 1),
    maxInputImages: Math.max(0, maxInput),
    maxPromptChars: num(sp.max_prompt_characters),
  };
}

/** Upscalers, background removers, croppers and the like: they make no new picture from a prompt. */
export function isToolModel(m: Pick<ImageModelInfo, "id" | "category" | "tags" | "description">): boolean {
  if (m.category === "Tools") return true;
  const text = `${m.id} ${m.tags.join(" ")}`.toLowerCase();
  return /upscal|denoise|super-focus|background|remov|erase|cropper|segment|depth|\bsam\d|birefnet|marigold|layerize|vto|try-on|seedvr|vosr/.test(text);
}

/** The size keys a request can use: the price table's, else the model's resolutions. */
export function sizesOf(m: Pick<ImageModelInfo, "prices" | "sizes">): string[] {
  const priced = Object.keys(m.prices);
  return priced.length ? priced : m.sizes;
}

/** The catalog's price for one picture at a size: that size's, else "auto"'s, else the cheapest. */
export function pricePerImage(m: Pick<ImageModelInfo, "prices">, size?: string | null): number | null {
  if (size && m.prices[size] != null) return m.prices[size]!;
  if (m.prices.auto != null) return m.prices.auto;
  const all = Object.values(m.prices);
  return all.length ? Math.min(...all) : null;
}

/** The size a model is drawn at when none is picked: a square near 1024 when there is one. */
export function defaultSize(m: Pick<ImageModelInfo, "prices" | "sizes">): string | undefined {
  const keys = sizesOf(m);
  return keys.find((k) => /^1024[x*]1024$/.test(k)) ?? keys.find((k) => /^1k$/i.test(k)) ?? keys.find((k) => k === "1:1") ?? keys.find((k) => k !== "auto") ?? keys[0];
}

const RATIO = /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/;

/**
 * The body for NanoGPT's `POST /api/v1/images/generations`. A size key that is an aspect ratio
 * also goes as `aspect_ratio`, for the models that read it there.
 */
export function imageBody(req: ImageRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { model: req.model, prompt: req.prompt, n: Math.max(1, req.n ?? 1), response_format: "b64_json" };
  if (req.size && req.size !== "auto") {
    body.size = req.size;
    if (RATIO.test(req.size)) body.aspect_ratio = req.size;
  }
  if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;
  if (req.seed != null) body.seed = req.seed;
  const refs = (req.references ?? []).map((r) => `data:${r.mime};base64,${Buffer.from(r.bytes).toString("base64")}`);
  if (refs.length === 1) body.imageDataUrl = refs[0];
  else if (refs.length > 1) body.imageDataUrls = refs;
  return body;
}

/** The body as logged: reference images become their size, so the log stays small. */
export function loggedBody(body: Record<string, unknown>): Record<string, unknown> {
  const short = (s: unknown) => (typeof s === "string" && s.startsWith("data:") ? `[image, ${Math.round((s.length * 3) / 4 / 1024)} KB]` : s);
  const out: Record<string, unknown> = { ...body };
  if (out.imageDataUrl) out.imageDataUrl = short(out.imageDataUrl);
  if (Array.isArray(out.imageDataUrls)) out.imageDataUrls = out.imageDataUrls.map(short);
  return out;
}

/** A `b64_json` value, bare or as a data URL. */
export function decodeBase64Image(v: string): Uint8Array {
  const comma = v.startsWith("data:") ? v.indexOf(",") : -1;
  return new Uint8Array(Buffer.from(comma >= 0 ? v.slice(comma + 1) : v, "base64"));
}
