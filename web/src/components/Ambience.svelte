<script lang="ts">
  import { device } from "../lib/device.svelte";
  import { layout } from "../lib/layout.svelte";
  import { route } from "../lib/router.svelte";
  import { BUTTERFLY, spray } from "../lib/ornaments";
  import { app } from "../lib/state.svelte";
  import type { RoomId } from "../lib/themes";

  // The living backdrop behind the four rooms, as Sky is for Lantern. "Drifting things" (petals,
  // snow, embers, searchlights) follow the fireflies switch; texture follows the grain switch.
  let { theme }: { theme: RoomId } = $props();

  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const petals = Array.from({ length: 16 }, (_, i) => ({ left: rand(0, 100), d: rand(13, 24), delay: -rand(0, 24), size: rand(7, 13), sway: rand(20, 70), c: i % 3 }));
  const motes = Array.from({ length: 18 }, () => ({ left: rand(0, 100), top: rand(0, 100), x: rand(-80, 80), y: rand(-80, 80), d: rand(9, 18), delay: rand(0, 4) }));
  const embers = Array.from({ length: 22 }, () => ({ left: rand(0, 100), d: rand(9, 18), delay: -rand(0, 18), drift: rand(-60, 60), size: rand(2, 4) }));
  const SPRAY = spray();
</script>

