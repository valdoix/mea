import { beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { strToU8, zipSync } from "fflate";
import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createApp } from "../src/app";
import { normalizeCard } from "../src/cards/card";
import { CHARX_LIMITS, parseCardFile } from "../src/cards/io";
import { htmlToText, privateIp, publicUrl } from "../src/creator/research";
import { createCharacter } from "../src/services/characters";
import { addMessage, addSwipe, createChat, softDeleteMessage, updateSwipe } from "../src/services/chats";
import { exportChatJsonl } from "../src/services/export";
import { deletedImagesDir, getImage, imagePath, mirrorImages, purgeUnreferencedImages, saveImage, sweepDeletedImages } from "../src/services/images";
import { storageReport } from "../src/services/storage";
import { saveCastProfile } from "../src/trackers/store";
import { paths } from "../src/config";
import { one, openDb, run } from "../src/db/db";
import type { HttpError } from "../src/lib/http";
import { placeholderAvatar } from "../src/lib/png-encode";
import { createBackup, listBackups, restoreBackup, scheduledBackup } from "../src/services/backup";
import { enqueue, registerJob, retryJob, runningJobCount } from "../src/services/jobs";
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
    const send = async (path: string, form: FormData) => (await app.fetch(new Request(`http://localhost${path}`, { method: "POST", body: form }), local)).status;
    const lore = new FormData();
    lore.append("file", new File(["not json"], "book.json"));
    expect(await send("/api/lorebooks/import", lore)).toBe(400);
    const img = new FormData();
    img.append("file", new File([placeholderAvatar(8, 8)], "a.png"));
    img.append("palette", "{bad");
    expect(await send("/api/images", img)).toBe(400);
  });
});

describe("M8: research URLs", () => {
  test("HTML stripping is linear on hostile input and keeps its output", () => {
    const hostile = ["<script", "<table class=\"navbox\"", "<span class=\"mw-editsection\">", "<main", "<title>"].map((t) => t.repeat(40_000)).join("");
    const t0 = performance.now();
    htmlToText(hostile);
    expect(performance.now() - t0).toBeLessThan(1500);
    const html = `<p>A <b>b</b></p><table class="navbox"><tr><td>nav</td></tr></table><span class="mw-editsection"><span>[</span>edit<span>]</span></span><h2>Story</h2><ul><li>one</li></ul><p>x</p>`;
    const text = htmlToText(html);
    expect(text).toContain("A b");
    expect(text).not.toContain("nav");
    expect(text).not.toContain("edit");
    expect(text).toContain("## Story");
    expect(text).toContain("- one");
  });

  test("private addresses are refused in every spelling", () => {
    for (const bad of ["http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[::ffff:a00:1]/", "http://0x7f.1/", "http://2130706433/", "http://[fd00::1]/", "http://[64:ff9b::c0a8:101]/", "http://100.64.0.1/", "http://0.0.0.0/"]) expect(publicUrl(bad)).toBeNull();
    for (const ok of ["https://en.wikipedia.org/wiki/X", "http://8.8.8.8/", "http://[2606:4700::1111]/"]) expect(publicUrl(ok)).not.toBeNull();
    expect(privateIp("::ffff:192.168.1.1")).toBe(true);
    expect(privateIp("93.184.216.34")).toBe(false);
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

describe("H11: restoring a bad backup", () => {
  const marker = () => one<{ value: string }>("SELECT value FROM settings WHERE key = 'test.h11'")?.value;
  const preRestores = () => listBackups().filter((b) => b.kind === "pre-restore").length;
  const status = (fn: () => void) => {
    try {
      fn();
      return 200;
    } catch (e) {
      return (e as HttpError).status ?? 500;
    }
  };

  beforeAll(() => {
    openDb(paths.db);
    run("INSERT INTO settings (key, value) VALUES ('test.h11', '\"live\"') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  });

  test("garbage, a truncated snapshot and a non-Mea database are refused before anything changes", () => {
    const before = preRestores();
    writeFileSync(join(paths.backups, "mea-manual-garbage.db"), "this is not sqlite".repeat(100));
    const good = createBackup("manual");
    const bytes = readFileSync(join(paths.backups, good.file));
    writeFileSync(join(paths.backups, "mea-manual-truncated.db"), bytes.subarray(0, Math.floor(bytes.length / 2)));
    const other = new Database(join(paths.backups, "mea-manual-other.db"), { create: true });
    other.exec("CREATE TABLE t (x)");
    other.close();
    for (const f of ["mea-manual-garbage.db", "mea-manual-truncated.db", "mea-manual-other.db"]) expect(status(() => restoreBackup(f))).toBe(400);
    expect(marker()).toBe('"live"');
    expect(preRestores()).toBe(before);
    expect(readdirSync(dirname(paths.db)).some((f) => f.includes(".restore-"))).toBe(false);
  });

  test("a snapshot that passes the check but won't open puts the pre-restore copy back", () => {
    // A Mea-looking file whose first migration collides with an existing table.
    const broken = new Database(join(paths.backups, "mea-manual-broken.db"), { create: true });
    broken.exec("CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL); CREATE TABLE settings (nope)");
    broken.close();
    expect(status(() => restoreBackup("mea-manual-broken.db"))).toBe(500);
    expect(marker()).toBe('"live"');
  });

  test("a restore waits for running jobs, then works", async () => {
    let release = () => {};
    registerJob("t.h11", () => new Promise<void>((r) => (release = r)));
    run("UPDATE settings SET value = '\"snap\"' WHERE key = 'test.h11'");
    const snap = createBackup("manual");
    run("UPDATE settings SET value = '\"live\"' WHERE key = 'test.h11'");
    enqueue("t.h11");
    await Bun.sleep(20);
    expect(runningJobCount()).toBe(1);
    expect(status(() => restoreBackup(snap.file))).toBe(409);
    expect(marker()).toBe('"live"');
    release();
    await Bun.sleep(20);
    expect(status(() => restoreBackup(snap.file))).toBe(200);
    expect(marker()).toBe('"snap"');
  });
});

describe("H12 / M36: the image purge", () => {
  const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const age = () => run("UPDATE images SET created_at = ?", Date.now() - 3 * 24 * 3600_000);

  test("cast portraits survive; purged files wait in deleted/ and come back with a restore", async () => {
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "Hi." } });
    const chatId = createChat({ characterId: createCharacter(data) }).id;
    const portrait = await saveImage(PNG);
    saveCastProfile(chatId, "Tom", { avatarId: portrait });
    const loose = await saveImage(PNG);
    const looseFile = getImage(loose)!.file;
    const snap = createBackup("manual"); // still has the loose image's row
    age();
    expect(storageReport().reclaimable.images.count).toBe(1);
    purgeUnreferencedImages();
    expect(getImage(portrait)).toBeTruthy();
    expect(getImage(loose)).toBeUndefined();
    expect(existsSync(imagePath(looseFile))).toBe(false);
    expect(existsSync(join(deletedImagesDir(), looseFile))).toBe(true);

    restoreBackup(snap.file);
    expect(getImage(loose)).toBeTruthy();
    expect(existsSync(imagePath(looseFile))).toBe(true);
  });

  test("parked files are unlinked after the grace period; the mirror gets each image once", async () => {
    const id = await saveImage(PNG);
    const file = getImage(id)!.file;
    age();
    purgeUnreferencedImages();
    expect(sweepDeletedImages(0).removed).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(deletedImagesDir(), file))).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), "mea-mirror-"));
    const first = mirrorImages(dir);
    expect(first.copied).toBeGreaterThan(0);
    expect(readdirSync(join(dir, "images"))).not.toContain("deleted");
    expect(mirrorImages(dir).copied).toBe(0);
    expect(mirrorImages(dir, (b) => Buffer.concat([Buffer.from("x"), b])).copied).toBe(first.copied);
  });
});

