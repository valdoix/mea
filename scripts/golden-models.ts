/**
 * docs/29 Part 2: the golden scenarios on several real models, one run per family, so each
 * adapter starts from a measured baseline. Every reply also goes through the tell census.
 *
 *   bun scripts/golden-models.ts [--db path/to/mea.db] [--models "z-ai/glm-5.3@NanoGPT · Subscription,…"] [--out report.md] [--keep run.db] [--go]
 *
 * Without --go it only reads: it prints each model, the connection it would use, whether that's your
 * subscription or pay-as-you-go, and the estimated price. Nothing is sent. With --go each model
 * writes the scenarios' replies for real. Your connections and keys are read from your database
 * and used in a throwaway in-memory one: your chats, profiles and settings are never touched.
 * --keep saves that throwaway database when the run ends (its requests, replies and errors), so a
 * run that went wrong can be looked into without paying for it again. It holds your keys, encrypted.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";

const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const GO = args.includes("--go");

const source = resolve(opt("--db") ?? join(import.meta.dir, "..", "data", "mea.db"));
const keyFile = join(dirname(source), "mea.key");
if (!existsSync(source) || !existsSync(keyFile)) {
  console.error(`Need ${source} and its key file ${keyFile}`);
  process.exit(2);
}

/** One per family: the route you already use where there is one. */
const DEFAULT_TARGETS = [
  "z-ai/glm-5.3@NanoGPT · Planner",
  "[SP]claude-opus-5-5@LinkAPI",
  "google/gemini-4-argon@Nano PAYG",
  "deepseek/deepseek-latest@NanoGPT · Planner",
  "moonshotai/kimi-k3.1-pro@Nano PAYG",
];
const targets = (opt("--models")?.split(",") ?? DEFAULT_TARGETS).map((t) => {
  const at = t.lastIndexOf("@");
  return at > 0 ? { model: t.slice(0, at).trim(), connection: t.slice(at + 1).trim() } : { model: t.trim(), connection: "" };
});

// ---------- read your connections (read-only) ----------

type Row = Record<string, unknown>;
const src = new Database(source, { readonly: true });
const connections = src.query<Row, []>("SELECT * FROM connections").all();
const modelRows = src.query<Row, []>("SELECT * FROM models").all();
const secrets = src.query<Row, []>("SELECT * FROM secrets").all();
src.close();

interface Route {
  model: string;
  conn: Row;
  modelRow: Row;
  subscription: boolean;
  price: { prompt: number; completion: number } | null;
}

/** NanoGPT's public price list, for models whose catalog entry has none. */
let publicPrices: Map<string, { prompt: number; completion: number }> | null = null;
async function nanoPrice(model: string) {
  if (!publicPrices) {
    publicPrices = new Map();
    try {
      const j = (await (await fetch("https://nano-gpt.com/api/v1/models?detailed=true", { signal: AbortSignal.timeout(30_000) })).json()) as { data?: { id: string; pricing?: { prompt?: number; completion?: number } }[] };
      for (const m of j.data ?? []) if (m.pricing?.prompt != null && m.pricing.completion != null) publicPrices.set(m.id, { prompt: m.pricing.prompt, completion: m.pricing.completion });
    } catch {
      /* no list: the price stays unknown */
    }
  }
  return publicPrices.get(model) ?? null;
}

async function routeFor(t: { model: string; connection: string }): Promise<Route | string> {
  const conns = connections.filter((c) => !t.connection || String(c.name) === t.connection);
  if (!conns.length) return `no connection named "${t.connection}"`;
  for (const conn of conns) {
    const modelRow = modelRows.find((m) => m.connection_id === conn.id && m.model_id === t.model);
    if (!modelRow) continue;
    if (!conn.secret_id && conn.kind !== "mock") return `"${conn.name}" has no key`;
    // Only a key you marked subscription-only counts as free: one with billing unset might pay.
    const subscription = conn.billing === "subscription" && Number(modelRow.subscription) === 1;
    const listed = JSON.parse(String(modelRow.pricing || "{}")) as { prompt?: number; completion?: number };
    const price = listed.prompt != null && listed.completion != null ? { prompt: listed.prompt, completion: listed.completion } : /nano-gpt/.test(String(conn.base_url)) ? await nanoPrice(t.model) : null;
    return { model: t.model, conn, modelRow, subscription, price };
  }
  return `no connection${t.connection ? ` "${t.connection}"` : ""} lists ${t.model}`;
}

