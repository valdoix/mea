<script lang="ts">
  import { get, post } from "../../lib/api";
  import { bytes, compact, timeAgo } from "../../lib/format";
  import { RefreshCw, RotateCcw, X } from "../../lib/icons";
  import { app, errorToast } from "../../lib/state.svelte";
  import type { JobRow } from "../../lib/types";

  let h = $state<any>(null);
  let jobs = $state<JobRow[]>([]);
  let filter = $state("");

  function loadHealth() {
    get("/api/health")
      .then((r) => (h = r))
      .catch(errorToast);
  }
  async function loadJobs() {
    try {
      jobs = (await get<{ jobs: JobRow[] }>(`/api/jobs?limit=60${filter ? `&status=${filter}` : ""}`)).jobs;
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    loadHealth();
  });
  // Refresh when the filter changes and whenever background activity changes.
  $effect(() => {
    void filter;
    void app.activity.running;
    void app.activity.queued;
    void loadJobs();
  });

  async function act(j: JobRow, what: "retry" | "cancel") {
    try {
      await post(`/api/jobs/${j.id}/${what}`);
      await loadJobs();
      loadHealth();
    } catch (e) {
      errorToast(e);
    }
  }
  const kindLabel: Record<string, string> = {
    "memory.segment": "Find scenes",
    "memory.build": "Write memory",
    "memory.embed": "Embed memories",
    "cache.probe": "Check caching",
    "quota.refresh": "Refresh quota",
  };
  const statusChip: Record<string, string> = { running: "lavender", queued: "", failed: "rose", done: "mint", cancelled: "" };
  const uptime = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} days`);
</script>

{#if h}
  <section class="panel stack tight">
    <h2>Server</h2>
    <div class="kv"><span>Status</span><b class:ok={h.ok}>{h.ok ? "Healthy ✿" : "Problem"}</b></div>
    <div class="kv"><span>Version</span><span>{h.version}{h.dev ? " (dev mode)" : ""}</span></div>
    <div class="kv"><span>Running for</span><span>{uptime(h.uptimeSec)}</span></div>
    <div class="kv"><span>Database</span><span>{bytes(h.db.bytes)}</span></div>
    {#if h.disk}<div class="kv"><span>Free disk space</span><span>{bytes(h.disk.freeBytes)} of {bytes(h.disk.totalBytes)}</span></div>{/if}
    <div class="kv"><span>Last backup</span><span>{h.lastBackupAt ? timeAgo(h.lastBackupAt) : "none yet"}</span></div>
    <div class="kv"><span>Quota checked</span><span>{h.quotaFetchedAt ? timeAgo(h.quotaFetchedAt) : "not yet"}</span></div>
    <div class="kv"><span>Background jobs</span><span>{h.jobs.running} running · {h.jobs.counts.queued ?? 0} queued · {h.jobs.counts.failed ?? 0} failed</span></div>
    {#each h.jobs.recentFailures as f (f.updated_at)}
      <div class="notice error tiny">{f.kind}: {f.last_error}</div>
    {/each}
    {#each h.connections.filter((c: any) => c.lastError) as c (c.name)}
      <div class="notice warn tiny">{c.name}: {c.lastError}</div>
    {/each}
  </section>
{/if}

<section class="panel stack tight jobs">
  <div class="row between wrap">
    <h2>Background jobs</h2>
    <div class="row">
      <select class="select narrow" bind:value={filter}>
        <option value="">All</option><option value="running">Running</option><option value="queued">Queued</option><option value="failed">Failed</option><option value="done">Done</option>
      </select>
      <button class="btn ghost icon small" onclick={loadJobs} aria-label="Refresh"><RefreshCw size={15} /></button>
    </div>
  </div>
  {#each jobs as j (j.id)}
    <div class="job">
      <span class="chip {statusChip[j.status] ?? ''}">{j.status}</span>
      <div class="grow">
        <div class="small">{kindLabel[j.kind] ?? j.kind}</div>
        <div class="tiny muted">
          {timeAgo(j.updatedAt)}{j.attempts ? ` · attempt ${j.attempts}/${j.maxAttempts}` : ""}{j.inputTokens ? ` · ${compact(j.inputTokens)} in / ${compact(j.outputTokens)} out` : ""}{j.status === "queued" && j.runAfter > Date.now() ? ` · waits until ${new Date(j.runAfter).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
        </div>
        {#if j.lastError}<div class="tiny err">{j.lastError}</div>{/if}
      </div>
      {#if j.status === "failed"}<button class="btn ghost icon small" onclick={() => act(j, "retry")} aria-label="Retry" title="Retry"><RotateCcw size={15} /></button>{/if}
      {#if j.status === "queued"}<button class="btn ghost icon small" onclick={() => act(j, "cancel")} aria-label="Cancel" title="Cancel"><X size={15} /></button>{/if}
    </div>
  {:else}
    <p class="tiny muted">No jobs{filter ? ` ${filter}` : ""}.</p>
  {/each}
</section>

<style>
  .jobs {
    margin-top: 1rem;
  }
  .narrow {
    width: auto;
  }
  .job {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.45rem 0;
    border-top: 1px solid var(--border);
  }
  .err {
    color: var(--danger);
  }
  .kv {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: var(--fs-sm);
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--border);
  }
  .kv span:first-child {
    color: var(--text-muted);
  }
  .ok {
    color: var(--ok);
  }
</style>
