<script lang="ts">
  import { ScenePainter, isPlace, readHome, readPlace, readWeather, worldOf, type HomeStyle, type Place, type StillScene } from "../../lib/scenery";
  import { Ellipsis } from "../../lib/icons";
  import { app } from "../../lib/state.svelte";
  import Menu, { type MenuItem } from "../Menu.svelte";
  import PlacePicker from "../trackers/PlacePicker.svelte";

  /**
   * J1: a painted header for a scene: a still from the scene window's own painter, at the scene's
   * hour and weather, so a plate shows every kind of place the window can. A long story has many
   * plates, so each paints only near the screen and keeps no painter afterwards. The current
   * scene's plate repaints as the clock moves. ⋯ › This place is… corrects the kind.
   */
  let { place, weather, hour, kind = null, title = "", onkind, styles = null, onstyle, calendar = null }: { place: string[]; weather: string | null; hour: number | null; kind?: string | null; title?: string; onkind?: (name: string, kind: Place) => void; styles?: Record<string, string> | null; onstyle?: (house: string, style: HomeStyle) => void; calendar?: string | null } = $props();

  const name = $derived(place.at(-1) ?? "");
  const world = $derived(worldOf(calendar));
  const k = $derived<Place>(isPlace(kind) ? kind : readPlace(place, { world }));
  // An unset clock paints the evening, as the scene window does.
  const h = $derived(hour ?? 20);
  const home = $derived(readHome(place, styles, { world }));
  const scene = $derived<StillScene>({ hour: h, weather: readWeather(weather), place: k, seed: name, home, focus: app.isMobile ? 0.64 : 0.72, mini: true });

  let canvas = $state<HTMLCanvasElement | null>(null);
  let near = $state(false);
  let size = $state("");
  let painted = "";

  $effect(() => {
    if (!canvas) return;
    const seen = new IntersectionObserver(([e]) => (near = Boolean(e?.isIntersecting)), { rootMargin: "400px 0px", scrollMargin: "400px 0px" }); // The chat scrolls inside its own pane, which rootMargin alone can't see past.
    seen.observe(canvas);
    // Dragging a window edge fires every frame: repaint once it settles.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const sized = new ResizeObserver(([e]) => {
      clearTimeout(settle);
      const next = `${Math.round(e!.contentRect.width)}x${Math.round(e!.contentRect.height)}`;
      settle = setTimeout(() => (size = next), size ? 150 : 0);
    });
    sized.observe(canvas);
    return () => {
      clearTimeout(settle);
      seen.disconnect();
      sized.disconnect();
    };
  });

  $effect(() => {
    const key = `${JSON.stringify(scene)}|${size}`;
    if (!canvas || !near || !size || key === painted) return;
    painted = key;
    ScenePainter.paintOnce(canvas, scene);
  });

  let picking = $state(false);
  let menuOpen = $state(false);
  let menuAt = $state<HTMLElement | null>(null);
  const items = $derived<MenuItem[]>([
    { label: "This place is…", onclick: () => (picking = true), disabled: !name },
    { label: "Save as image", onclick: saveImage },
  ]);

  function saveImage() {
    // Its own canvas at a fixed size, so the saved picture doesn't depend on the screen.
    const c = document.createElement("canvas");
    ScenePainter.paintOnce(c, scene, { w: 1200, h: 300 });
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `${(title || name || "scene").replace(/[^\w\- ]+/g, "").trim() || "scene"}.png`;
    a.click();
  }
</script>

<figure class="plate" aria-label="The scene: {name || 'somewhere'}{weather ? `, ${weather}` : ''}">
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
  {#if onkind}
    <button class="more" bind:this={menuAt} onclick={() => (menuOpen = !menuOpen)} aria-label="Scene plate options" title="This place is… · Save as image"><Ellipsis size={14} /></button>
    <Menu bind:open={menuOpen} {items} anchor={menuAt} title="Scene plate" />
  {/if}
</figure>
{#if onkind && picking}<PlacePicker bind:open={picking} {name} current={k} hour={h} {weather} {home} onpick={(p) => onkind?.(name, p)} {onstyle} />{/if}

<style>
  .plate {
    position: relative;
    margin: 0.4rem 0 0.2rem;
    border-radius: var(--r-md, 14px);
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    box-shadow: 0 6px 24px -14px color-mix(in srgb, var(--accent) 60%, transparent);
    aspect-ratio: 4 / 1;
    max-height: 9rem;
    width: 100%;
    background: #0a0c20;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .more {
    position: absolute;
    right: 0.4rem;
    top: 0.4rem;
    border: 0;
    border-radius: 999px;
    padding: 0.2rem 0.35rem;
    background: rgba(0, 0, 0, 0.35);
    color: #fff;
    cursor: pointer;
    opacity: 0.7;
  }
  .more:hover,
  .more:focus-visible {
    opacity: 1;
  }
</style>
