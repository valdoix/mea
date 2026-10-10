import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { placeholderAvatar } from "../lib/png-encode";
import { type CardData, type CardSpec, normalizeCard, toV2, toV3 } from "./card";
import { base64ToUtf8, isPng, readTextChunks, setTextChunks, utf8ToBase64 } from "./png";

export interface ParsedCard {
  data: CardData;
  spec: CardSpec;
  image?: { bytes: Uint8Array; mime: string };
  extraImages: { bytes: Uint8Array; mime: string; name: string }[];
}

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Parses a PNG, JSON, or CHARX character card file. */
export function parseCardFile(bytes: Uint8Array, filename = ""): ParsedCard {
  if (isPng(bytes)) {
    const text = readTextChunks(bytes);
    const payload = text.ccv3 ?? text.chara;
    if (!payload) throw new Error("This PNG has no character card data");
    const { data, spec } = normalizeCard(JSON.parse(base64ToUtf8(payload)));
    return { data, spec, image: { bytes, mime: "image/png" }, extraImages: [] };
  }
  if (isZip(bytes) || filename.toLowerCase().endsWith(".charx")) return parseCharx(bytes);
  const json = JSON.parse(new TextDecoder().decode(bytes));
  const { data, spec } = normalizeCard(json);
  return { data, spec, extraImages: [] };
}

/** H10: zip-bomb limits. Only card.json and icon entries are inflated, each by its declared size. */
export const CHARX_LIMITS = { cardJson: 16 * 1024 * 1024, asset: 25 * 1024 * 1024, total: 64 * 1024 * 1024 };

function parseCharx(bytes: Uint8Array): ParsedCard {
  // Pass 1: card.json only. fflate allocates `originalSize` up front and won't grow past it.
  const head = unzipSync(bytes, {
    filter: (f) => {
      if (f.name !== "card.json") return false;
      if (f.originalSize > CHARX_LIMITS.cardJson) throw new Error("card.json is too large");
      return true;
    },
  });
  const cardFile = head["card.json"];
  if (!cardFile) throw new Error("CHARX archive has no card.json");
  const { data, spec } = normalizeCard(JSON.parse(strFromU8(cardFile)));
  const wanted = new Set<string>();
  for (const asset of data.assets ?? []) {
    const uri = asset.uri ?? "";
    const path = uri.replace(/^embedd?ed:\/\//, "");
    if (path !== uri && asset.type === "icon") wanted.add(path);
  }
  // Pass 2: only the icon entries card.json names, each capped, with a cap on the total.
  let total = 0;
  const files = wanted.size
    ? unzipSync(bytes, {
        filter: (f) => {
          if (!wanted.has(f.name)) return false;
          if (f.originalSize > CHARX_LIMITS.asset) return false;
          total += f.originalSize;
          if (total > CHARX_LIMITS.total) throw new Error("The card's images are too large");
          return true;
        },
      })
    : {};
  const icons: { bytes: Uint8Array; mime: string; name: string }[] = [];
  for (const asset of data.assets ?? []) {
    const uri = asset.uri ?? "";
    const path = uri.replace(/^embedd?ed:\/\//, "");
    if (path === uri || asset.type !== "icon") continue;
    const fileBytes = files[path];
    if (!fileBytes) continue;
    icons.push({ bytes: fileBytes, mime: mimeFromExt(asset.ext || path.split(".").pop() || "png"), name: asset.name });
  }
  const main = icons.find((i) => i.name === "main") ?? icons[0];
  const extraImages = icons.filter((i) => i !== main);
  return { data, spec, image: main && { bytes: main.bytes, mime: main.mime }, extraImages };
}

export function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, "");
  return e === "jpg" || e === "jpeg" ? "image/jpeg" : e === "webp" ? "image/webp" : e === "gif" ? "image/gif" : e === "avif" ? "image/avif" : "image/png";
}

/** Writes a PNG card containing both V2 ("chara") and V3 ("ccv3") payloads for maximum compatibility. */
export function buildPngCard(data: CardData, avatarPng?: Uint8Array): Uint8Array {
  const base = avatarPng && isPng(avatarPng) ? avatarPng : placeholderAvatar();
  return setTextChunks(base, {
    chara: utf8ToBase64(JSON.stringify(toV2(data))),
    ccv3: utf8ToBase64(JSON.stringify(toV3(data))),
  });
}

export function buildJsonCard(data: CardData, spec: "v2" | "v3" = "v3"): string {
  return JSON.stringify(spec === "v2" ? toV2(data) : toV3(data), null, 2);
}

export function buildCharx(data: CardData, avatar?: { bytes: Uint8Array; mime: string }): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const card = { ...data, assets: [] as NonNullable<CardData["assets"]> };
  if (avatar) {
    const ext = avatar.mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    const path = `assets/icon/images/main.${ext}`;
    files[path] = avatar.bytes;
    card.assets.push({ type: "icon", uri: `embeded://${path}`, name: "main", ext });
  } else {
    card.assets.push({ type: "icon", uri: "ccdefault:", name: "main", ext: "png" });
  }
  files["card.json"] = strToU8(JSON.stringify(toV3(card), null, 2));
  return zipSync(files);
}