// ---------- the estimate ----------

/** Measured on the mock provider (docs/29 Part 2): 16 story replies of ~8.5k prompt tokens, 5 planner calls of ~1.4k. */
const STORY = { calls: 16, prompt: 8_500 };
const PLANNER = { calls: 5, prompt: 1_400, completion: 600 };
/** Reply tokens, thinking included, from your own history (Claude ~2.4k, GLM ~1.1k); others assumed 2k. */
const completionFor = (model: string) => (/claude/i.test(model) ? 2_400 : /glm/i.test(model) ? 1_100 : 2_000);
/** Plan-watch retries and swipes the pipeline makes on its own. */
const RETRIES = 1.3;

function estimate(r: Route) {
  const tin = (STORY.calls * STORY.prompt + PLANNER.calls * PLANNER.prompt) * RETRIES;
  const tout = (STORY.calls * completionFor(r.model) + PLANNER.calls * PLANNER.completion) * RETRIES;
  const usd = r.subscription ? 0 : r.price ? (tin * r.price.prompt + tout * r.price.completion) / 1e6 : null;
  return { tin: Math.round(tin), tout: Math.round(tout), usd };
}

const routes: Route[] = [];
console.log(`${GO ? "Running" : "Dry run (nothing is sent)"}: golden scenarios with a real model, one run per model\n`);
console.log("| Model | Connection | Billing | Price per M (in / out) | Tokens (in / out) | Estimate |");
console.log("|---|---|---|---|---|---:|");
let total = 0;
let unknown = false;
for (const t of targets) {
  const r = await routeFor(t);
  if (typeof r === "string") {
    console.log(`| ${t.model} | — | — | — | — | skipped: ${r} |`);
    continue;
  }
  routes.push(r);
  const e = estimate(r);
  if (e.usd == null) unknown = true;
  else total += e.usd;
  console.log(`| ${r.model} | ${r.conn.name} | ${r.subscription ? "subscription" : String(r.conn.billing)} | ${r.price ? `$${r.price.prompt} / $${r.price.completion}` : "unknown"} | ${Math.round(e.tin / 1000)}k / ${Math.round(e.tout / 1000)}k | ${r.subscription ? "$0 (subscription)" : e.usd == null ? "unknown" : `≈ $${e.usd.toFixed(2)}`} |`);
}
console.log(`\nEstimated total: ≈ $${total.toFixed(2)}${unknown ? " plus the routes with an unknown price" : ""}. Retries are budgeted at ×${RETRIES}; a run that retries every reply costs up to ×2.`);
if (!GO) {
  console.log("Nothing was sent. Add --go to run it.");
  process.exit(0);
}

// ---------- the run (throwaway database, your connections and keys) ----------

process.env.MEA_DATA_DIR = mkdtempSync(join(tmpdir(), "mea-golden-models-"));
process.env.MEA_MOCK_DELAY = "0";
const { ensureDirs } = await import("../server/src/config");
const { all, openDb, run } = await import("../server/src/db/db");
const { setMasterKey } = await import("../server/src/lib/crypto");
const { defaultMemoryConfig, setSetting } = await import("../server/src/lib/settings");
const { createProfile } = await import("../server/src/services/connections");
const { pauseJobs } = await import("../server/src/services/jobs");
const { runGolden } = await import("../server/src/golden/run");
const { census, censusReport } = await import("../server/src/steer/census");

ensureDirs();
setMasterKey(Buffer.from(readFileSync(keyFile, "utf8").trim(), "base64"));
openDb(":memory:");
pauseJobs(true);
setSetting("memory.config", { ...defaultMemoryConfig, checkerModel: false });

