<script lang="ts">
  import { compact } from "../lib/format";
  import { app } from "../lib/state.svelte";

  let { size = 26, label = false }: { size?: number; label?: boolean } = $props();

  const win = $derived.by(() => {
    const q = app.quota;
    if (!q) return null;
    const w = q.weekly?.limit ? q.weekly : q.daily?.limit ? q.daily : null;
    if (!w || !w.limit) return null;
    return { ...w, kind: w === q.weekly ? "weekly" : "daily" };
  });
  const pct = $derived(win ? Math.min(1, win.percentUsed ?? (win.used ?? 0) / (win.limit ?? 1)) : 0);
  const color = $derived(pct < 0.6 ? "var(--mint)" : pct < 0.85 ? "var(--butter)" : "var(--accent-strong)");
  const r = $derived(size / 2 - 3);
  const circ = $derived(2 * Math.PI * r);
  const title = $derived(
    win
      ? `${win.kind === "weekly" ? "Weekly" : "Daily"} subscription quota: ${compact(win.used)} of ${compact(win.limit)} input tokens used${win.resetAt ? ` · resets ${new Date(win.resetAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}`
      : "",
  );
</script>

{#if win}
  <span class="quota" {title}>
    <svg width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} {r} fill="none" stroke="var(--surface-3)" stroke-width="3.5" />
      <circle
        cx={size / 2}
        cy={size / 2}
        {r}
        fill="none"
        stroke={color}
        stroke-width="3.5"
        stroke-linecap="round"
        stroke-dasharray={circ}
        stroke-dashoffset={circ * (1 - pct)}
        transform="rotate(-90 {size / 2} {size / 2})"
      />
    </svg>
    {#if label}<span class="tiny muted">{Math.round(pct * 100)}% of {win.kind} quota</span>{/if}
    <span class="sr-only">{title}</span>
  </span>
{/if}

<style>
  .quota {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }
  circle {
    transition: stroke-dashoffset 0.6s var(--ease);
  }
</style>
