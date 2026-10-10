import { createApp } from "./app";
import { onShutdown } from "./lib/lifecycle";
import { config } from "./config";
import { closeDb, dbMode } from "./db/db";
import { persistVault, stopVaultTimer } from "./lib/vault";
import { markPublic } from "./services/auth";
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

// The tunnel's door (ngrok forwards here). Same app, but no request on it counts as the host computer.
let publicServer: ReturnType<typeof Bun.serve> | null = null;
if (config.publicPort) {
  try {
    publicServer = Bun.serve({
      hostname: "127.0.0.1",
      port: config.publicPort,
      fetch(req, srv) {
        markPublic(req);
        return app.fetch(req, srv);
      },
      idleTimeout: 120,
    });
  } catch (err) {
    console.error(`[mea] couldn't open the tunnel port ${config.publicPort}:`, (err as Error).message);
  }
}

console.log(`✿ Mea ${config.version} is running at http://${server.hostname}:${server.port}${config.dev ? " (dev mode)" : ""}`);
console.log(`  data: ${config.dataDir}`);
if (publicServer) console.log(`  tunnel port: ${publicServer.port} (paired devices only)`);

function shutdown() {
  console.log("Mea is shutting down…");
  stopJobs();
  server.stop();
  publicServer?.stop();
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
onShutdown(shutdown);

// One failed background task must never take Mea down for every device (Bun exits on these by default).
process.on("unhandledRejection", (err) => console.error("[mea] unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("[mea] uncaught exception:", err));
