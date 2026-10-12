<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { app } from "../../lib/state.svelte";

  // Citadel's hall: mottled parchment, a guttering candle, and by night snow and embers.
  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const embers = Array.from({ length: 22 }, () => ({ left: rand(0, 100), d: rand(9, 18), delay: -rand(0, 18), drift: rand(-60, 60), size: rand(2, 4) }));
</script>

<i class="mottle"></i>
<i class="candle"></i>
<i class="vignette"></i>
{#if app.night && device.fireflies}
  <i class="snow s1"></i><i class="snow s2"></i><i class="snow s3"></i>
  {#each embers as e, i (i)}
    <span class="ember" style:left="{e.left}%" style:--d="{e.d}s" style:--dx="{e.drift}px" style:--s="{e.size}px" style:animation-delay="{e.delay}s"></span>
  {/each}
{/if}

<style>
  .mottle {
    inset: 0;
    background: var(--sig1);
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='520' height='520'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.009' numOctaves='5' seed='9' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.4 -1.05'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23p)'/%3E%3C/svg%3E") 0 0 / 520px 520px;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='520' height='520'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.009' numOctaves='5' seed='9' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.4 -1.05'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23p)'/%3E%3C/svg%3E") 0 0 / 520px 520px;
    opacity: 0.26;
  }
  :global(.amb.night) .mottle {
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
  :global(.amb.night) .candle {
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
  :global(.amb.night) .vignette {
    background: radial-gradient(120% 90% at 50% 35%, transparent 50%, rgb(0 0 0 / 55%));
  }
  /* Snow falls by moving each layer, not its background: animating background-position on a
     screen-sized layer repaints it every frame (VENUS measured half the frame rate in an embedded
     browser), while a transform stays on the compositor. Each layer is one tile taller and wider
     on the side it moves from, so it still covers the screen at both ends of the loop. */
  .snow {
    --tx: 40px;
    --ty: 240px;
    top: calc(var(--ty) * -1);
    bottom: 0;
    left: calc(var(--tx) * -1);
    right: 0;
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
    --tx: -60px;
    --ty: 380px;
    left: 0;
    right: var(--tx);
    background-size: 380px 380px;
    animation-duration: 26s;
    opacity: 0.6;
    filter: blur(0.6px);
  }
  .snow.s3 {
    --tx: 80px;
    --ty: 560px;
    background-size: 560px 560px;
    animation-duration: 11s;
    opacity: 0.5;
    filter: blur(1.4px);
    scale: 1.6;
  }
  @keyframes snow {
    to {
      transform: translate3d(var(--tx), var(--ty), 0);
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
  @media (prefers-reduced-motion: reduce) {
    .ember {
      display: none;
    }
  }
</style>
