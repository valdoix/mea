<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { route } from "../../lib/router.svelte";

  // Meringue: a tearoom on a rainy morning. A sugared-almond sky with clouds drifting through it,
  // bunting along the top, a teapot and a tulip on the sill and a few soft lights floating by. By
  // night it's lavender dusk: stars, a crescent moon, and the bunting turns into fairy lights.
  const HANG = [
    [45, 11.2],
    [135, 21],
    [225, 24.5],
    [315, 21.8],
    [405, 12.8],
    [495, 12.8],
    [585, 21.8],
    [675, 24.5],
    [765, 21],
    [855, 11.2],
  ] as const;
  const FLAGS = ["#f2a7c0", "#f3d27a", "#9fd6bd", "#bfb3ee"];
  const BULBS = ["#ffd6e6", "#fff0b8", "#c9f5e2", "#ddd5ff"];
  const CLOUDS = [
    { x: "62vw", y: "16vh", s: 1, d: 60, delay: 0 },
    { x: "18vw", y: "9vh", s: 0.7, d: 75, delay: -30 },
    { x: "80vw", y: "48vh", s: 0.55, d: 68, delay: -12 },
    { x: "6vw", y: "62vh", s: 0.8, d: 82, delay: -50 },
  ];
  const PUFFS = Array.from({ length: 9 }, (_, i) => ({
    x: `${(i * 37 + 9) % 100}vw`,
    y: `${(i * 53 + 20) % 90}vh`,
    s: 40 + ((i * 17) % 50),
    d: 22 + ((i * 7) % 14),
    delay: -((i * 3.1) % 20),
    c: FLAGS[i % 4],
  }));
</script>

