import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unzipSync, strFromU8 } from "fflate";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { normalizeCard } from "../src/cards/card";
import { paths } from "../src/config";
import { all, closeDb, dbMode, newId, now, one, openDb, openDbFromBytes, run } from "../src/db/db";
import { subscribe, type MeaEvent } from "../src/lib/events";
import { putSecret } from "../src/lib/crypto";
import { redact, refreshRedaction } from "../src/lib/redact";
import { defaultMemoryConfig, setSetting } from "../src/lib/settings";
import { changeVaultPassphrase, disableVault, enableVault, isLocked, lockUntilUnlocked, persistVault, resetVaultState, unlockVault, vaultEnabled, vaultFile } from "../src/lib/vault";
import { createLorebook } from "../src/lore/service";
import { defaultEntry } from "../src/lore/types";
import { insertAtom } from "../src/memory/atoms";
import { buildSummary } from "../src/memory/build";
import { createEntity } from "../src/memory/entities";
import { endSceneAfter } from "../src/memory/scheduler";
import { levelRows } from "../src/memory/store";
import { exportMemory, queueMemoryImport, runMemoryImport } from "../src/memory/transfer";
import { createBackup, listBackups } from "../src/services/backup";
import { bookEpub, bookHtml, bookOutline } from "../src/services/book";
import { createCharacter } from "../src/services/characters";
import { addMessage, createChat, getMessage, setMessageFlags, updateChat } from "../src/services/chats";
import { createConnection, createProfile, syncModels } from "../src/services/connections";
import { previewPrompt, startStory } from "../src/services/generation";
import { imageFileFor, getImage, purgeUnreferencedImages, saveImage } from "../src/services/images";
import { registerJob } from "../src/services/jobs";
import { addHighlight, createNote, deleteNote, listNotes, markedMessageIds, moments, restoreNote } from "../src/services/notebook";
import { finishRequest, startRequest } from "../src/services/requests";
import { clean, storageReport, vacuum } from "../src/services/storage";
import { pruneGenerations } from "../src/services/usage";
import { freshDb } from "./helpers";

let charId = "";
let chatId = "";
const ids: string[] = [];

function waitFor(pred: (e: MeaEvent) => boolean, timeout = 8000) {
  return new Promise<MeaEvent>((resolve, reject) => {
    const t = setTimeout(() => (off(), reject(new Error("timed out"))), timeout);
    const off = subscribe((e) => {
      if (pred(e)) {
        clearTimeout(t);
        off();
        resolve(e);
      }
    });
  });
}

// A tiny valid PNG (1×1) and WebP header bytes for the image pipeline.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

beforeAll(async () => {
  freshDb();
  for (const kind of ["memory.segment", "memory.build", "memory.embed", "memory.journal", "memory.consolidate", "lore.chronicle", "accuracy.check", "accuracy.drift", "steer.edit", "memory.import", "quota.refresh", "cache.probe"]) registerJob(kind, async () => {});
  const connId = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
  await syncModels(connId);
  createProfile({ name: "Story", connectionId: connId, modelId: "mock/storyteller", params: { context_target: 6000, max_tokens: 400 } });
  setSetting("memory.config", { ...defaultMemoryConfig, boundaryCheck: false, verify: false, lag: 0 });
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Keeper of the lighthouse.", first_mes: "The lamp is lit." } });
  charId = createCharacter(data);
  chatId = createChat({ characterId: charId }).id;
  const lines = [
    "I knock on the lighthouse door.",
    "Mira opens it. *She smiles.* \"You came back.\" (OOC: love this scene)",
    "I step inside, shaking off the rain.",
    "\"Tea's on,\" she says. I promise to fix the lantern before winter.",
    "We climb to the lamp room.",
    "The lamp hums above them.",
  ];
  for (const [i, t] of lines.entries()) ids.push(addMessage(chatId, i % 2 ? "assistant" : "user", t, { name: i % 2 ? "Mira" : "Ash" }));
});

