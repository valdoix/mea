<script lang="ts">
  import Modal from "../Modal.svelte";
  import { HOME_STYLES, PLACE_GROUPS, ScenePainter, readWeather, type Home, type HomeStyle, type Place } from "../../lib/scenery";

  /** "This place is…": every kind of place, each painted at the scene's own hour and weather. "This house is…" sets how its home is kept. */
  let { open = $bindable(false), name, current, hour, weather, home = null, onpick, onstyle }: { open?: boolean; name: string; current: Place; hour: number; weather: string | null; home?: Home | null; onpick: (kind: Place) => void; onstyle?: (house: string, style: HomeStyle) => void } = $props();

  let q = $state("");
  const groups = $derived.by(() => {
    const t = q.trim().toLowerCase();
    const out = PLACE_GROUPS.map((g) => ({ label: g.label, kinds: g.kinds.filter((k) => !t || k.label.toLowerCase().includes(t) || k.id.includes(t) || g.label.toLowerCase().includes(t)) }));
    return out.filter((g) => g.kinds.length);
  });

  function paint(node: HTMLCanvasElement, arg: { place: Place; home: Home | null }) {
    const p = new ScenePainter(node, { mini: true, still: true, focus: 0.55 });
    p.set({ hour, weather: readWeather(weather), place: arg.place, seed: name, home: arg.home });
    return { update: (a: { place: Place; home: Home | null }) => p.set({ place: a.place, home: a.home }), destroy: () => p.destroy() };
  }
</script>

<Modal bind:open title={name ? `${name} is…` : "This place is…"} size="lg">
  <p class="tiny muted lead">Pick what this place looks like. It's remembered for this story, everywhere the scene is painted.</p>
  {#if home && onstyle}
    <div class="house" role="group" aria-label="This house is…">
      <span class="tiny muted">This house is</span>
      {#each HOME_STYLES as s (s.id)}
        <button class="chip" class:on={home.style === s.id} aria-pressed={home.style === s.id} onclick={() => onstyle?.(home.house, s.id)}>{s.label}</button>
      {/each}
    </div>
  {/if}
  <input class="search" type="search" placeholder="Find a place…" aria-label="Find a place" bind:value={q} />
  {#each groups as grp (grp.label)}
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
          <canvas use:paint={{ place: k.id, home }} aria-hidden="true"></canvas>
          <span>{k.label}</span>
        </button>
      {/each}
    </div>
  {:else}
    <p class="tiny muted none">No place by that name.</p>
  {/each}
</Modal>

<style>
  .lead {
    margin: 0 0 0.6rem;
  }
  .house {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.6rem;
  }
  .chip {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
    background: none;
    color: inherit;
    font: 600 0.74rem var(--font-ui);
    cursor: pointer;
  }
  .chip.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .search {
    width: 100%;
    box-sizing: border-box;
  }
  .none {
    margin: 1rem 0;
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
  .house span {
    position: static;
    padding: 0;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.74rem;
  }
</style>
