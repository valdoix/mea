<script lang="ts">
  import Modal from "../Modal.svelte";
  import { PLACE_GROUPS, ScenePainter, readWeather, type Place } from "../../lib/scenery";

  /** "This place is…": every kind of place, each painted at the scene's own hour and weather. */
  let { open = $bindable(false), name, current, hour, weather, onpick }: { open?: boolean; name: string; current: Place; hour: number; weather: string | null; onpick: (kind: Place) => void } = $props();

  function paint(node: HTMLCanvasElement, place: Place) {
    const p = new ScenePainter(node, { mini: true, still: true, focus: 0.55 });
    p.set({ hour, weather: readWeather(weather), place, seed: name });
    return { destroy: () => p.destroy() };
  }
</script>

<Modal bind:open title={name ? `${name} is…` : "This place is…"} size="lg">
  <p class="tiny muted lead">Pick what this place looks like. It's remembered for this story, everywhere the scene is painted.</p>
  {#each PLACE_GROUPS as grp (grp.label)}
    <h4>{grp.label}</h4>
    <div class="grid">
      {#each grp.kinds as k (k.id)}
        <button
          class="tile"
          class:on={k.id === current}
          aria-pressed={k.id === current}
          onclick={() => {
            onpick(k.id);
            open = false;
          }}
        >
          <canvas use:paint={k.id} aria-hidden="true"></canvas>
          <span>{k.label}</span>
        </button>
      {/each}
    </div>
  {/each}
</Modal>

<style>
  .lead {
    margin: 0 0 0.6rem;
  }
  h4 {
    margin: 1rem 0 0.5rem;
    font: 800 0.68rem var(--font-ui);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: 0.6rem;
  }
  .tile {
    position: relative;
    padding: 0;
    border: 0;
    border-radius: var(--r-md, 14px);
    overflow: hidden;
    aspect-ratio: 16 / 10;
    background: #0a0c20;
    cursor: pointer;
    box-shadow: 0 0 0 1px var(--border);
    transition:
      transform 0.25s var(--spring, ease),
      box-shadow 0.2s;
  }
  .tile:hover,
  .tile:focus-visible {
    transform: translateY(-2px);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .tile.on {
    box-shadow:
      0 0 0 2px var(--accent),
      0 8px 24px -12px var(--accent);
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  span {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 1.2rem 0.55rem 0.4rem;
    background: linear-gradient(transparent, rgb(0 0 0 / 70%));
    color: #fff;
    font: 700 0.74rem var(--font-ui);
    text-align: left;
  }
</style>
