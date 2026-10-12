<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { route } from "../../lib/router.svelte";

  // Rosewater Vanity: folds of silk drifting through warm light, strands of pearls swagged across
  // the top, a satin bow, gold roses in every corner, rose petals falling and sparkles catching
  // the light.
  const LIGHTS = [
    { x: "14vw", y: "22vh", s: 160, d: 26, delay: 0 },
    { x: "76vw", y: "64vh", s: 120, d: 31, delay: -9 },
    { x: "58vw", y: "14vh", s: 90, d: 24, delay: -15 },
    { x: "30vw", y: "78vh", s: 110, d: 29, delay: -5 },
  ];
  const PETALS = Array.from({ length: 14 }, (_, i) => ({
    x: `${(i * 41 + 7) % 100}vw`,
    s: 14 + ((i * 7) % 12),
    d: 16 + ((i * 5) % 12),
    delay: -((i * 2.9) % 24),
    r: (i * 47) % 360,
    deep: i % 3 === 0,
  }));
  const SPARKS = [
    { x: "22vw", y: "30vh", s: 14, delay: 0 },
    { x: "68vw", y: "20vh", s: 18, delay: -1.2 },
    { x: "84vw", y: "46vh", s: 12, delay: -2.1 },
    { x: "40vw", y: "70vh", s: 16, delay: -0.6 },
    { x: "8vw", y: "54vh", s: 12, delay: -1.8 },
    { x: "56vw", y: "86vh", s: 14, delay: -2.6 },
  ];
</script>

<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <g id="rw-rose">
      <path d="M100 250C96 205 108 160 100 108" />
      <path d="M100 196C72 188 60 166 62 148c22 4 35 22 38 48z" />
      <path d="M101 164c26-8 38-24 38-42-22 3-35 20-38 42z" />
      <path d="M70 92c-2-30 62-30 60 0-4 22-56 22-60 0z" />
      <path d="M76 80c2-20 16-28 24-22 8-6 22 2 24 22" />
      <path d="M100 68c-12 2-14 18-2 20 12 2 14-12 4-14-6-1-8 6-2 8" />
      <path d="M84 100c6 8 26 8 32 0" />
      <path d="M66 86c-10-4-14 6-8 12M134 86c10-4 14 6 8 12" />
    </g>
    <linearGradient id="rw-satin" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f7d3d9" />
      <stop offset=".45" stop-color="#e79aab" />
      <stop offset=".55" stop-color="#fbe3e7" />
      <stop offset="1" stop-color="#c96a82" />
    </linearGradient>
  </defs>
</svg>

