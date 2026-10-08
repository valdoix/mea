import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const dataDir = resolve(process.env.MEA_DATA_DIR ?? join(root, "data"));

export const config = {
  root,
  dataDir,
  port: Number(process.env.MEA_PORT ?? 7766),
  /** Localhost-only by default (SEC-02). Remote devices come in through Tailscale Serve. */
  host: process.env.MEA_HOST ?? "127.0.0.1",
  /** Enables the mock provider and other developer conveniences. */
  dev: process.env.MEA_DEV === "1",
  webDist: resolve(process.env.MEA_WEB_DIST ?? join(root, "web", "dist")),
  version: "0.1.0",
};

export const paths = {
  db: join(dataDir, "mea.db"),
  images: join(dataDir, "images"),
  backups: join(dataDir, "backups"),
  keyFile: join(dataDir, "mea.key"),
  logs: join(dataDir, "logs"),
};

export function ensureDirs() {
  for (const dir of [paths.images, paths.backups, paths.logs]) mkdirSync(dir, { recursive: true });
}