/** Copies a row into the throwaway database, keeping only the columns its schema has. */
function copy(table: string, row: Row) {
  const cols = new Set(all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));
  const keys = Object.keys(row).filter((k) => cols.has(k));
  run(`INSERT OR IGNORE INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...keys.map((k) => row[k] as never));
}

const out: string[] = ["# Golden baseline by model", "", `Preset v${(await import("../server/src/prompt/mea")).MEA_PRESET_VERSION}, ${new Date().toISOString().slice(0, 10)}.`, ""];
const board: string[] = ["| Model | Scenarios passed | Requests | Tokens in / out | Cost reported |", "|---|---:|---:|---|---:|"];
/** Scenarios that steer the mock's own planner (MOCK_PLANNER_FAIL, a scripted plan): a real model can't pass them. */
const MOCK_ONLY = new Set(["planner-fallback", "already-said"]);
const failures: string[] = [];
const requests: string[] = [];
const replies: { chatId: string; modelId: string; content: string; reasoning: string }[] = [];

for (const r of routes) {
  const secret = secrets.find((s) => s.id === r.conn.secret_id);
  if (secret) copy("secrets", secret);
  copy("connections", r.conn);
  copy("models", r.modelRow);
  const id = createProfile({ name: `Golden · ${r.model}`, connectionId: String(r.conn.id), modelId: r.model, params: { context_target: 48_000, max_tokens: 2_200 } });
  setSetting("routing.story", id);
  const started = Date.now();
  console.log(`\n${r.model}: running…`);
  const g = await runGolden({ model: true });
  const used = all<{ n: number; pin: number; pout: number; cost: number | null }>(
    "SELECT COUNT(*) n, COALESCE(SUM(prompt_tokens), 0) pin, COALESCE(SUM(completion_tokens), 0) pout, SUM(cost) cost FROM generations WHERE started_at >= ?",
    started,
  )[0]!;
  const real = g.results.filter((x) => !MOCK_ONLY.has(x.name));
  const passed = real.filter((x) => x.pass).length;
  board.push(`| ${r.model} | ${passed} / ${real.length} | ${used.n} | ${Math.round(used.pin / 1000)}k / ${Math.round(used.pout / 1000)}k | ${used.cost != null ? `$${used.cost.toFixed(2)}` : "—"} |`);
  for (const s of real.filter((x) => !x.pass)) failures.push(`- **${r.model}** · ${s.name}: ${s.checks.filter((c) => !c.pass).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`).join("; ")}`);
  for (const w of all<{ chat_id: string; content: string; reasoning: string | null }>(
    `SELECT m.chat_id, s.content, s.reasoning FROM swipes s JOIN messages m ON m.id = s.message_id
      WHERE m.role = 'assistant' AND s.status = 'done' AND s.content != '' AND s.created_at >= ? AND json_extract(s.meta, '$.model') = ?`,
    started,
    r.model,
  ))
    replies.push({ chatId: w.chat_id, modelId: r.model, content: w.content, reasoning: w.reasoning ?? "" });
  // Where the requests went (a retry shows up as "retried" or "replaced"), and what the pipeline noted on each reply.
  const kinds = all<{ task: string; kind: string; status: string; n: number }>(
    "SELECT task, kind, status, COUNT(*) n FROM generations WHERE started_at >= ? GROUP BY task, kind, status ORDER BY n DESC",
    started,
  );
  requests.push(`- **${r.model}**: ${kinds.map((k) => `${k.task}/${k.kind} ${k.status} ×${k.n}`).join(", ")}`);
  const noted = new Map<string, number>();
  for (const m of all<{ meta: string }>("SELECT meta FROM swipes WHERE created_at >= ?", started))
    for (const n of (JSON.parse(m.meta || "{}") as { notes?: string[] }).notes ?? []) noted.set(n, (noted.get(n) ?? 0) + 1);
  if (noted.size) requests.push(...[...noted].sort((a, b) => b[1] - a[1]).map(([n, c]) => `  - ${n} ×${c}`));
  console.log(`${r.model}: ${passed} / ${real.length} scenarios, ${used.n} requests`);
}

out.push(...board, "", `Left out: ${[...MOCK_ONLY].join(", ")} (they steer the mock's planner, so only the mock can pass them).`, "", "## Where the requests went", "", ...requests, "");
if (failures.length) out.push("## Failed checks", "", ...failures, "");
out.push(censusReport(census(replies), { minReplies: 10, title: "Tell census of these replies" }).replace(/^# /, "## "));
const report = out.join("\n");
const keep = opt("--keep");
if (keep) {
  run("VACUUM INTO ?", keep);
  console.log(`Kept the run's database in ${keep}`);
}
const file = opt("--out");
if (file) {
  writeFileSync(file, `${report}\n`);
  console.log(`\nWrote ${file}`);
} else console.log(`\n${report}`);
process.exit(0);
