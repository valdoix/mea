<script lang="ts">
  import { device } from "../lib/device.svelte";
  import { layout } from "../lib/layout.svelte";
  import { app } from "../lib/state.svelte";
  import { room, type RoomId } from "../rooms";

  // The living backdrop behind the rooms, as Sky is for Lantern. Each room paints its own
  // (src/rooms/<room>/Ambience.svelte); this is the frame they share. "Drifting things" (petals,
  // snow, embers, searchlights) follow the fireflies switch; texture follows the grain switch.
  let { theme }: { theme: RoomId } = $props();

  const current = $derived(room(theme));
  const RoomAmbience = $derived(current?.Ambience);
  const grain = $derived(device.grain && current?.grain ? (app.night ? current.grain.night : current.grain.day) : 0);
</script>

<div class="amb a-{theme}" class:night={app.night} class:dim={layout.focus} class:still={!device.fireflies} aria-hidden="true">
  {#if RoomAmbience}<RoomAmbience />{/if}
</div>
{#if grain}<div class="tex" class:night={app.night} style:opacity={grain} aria-hidden="true"></div>{/if}

<style>
  .amb {
    position: fixed;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
    background: var(--bg);
    transition:
      opacity 0.8s var(--ease),
      filter 0.8s var(--ease);
  }
  .amb.dim {
    opacity: 0.55;
    filter: saturate(0.8);
  }
  .amb > :global(i),
  .amb > :global(span),
  .amb > :global(div) {
    position: absolute;
  }
  .tex {
    position: fixed;
    inset: 0;
    z-index: 300;
    pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    mix-blend-mode: multiply;
  }
  .tex.night {
    mix-blend-mode: screen;
  }
</style>
