<script lang="ts">
  import { get } from "../../lib/api";
  import { bytes, timeAgo } from "../../lib/format";
  import { errorToast } from "../../lib/state.svelte";

  let h = $state<any>(null);
  $effect(() => {
    get("/api/health")
      .then((r) => (h = r))
      .catch(errorToast);
  });
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

<style>
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
