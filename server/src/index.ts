import { createApp } from "./app";
import { config } from "./config";
import { closeDb } from "./db/db";
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
  closeDb();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
