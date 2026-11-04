<script lang="ts">
  import { onMount } from "svelte";
  import { ScenePainter, isPlace, placeUnder, readHome, readPlace, readWeather, sceneOccasion, worldOf, type HomeStyle, type Place } from "../../lib/scenery";
  import { ChevronDown, ChevronUp, Palette } from "../../lib/icons";
  import { app } from "../../lib/state.svelte";
  import type { KeepStyle, StoryWhen } from "../../lib/types";
  import PlacePicker from "./PlacePicker.svelte";

  /**
   * A window onto the story: the sky at the story's hour, its weather and its place, painted live
   * from the trackers. "arch" is the framed window of the Almanac; "card" fits the side panel;
   * "strip" sits above the newest reply; "band" is the backdrop of Stage's band (no caption).
   * `kind` is your "This place is…" correction; `onkind` offers the picker.
   */
  let {
    when,
    weather,
    place,
    shape = "card",
    kind = null,
    onkind,
    styles = null,
    onstyle,
    slim = false,
    onslim,
    calendar = null,
    keeps = null,
    onkeep,
    occasion = null,
    fix = null,
    dated = null,
    today = null,
    onoccasion,
    minutes = null,
  }: {
    when: StoryWhen | null;
    weather: string | null;
    place: string[];
    shape?: "card" | "arch" | "strip" | "band";
    kind?: string | null;
    onkind?: (name: string, kind: Place) => void;
    styles?: Record<string, string> | null;
    onstyle?: (house: string, style: HomeStyle) => void;
    slim?: boolean;
    onslim?: () => void;
    /** The chat's calendar: a Westeros chat reads its places as Westeros. */
    calendar?: string | null;
    /** Your "This keep is…" corrections. */
    keeps?: Record<string, KeepStyle> | null;
    onkeep?: (house: string, style: KeepStyle) => void;
    /** docs/25 §4.2: what the tracker says is under way, your correction, and entries on the calendar. */
    occasion?: string | null;
    fix?: string | null;
    dated?: { title: string; at: number }[] | null;
    today?: string[] | null;
    onoccasion?: (id: string) => void;
    minutes?: number | null;
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let painter: ScenePainter | null = null;
  let picking = $state(false);

  const name = $derived(place.at(-1) ?? "");
  const world = $derived(worldOf(calendar));
  const kindNow = $derived<Place>(isPlace(kind) ? kind : readPlace(placeUnder(place), { world }));
  const occ = $derived.by(() => {
    const o = sceneOccasion({ place, fix, tracked: occasion, dated, minutes, world, keeps });
    return o && isPlace(kind) ? { ...o, stage: false } : o;
  });
  const home = $derived(readHome(place, styles, { world, keeps, year: when?.year }));
  // An unset clock still paints: the evening, which suits most openings.
  const hour = $derived(when?.hour ?? 20);

  onMount(() => {
    const focus = shape === "band" ? (app.isMobile ? 0.62 : 0.76) : shape === "strip" ? (app.isMobile ? 0.64 : 0.72) : 0.6;
    painter = new ScenePainter(canvas!, { mini: shape === "card", focus });
    return () => painter?.destroy();
  });

  $effect(() => {
    painter?.set({ hour, weather: readWeather(weather), place: kindNow, seed: name, home, occasion: occ });
  });

  const crumbs = $derived(place.slice(-3));
</script>

<div class="win {shape}" class:slim role="figure" aria-label="The scene: {when?.label ?? 'time unknown'}{weather ? `, ${weather}` : ''}{place.length ? `, ${place.join(' › ')}` : ''}">
  <div class="pane">
    <canvas bind:this={canvas} aria-hidden="true"></canvas>
    {#if shape === "arch"}<div class="mullion" aria-hidden="true"></div>{/if}
    {#if shape !== "band"}
      <div class="sheen" aria-hidden="true"></div>
      <div class="cap">
        {#if when}
          <div class="clock">{when.time}<small>{when.period}</small></div>
          <div class="day">{when.form === "date" ? (when.calendar === "westeros" ? `${when.date} · ${when.year} AC` : when.date) : when.date}{when.season && when.calendar === "westeros" ? ` · ${when.season}` : ""}</div>
        {/if}
        {#if weather}<div class="wx">{weather}</div>{/if}
        {#if crumbs.length}<div class="crumbs">{#each crumbs as c, i (i)}{#if i}<i>›</i>{/if}<span>{c}</span>{/each}</div>{/if}
      </div>
      <div class="tools">
        {#if onkind && name}<button class="tool" onclick={() => (picking = true)} aria-label="This place is…" title="This place is… (change the scenery)"><Palette size={14} /></button>{/if}
        {#if onslim}<button class="tool" onclick={onslim} aria-label={slim ? "Show the whole scene" : "Fold the scene"} title={slim ? "Show the whole scene" : "Fold the scene"}>{#if slim}<ChevronDown size={14} />{:else}<ChevronUp size={14} />{/if}</button>{/if}
      </div>
    {/if}
  </div>
  {#if shape === "arch"}<div class="sill" aria-hidden="true"></div>{/if}
</div>
{#if onkind && picking}<PlacePicker bind:open={picking} {name} current={kindNow} {hour} {weather} {home} onpick={(k) => onkind?.(name, k)} {onstyle} {onkeep} occasion={occ?.id ?? null} {today} {onoccasion} />{/if}

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
  .strip .pane {
    border-radius: var(--r-md, 14px);
    height: clamp(8rem, 22vw, 11rem);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent),
      0 14px 34px -22px color-mix(in srgb, var(--accent) 80%, #000);
    transition: height 0.4s var(--spring, ease);
  }
  .strip.slim .pane {
    height: 3.1rem;
  }
  .band,
  .band .pane {
    position: absolute;
    inset: 0;
    background: none;
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
  .strip .sheen {
    background: linear-gradient(90deg, rgb(8 6 18 / 62%), rgb(8 6 18 / 18%) 45%, transparent 70%);
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
  .strip .cap {
    left: 1.1rem;
    right: 4rem;
    bottom: 0.85rem;
  }
  .strip.slim .cap {
    display: flex;
    align-items: baseline;
    gap: 0.8rem;
    bottom: 0.55rem;
    white-space: nowrap;
    overflow: hidden;
  }
  .clock {
    font: 400 2.1rem/0.95 "Instrument Serif", Georgia, serif;
    letter-spacing: -0.01em;
  }
  .arch .clock {
    font-size: clamp(2.6rem, 6vw, 4.6rem);
  }
  .strip.slim .clock {
    font-size: 1.5rem;
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
  .strip.slim :is(.day, .wx, .crumbs) {
    margin: 0;
  }
  .strip.slim .crumbs {
    flex-wrap: nowrap;
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
  .tools {
    position: absolute;
    top: 0.45rem;
    right: 0.45rem;
    display: flex;
    gap: 0.3rem;
  }
  .strip.slim .tools {
    top: 50%;
    transform: translateY(-50%);
  }
  .tool {
    display: grid;
    place-items: center;
    width: 1.8rem;
    height: 1.8rem;
    border: 1px solid #ffffff22;
    border-radius: 999px;
    background: rgb(0 0 0 / 35%);
    color: #fff;
    cursor: pointer;
    opacity: 0.7;
    backdrop-filter: blur(6px);
    transition: opacity 0.2s;
  }
  .win:hover .tool,
  .tool:focus-visible {
    opacity: 1;
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
    .strip .clock {
      font-size: 1.7rem;
    }
    .strip.slim .day,
    .strip.slim .crumbs {
      display: none;
    }
  }
</style>
