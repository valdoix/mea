import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "../src/config";
import { all, one, openDb, run } from "../src/db/db";
import { createBackup, listBackups, restoreBackup } from "../src/services/backup";
import { enqueue, registerJob, startJobs, stopJobs } from "../src/services/jobs";
import { freshDb } from "./helpers";
import { getSecret, putSecret } from "../src/lib/crypto";

describe("secrets", () => {
  test("API keys are encrypted at rest", () => {
    freshDb();
    const id = putSecret("sk-very-secret");
    const row = one<{ ciphertext: Uint8Array }>("SELECT ciphertext FROM secrets WHERE id = ?", id)!;
    expect(Buffer.from(row.ciphertext).toString("utf8")).not.toContain("sk-very-secret");
    expect(getSecret(id)).toBe("sk-very-secret");
  });
});

describe("jobs", () => {
  test("runs, retries, and dedupes", async () => {
    freshDb();
    let runs = 0;
    let flaky = 0;
    registerJob("t.ok", async () => {
      runs++;
    });
    registerJob("t.flaky", async () => {
      flaky++;
      if (flaky < 2) throw new Error("first try fails");
    });
    enqueue("t.ok", {}, { dedupeKey: "same" });
    expect(enqueue("t.ok", {}, { dedupeKey: "same" })).toBeNull();
    enqueue("t.flaky", {}, { maxAttempts: 3 });
    startJobs();
    await Bun.sleep(200);
    expect(runs).toBe(1);
    expect(flaky).toBe(1);
    // the retry is scheduled with backoff; pull it forward
    run("UPDATE jobs SET run_after = 0 WHERE status = 'queued'");
    await Bun.sleep(1300);
    stopJobs();
    expect(flaky).toBe(2);
    expect(all<{ status: string }>("SELECT status FROM jobs").every((j) => j.status === "done")).toBe(true);
  });
});

describe("backups", () => {
  test("snapshot and restore", () => {
    openDb(paths.db);
    run("INSERT INTO settings (key, value) VALUES ('test.marker', '\"before\"') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    const b = createBackup("manual");
    expect(existsSync(join(paths.backups, b.file))).toBe(true);
    run("UPDATE settings SET value = '\"after\"' WHERE key = 'test.marker'");
    restoreBackup(b.file);
    expect(one<{ value: string }>("SELECT value FROM settings WHERE key = 'test.marker'")?.value).toBe('"before"');
    expect(listBackups().some((x) => x.kind === "pre-restore")).toBe(true);
    expect(() => restoreBackup("../evil.db")).toThrow();
  });
});