<i class="wash"></i>
<i class="glow"></i>
<i class="stars"></i>
<i class="moon"></i>
{#each CLOUDS as c, i (i)}<i class="cloud" style:left={c.x} style:top={c.y} style:scale={c.s} style:animation-duration="{c.d}s" style:animation-delay="{c.delay}s"></i>{/each}
<svg class="garland" viewBox="0 0 900 70" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 4Q225 44 450 6Q675 44 900 4" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".45" />
  <g class="flags">{#each HANG as [x, y], i (i)}<path d="M{x - 15} {y}h30l-15 26z" fill={FLAGS[i % 4]} />{/each}</g>
  <g class="bulbs">{#each HANG as [x, y], i (i)}<circle cx={x} cy={y + 8} r="5" fill={BULBS[i % 4]} style:color={BULBS[i % 4]} style:animation-delay="{-(i % 3) * 0.8}s" />{/each}</g>
</svg>
{#if device.grain}<i class="gingham"></i>{/if}
<svg class="sill" viewBox="0 0 150 110" aria-hidden="true">
  <rect x="2" y="100" width="146" height="9" rx="3" class="q3" />
  <path d="M22 76q-16 2-10 16q4 6 9 4" fill="none" />
  <path d="M78 86q14-2 18-18l5 2q-4 22-21 25" class="q1" />
  <path d="M18 100q-6-34 32-34q38 0 32 34z" class="q1" />
  <ellipse cx="50" cy="66" rx="17" ry="4.5" class="q4" />
  <circle cx="50" cy="59" r="4.5" class="q4" />
  <g class="dots"><circle cx="36" cy="80" r="3" /><circle cx="52" cy="88" r="3" /><circle cx="66" cy="78" r="3" /><circle cx="44" cy="94" r="2.5" /><circle cx="62" cy="94" r="2.5" /></g>
  <path d="M106 100l-4-22h30l-4 22z" class="q2" />
  <path d="M117 78V48" fill="none" class="stem" />
  <path d="M117 70q-15-5-15-20q13 4 15 18z" class="q2" />
  <path d="M107 40q0-14 10-17q10 3 10 17q-5 7-10 7t-10-7z" class="bloom" />
</svg>
{#if device.fireflies}
  {#each PUFFS as p, i (i)}<i class="puff" style:left={p.x} style:top={p.y} style:width="{p.s}px" style:height="{p.s}px" style:--c={p.c} style:animation-duration="{p.d}s" style:animation-delay="{p.delay}s"></i>{/each}
{/if}
{#if route.name !== "chat"}<span class="sign">A cup of something warm</span>{/if}

<style>
  .wash {
    inset: 0;
    background:
      radial-gradient(55% 45% at 92% 0%, rgb(255 206 184 / 75%), transparent 70%),
      radial-gradient(50% 50% at 0% 100%, rgb(211 235 222 / 80%), transparent 70%),
      linear-gradient(180deg, #fde4ec, #fdf0e0 45%, #e4f1ea);
  }
  :global(.amb.night) .wash {
    background:
      radial-gradient(45% 40% at 88% 10%, rgb(196 185 244 / 30%), transparent 70%),
      radial-gradient(50% 50% at 0% 100%, rgb(245 168 197 / 16%), transparent 70%),
      linear-gradient(180deg, #24213c, #302b50 55%, #3e365c);
  }
  .glow {
    inset: 0;
    background: radial-gradient(40% 35% at 50% 40%, rgb(255 255 255 / 45%), transparent 70%);
  }
  :global(.amb.night) .glow {
    display: none;
  }
  .stars,
  .moon {
    display: none;
  }
  :global(.amb.night) .stars {
    display: block;
    inset: 0 0 30% 0;
    background:
      radial-gradient(circle, #fff 1px, transparent 1.6px) 0 0 / 53px 47px,
      radial-gradient(circle, #ffe0ef 1.3px, transparent 1.9px) 20px 30px / 89px 71px,
      radial-gradient(circle, #d9f5e9 1px, transparent 1.6px) 40px 12px / 67px 59px;
    -webkit-mask: linear-gradient(#000, transparent);
    mask: linear-gradient(#000, transparent);
    opacity: 0.8;
  }
  :global(.amb.night) .moon {
    display: block;
    right: 7vw;
    top: 12vh;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    box-shadow: inset -15px 8px 0 0 #fff1cc;
    filter: drop-shadow(0 0 18px rgb(255 236 190 / 55%));
  }
  /* clouds: three soft lobes on a pill, drifting across very slowly */
  .cloud {
    width: 150px;
    height: 44px;
    border-radius: 999px;
    background: #fff;
    opacity: 0.75;
    animation: drift 60s linear infinite alternate;
  }
  .cloud::before,
  .cloud::after {
    content: "";
    position: absolute;
    border-radius: 50%;
    background: inherit;
  }
  .cloud::before {
    left: 24px;
    top: -28px;
    width: 64px;
    height: 64px;
  }
  .cloud::after {
    left: 70px;
    top: -18px;
    width: 50px;
    height: 50px;
  }
  :global(.amb.night) .cloud {
    background: #4a4270;
    opacity: 0.45;
  }
  :global(.amb.still) .cloud {
    animation: none;
  }
  @keyframes drift {
    to {
      transform: translate3d(-14vw, 1vh, 0);
    }
  }
  .garland {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 8vh;
    min-height: 54px;
    color: #8a7584;
  }
  .bulbs {
    display: none;
  }
  :global(.amb.night) .garland {
    color: #b6a6c8;
  }
  :global(.amb.night) .flags {
    display: none;
  }
  :global(.amb.night) .bulbs {
    display: inline;
  }
  .bulbs circle {
    filter: drop-shadow(0 0 5px currentColor);
    animation: twinkle 2.4s ease-in-out infinite alternate;
  }
  @keyframes twinkle {
    to {
      opacity: 0.55;
    }
  }
  /* a faint gingham over everything */
  .gingham {
    inset: 0;
    opacity: 0.35;
    background:
      repeating-linear-gradient(0deg, rgb(242 167 192 / 14%) 0 14px, transparent 14px 28px),
      repeating-linear-gradient(90deg, rgb(242 167 192 / 14%) 0 14px, transparent 14px 28px);
    -webkit-mask: radial-gradient(80% 70% at 50% 45%, transparent 40%, #000);
    mask: radial-gradient(80% 70% at 50% 45%, transparent 40%, #000);
  }
  :global(.amb.night) .gingham {
    background:
      repeating-linear-gradient(0deg, rgb(196 185 244 / 8%) 0 14px, transparent 14px 28px),
      repeating-linear-gradient(90deg, rgb(196 185 244 / 8%) 0 14px, transparent 14px 28px);
  }
  .sill {
    position: absolute;
    right: 3vw;
    bottom: 2vh;
    width: clamp(110px, 11vw, 170px);
    height: auto;
    stroke: #86717f;
    stroke-width: 1.5;
    stroke-linejoin: round;
    opacity: 0.85;
  }
  .sill .q1 {
    fill: #f8d3df;
  }
  .sill .q2 {
    fill: #d3ebde;
  }
  .sill .q3 {
    fill: #fae6b4;
  }
  .sill .q4 {
    fill: #dcd5f2;
  }
  .sill .dots {
    fill: #fff;
    stroke: none;
    opacity: 0.8;
  }
  .sill .stem {
    stroke: #3a8a6b;
  }
  .sill .bloom {
    fill: #f2a7c0;
  }
  :global(.amb.night) .sill {
    stroke: #c6b6d2;
    opacity: 0.7;
  }
  :global(.amb.night) .sill .q1 {
    fill: #6a5080;
  }
  :global(.amb.night) .sill .q2 {
    fill: #3f6068;
  }
  :global(.amb.night) .sill .q3 {
    fill: #5d5249;
  }
  :global(.amb.night) .sill .q4 {
    fill: #534e85;
  }
  /* soft pastel lights floating up */
  .puff {
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--c) 70%, transparent), transparent 68%);
    opacity: 0.5;
    animation: float 26s ease-in-out infinite alternate;
  }
  :global(.amb.night) .puff {
    opacity: 0.28;
  }
  @keyframes float {
    to {
      transform: translate3d(30px, -60px, 0) scale(1.2);
    }
  }
  .sign {
    left: 5vw;
    bottom: 7vh;
    font: 400 clamp(1.6rem, 3vw, 2.6rem) / 1 "Young Serif", Georgia, serif;
    color: #d2789a;
    opacity: 0.45;
  }
  :global(.amb.night) .sign {
    color: #f5a8c5;
    opacity: 0.35;
  }
  @media (max-width: 760px) {
    .sill,
    .sign {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cloud,
    .puff,
    .bulbs circle {
      animation: none;
    }
  }
</style>
