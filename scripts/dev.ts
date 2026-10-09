/** Runs the API server (with mock provider enabled) and the Vite dev server together. */
// Development uses its own data folder so real stories in ./data are never touched.
const env = { ...process.env, MEA_DEV: "1", MEA_DATA_DIR: process.env.MEA_DATA_DIR ?? "data-dev" };
const procs = [
  Bun.spawn(["bun", "--watch", "server/src/index.ts"], { env, stdout: "inherit", stderr: "inherit" }),
  // MEA_WEB_PORT runs a second copy next to one already on 5173 (pair it with MEA_PORT and MEA_DATA_DIR).
  Bun.spawn(["bunx", "vite", "--config", "web/vite.config.ts", ...(process.env.MEA_WEB_PORT ? ["--port", process.env.MEA_WEB_PORT] : [])], { env, stdout: "inherit", stderr: "inherit" }),
];

function stop() {
  for (const p of procs) p.kill();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race(procs.map((p) => p.exited));
stop();