<div class="amb a-{theme}" class:night={app.night} class:dim={layout.focus} class:still={!device.fireflies} aria-hidden="true">
  {#if theme === "wildflower"}
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
  {:else if theme === "overprint"}
    <i class="dots pink"></i><i class="dots blue"></i>
    <i class="ring r1"></i><i class="ring r2"></i><i class="ring r3"></i><i class="ring r4"></i>
    <span class="reg rg1"></span><span class="reg rg2"></span>
    <span class="slug">Mea · two-colour edition · pass {app.night ? "02" : "01"}</span>
  {:else if theme === "citadel"}
    <i class="mottle"></i>
    <i class="candle"></i>
    <i class="vignette"></i>
    {#if app.night && device.fireflies}
      <i class="snow s1"></i><i class="snow s2"></i><i class="snow s3"></i>
      {#each embers as e, i (i)}
        <span class="ember" style:left="{e.left}%" style:--d="{e.d}s" style:--dx="{e.drift}px" style:--s="{e.size}px" style:animation-delay="{e.delay}s"></span>
      {/each}
    {/if}
  {:else if theme === "marquee"}
    {#if device.grain}<i class="brick"></i>{/if}
    <i class="spill s1"></i><i class="spill s2"></i><i class="spill s3"></i>
    {#if device.fireflies}<i class="beam b1"></i><i class="beam b2"></i>{/if}
    {#if route.name !== "chat"}<span class="sign">{app.night ? "open late" : "now showing"}</span>{/if}
  {/if}
</div>
{#if device.grain && theme !== "marquee"}<div class="tex t-{theme}" class:night={app.night} aria-hidden="true"></div>{/if}

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
  .amb > i,
  .amb > span,
  .amb > div {
    position: absolute;
  }
  .tex {
    position: fixed;
    inset: 0;
    z-index: 300;
    pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    mix-blend-mode: multiply;
    opacity: 0.06;
  }
  .tex.night {
    mix-blend-mode: screen;
    opacity: 0.035;
  }
  .tex.t-overprint {
    opacity: 0.12;
  }
  .tex.t-overprint.night {
    opacity: 0.06;
  }
  .tex.t-citadel {
    opacity: 0.1;
  }

  /* ================= Wildflower ================= */
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
  .night .wash {
    opacity: 0.16;
  }
  .night .w2 {
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
  .night .bq {
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
  .amb :global(.stem) {
    fill: none;
    stroke: var(--leaf);
    stroke-width: 1.6;
    stroke-linecap: round;
  }
  .amb :global(.lf) {
    fill: var(--leaf);
    opacity: 0.85;
  }
  .amb :global(.lf2) {
    fill: var(--sig1);
  }
  .amb :global(.p1) {
    fill: var(--sig2);
  }
  .amb :global(.p2) {
    fill: color-mix(in srgb, var(--sig2) 55%, var(--surface));
  }
  .amb :global(.p3) {
    fill: var(--lavender);
  }
  .amb :global(.p4) {
    fill: var(--peach);
  }
  .amb :global(.fc) {
    fill: var(--butter);
  }
  .amb :global(.bud) {
    fill: var(--sig2);
  }
  .amb :global(.sway) {
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
  .night .petal {
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

  /* ================= Overprint ================= */
  .dots {
    inset: -40px;
    opacity: 0.22;
    -webkit-mask: radial-gradient(70% 60% at var(--mx) var(--my), #000, transparent 70%);
    mask: radial-gradient(70% 60% at var(--mx) var(--my), #000, transparent 70%);
    animation: dots 60s linear infinite;
  }
  .dots.pink {
    --mx: 88%;
    --my: 10%;
    background: radial-gradient(circle, var(--accent) 1.6px, transparent 2.2px) 0 0 / 11px 11px;
  }
  .dots.blue {
    --mx: 10%;
    --my: 92%;
    background: radial-gradient(circle, var(--sig2) 1.6px, transparent 2.2px) 3px 4px / 11px 11px;
    animation-direction: reverse;
  }
  .night .dots {
    opacity: 0.2;
  }
  @keyframes dots {
    to {
      transform: translate(33px, 22px);
    }
  }
  .ring {
    border-radius: 50%;
    mix-blend-mode: multiply;
    opacity: 0.22;
    animation: register 9s ease-in-out infinite alternate;
  }
  .night .ring {
    mix-blend-mode: screen;
    opacity: 0.16;
  }
  .r1 {
    width: 420px;
    height: 420px;
    right: -120px;
    top: 8%;
    background: var(--accent);
  }
  .r2 {
    width: 300px;
    height: 300px;
    right: 120px;
    top: 30%;
    background: var(--sig2);
    animation-duration: 11s;
    animation-direction: alternate-reverse;
  }
  .r3 {
    width: 240px;
    height: 240px;
    left: -60px;
    bottom: 6%;
    background: var(--sig1);
    opacity: 0.4;
    animation-duration: 13s;
  }
  .night .r3 {
    opacity: 0.12;
  }
  .r4 {
    width: 140px;
    height: 140px;
    left: 130px;
    bottom: 22%;
    background: transparent;
    border: 14px solid var(--accent);
    opacity: 0.18;
    animation-duration: 7s;
  }
  @keyframes register {
    0%,
    100% {
      translate: 0 0;
    }
    45% {
      translate: 5px -3px;
    }
    50% {
      translate: -2px 2px;
    }
    55% {
      translate: 3px 1px;
    }
  }
  .reg {
    width: 22px;
    height: 22px;
    opacity: 0.45;
    background:
      linear-gradient(var(--text), var(--text)) center / 1px 100% no-repeat,
      linear-gradient(var(--text), var(--text)) center / 100% 1px no-repeat;
  }
  .reg::after {
    content: "";
    position: absolute;
    inset: 5px;
    border-radius: 50%;
    border: 1px solid var(--text);
  }
  .rg1 {
    right: 18px;
    top: 18px;
  }
  .rg2 {
    left: 18px;
    bottom: 18px;
  }
  .slug {
    right: 48px;
    bottom: 16px;
    font: 400 10px var(--font-meta, monospace);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
    opacity: 0.7;
  }

  /* ================= Citadel ================= */
  .mottle {
    inset: 0;
    background: var(--sig1);
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='520' height='520'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.009' numOctaves='5' seed='9' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.4 -1.05'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23p)'/%3E%3C/svg%3E") 0 0 / 520px 520px;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='520' height='520'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.009' numOctaves='5' seed='9' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.4 -1.05'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23p)'/%3E%3C/svg%3E") 0 0 / 520px 520px;
    opacity: 0.26;
  }
  .night .mottle {
    background: var(--sig2);
    opacity: 0.08;
  }
  .candle {
    left: -160px;
    top: -160px;
    width: 640px;
    height: 640px;
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, #ffcf7a 40%, transparent), transparent 65%);
    animation: candle 3.4s ease-in-out infinite;
  }
  .night .candle {
    left: auto;
    top: auto;
    right: -200px;
    bottom: -200px;
    background: radial-gradient(circle, color-mix(in srgb, var(--accent) 22%, transparent), transparent 65%);
  }
  @keyframes candle {
    0%,
    100% {
      opacity: 1;
      scale: 1;
    }
    38% {
      opacity: 0.8;
      scale: 0.98;
    }
    41% {
      opacity: 0.95;
    }
    66% {
      opacity: 0.74;
      scale: 1.02;
    }
    70% {
      opacity: 0.92;
    }
  }
  .vignette {
    inset: 0;
    background: radial-gradient(130% 95% at 50% 40%, transparent 55%, color-mix(in srgb, #2a2018 26%, transparent));
  }
  .night .vignette {
    background: radial-gradient(120% 90% at 50% 35%, transparent 50%, rgb(0 0 0 / 55%));
  }
  .snow {
    inset: 0;
    background-image:
      radial-gradient(2px 2px at 20px 30px, #ffffffb0, transparent),
      radial-gradient(1.6px 1.6px at 90px 130px, #ffffff90, transparent),
      radial-gradient(2.4px 2.4px at 160px 60px, #ffffffa0, transparent),
      radial-gradient(1.4px 1.4px at 210px 190px, #ffffff80, transparent),
      radial-gradient(1.8px 1.8px at 60px 210px, #ffffff90, transparent);
    background-size: 240px 240px;
    animation: snow 16s linear infinite;
  }
  .snow.s2 {
    background-size: 380px 380px;
    animation: snow2 26s linear infinite;
    opacity: 0.6;
    filter: blur(0.6px);
  }
  .snow.s3 {
    background-size: 560px 560px;
    animation: snow3 11s linear infinite;
    opacity: 0.5;
    filter: blur(1.4px);
    scale: 1.6;
  }
  @keyframes snow {
    to {
      background-position: 40px 240px;
    }
  }
  @keyframes snow2 {
    to {
      background-position: -60px 380px;
    }
  }
  @keyframes snow3 {
    to {
      background-position: 80px 560px;
    }
  }
  .ember {
    bottom: -10px;
    width: var(--s);
    height: var(--s);
    border-radius: 50%;
    background: #ffb26b;
    box-shadow:
      0 0 6px 2px rgb(255 140 60 / 70%),
      0 0 14px 4px rgb(184 77 40 / 40%);
    animation: rise var(--d) ease-in infinite;
  }
  @keyframes rise {
    0% {
      opacity: 0;
      transform: translate(0, 0);
    }
    10% {
      opacity: 1;
    }
    60% {
      opacity: 0.7;
    }
    100% {
      opacity: 0;
      transform: translate(var(--dx), -70vh);
    }
  }

  /* ================= Marquee ================= */
  .brick {
    inset: 0;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='56'%3E%3Cpath d='M0 .5H64M0 28.5H64M.5 0V28M32.5 28V56' fill='none' stroke='%231b1630' stroke-opacity='.06'/%3E%3C/svg%3E");
  }
  .night .brick {
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='56'%3E%3Cpath d='M0 .5H64M0 28.5H64M.5 0V28M32.5 28V56' fill='none' stroke='%23fff' stroke-opacity='.05'/%3E%3C/svg%3E");
    -webkit-mask: radial-gradient(120% 90% at 50% 30%, #000 40%, transparent);
    mask: radial-gradient(120% 90% at 50% 30%, #000 40%, transparent);
  }
  .spill {
    border-radius: 50%;
    filter: blur(70px);
    animation: hum 6s ease-in-out infinite alternate;
  }
  .spill.s1 {
    width: 620px;
    height: 520px;
    left: -200px;
    top: -200px;
    background: var(--n2);
    opacity: calc(0.3 * var(--gl));
  }
  .spill.s2 {
    width: 640px;
    height: 560px;
    right: -220px;
    bottom: -220px;
    background: var(--n1);
    opacity: calc(0.28 * var(--gl));
    animation-duration: 8s;
  }
  .spill.s3 {
    width: 460px;
    height: 360px;
    left: 52%;
    top: -180px;
    background: var(--n3);
    opacity: calc(0.24 * var(--gl));
    animation-duration: 7s;
  }
  .amb.a-marquee:not(.night) .spill {
    opacity: 0.22;
  }
  @keyframes hum {
    0%,
    100% {
      scale: 1;
    }
    50% {
      scale: 1.08;
    }
  }
  .beam {
    bottom: -40vh;
    width: 46vw;
    height: 140vh;
    transform-origin: 50% 100%;
    background: conic-gradient(from -8deg at 50% 100%, transparent, color-mix(in srgb, var(--n1) 22%, transparent) 4deg, color-mix(in srgb, #fff 10%, transparent) 8deg, color-mix(in srgb, var(--n1) 22%, transparent) 12deg, transparent 16deg);
    -webkit-mask: linear-gradient(transparent, #000 40%);
    mask: linear-gradient(transparent, #000 40%);
    opacity: calc(0.75 * var(--gl));
    animation: sweep 18s ease-in-out infinite alternate;
  }
  .beam.b1 {
    left: 2vw;
    rotate: -24deg;
  }
  .beam.b2 {
    right: 4vw;
    rotate: 20deg;
    background: conic-gradient(from -8deg at 50% 100%, transparent, color-mix(in srgb, var(--n2) 20%, transparent) 4deg, color-mix(in srgb, #fff 9%, transparent) 8deg, color-mix(in srgb, var(--n2) 20%, transparent) 12deg, transparent 16deg);
    animation-duration: 23s;
    animation-delay: -6s;
  }
  .amb.a-marquee:not(.night) .beam {
    opacity: 0.28;
  }
  @keyframes sweep {
    from {
      transform: rotate(-16deg);
    }
    to {
      transform: rotate(18deg);
    }
  }
  .sign {
    right: 4vw;
    bottom: 7vh;
    font: 400 clamp(3rem, 6vw, 5.4rem) / 1 var(--font-script);
    rotate: -8deg;
    --ng: var(--n3);
    color: var(--nt-violet);
    --o: 0.55;
    opacity: var(--o);
    text-shadow:
      0 0 calc(4px * var(--gl)) var(--ng),
      0 0 calc(14px * var(--gl)) var(--ng),
      0 0 calc(34px * var(--gl)) var(--ng);
    animation: flick 9s infinite -3s;
  }
  .amb.a-marquee:not(.night) .sign {
    --o: 0.3;
  }
  @keyframes flick {
    0%,
    30%,
    32%,
    34%,
    72%,
    74%,
    100% {
      opacity: var(--o, 0.55);
    }
    31%,
    33%,
    73% {
      opacity: 0.12;
    }
  }

  .still .petal,
  .still .fly-path {
    display: none;
  }
  @media (max-width: 760px) {
    .bq {
      width: 190px;
      height: 190px;
    }
    .wash,
    .spill {
      filter: blur(48px);
    }
    .sign {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .petal,
    .fly-path,
    .ember,
    .mote,
    .beam {
      display: none;
    }
  }
</style>
