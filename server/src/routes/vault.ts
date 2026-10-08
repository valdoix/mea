import { Hono } from "hono";
import { z } from "zod";
import { body } from "../lib/http";
import { changeVaultPassphrase, disableVault, enableVault, isLocked, unlockVault, vaultEnabled } from "../lib/vault";

/** Database encryption at rest (SEC-05): status, unlock, and switching it on or off. */
export const vault = new Hono();

const pass = z.string().min(1).max(500);

vault.get("/vault/status", (c) => c.json({ enabled: vaultEnabled(), locked: isLocked() }));

/** Works while locked (it's how you get in); slowed after a few wrong tries. */
vault.post("/vault/unlock", async (c) => {
  const input = await body(c, z.object({ passphrase: pass }));
  return c.json(unlockVault(input.passphrase));
});

vault.post("/vault/enable", async (c) => {
  const input = await body(c, z.object({ passphrase: pass }));
  return c.json(enableVault(input.passphrase));
});

vault.post("/vault/disable", async (c) => {
  const input = await body(c, z.object({ passphrase: pass }));
  return c.json(disableVault(input.passphrase));
});

vault.post("/vault/passphrase", async (c) => {
  const input = await body(c, z.object({ current: pass, next: pass }));
  return c.json(changeVaultPassphrase(input.current, input.next));
});
