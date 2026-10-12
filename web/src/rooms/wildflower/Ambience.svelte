<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { BUTTERFLY, spray } from "../../lib/ornaments";
  import { app } from "../../lib/state.svelte";

  // Wildflower's meadow: pastel washes, a bouquet in two corners, falling petals, a butterfly, and
  // by night a moon and drifting motes.
  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const petals = Array.from({ length: 16 }, (_, i) => ({ left: rand(0, 100), d: rand(13, 24), delay: -rand(0, 24), size: rand(7, 13), sway: rand(20, 70), c: i % 3 }));
  const motes = Array.from({ length: 18 }, () => ({ left: rand(0, 100), top: rand(0, 100), x: rand(-80, 80), y: rand(-80, 80), d: rand(9, 18), delay: rand(0, 4) }));
  const SPRAY = spray();
</script>

<i class="wash w1"></i><i class="wash w2"></i><i class="wash w3"></i><i class="wash w4"></i>
{#if app.night}<i class="moon"></i>{/if}
<div class="bq bl">{@html SPRAY}</div>
<div class="bq tr">{@html SPRAY}</div>
{#if device.fireflies}
  {#each petals as p, i (i)}
    <span class="petal c{p.c}" style:left="{p.left}%" style:--d="{p.d}s" style:--s="{p.size}px" style:--sw="{p.sway}px" style:animation-delay="{p.delay}s"></span>
  {/each}
  {#if app.night}
    {#each motes as m, i (i)}
      <span class="mote" style:left="{m.left}%" style:top="{m.top}%" style:--x="{m.x}px" style:--y="{m.y}px" style:--d="{m.d}s" style:animation-delay="0s, {m.delay}s"></span>
    {/each}
  {/if}
  <div class="fly-path"><span class="butterfly">{@html BUTTERFLY}</span></div>
{/if}

<style>
  .wash {
    border-radius: 50%;
    filter: blur(60px);
    animation: bloom-drift 26s ease-in-out infinite alternate;
  }
  .w1 {
    width: 620px;
    height: 520px;
    left: -180px;
    top: -200px;
    background: var(--sig2);
    opacity: 0.55;
  }
  .w2 {
    width: 640px;
    height: 560px;
    right: -200px;
    bottom: -220px;
    background: var(--sig1);
    opacity: 0.6;
    animation-duration: 31s;
  }
  .w3 {
    width: 420px;
    height: 380px;
    right: 14%;
    top: -160px;
    background: var(--lavender);
    opacity: 0.45;
    animation-duration: 23s;
  }
  .w4 {
    width: 380px;
    height: 340px;
    left: 14%;
    bottom: -170px;
    background: var(--peach);
    opacity: 0.45;
    animation-duration: 29s;
  }
  :global(.amb.night) .wash {
    opacity: 0.16;
  }
  :global(.amb.night) .w2 {
    opacity: 0.2;
  }
  @keyframes bloom-drift {
    to {
      transform: translate(50px, 40px) scale(1.1);
    }
  }
  .moon {
    right: 3.5%;
    top: 5%;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: radial-gradient(circle at 40% 38%, #fdf6ec, #e9e2d6 60%, #cfc6bb);
    box-shadow:
      0 0 60px 10px rgb(253 246 236 / 22%),
      0 0 160px 40px rgb(242 167 195 / 10%);
    opacity: 0.75;
  }
  .bq {
    width: 300px;
    height: 300px;
    opacity: 0.92;
  }
  :global(.amb.night) .bq {
    opacity: 0.6;
  }
  .bq.bl {
    left: -30px;
    bottom: -14px;
    transform-origin: 0 100%;
    animation: breeze 7s ease-in-out infinite alternate;
  }
  .bq.tr {
    right: -30px;
    top: -14px;
    transform: scale(-1, -1);
    transform-origin: 100% 0;
  }
  .bq :global(svg) {
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  @keyframes breeze {
    from {
      transform: rotate(-1.5deg);
    }
    to {
      transform: rotate(2deg);
    }
  }
  .bq :global(.stem) {
    fill: none;
    stroke: var(--leaf);
    stroke-width: 1.6;
    stroke-linecap: round;
  }
  .bq :global(.lf) {
    fill: var(--leaf);
    opacity: 0.85;
  }
  .bq :global(.lf2) {
    fill: var(--sig1);
  }
  .bq :global(.p1) {
    fill: var(--sig2);
  }
  .bq :global(.p2) {
    fill: color-mix(in srgb, var(--sig2) 55%, var(--surface));
  }
  .bq :global(.p3) {
    fill: var(--lavender);
  }
  .bq :global(.p4) {
    fill: var(--peach);
  }
  .bq :global(.fc) {
    fill: var(--butter);
  }
  .bq :global(.bud) {
    fill: var(--sig2);
  }
  .bq :global(.sway) {
    animation: nod 5s ease-in-out infinite alternate;
  }
  @keyframes nod {
    from {
      transform: rotate(-6deg);
    }
    to {
      transform: rotate(7deg);
    }
  }
  .petal {
    top: -30px;
    width: var(--s);
    height: calc(var(--s) * 1.35);
    border-radius: 80% 0 80% 0;
    background: var(--sig2);
    opacity: 0.8;
    animation: fall var(--d) linear infinite;
  }
  .petal.c1 {
    background: var(--sig1);
  }
  .petal.c2 {
    background: var(--lavender);
  }
  :global(.amb.night) .petal {
    opacity: 0.55;
    box-shadow: 0 0 10px color-mix(in srgb, var(--sig2) 60%, transparent);
  }
  @keyframes fall {
    0% {
      transform: translate(0, 0) rotate(0);
    }
    25% {
      transform: translate(var(--sw), 27vh) rotate(110deg);
    }
    50% {
      transform: translate(calc(var(--sw) * -0.3), 53vh) rotate(200deg);
    }
    75% {
      transform: translate(calc(var(--sw) * 0.8), 79vh) rotate(290deg);
    }
    100% {
      transform: translate(0, 106vh) rotate(380deg);
    }
  }
  .mote {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--sig1);
    box-shadow: 0 0 10px 3px color-mix(in srgb, var(--sig1) 55%, transparent);
    animation:
      mote var(--d) ease-in-out infinite alternate,
      lantern-glow 3s ease-in-out infinite alternate;
  }
  .mote:nth-child(odd) {
    background: var(--sig2);
    box-shadow: 0 0 10px 3px color-mix(in srgb, var(--sig2) 55%, transparent);
  }
  @keyframes mote {
    to {
      transform: translate(var(--x), var(--y));
    }
  }
  .fly-path {
    inset: 0;
    animation: flight 46s linear infinite;
    animation-delay: 4s;
    opacity: 0;
  }
  .butterfly {
    position: absolute;
    left: 0;
    top: 0;
    width: 34px;
    height: 28px;
    animation: flutter 1.6s ease-in-out infinite;
  }
  .butterfly :global(svg) {
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .butterfly :global(.wing) {
    transform-origin: 20px 16px;
    animation: beat 0.32s ease-in-out infinite alternate;
  }
  .butterfly :global(.body) {
    stroke: var(--text-muted);
  }
  @keyframes beat {
    to {
      transform: scaleX(0.25);
    }
  }
  @keyframes flutter {
    50% {
      translate: 0 -14px;
    }
  }
  @keyframes flight {
    0% {
      opacity: 0;
      transform: translate(-6vw, 78vh) rotate(18deg);
    }
    3% {
      opacity: 1;
    }
    18% {
      transform: translate(28vw, 52vh) rotate(8deg);
    }
    32% {
      transform: translate(54vw, 64vh) rotate(-6deg);
    }
    46% {
      opacity: 1;
      transform: translate(86vw, 30vh) rotate(14deg);
    }
    50%,
    100% {
      opacity: 0;
      transform: translate(108vw, 18vh) rotate(14deg);
    }
  }
  :global(.amb.still) .petal,
  :global(.amb.still) .fly-path {
    display: none;
  }
  @media (max-width: 760px) {
    .bq {
      width: 190px;
      height: 190px;
    }
    .wash {
      filter: blur(48px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .petal,
    .fly-path,
    .mote {
      display: none;
    }
  }
</style>