<i class="wash"></i>
<i class="silk f1"></i><i class="silk f2"></i><i class="silk f3"></i>
{#if device.grain}<i class="lattice"></i><i class="leaf"></i>{/if}
<svg class="rose tl" viewBox="0 0 200 260" aria-hidden="true"><use href="#rw-rose" /></svg>
<svg class="rose tr" viewBox="0 0 200 260" aria-hidden="true"><use href="#rw-rose" /></svg>
<svg class="rose bl" viewBox="0 0 200 260" aria-hidden="true"><use href="#rw-rose" /></svg>
<svg class="rose br" viewBox="0 0 200 260" aria-hidden="true"><use href="#rw-rose" /></svg>
<svg class="pearls" viewBox="0 0 1200 140" preserveAspectRatio="none" aria-hidden="true">
  <path class="p1" d="M-10 6Q300 130 600 6Q900 130 1210 6" />
  <path class="p2" d="M-10 6Q150 70 300 6Q450 70 600 6Q750 70 900 6Q1050 70 1210 6" />
</svg>
<svg class="bow" viewBox="0 0 120 104" aria-hidden="true">
  <path d="M56 46c-6 20-16 36-26 50l12-4 4 8c8-18 12-36 14-52zM64 46c6 20 16 36 26 50l-12-4-4 8c-8-18-12-36-14-52z" />
  <path d="M60 40C40 8 6 12 12 36c4 18 32 16 48 4zM60 40c20-32 54-28 48-4-4 18-32 16-48 4z" />
  <ellipse cx="60" cy="41" rx="8" ry="9" />
</svg>
{#if device.fireflies}
  {#each LIGHTS as b, i (i)}<i class="light" style:left={b.x} style:top={b.y} style:width="{b.s}px" style:height="{b.s}px" style:animation-duration="{b.d}s" style:animation-delay="{b.delay}s"></i>{/each}
  {#each PETALS as p, i (i)}<i class="petal" class:deep={p.deep} style:left={p.x} style:width="{p.s}px" style:height="{p.s * 1.25}px" style:--r="{p.r}deg" style:animation-duration="{p.d}s" style:animation-delay="{p.delay}s"></i>{/each}
  {#each SPARKS as s, i (i)}<i class="spark" style:left={s.x} style:top={s.y} style:width="{s.s}px" style:height="{s.s}px" style:animation-delay="{s.delay}s"></i>{/each}
{/if}
{#if route.name !== "chat"}<span class="sign">Blush, powder, prose</span>{/if}

<style>
  .wash {
    inset: 0;
    background:
      radial-gradient(70% 55% at 85% 0%, color-mix(in srgb, var(--lamp) 60%, transparent), transparent 70%),
      radial-gradient(60% 60% at 0% 100%, color-mix(in srgb, var(--blush) 65%, transparent), transparent 70%),
      radial-gradient(40% 40% at 50% 50%, color-mix(in srgb, var(--pearl) 60%, transparent), transparent 70%),
      linear-gradient(160deg, var(--bg), color-mix(in srgb, var(--bg) 80%, var(--blush)));
  }
  :global(.amb.night) .wash {
    background:
      radial-gradient(60% 50% at 85% 0%, rgb(232 180 160 / 16%), transparent 70%),
      radial-gradient(60% 60% at 0% 100%, rgb(143 58 85 / 45%), transparent 70%),
      linear-gradient(160deg, var(--bg), #2a0f1c);
  }
  /* silk: long soft folds with a sheen along each, drifting very slowly */
  .silk {
    width: 130vw;
    height: 34vh;
    left: -15vw;
    border-radius: 50%;
    background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--pearl) 75%, transparent) 42%, color-mix(in srgb, #fff 60%, transparent) 50%, color-mix(in srgb, var(--blush) 55%, transparent) 60%, transparent);
    filter: blur(26px);
    opacity: 0.8;
    rotate: -14deg;
    animation: sway 34s ease-in-out infinite alternate;
  }
  .silk.f1 {
    top: 6vh;
  }
  .silk.f2 {
    top: 46vh;
    rotate: -9deg;
    opacity: 0.6;
    animation-duration: 42s;
    animation-delay: -14s;
  }
  .silk.f3 {
    top: 78vh;
    rotate: -18deg;
    opacity: 0.5;
    animation-duration: 38s;
    animation-delay: -24s;
  }
  :global(.amb.night) .silk {
    background: linear-gradient(180deg, transparent, rgb(143 58 85 / 45%) 42%, rgb(232 180 160 / 20%) 50%, rgb(143 58 85 / 35%) 60%, transparent);
  }
  @keyframes sway {
    to {
      transform: translate3d(-4vw, 3vh, 0) scaleY(1.15);
    }
  }
  /* a trellis of gold and flecks of gold leaf */
  .lattice {
    inset: 0;
    opacity: 0.5;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='90' viewBox='0 0 90 90'%3E%3Cg fill='none' stroke='%23b08a4e' stroke-opacity='.18'%3E%3Cpath d='M0 45L45 0l45 45-45 45z'/%3E%3Ccircle cx='45' cy='45' r='3'/%3E%3Ccircle cx='0' cy='0' r='3'/%3E%3Ccircle cx='90' cy='90' r='3'/%3E%3C/g%3E%3C/svg%3E") 0 0 / 90px 90px;
    -webkit-mask: radial-gradient(80% 70% at 50% 45%, transparent 35%, #000);
    mask: radial-gradient(80% 70% at 50% 45%, transparent 35%, #000);
  }
  .leaf {
    inset: 0;
    opacity: 0.6;
    background-image:
      radial-gradient(1.2px 1.2px at 30px 40px, var(--gold) 98%, transparent),
      radial-gradient(2.5px 1.2px at 140px 120px, var(--gold-hi) 98%, transparent),
      radial-gradient(1px 1px at 210px 30px, var(--gold) 98%, transparent),
      radial-gradient(1.5px 1.5px at 90px 200px, var(--gold-hi) 98%, transparent);
    background-size: 260px 240px;
  }
  .rose {
    position: absolute;
    width: clamp(150px, 17vw, 250px);
    height: auto;
    fill: color-mix(in srgb, var(--blush) 22%, transparent);
    stroke: var(--gold);
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.55;
  }
  .rose.tl {
    left: 1vw;
    top: 8vh;
    rotate: 150deg;
    scale: 0.8;
  }
  .rose.tr {
    right: 1vw;
    top: 8vh;
    rotate: 210deg;
  }
  .rose.bl {
    left: 2vw;
    bottom: 1vh;
    rotate: 18deg;
  }
  .rose.br {
    right: 2vw;
    bottom: 1vh;
    rotate: -24deg;
    scale: 0.85;
  }
  /* pearls swagged across the top: zero-length dashes with round caps are beads */
  .pearls {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 16vh;
    fill: none;
    stroke-linecap: round;
    filter: drop-shadow(0 2px 2px rgb(120 50 70 / 25%));
  }
  .pearls path {
    stroke: var(--bulb);
    vector-effect: non-scaling-stroke;
  }
  .pearls .p1 {
    stroke-width: 10;
    stroke-dasharray: 0 15;
  }
  .pearls .p2 {
    stroke-width: 6;
    stroke-dasharray: 0 10;
    opacity: 0.8;
  }
  :global(.amb.night) .pearls path {
    stroke: #f7e6d0;
  }
  .bow {
    position: absolute;
    left: 50%;
    top: -6px;
    width: 120px;
    translate: -50% 0;
    fill: url(#rw-satin);
    stroke: var(--gold);
    stroke-width: 1;
    filter: drop-shadow(0 6px 8px rgb(150 50 80 / 30%));
  }
  .light {
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--bulb) 80%, transparent), transparent 68%);
    opacity: 0.5;
    animation: float 26s ease-in-out infinite alternate;
  }
  :global(.amb.night) .light {
    background: radial-gradient(circle, rgb(243 220 176 / 30%), transparent 68%);
  }
  @keyframes float {
    to {
      transform: translate3d(-50px, 30px, 0) scale(1.2);
    }
  }
  /* rose petals, velvety, falling and turning */
  .petal {
    top: -40px;
    border-radius: 80% 10% 80% 30%;
    background: radial-gradient(120% 90% at 30% 20%, #ffe3e8, #f2a5b6 55%, #d9738d);
    box-shadow: inset -2px -3px 4px rgb(160 40 80 / 25%);
    opacity: 0.85;
    animation: fall 20s linear infinite;
  }
  .petal.deep {
    background: radial-gradient(120% 90% at 30% 20%, #f7b3c2, #c9536f 55%, #8f2a46);
  }
  @keyframes fall {
    0% {
      transform: translate3d(0, 0, 0) rotate(var(--r));
    }
    25% {
      transform: translate3d(40px, 28vh, 0) rotate(calc(var(--r) + 90deg));
    }
    50% {
      transform: translate3d(-20px, 56vh, 0) rotate(calc(var(--r) + 180deg));
    }
    75% {
      transform: translate3d(30px, 84vh, 0) rotate(calc(var(--r) + 270deg));
    }
    100% {
      transform: translate3d(0, 112vh, 0) rotate(calc(var(--r) + 360deg));
    }
  }
  /* sparkles: four-point stars that catch the light in turn */
  .spark {
    background: radial-gradient(circle, #fff, var(--gold-hi) 60%);
    clip-path: polygon(50% 0, 60% 40%, 100% 50%, 60% 60%, 50% 100%, 40% 60%, 0 50%, 40% 40%);
    animation: glint 3s ease-in-out infinite;
  }
  @keyframes glint {
    0%,
    100% {
      transform: scale(0.2) rotate(0deg);
      opacity: 0;
    }
    50% {
      transform: scale(1) rotate(45deg);
      opacity: 1;
    }
  }
  .sign {
    right: 6vw;
    bottom: 8vh;
    font: italic 400 clamp(1.8rem, 3.4vw, 3rem) / 1 "Playfair Display Variable", Georgia, serif;
    color: var(--gold);
    opacity: 0.5;
  }
  :global(.amb.still) .silk {
    animation: none;
  }
  @media (max-width: 760px) {
    .rose.tl,
    .rose.tr,
    .sign {
      display: none;
    }
    .bow {
      width: 80px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .silk,
    .light,
    .spark {
      animation: none;
    }
    .petal {
      display: none;
    }
  }
</style>
