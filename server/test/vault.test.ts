import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "../src/config";
import { closeDb, one, openDb, openDbFromBytes, run } from "../src/db/db";
import { disableVault, enableVault, lockUntilUnlocked, persistVault, resetVaultState, unlockVault, vaultFile } from "../src/lib/vault";
import { freshDb } from "./helpers";

const plain = paths.db;
const prev = `${vaultFile}.prev`;

afterAll(() => {
  resetVaultState();
  closeDb();
  for (const f of [plain, `${plain}-wal`, `${plain}-shm`, vaultFile, prev]) if (existsSync(f)) unlinkSync(f);
  for (const f of readdirSync(paths.backups)) unlinkSync(join(paths.backups, f));
  freshDb();
});

function restart() {
  resetVaultState();
  closeDb();
  lockUntilUnlocked((bytes) => openDbFromBytes(bytes));
}

describe("encrypted database durability (SEC-05)", () => {
  test("a damaged file falls back to the previous copy; remote guesses don't lock the host out", () => {
    freshDb();
    resetVaultState();
    openDb(plain);
    enableVault("correct horse battery");
    run("INSERT INTO settings (key, value) VALUES ('test.first', '1')");
    persistVault(true);
    run("INSERT INTO settings (key, value) VALUES ('test.second', '2')");
    persistVault(true);
    expect(existsSync(prev)).toBe(true);

    // A power cut left the newest file torn.
    writeFileSync(vaultFile, Buffer.from("MEA1 torn"));
    restart();
    for (let i = 0; i < 5; i++) expect(() => unlockVault("guess", false)).toThrow();
    expect(() => unlockVault("guess", false)).toThrow("Too many tries");
    unlockVault("correct horse battery", true);
    expect(one<{ value: string }>("SELECT value FROM settings WHERE key = 'test.first'")?.value).toBe("1");

    disableVault("correct horse battery");
    expect(existsSync(prev)).toBe(false);
  });
});