describe("L5: long-running work", () => {
  test("chat export keeps each message's swipes and skips deleted messages", () => {
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", first_mes: "Hi." } });
    const chatId = createChat({ characterId: createCharacter(data) }).id;
    const a = addMessage(chatId, "assistant", "first");
    updateSwipe(a, addSwipe(a, "done"), { content: "second" });
    const gone = addMessage(chatId, "user", "deleted line");
    softDeleteMessage(gone);
    const lines = exportChatJsonl(chatId)!.trim().split("\n").map((l) => JSON.parse(l));
    const swiped = lines.find((l) => l.swipes);
    expect(swiped.swipes).toEqual(["first", "second"]);
    expect(swiped.mes).toBe("second");
    expect(lines.some((l) => l.mes === "deleted line")).toBe(false);
  });

  test("the hourly snapshot isn't retaken right after a restart", () => {
    createBackup("daily");
    const count = () => listBackups().length;
    const before = count();
    scheduledBackup();
    expect(count()).toBe(before);
    for (const b of listBackups()) utimesSync(join(paths.backups, b.file), new Date(Date.now() - 2 * 3600_000), new Date(Date.now() - 2 * 3600_000));
    scheduledBackup();
    expect(listBackups().some((b) => b.kind === "hourly")).toBe(true);
  });
});

describe("L17: retrying a job whose dedupe key is taken again", () => {
  test("is a no-op instead of a unique-index error", async () => {
    let release = () => {};
    registerJob("t.l17", () => new Promise<void>((r) => (release = r)));
    const failed = enqueue("t.l17", {}, { dedupeKey: "l17" })!;
    run("UPDATE jobs SET status = 'failed' WHERE id = ?", failed);
    const again = enqueue("t.l17", {}, { dedupeKey: "l17" });
    expect(again).toBeTruthy();
    expect(() => retryJob(failed)).not.toThrow();
    expect(one<{ status: string }>("SELECT status FROM jobs WHERE id = ?", failed)?.status).toBe("failed");
    release();
    await Bun.sleep(20);
  });
});

describe("L17: the chat list", () => {
  test("pages with limit/offset and lists the archive", async () => {
    const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Old", first_mes: "Hi." } });
    for (let i = 0; i < 4; i++) createChat({ characterId: createCharacter(data) });
    const all = (await api<{ chats: { id: string }[] }>("GET", "/api/chats?limit=500")).json.chats.map((c) => c.id);
    expect(all.length).toBeGreaterThanOrEqual(4);
    const page1 = (await api("GET", "/api/chats?limit=2")).json.chats.map((c: { id: string }) => c.id);
    const page2 = (await api("GET", "/api/chats?limit=2&offset=2")).json.chats.map((c: { id: string }) => c.id);
    expect([...page1, ...page2]).toEqual(all.slice(0, 4));
    const id = createChat({ characterId: createCharacter(data) }).id;
    await api("PATCH", `/api/chats/${id}`, { archived: true });
    expect((await api("GET", "/api/chats?limit=500")).json.chats.some((c: { id: string }) => c.id === id)).toBe(false);
    expect((await api("GET", "/api/chats?archived=1")).json.chats.some((c: { id: string }) => c.id === id)).toBe(true);
  });
});
