<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { route } from "../../lib/router.svelte";

  // Rosewater Vanity: the arched mirror with its ring of bulbs, bokeh drifting through soft light,
  // powder shimmer and a whisper of damask on the wall.
  const BOKEH = [
    { x: "12vw", y: "18vh", s: 180, c: "var(--blush)", d: 22, delay: 0 },
    { x: "70vw", y: "60vh", s: 120, c: "var(--gold-hi)", d: 27, delay: -6 },
    { x: "84vw", y: "12vh", s: 220, c: "var(--blush)", d: 31, delay: -12 },
    { x: "30vw", y: "74vh", s: 90, c: "var(--bulb)", d: 24, delay: -4 },
    { x: "52vw", y: "30vh", s: 70, c: "var(--gold-hi)", d: 20, delay: -15 },
    { x: "6vw", y: "62vh", s: 140, c: "var(--bulb)", d: 29, delay: -9 },
    { x: "92vw", y: "82vh", s: 100, c: "var(--blush)", d: 26, delay: -2 },
  ];
</script>

<i class="glow"></i>
{#if device.grain}<i class="damask"></i>{/if}
<i class="mirror"><i class="bulbs a"></i><i class="bulbs b"></i></i>
{#if device.fireflies}
  {#each BOKEH as b, i (i)}<i class="bokeh" style:left={b.x} style:top={b.y} style:width="{b.s}px" style:height="{b.s}px" style:--c={b.c} style:animation-duration="{b.d}s" style:animation-delay="{b.delay}s"></i>{/each}
{/if}
{#if device.grain}<i class="powder"></i>{/if}
{#if route.name !== "chat"}<span class="sign">Blush, powder, prose</span>{/if}

<style>
  .glow {
    inset: 0;
    background:
      radial-gradient(46% 50% at 50% 8%, color-mix(in srgb, var(--bulb) 70%, transparent), transparent 70%),
      radial-gradient(60% 50% at 0% 100%, color-mix(in srgb, var(--blush) 35%, transparent), transparent 70%),
      radial-gradient(50% 40% at 100% 90%, color-mix(in srgb, var(--gold-hi) 30%, transparent), transparent 70%);
  }
  :global(.amb.night) .glow {
    background:
      radial-gradient(46% 50% at 50% 8%, rgb(255 210 160 / 18%), transparent 70%),
      radial-gradient(60% 50% at 0% 100%, rgb(194 87 122 / 35%), transparent 70%),
      radial-gradient(50% 40% at 100% 90%, rgb(240 207 148 / 14%), transparent 70%);
  }
  .damask {
    inset: 0;
    opacity: 0.5;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='160' viewBox='0 0 120 160'%3E%3Cg fill='none' stroke='%23c39557' stroke-opacity='.22' stroke-width='1.2'%3E%3Cpath d='M60 20c14 16 22 30 0 60C38 50 46 36 60 20zM60 80c18 6 34 20 34 40-16-2-28-14-34-40zM60 80c-18 6-34 20-34 40 16-2 28-14 34-40zM60 100v40M50 140h20'/%3E%3Ccircle cx='60' cy='12' r='4'/%3E%3C/g%3E%3C/svg%3E") 0 0 / 120px 160px;
    -webkit-mask: linear-gradient(90deg, #000, transparent 22%, transparent 78%, #000);
    mask: linear-gradient(90deg, #000, transparent 22%, transparent 78%, #000);
  }
  /* the vanity mirror: an arch outlined in bulbs, two sets twinkling in turn */
  .mirror {
    left: 50%;
    top: 4vh;
    width: min(74vw, 980px);
    height: 92vh;
    translate: -50% 0;
    border-radius: 50% 50% 0 0 / 34% 34% 0 0;
    background: radial-gradient(70% 60% at 50% 30%, color-mix(in srgb, #fff 30%, transparent), transparent 70%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gold) 30%, transparent);
    -webkit-mask: linear-gradient(#000 60%, transparent);
    mask: linear-gradient(#000 60%, transparent);
  }
  :global(.amb.night) .mirror {
    background: radial-gradient(70% 60% at 50% 30%, rgb(255 230 200 / 7%), transparent 70%);
  }
  .bulbs {
    position: absolute;
    inset: 0;
    padding: 14px;
    border-radius: inherit;
    background: radial-gradient(circle, var(--bulb) 0 5px, transparent 6px) 0 0 / 56px 56px;
    -webkit-mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    mask-composite: exclude;
    filter: drop-shadow(0 0 6px #ffd98a) drop-shadow(0 0 14px rgb(255 217 138 / 60%));
    animation: twinkle 3.2s ease-in-out infinite;
  }
  .bulbs.b {
    background-position: 28px 28px;
    animation-delay: -1.6s;
  }
  @keyframes twinkle {
    50% {
      opacity: 0.35;
    }
  }
  .bokeh {
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--c) 60%, transparent) 0 55%, transparent 70%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 50%, transparent);
    filter: blur(3px);
    opacity: 0.45;
    animation: float 24s ease-in-out infinite alternate;
  }
  :global(.amb.night) .bokeh {
    opacity: 0.35;
  }
  @keyframes float {
    to {
      transform: translate3d(-60px, 40px, 0) scale(1.15);
    }
  }
  .powder {
    inset: 0;
    opacity: 0.6;
    background-image:
      radial-gradient(1px 1px at 20px 30px, var(--gold) 98%, transparent),
      radial-gradient(1.5px 1.5px at 90px 110px, #fff 98%, transparent),
      radial-gradient(1px 1px at 150px 60px, var(--gold) 98%, transparent),
      radial-gradient(1px 1px at 60px 150px, #fff 98%, transparent);
    background-size: 180px 170px;
    animation: shimmer 5s ease-in-out infinite alternate;
  }
  @keyframes shimmer {
    from {
      opacity: 0.25;
    }
    to {
      opacity: 0.7;
    }
  }
  .sign {
    right: 5vw;
    bottom: 7vh;
    font: italic 400 clamp(1.8rem, 3.4vw, 3rem) / 1 "Playfair Display Variable", Georgia, serif;
    color: var(--gold);
    opacity: 0.5;
  }
  :global(.amb.still) .bulbs,
  :global(.amb.still) .powder {
    animation: none;
  }
  @media (max-width: 760px) {
    .mirror {
      width: 92vw;
    }
    .sign {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bulbs,
    .bokeh,
    .powder {
      animation: none;
    }
  }
</style>
