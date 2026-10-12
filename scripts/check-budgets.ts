/**
 * Performance budgets (PERF-01): the JS and CSS needed for first load must stay small.
 * Reads web/dist/index.html (or MEA_WEB_DIST), follows its scripts, styles and modulepreloads, and gzips them.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const dist = resolve(process.env.MEA_WEB_DIST ?? resolve(import.meta.dir, "../web/dist"));
const html = readFileSync(join(dist, "index.html"), "utf8");
const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]!);

const BUDGET_JS = 250 * 1024;
// Raised from 60 KB for the visual toolkit (styles/vtk.css), which has to be there on first paint.
const BUDGET_CSS = 72 * 1024;
let js = 0;
let css = 0;
for (const ref of new Set(refs)) {
  const size = gzipSync(readFileSync(join(dist, ref))).length;
  if (ref.endsWith(".js")) js += size;
  else css += size;
  console.log(`${(size / 1024).toFixed(1).padStart(7)} KB gz  ${ref}`);
}
console.log(`\nInitial JS:  ${(js / 1024).toFixed(1)} KB gz (budget ${BUDGET_JS / 1024} KB)`);
console.log(`Initial CSS: ${(css / 1024).toFixed(1)} KB gz (budget ${BUDGET_CSS / 1024} KB)`);
if (js > BUDGET_JS || css > BUDGET_CSS) {
  console.error("Over budget ✗");
  process.exit(1);
}
console.log("Within budget ✿");
