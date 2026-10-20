<script lang="ts">
  import { get, post } from "../../lib/api";
  import { Gauge, RefreshCw } from "../../lib/icons";
  import { errorToast } from "../../lib/state.svelte";

  type Task = "story" | "summarizer" | "helper" | "tracker" | "world" | "assistant" | "planner";
  interface Stats {
    n: number;
    firstWord: number | null;
    tokensPerSec: number | null;
    errorRate: number;
  }
  interface Route {
    connectionId: string;
    connectionName: string;
    modelId: string;
    tasks: Task[];
    recent: Stats;
    usual: Stats;
    verdict: "normal" | "slow" | "very slow" | "failing" | "unknown";
  }
  interface Test {
    connectionId: string;
    modelId: string;
    ok: boolean;
    error?: string;
    firstByte: number | null;
    firstWord: number | null;
    tokensPerSec: number | null;
    total: number;
    tokens: number;
  }

  const taskLabel: Record<Task, string> = {
    story: "story",
    summarizer: "memory and studios",
    helper: "helper checks",
    tracker: "trackers",
    world: "world",
    planner: "planner",
    assistant: "Meus",
  };

  let routes = $state<Route[] | null>(null);
  let tests = $state<Record<string, Test>>({});
  let testing = $state<string | null>(null);
  const key = (r: { connectionId: string; modelId: string }) => `${r.connectionId}|${r.modelId}`;

  async function load() {
    try {
      routes = (await get<{ routes: Route[] }>("/api/speed")).routes;
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void load();
  });

  async function test(r: Route) {
    testing = key(r);
    try {
      const res = await post<{ test: Test; routes: Route[] }>("/api/speed/test", { task: r.tasks[0] });
      tests = { ...tests, [key(res.test)]: res.test };
      routes = res.routes;
    } catch (e) {
      errorToast(e);
    } finally {
      testing = null;
    }
  }

  const sec = (x: number | null) => (x == null ? "–" : `${x < 10 ? x.toFixed(1) : Math.round(x)} s`);
  const tps = (x: number | null) => (x == null ? "–" : `${x < 10 ? x.toFixed(1) : Math.round(x)} tok/s`);
  const verdictText: Record<Route["verdict"], string> = {
    normal: "As usual",
    slow: "Slower than usual",
    "very slow": "Much slower than usual",
    failing: "Failing",
    unknown: "Not enough recent calls",
  };
  const tone = (v: Route["verdict"]) => (v === "normal" ? "ok" : v === "slow" ? "warn" : v === "unknown" ? "" : "bad");
</script>

<section class="stack tight">
  <div class="row between wrap">
    <h2><Gauge size={18} /> Connection speed</h2>
    <button class="btn ghost small" onclick={load} disabled={Boolean(testing)}><RefreshCw size={13} /> Refresh</button>
  </div>
  <p class="tiny muted">
    How fast each model your tasks use is answering in the last 3 hours, next to its usual speed over the two weeks before. A slow provider makes long jobs like lorebook planning sit on
    "Planning…" for minutes. <b>Test now</b> sends one short request.
  </p>
  {#if routes === null}
    <p class="tiny faint">Loading…</p>
  {:else if !routes.length}
    <p class="tiny faint">No model is set up for any task yet.</p>
  {:else}
    {#each routes as r (key(r))}
      {@const t = tests[key(r)]}
      <div class="card speed stack tight">
        <div class="row between wrap">
          <div>
            <b>{r.modelId}</b>
            <div class="tiny muted">{r.connectionName} · {r.tasks.map((x) => taskLabel[x]).join(", ")}</div>
          </div>
          <div class="row wrap">
            <span class="verdict {tone(r.verdict)}">{verdictText[r.verdict]}</span>
            <button class="btn small" onclick={() => test(r)} disabled={Boolean(testing)}>
              <Gauge size={13} />
              {testing === key(r) ? "Testing…" : "Test now"}
            </button>
          </div>
        </div>
        <div class="scroll"><table class="tiny">
          <thead><tr><th></th><th>First word</th><th>Writing speed</th><th>Failed</th><th>Calls</th></tr></thead>
          <tbody>
            <tr>
              <th>Last 3 hours</th>
              <td>{sec(r.recent.firstWord)}</td>
              <td>{tps(r.recent.tokensPerSec)}</td>
              <td>{Math.round(r.recent.errorRate * 100)}%</td>
              <td>{r.recent.n}</td>
            </tr>
            <tr class="muted">
              <th>Usually</th>
              <td>{sec(r.usual.firstWord)}</td>
              <td>{tps(r.usual.tokensPerSec)}</td>
              <td>{Math.round(r.usual.errorRate * 100)}%</td>
              <td>{r.usual.n}</td>
            </tr>
          </tbody>
        </table></div>
        {#if t}
          <p class="tiny test" class:bad={!t.ok}>
            {#if t.ok}
              Live test: first response in {sec(t.firstByte)}{t.firstWord != null && t.firstByte != null && t.firstWord - t.firstByte >= 1 ? ` (thought until ${sec(t.firstWord)})` : ""}, wrote {t.tokens} tokens at {tps(t.tokensPerSec)}, {sec(t.total)} in all.
            {:else}
              Live test failed after {sec(t.total)}: {t.error}
            {/if}
          </p>
        {/if}
      </div>
    {/each}
  {/if}
</section>

<style>
  h2 {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .speed {
    padding: 0.8rem 1rem;
  }
  .verdict {
    font-size: 0.8rem;
    padding: 0.1rem 0.55rem;
    border-radius: 999px;
    border: 1px solid currentColor;
    color: var(--text-muted);
  }
  .verdict.ok {
    color: var(--ok);
  }
  .verdict.warn {
    color: var(--warn);
  }
  .verdict.bad,
  .test.bad {
    color: var(--danger);
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    max-width: 34rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.15rem 0.6rem 0.15rem 0;
    font-weight: normal;
    white-space: nowrap;
  }
  thead th {
    color: var(--text-muted);
  }
  tbody th {
    font-weight: 600;
  }
  .test {
    margin: 0;
  }
</style>
