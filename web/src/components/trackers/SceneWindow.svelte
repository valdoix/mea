<script lang="ts">
  import { onMount } from "svelte";
  import { ScenePainter, readPlace, readWeather } from "../../lib/scenery";
  import type { StoryWhen } from "../../lib/types";

  /**
   * A window onto the story: the sky at the story's hour, its weather and its place, painted live
   * from the trackers. "arch" is the framed window of the Almanac; "card" fits the side panel.
   */
  let { when, weather, place, shape = "card" }: { when: StoryWhen | null; weather: string | null; place: string[]; shape?: "card" | "arch" } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let painter: ScenePainter | null = null;

  onMount(() => {
    painter = new ScenePainter(canvas!, shape === "card");
    return () => painter?.destroy();
  });

  $effect(() => {
    // An unset clock still paints: the evening, which suits most openings.
    painter?.set({ hour: when?.hour ?? 20, weather: readWeather(weather), place: readPlace(place) });
  });

  const crumbs = $derived(place.slice(-3));
</script>

<div class="win {shape}" role="figure" aria-label="The scene: {when?.label ?? 'time unknown'}{weather ? `, ${weather}` : ''}{place.length ? `, ${place.join(' › ')}` : ''}">
  <div class="pane">
    <canvas bind:this={canvas} aria-hidden="true"></canvas>
    {#if shape === "arch"}<div class="mullion" aria-hidden="true"></div>{/if}
    <div class="sheen" aria-hidden="true"></div>
    <div class="cap">
      {#if when}
        <div class="clock">{when.time}<small>{when.period}</small></div>
        <div class="day">{when.form === "date" ? (when.calendar === "westeros" ? `${when.date} · ${when.year} AC` : when.date) : when.date}{when.season && when.calendar === "westeros" ? ` · ${when.season}` : ""}</div>
      {/if}
      {#if weather}<div class="wx">{weather}</div>{/if}
      {#if crumbs.length}<div class="crumbs">{#each crumbs as c, i (i)}{#if i}<i>›</i>{/if}<span>{c}</span>{/each}</div>{/if}
    </div>
  </div>
  {#if shape === "arch"}<div class="sill" aria-hidden="true"></div>{/if}
</div>

<style>
  .win {
    margin: 0;
    position: relative;
  }
  .pane {
    position: relative;
    overflow: hidden;
    background: #0a0c20;
    color: #fff;
  }
  .card .pane {
    border-radius: var(--r-md, 14px);
    aspect-ratio: 16 / 10;
  }
  .arch {
    padding: 12px;
    border-radius: 180px 180px 20px 20px;
    background: linear-gradient(160deg, #3a2b52, #1a1228);
    box-shadow: 0 40px 90px -40px #000, inset 0 1px 0 #ffffff1c, 0 0 0 1px #ffffff12;
  }
  .arch .pane {
    border-radius: 170px 170px 10px 10px;
    aspect-ratio: 16 / 10.4;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .mullion {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(90deg, transparent calc(50% - 3px), #1d142c calc(50% - 3px), #2d2140 50%, #1d142c calc(50% + 3px), transparent calc(50% + 3px)),
      linear-gradient(180deg, transparent calc(46% - 3px), #1d142c calc(46% - 3px), #2d2140 46%, #1d142c calc(46% + 3px), transparent calc(46% + 3px));
    opacity: 0.85;
  }
  .sheen {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(115deg, transparent 30%, rgb(255 255 255 / 6%) 38%, transparent 46%, transparent 60%, rgb(255 255 255 / 3%) 64%, transparent 70%);
  }
  .sill {
    height: 18px;
    margin: 10px -22px -12px;
    border-radius: 6px;
    background: linear-gradient(180deg, #4a3866, #241a36);
    box-shadow: 0 20px 30px -14px #000;
  }
  .cap {
    position: absolute;
    left: 0.9rem;
    right: 0.9rem;
    bottom: 0.75rem;
    text-shadow: 0 2px 16px #000c;
    pointer-events: none;
  }
  .arch .cap {
    left: 1.8rem;
    bottom: 1.4rem;
  }
  .clock {
    font: 400 2.1rem/0.95 "Instrument Serif", Georgia, serif;
    letter-spacing: -0.01em;
  }
  .arch .clock {
    font-size: clamp(2.6rem, 6vw, 4.6rem);
  }
  .clock small {
    font-size: 0.42em;
    font-style: italic;
    margin-left: 0.4em;
    opacity: 0.85;
  }
  .day {
    font: 700 0.62rem var(--font-ui);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    opacity: 0.88;
    margin-top: 0.3rem;
  }
  .wx {
    font: italic 0.95rem/1.3 var(--font-story);
    margin-top: 0.25rem;
  }
  .arch .wx {
    font-size: 1.2rem;
  }
  .crumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-items: center;
    margin-top: 0.4rem;
  }
  .crumbs span {
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: rgb(0 0 0 / 32%);
    font: 600 0.66rem var(--font-ui);
    border: 1px solid #ffffff1f;
    backdrop-filter: blur(6px);
  }
  .crumbs i {
    opacity: 0.5;
    font-style: normal;
    font-size: 0.7rem;
  }
  @media (max-width: 640px) {
    .arch {
      padding: 7px;
      border-radius: 110px 110px 14px 14px;
    }
    .arch .pane {
      border-radius: 104px 104px 8px 8px;
    }
    .sill {
      margin-inline: -8px;
    }
    .arch .cap {
      left: 0.9rem;
      bottom: 0.8rem;
    }
  }
</style>
