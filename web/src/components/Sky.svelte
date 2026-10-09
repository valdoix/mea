<script lang="ts">
  import { device } from "../lib/device.svelte";
  import { layout } from "../lib/layout.svelte";

  // Lantern: the night sky behind everything. Fireflies are placed once, at random.
  const flies = Array.from({ length: 24 }, () => ({
    left: Math.random() * 100,
    top: Math.random() * 100,
    x: Math.random() * 180 - 90,
    y: Math.random() * 180 - 90,
    d: 9 + Math.random() * 12,
    delay: Math.random() * 3,
  }));
</script>

<div class="sky" class:dim={layout.focus} aria-hidden="true">
  <div class="stars"></div>
  <div class="blob b1"></div>
  <div class="blob b2"></div>
  <div class="blob b3"></div>
  <div class="blob b4"></div>
  <div class="shoot"></div>
  {#if device.fireflies}
    {#each flies as f, i (i)}
      <span class="fly" style:left="{f.left}%" style:top="{f.top}%" style:--x="{f.x}px" style:--y="{f.y}px" style:--d="{f.d}s" style:animation-delay="0s, {f.delay}s"></span>
    {/each}
  {/if}
</div>
{#if device.grain}<div class="grain" aria-hidden="true"></div>{/if}

<style>
  .sky {
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
  .sky.dim {
    opacity: 0.6;
    filter: saturate(0.8);
  }
  .stars {
    position: absolute;
    inset: -50%;
    background-image:
      radial-gradient(1px 1px at 10% 20%, #fff9, transparent),
      radial-gradient(1px 1px at 30% 70%, #fff6, transparent),
      radial-gradient(1.5px 1.5px at 55% 15%, #fffb, transparent),
      radial-gradient(1px 1px at 80% 40%, #fff7, transparent),
      radial-gradient(1px 1px at 90% 85%, #fff5, transparent),
      radial-gradient(1.4px 1.4px at 70% 60%, #fff8, transparent),
      radial-gradient(1px 1px at 20% 90%, #fff5, transparent),
      radial-gradient(1px 1px at 45% 45%, #fff6, transparent);
    background-size: 520px 520px;
    animation: stars 240s linear infinite;
  }
  @keyframes stars {
    to {
      transform: translate(-520px, -260px);
    }
  }
  .blob {
    position: absolute;
    border-radius: 50%;
    filter: blur(100px);
    animation: drift 24s ease-in-out infinite alternate;
  }
  .b1 {
    width: 680px;
    height: 680px;
    background: #5d3596;
    left: -160px;
    top: -200px;
    opacity: 0.55;
  }
  .b2 {
    width: 560px;
    height: 560px;
    background: #b8406f;
    right: -160px;
    top: 34%;
    opacity: 0.36;
    animation-duration: 30s;
  }
  .b3 {
    width: 620px;
    height: 440px;
    background: #19767d;
    left: 26%;
    bottom: -260px;
    opacity: 0.4;
    animation-duration: 27s;
  }
  .b4 {
    width: 300px;
    height: 300px;
    background: #ffb86b;
    left: 48%;
    top: 4%;
    opacity: 0.13;
    animation-duration: 19s;
  }
  @keyframes drift {
    to {
      transform: translate(70px, 50px) scale(1.12);
    }
  }
  .fly {
    position: absolute;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--lamp);
    box-shadow: 0 0 10px 3px rgb(255 208 143 / 55%);
    animation:
      float var(--d) ease-in-out infinite alternate,
      lantern-glow 2.8s ease-in-out infinite alternate;
  }
  @keyframes float {
    to {
      transform: translate(var(--x), var(--y));
    }
  }
  .shoot {
    position: absolute;
    top: 9%;
    left: 72%;
    width: 160px;
    height: 1.5px;
    background: linear-gradient(90deg, #fff, transparent);
    opacity: 0;
    animation: shoot 13s ease-in 5s infinite;
  }
  @keyframes shoot {
    0% {
      opacity: 0;
      transform: rotate(-18deg) translateX(0);
    }
    3% {
      opacity: 1;
    }
    9% {
      opacity: 0;
      transform: rotate(-18deg) translateX(-460px);
    }
    100% {
      opacity: 0;
    }
  }
  .grain {
    position: fixed;
    inset: 0;
    z-index: 300;
    pointer-events: none;
    opacity: 0.055;
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  @media (max-width: 760px) {
    .blob {
      filter: blur(70px);
    }
  }
</style>
