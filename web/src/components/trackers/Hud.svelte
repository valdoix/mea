<script lang="ts">
  import { trk } from "../../lib/trackers.svelte";

  let { onopen }: { onopen: () => void } = $props();
</script>

{#if trk.data?.hud && trk.data.config.mode !== "off"}
  <button class="hud tiny" onclick={onopen} title="Story state: tap to open">
    {#if trk.running}<span class="dot" aria-label="Reading the latest reply"></span>{/if}
    <span class="truncate">{trk.data.hud}</span>
  </button>
{/if}

<style>
  .hud {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    max-width: 46rem;
    margin: 0 auto 0.35rem;
    padding: 0.3rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--surface) 80%, transparent);
    color: var(--text-muted);
    font-weight: 600;
    cursor: pointer;
    text-align: left;
  }
  .dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
</style>
