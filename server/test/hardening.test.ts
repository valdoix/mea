import { beforeAll, describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { createApp } from "../src/app";
import { CHARX_LIMITS, parseCardFile } from "../src/cards/io";
import { placeholderAvatar } from "../src/lib/png-encode";
import { freshDb } from "./helpers";

/** Regression tests for the audit's data-layer findings (H9–H12). */

let app: ReturnType<typeof createApp>;
const local = { requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 5000 }) };

async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const init: RequestInit = { method, headers: body !== undefined ? { "Content-Type": "application/json" } : {} };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await app.fetch(new Request(`http://localhost${path}`, init), local);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

beforeAll(() => {
  freshDb();
  app = createApp();
});

describe("H9: template import with a long key", () => {
  const schema = { fields: [{ key: "hp", label: "HP", type: "meter", min: 0, max: 100 }] };
  const key = "a".repeat(30);

  test("a taken 30-character key gets a numbered key instead of hanging", async () => {
    const keys: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await api("POST", "/api/tracker-templates/import", { key, name: "Long", schema });
      expect(r.status).toBe(201);
      keys.push(r.json.key);
    }
    expect(new Set(keys).size).toBe(12);
    for (const k of keys) expect(k.length).toBeLessThanOrEqual(30);
    expect(keys[0]).toBe(key);
    expect(keys[1]).toBe(`${"a".repeat(29)}2`);
    expect(keys[9]).toBe(`${"a".repeat(28)}10`);
  });

  test("duplicating a 30-character key works more than once", async () => {
    const list = await api("GET", "/api/tracker-templates");
    const src = list.json.templates.find((t: { key: string }) => t.key === key);
    const a = await api("POST", `/api/tracker-templates/${src.id}/duplicate`);
    const b = await api("POST", `/api/tracker-templates/${src.id}/duplicate`);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.json.key).not.toBe(b.json.key);
  });

  test("L2: bad JSON or a bad template is a 400, not a 500", async () => {
    expect((await api("POST", "/api/tracker-templates/import", "{nope")).status).toBe(400);
    expect((await api("POST", "/api/tracker-templates", { key: "Bad Key", name: "x", schema })).status).toBe(400);
    expect((await api("POST", "/api/tracker-templates", "{nope")).status).toBe(400);
  });
});

/** Rewrites the declared uncompressed size of `name` in a zip's central directory. */
function patchDeclaredSize(zip: Uint8Array, name: string, size: number) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let o = 0; o < zip.length - 46; o++) {
    if (view.getUint32(o, true) !== 0x02014b50) continue;
    const len = view.getUint16(o + 28, true);
    if (new TextDecoder().decode(zip.subarray(o + 46, o + 46 + len)) === name) {
      view.setUint32(o + 24, size, true);
      return;
    }
  }
  throw new Error(`no entry ${name}`);
}

describe("H10: CHARX zip bombs", () => {
  const card = (assets: unknown[]) => strToU8(JSON.stringify({ spec: "chara_card_v3", spec_version: "3.0", data: { name: "Z", first_mes: "hi", assets } }));

  test("entries card.json doesn't name are never inflated", () => {
    const zip = zipSync({ "card.json": card([]), "junk.bin": [new Uint8Array(1 << 20), { level: 9 }] });
    patchDeclaredSize(zip, "junk.bin", 0xfffffff0); // a ~4 GB claim: inflating it would allocate 4 GB
    expect(parseCardFile(zip, "z.charx").data.name).toBe("Z");
  });

  test("an icon over the per-asset cap is skipped, a normal one is kept", () => {
    const icon = placeholderAvatar(8, 8);
    const assets = [
      { type: "icon", uri: "embeded://assets/icon/main.png", name: "main", ext: "png" },
      { type: "icon", uri: "embeded://assets/icon/big.png", name: "big", ext: "png" },
    ];
    const zip = zipSync({ "card.json": card(assets), "assets/icon/main.png": [icon, { level: 0 }], "assets/icon/big.png": [new Uint8Array(1 << 16), { level: 9 }] });
    patchDeclaredSize(zip, "assets/icon/big.png", CHARX_LIMITS.asset + 1);
    const parsed = parseCardFile(zip, "z.charx");
    expect(parsed.image?.bytes.length).toBe(icon.length);
    expect(parsed.extraImages.length).toBe(0);
  });

  test("an oversized card.json is refused", () => {
    const zip = zipSync({ "card.json": [card([]), { level: 9 }] });
    patchDeclaredSize(zip, "card.json", CHARX_LIMITS.cardJson + 1);
    expect(() => parseCardFile(zip, "z.charx")).toThrow(/too large/);
  });
});