describe("the request log (SEC-06)", () => {
  test("keys and key-shaped strings are redacted", () => {
    putSecret("nano-SECRET-abcdef123456");
    refreshRedaction();
    expect(redact("error: bad key nano-SECRET-abcdef123456 given")).toBe("error: bad key [redacted key] given");
    expect(redact("Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345")).toContain("Bearer [redacted]");
    expect(redact('{"api_key":"hunter22hunter22"}')).toBe('{"api_key":"[redacted]"}');
    expect(redact("sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX")).toBe("[redacted key]");
  });
  test("each request leaves a line in the day's log, without its text; old bodies are pruned", () => {
    const conn = one<{ id: string }>("SELECT id FROM connections")!.id;
    const profile = one<{ id: string }>("SELECT id FROM profiles")!.id;
    const id = startRequest({ chatId, kind: "story", task: "story", resolved: { connection: { id: conn }, modelId: "mock/x", billing: "subscription", profile: { id: profile } }, request: { messages: [{ role: "user", content: "the secret story text" }] } });
    finishRequest(id, { status: "error", error: "upstream said nano-SECRET-abcdef123456 was wrong", usage: { promptTokens: 12, completionTokens: 3 } });
    expect(one<{ error: string }>("SELECT error FROM generations WHERE id = ?", id)?.error).toContain("[redacted key]");
    const day = new Date().toISOString().slice(0, 10);
    const log = readFileSync(join(paths.logs, `requests-${day}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const line = log.find((l) => l.id === id);
    expect(line).toMatchObject({ task: "story", status: "error", in: 12, out: 3 });
    expect(JSON.stringify(line)).not.toContain("secret story text");
    run("UPDATE generations SET started_at = ? WHERE id = ?", now() - 40 * 24 * 3600_000, id);
    pruneGenerations();
    expect(one<{ request: string | null }>("SELECT request FROM generations WHERE id = ?", id)?.request).toBeNull();
  });
});

describe("book export (DATA-04)", () => {
  beforeAll(async () => {
    endSceneAfter(chatId, ids[2]!);
  });
  test("chapters, scenes and clean prose", () => {
    run("UPDATE summaries SET title = 'The Return', story_time = 'Day 1, evening' WHERE chat_id = ? AND level = 'chapter'", chatId);
    const html = bookHtml(chatId, { clean: true, voices: "prose", includeUser: true });
    expect(html).toContain("<h2>The Return</h2>");
    expect(html).toContain("Day 1, evening");
    expect(html).toContain("<em>She smiles.</em>");
    expect(html).not.toContain("OOC");
    expect(html).toContain('class="user"');
    expect(html).toContain("⁂");
    expect(bookHtml(chatId, { clean: false, voices: "prose", includeUser: true })).toContain("OOC");
    expect(bookHtml(chatId, { clean: true, voices: "names", includeUser: false })).not.toContain("I knock on the lighthouse door");
    expect(bookHtml(chatId, { clean: true, voices: "prose", includeUser: true }, { print: true })).toContain("print()");
    expect(bookOutline(chatId, { clean: true, voices: "prose", includeUser: true }).chapters[0]).toMatchObject({ title: "The Return" });
  });
  test("a valid EPUB 3 package", () => {
    const zip = bookEpub(chatId, { clean: true, voices: "prose", includeUser: true });
    // The mimetype comes first, uncompressed.
    expect(strFromU8(zip.subarray(30, 38))).toBe("mimetype");
    const files = unzipSync(zip);
    expect(strFromU8(files.mimetype!)).toBe("application/epub+zip");
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["META-INF/container.xml", "OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/toc.ncx", "OEBPS/ch1.xhtml"]));
    const ch = strFromU8(files["OEBPS/ch1.xhtml"]!);
    expect(ch).toContain("<h2>The Return</h2>");
    expect(ch).not.toMatch(/<br>/);
  });
});

describe("memory export and import (DATA-05, PERF-11)", () => {
  test("round trip into a copy of the story, then merge without doubling", async () => {
    const scene = levelRows(chatId, "scene")[0]!;
    await buildSummary(scene.id);
    insertAtom(chatId, null, { type: "promise", content: "Ash promised to fix the lantern before winter.", importance: 8 }, [{ id: ids[3]!, seq: 4 }]);
    createEntity(chatId, { name: "Joss", kind: "person", description: "Runs the tavern." });
    createNote({ chatId, title: "Plans", body: "Ask about [[Joss]]." });
    addHighlight(ids[3]!, "Tea's on");
    const file = exportMemory(chatId);
    expect(file.format).toBe("mea-memory");
    expect(file.memories.find((m) => String((m as { content?: unknown }).content).includes("lantern"))?.sources).toEqual([4]);

    const copy = createChat({ characterId: charId }).id;
    run("DELETE FROM messages WHERE chat_id = ?", copy);
    for (const [i, t] of ["I knock.", "Mira opens.", "I step in.", "Tea's on.", "We climb.", "The lamp hums."].entries()) addMessage(copy, i % 2 ? "assistant" : "user", t, { name: i % 2 ? "Mira" : "Ash" });
    const q = queueMemoryImport(copy, JSON.stringify(file), "merge");
    expect(q.counts.memories).toBe(file.memories.length);
    const progress: number[] = [];
    const off = subscribe((e) => e.type === "import.progress" && e.chatId === copy && progress.push(e.done));
    const payload = one<{ payload: string }>("SELECT payload FROM jobs WHERE id = ?", q.jobId)!.payload;
    await runMemoryImport(JSON.parse(payload));
    off();
    expect(progress.length).toBeGreaterThan(0);
    const promise = one<{ id: string }>("SELECT id FROM memories WHERE chat_id = ? AND content LIKE '%lantern%'", copy)!;
    expect(all<{ seq: number }>("SELECT seq FROM memory_sources WHERE memory_id = ?", promise.id).map((r) => r.seq)).toEqual([4]);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM summaries WHERE chat_id = ?", copy)!.n).toBe(file.summaries.length);
    expect(one("SELECT 1 FROM entities WHERE chat_id = ? AND name = 'Joss'", copy)).toBeTruthy();
    expect(one("SELECT 1 FROM highlights WHERE chat_id = ?", copy)).toBeTruthy();
    // Merging the same file again adds nothing new.
    const before = one<{ n: number }>("SELECT COUNT(*) AS n FROM memories WHERE chat_id = ?", copy)!.n;
    const again = queueMemoryImport(copy, JSON.stringify(file), "merge");
    await runMemoryImport(JSON.parse(one<{ payload: string }>("SELECT payload FROM jobs WHERE id = ?", again.jobId)!.payload));
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM memories WHERE chat_id = ?", copy)!.n).toBe(before);
    expect(() => queueMemoryImport(copy, '{"hello": 1}', "merge")).toThrow();
  });
});

describe("storage (DATA-06)", () => {
  test("sizes, reclaimable space, clean-ups", () => {
    const r = storageReport();
    expect(r.chats.find((c) => c.id === chatId)?.messages).toBeGreaterThan(0);
    expect(r.characters.find((c) => c.id === charId)?.chats).toBeGreaterThan(0);
    expect(r.reclaimable).toHaveProperty("freePages");
    expect(clean("requestBodies")).toHaveProperty("removed");
    expect(vacuum()).toHaveProperty("saved");
  });
});

describe("images (PERF-08)", () => {
  test("sizes are kept and picked; covers and variant portraits survive the purge", async () => {
    const id = await saveImage(PNG, { thumb: WEBP, variants: { s: WEBP, l: WEBP } });
    const img = getImage(id)!;
    expect(imageFileFor(img, "s").file).toContain(".s.webp");
    expect(imageFileFor(img, "l").file).toContain(".l.webp");
    expect(imageFileFor(img, "m").file).toContain(".thumb.webp");
    expect(imageFileFor(img, null).original).toBe(true);
    // A chat cover and a variant portrait are in use, even with no character pointing at them.
    const cover = await saveImage(PNG);
    const portrait = await saveImage(PNG);
    run("UPDATE chats SET cover_image_id = ? WHERE id = ?", cover, chatId);
    run("INSERT INTO variants (id, owner_type, owner_id, name, avatar_id, created_at, updated_at) VALUES (?, 'character', ?, 'Winter', ?, ?, ?)", newId(), charId, portrait, now(), now());
    run("UPDATE images SET created_at = ?", now() - 3 * 24 * 3600_000);
    purgeUnreferencedImages();
    expect(getImage(cover)).toBeTruthy();
    expect(getImage(portrait)).toBeTruthy();
    expect(getImage(id)).toBeUndefined();
  });
});

describe("timing (PERF-10)", () => {
  test("the stages before the request, and speed after it", async () => {
    const p = await previewPrompt(chatId);
    const t = (p.trace as unknown as { timing: Record<string, number> }).timing;
    expect(t.totalMs).toBeGreaterThanOrEqual(0);
    expect(Object.keys(t)).toEqual(expect.arrayContaining(["trackersMs", "retrievalMs", "loreMs", "advisorMs", "assemblyMs"]));
    addMessage(chatId, "user", "What's for supper?", { name: "Ash" });
    const ended = waitFor((e) => e.type === "gen.end" && "chatId" in e && e.chatId === chatId);
    const r = await startStory(chatId, "new");
    await ended;
    const timing = getMessage(r.messageId)?.meta.timing as Record<string, number | null>;
    expect(timing.ttftMs).not.toBeNull();
    expect(timing).toHaveProperty("tokensPerSec");
    expect(timing).toHaveProperty("retrievalMs");
  });
});

describe("notebook and best moments (QOL-01, QOL-02)", () => {
  test("[[links]] go to the Codex or the lorebook", () => {
    createLorebook({ name: "Port", entries: [defaultEntry({ comment: "The Gull Inn", keys: ["Gull Inn"], content: "A tavern." })] });
    const n = createNote({ chatId, title: "Ideas", body: "Meet [[Joss]] at [[Gull Inn]], then [[Nobody]]." });
    expect(n.links.map((l) => l.kind)).toEqual(["entity", "lore", "missing"]);
    expect(n.links[0]!.href).toContain(`/chat/${chatId}/codex?entity=`);
    const global = createNote({ title: "Everywhere", body: "A global idea." });
    expect(listNotes({ chatId }).map((x) => x.id)).toEqual(expect.arrayContaining([n.id, global.id]));
    expect(listNotes({ chatId, scope: "chat" }).some((x) => x.id === global.id)).toBe(false);
    deleteNote(n.id);
    expect(listNotes({ chatId }).some((x) => x.id === n.id)).toBe(false);
    restoreNote(n.id);
    expect(listNotes({ chatId }).some((x) => x.id === n.id)).toBe(true);
  });
  test("bookmarks and highlights make the reel and count in memory", async () => {
    setMessageFlags(ids[1]!, { bookmarked: true });
    const reel = moments({ chatId });
    expect(reel.map((m) => m.kind)).toEqual(expect.arrayContaining(["bookmark", "highlight"]));
    expect(reel.map((m) => m.seq)).toEqual([...reel.map((m) => m.seq)].sort((a, b) => a - b));
    expect(markedMessageIds(chatId).has(ids[1]!)).toBe(true);
    // The scene summarizer is told which moments you marked.
    const scene = levelRows(chatId, "scene")[0]!;
    await buildSummary(scene.id);
    const req = one<{ request: string }>("SELECT request FROM generations WHERE chat_id = ? AND kind = 'scene' ORDER BY started_at DESC LIMIT 1", chatId)!.request;
    expect(req).toContain("favourite moments");
  });
});

describe("encryption at rest (SEC-05)", () => {
  const plain = paths.db;
  afterAll(() => {
    resetVaultState();
    closeDb();
    for (const f of [plain, `${plain}-wal`, `${plain}-shm`, vaultFile]) if (existsSync(f)) unlinkSync(f);
    for (const f of readdirSync(paths.backups)) unlinkSync(join(paths.backups, f));
    freshDb();
  });
  test("on, locked after a restart, unlocked, off again", async () => {
    resetVaultState();
    openDb(plain);
    run("INSERT INTO settings (key, value) VALUES ('test.vault', '\"kept\"')");
    createBackup("manual");
    expect(listBackups().some((b) => !b.encrypted)).toBe(true);
    const r = enableVault("correct horse battery");
    expect(r.backupsEncrypted).toBeGreaterThan(0);
    expect(dbMode()).toBe("memory");
    expect(existsSync(plain)).toBe(false);
    expect(existsSync(vaultFile)).toBe(true);
    expect(readFileSync(vaultFile).includes(Buffer.from("test.vault"))).toBe(false);
    expect(listBackups().every((b) => b.encrypted)).toBe(true);
    run("INSERT INTO settings (key, value) VALUES ('test.after', '\"saved\"')");
    expect(persistVault()).toBe(true);
    expect(createBackup("manual").file.endsWith(".db.enc")).toBe(true);

    // Restart: Mea starts locked and waits for the passphrase.
    resetVaultState();
    closeDb();
    expect(vaultEnabled()).toBe(true);
    let opened = false;
    lockUntilUnlocked((bytes) => {
      openDbFromBytes(bytes);
      opened = true;
    });
    expect(isLocked()).toBe(true);
    expect(() => unlockVault("wrong passphrase")).toThrow("doesn't open");
    unlockVault("correct horse battery");
    expect(opened).toBe(true);
    expect(isLocked()).toBe(false);
    expect(one<{ value: string }>("SELECT value FROM settings WHERE key = 'test.after'")?.value).toBe('"saved"');

    changeVaultPassphrase("correct horse battery", "a brand new passphrase");
    expect(() => disableVault("correct horse battery")).toThrow();
    disableVault("a brand new passphrase");
    expect(dbMode()).toBe("file");
    expect(existsSync(vaultFile)).toBe(false);
    expect(one<{ value: string }>("SELECT value FROM settings WHERE key = 'test.vault'")?.value).toBe('"kept"');
    expect(listBackups().every((b) => !b.encrypted)).toBe(true);
  });
});

describe("undo for deletes (QOL-05)", () => {
  test("a deleted connection comes back with its key, its models and its profiles' link", async () => {
    const { stash, restoreStash } = await import("../src/services/undo");
    const { deleteConnection, getConnectionRow } = await import("../src/services/connections");
    const conn = createConnection({ name: "Spare", kind: "mock", billing: "subscription", apiKey: "spare-key-1234567890" });
    await syncModels(conn);
    const prof = createProfile({ name: "Spare story", connectionId: conn, modelId: "mock/storyteller", params: {} });
    const secret = getConnectionRow(conn)!.secret_id!;
    const token = stash("Connection", [
      { table: "secrets", where: "id = ?", params: [secret] },
      { table: "connections", where: "id = ?", params: [conn] },
      { table: "models", where: "connection_id = ?", params: [conn] },
      { table: "profiles", where: "connection_id = ?", params: [conn] },
    ]);
    deleteConnection(conn);
    expect(getConnectionRow(conn)).toBeUndefined();
    expect(one<{ connection_id: string | null }>("SELECT connection_id FROM profiles WHERE id = ?", prof)?.connection_id).toBeNull();
    restoreStash(token);
    expect(getConnectionRow(conn)?.secret_id).toBe(secret);
    expect(one<{ connection_id: string | null }>("SELECT connection_id FROM profiles WHERE id = ?", prof)?.connection_id).toBe(conn);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM models WHERE connection_id = ?", conn)!.n).toBeGreaterThan(0);
    expect(() => restoreStash(token)).toThrow("too late");
  });
});
