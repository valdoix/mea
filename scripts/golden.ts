/**
 * K1: the golden scenarios as a pass/fail board, on the mock provider in a throwaway database
 * (free; CI runs it). For a real model, use Settings › Status › Run story checks in the app.
 *
 *   bun run golden
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MEA_DATA_DIR = mkdtempSync(join(tmpdir(), "mea-golden-"));
process.env.MEA_DEV = "1";
process.env.MEA_MOCK_DELAY = "0";
process.env.MEA_OFFLINE = "1";

const { randomBytes } = await import("node:crypto");
const { ensureDirs } = await import("../server/src/config");
const { openDb } = await import("../server/src/db/db");
const { setMasterKey } = await import("../server/src/lib/crypto");
const { defaultMemoryConfig, setSetting } = await import("../server/src/lib/settings");
const { createConnection, createProfile, syncModels } = await import("../server/src/services/connections");
const { pauseJobs } = await import("../server/src/services/jobs");
const { runGolden } = await import("../server/src/golden/run");

ensureDirs();
setMasterKey(randomBytes(32));
openDb(":memory:");
pauseJobs(true);
const conn = createConnection({ name: "Mock", kind: "mock", billing: "subscription" });
await syncModels(conn);
createProfile({ name: "Story", connectionId: conn, modelId: "mock/storyteller", params: { context_target: 12000, max_tokens: 300 } });
setSetting("memory.config", { ...defaultMemoryConfig, checkerModel: false });

const r = await runGolden();
for (const s of r.results) {
  console.log(`${s.pass ? "✓" : "✗"} ${s.name} — ${s.about}`);
  for (const c of s.checks.filter((x) => !x.pass)) console.log(`    ✗ ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
}
const failed = r.results.filter((s) => !s.pass).length;
console.log(failed ? `\n${failed} of ${r.results.length} scenarios failed` : `\nAll ${r.results.length} scenarios pass ✿`);
process.exit(failed ? 1 : 0);
