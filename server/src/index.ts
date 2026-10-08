import { createApp } from "./app";
import { config } from "./config";
import { closeDb, dbMode } from "./db/db";
import { persistVault, stopVaultTimer } from "./lib/vault";
import { stopJobs } from "./services/jobs";
import { startup } from "./startup";

startup();
const app = createApp();

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch: app.fetch,
  idleTimeout: 120,
});

console.log(`✿ Mea ${config.version} is running at http://${server.hostname}:${server.port}${config.dev ? " (dev mode)" : ""}`);
console.log(`  data: ${config.dataDir}`);

function shutdown() {
  console.log("Mea is shutting down…");
  stopJobs();
  server.stop();
  // SEC-05: the in-memory database goes back to disk, encrypted, before Mea stops.
  if (dbMode() === "memory") {
    try {
      persistVault(true);
    } catch (err) {
      console.error("[mea] couldn't save the encrypted database:", err);
    }
    stopVaultTimer();
  }
  closeDb();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
