<script lang="ts">
  import { voiceColor } from "../../lib/voices";
  import { trk } from "../../lib/trackers.svelte";
  import type { TrackerChange } from "../../lib/types";

  /**
   * What went unsaid in this reply: the private thoughts and hidden feelings the trackers read
   * from it. Folded by default, so knowing is a choice; never shown for your own character
   * (the trackers don't write it when your inner life is sealed).
   */
  let { changes, open = false }: { changes: TrackerChange[]; open?: boolean } = $props();

  const inner = $derived(changes.filter((c) => (c.kind === "thought" || c.kind === "mask") && typeof c.to === "string" && c.to));
  const color = (name?: string) => voiceColor(name ?? "", name ? trk.data?.profiles[name.toLowerCase()]?.color : null);
</script>

{#if inner.length}
  <details class="drawer" {open}>
    <summary><span class="dots" aria-hidden="true">∴</span> What went unsaid <span class="count">{inner.length}</span></summary>
    <div class="in">
      {#each inner as c, i (i)}
        <div class="th" style:--vc={color(c.subject)}>
          <span class="orb" aria-hidden="true">{(c.subject ?? "?").slice(0, 1)}</span>
          <div>
            <small>{c.subject ?? "Someone"} · {c.kind === "thought" ? "thinking" : "hiding"}</small>
            <span class="text">{c.to}</span>
          </div>
        </div>
      {/each}
    </div>
  </details>
{/if}

<style>
  .drawer {
    margin-top: 0.6rem;
    border-radius: var(--r-md, 14px);
    border: 1px solid color-mix(in srgb, var(--lavender, #c7b4ff) 30%, var(--border));
    background: linear-gradient(160deg, color-mix(in srgb, var(--lavender, #c7b4ff) 8%, transparent), color-mix(in srgb, var(--accent) 4%, transparent));
    overflow: hidden;
  }
  summary {
    list-style: none;
    cursor: pointer;
    padding: 0.5rem 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font: 700 var(--fs-xs) var(--font-ui);
    color: color-mix(in srgb, var(--lavender, #c7b4ff) 70%, var(--text));
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .dots {
    font-size: 1.2em;
    line-height: 0;
  }
  .count {
    margin-left: auto;
    color: var(--text-muted);
    font-weight: 600;
  }
  .in {
    padding: 0 0.8rem 0.8rem;
    display: grid;
    gap: 0.6rem;
    animation: unveil 0.6s var(--ease, ease);
  }
  @keyframes unveil {
    from {
      filter: blur(6px);
      opacity: 0;
    }
  }
  .th {
    display: grid;
    grid-template-columns: 1.6rem 1fr;
    gap: 0.6rem;
    font: italic 0.95em/1.5 var(--font-story);
  }
  .th small {
    display: block;
    font: 700 0.62rem var(--font-ui);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    font-style: normal;
  }
  .orb {
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font: 400 0.9rem "Instrument Serif", Georgia, serif;
    color: #0e0a18;
    background: radial-gradient(circle at 30% 26%, #fffa, transparent 34%), var(--vc);
  }
  @media (prefers-reduced-motion: reduce) {
    .in {
      animation: none;
    }
  }
</style>
