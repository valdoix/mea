<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { route } from "../../lib/router.svelte";
  import { app } from "../../lib/state.svelte";

  // Arcade Afterhours: by day the cabinet's sunburst and racing stripes, by night a vector grid
  // rolling toward you under green mountains, scanlines on the glass, and pixel invaders drifting by.
  const SPRITE = ["..X.....X..", "...X...X...", "..XXXXXXX..", ".XX.XXX.XX.", "XXXXXXXXXXX", "X.XXXXXXX.X", "X.X.....X.X", "...XX.XX..."];
  const INVADER = SPRITE.flatMap((row, y) => [...row].map((c, x) => (c === "X" ? `M${x} ${y}h1v1h-1z` : ""))).join("");
  const SHIPS = [
    { y: "14vh", s: 30, d: 34, delay: 0, c: "var(--p1)" },
    { y: "38vh", s: 22, d: 46, delay: -18, c: "var(--p3)" },
    { y: "64vh", s: 26, d: 40, delay: -9, c: "var(--p2)" },
  ];
</script>

{#if app.night}
  <i class="haze"></i>
  <i class="stars"></i>
  <svg class="peaks" viewBox="0 0 1200 160" preserveAspectRatio="none"><polyline points="0,160 80,90 150,120 240,40 330,110 400,70 470,130 560,30 650,100 720,60 800,120 880,50 960,110 1040,70 1120,120 1200,80" /></svg>
  <div class="floor"><i class="grid"></i></div>
  {#if device.grain}<i class="scan"></i>{/if}
  <i class="vignette"></i>
{:else}
  <i class="burst"></i>
  <i class="stripes"></i>
  {#if device.grain}<i class="wood l"></i><i class="wood r"></i>{/if}
{/if}
{#if device.fireflies}
  {#each SHIPS as s, i (i)}
    <svg class="ship" viewBox="0 0 11 8" shape-rendering="crispEdges" style:top={s.y} style:width="{s.s * 1.4}px" style:color={s.c} style:animation-duration="{s.d}s" style:animation-delay="{s.delay}s"><path d={INVADER} fill="currentColor" /></svg>
  {/each}
{/if}
{#if route.name !== "chat"}<span class="coin">INSERT COIN</span><span class="score">HI-SCORE 098350</span>{/if}

<style>
  /* ---------- day: the cabinet art ---------- */
  .burst {
    left: 50%;
    bottom: -70vmax;
    width: 140vmax;
    height: 140vmax;
    margin-left: -70vmax;
    border-radius: 50%;
    background: repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--p2) 22%, transparent) 0 6deg, transparent 6deg 12deg);
    -webkit-mask: radial-gradient(closest-side, #000 30%, transparent);
    mask: radial-gradient(closest-side, #000 30%, transparent);
    animation: turn 160s linear infinite;
  }
  .stripes {
    left: -10vw;
    right: -10vw;
    bottom: 16vh;
    height: 64px;
    rotate: -8deg;
    background: linear-gradient(var(--p1) 0 25%, var(--p2) 25% 50%, var(--p3) 50% 75%, var(--p4) 75%);
    opacity: 0.22;
  }
  .wood {
    top: 0;
    bottom: 0;
    width: 22px;
    background: repeating-linear-gradient(180deg, #7a4a26 0 9px, #6b3f1f 9px 11px, #82512b 11px 19px, #5f381c 19px 20px);
    box-shadow: inset 0 0 0 2px #3b2314;
    opacity: 0.85;
  }
  .wood.l {
    left: 0;
  }
  .wood.r {
    right: 0;
  }
  @keyframes turn {
    to {
      transform: rotate(1turn);
    }
  }
  /* ---------- night: the screen ---------- */
  .haze {
    inset: 0;
    background:
      radial-gradient(60% 40% at 50% 62%, rgb(255 106 43 / 22%), transparent 70%),
      radial-gradient(50% 40% at 80% 0%, rgb(255 176 0 / 10%), transparent 70%);
  }
  .stars {
    inset: 0 0 45vh;
    background-image:
      radial-gradient(1px 1px at 30px 40px, #ffd38a 98%, transparent),
      radial-gradient(1.5px 1.5px at 140px 90px, #fff 98%, transparent),
      radial-gradient(1px 1px at 230px 20px, #7dff5a 98%, transparent),
      radial-gradient(1px 1px at 80px 160px, #ffd38a 98%, transparent);
    background-size: 260px 200px;
    animation: twinkle 3.6s ease-in-out infinite alternate;
  }
  @keyframes twinkle {
    from {
      opacity: 0.3;
    }
    to {
      opacity: 0.85;
    }
  }
  .peaks {
    position: absolute;
    left: 0;
    width: 100%;
    bottom: 38vh;
    height: 15vh;
    fill: none;
    stroke: #7dff5a;
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    opacity: 0.5;
    filter: drop-shadow(0 0 6px #7dff5a);
  }
  .floor {
    left: -50vw;
    right: -50vw;
    bottom: 0;
    height: 40vh;
    perspective: 260px;
    perspective-origin: 50% 0;
    overflow: hidden;
    -webkit-mask: linear-gradient(transparent, #000 35%);
    mask: linear-gradient(transparent, #000 35%);
  }
  .grid {
    position: absolute;
    left: 0;
    right: 0;
    top: -60px;
    height: 220%;
    transform-origin: 50% 0;
    background:
      repeating-linear-gradient(90deg, rgb(255 176 0 / 55%) 0 1.5px, transparent 1.5px 60px),
      repeating-linear-gradient(0deg, rgb(255 176 0 / 55%) 0 1.5px, transparent 1.5px 60px);
    transform: rotateX(62deg) translate3d(0, 0, 0);
    animation: roll 2.4s linear infinite;
  }
  @keyframes roll {
    to {
      transform: rotateX(62deg) translate3d(0, 60px, 0);
    }
  }
  .scan {
    left: 0;
    right: 0;
    top: -4px;
    bottom: 0;
    z-index: 2;
    background: repeating-linear-gradient(180deg, rgb(0 0 0 / 32%) 0 1px, transparent 1px 3px);
    animation: scan 8s linear infinite;
  }
  @keyframes scan {
    to {
      transform: translate3d(0, 3px, 0);
    }
  }
  .vignette {
    inset: 0;
    z-index: 2;
    background: radial-gradient(120% 90% at 50% 45%, transparent 55%, rgb(0 0 0 / 65%));
  }
  /* ---------- both: invaders, a coin slot and a score ---------- */
  .ship {
    position: absolute;
    left: 0;
    height: auto;
    opacity: 0.4;
    animation: fly 40s linear infinite;
  }
  :global(.amb.night) .ship {
    opacity: 0.6;
    filter: drop-shadow(0 0 6px currentColor);
  }
  @keyframes fly {
    from {
      transform: translate3d(-8vw, 0, 0);
    }
    25% {
      transform: translate3d(22vw, 24px, 0);
    }
    50% {
      transform: translate3d(52vw, 0, 0);
    }
    75% {
      transform: translate3d(82vw, 24px, 0);
    }
    to {
      transform: translate3d(108vw, 0, 0);
    }
  }
  .coin {
    right: 5vw;
    bottom: 7vh;
    font: 400 clamp(0.9rem, 1.6vw, 1.3rem) / 1 "Press Start 2P", monospace;
    color: var(--p1);
    opacity: 0.7;
    text-shadow: 3px 3px 0 color-mix(in srgb, var(--p4) 50%, transparent);
    animation: blink 1.2s steps(1) infinite;
  }
  .score {
    right: 5vw;
    top: 5vh;
    font: 400 clamp(0.7rem, 1.1vw, 0.95rem) / 1 "Press Start 2P", monospace;
    color: var(--p2);
    opacity: 0.6;
  }
  :global(.amb.night) .coin,
  :global(.amb.night) .score {
    text-shadow: 0 0 10px currentColor;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  :global(.amb.still) .burst,
  :global(.amb.still) .grid,
  :global(.amb.still) .scan {
    animation: none;
  }
  @media (max-width: 760px) {
    .coin,
    .score,
    .wood {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .burst,
    .grid,
    .scan,
    .stars,
    .coin {
      animation: none;
    }
    .ship {
      display: none;
    }
  }
</style>
