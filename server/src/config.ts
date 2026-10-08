import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** True inside the compiled mea.exe (ARCH-14): source paths then point into Bun's virtual filesystem. */
export const compiled = /\$bunfs|~BUN/.test(import.meta.dir);
/** Repo root from source; the exe's own folder when compiled, so data sits next to mea.exe. */
const root = compiled ? dirname(process.execPath) : resolve(import.meta.dir, "../..");
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
