<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { route } from "../../lib/router.svelte";
  import { app } from "../../lib/state.svelte";

  // Noir Salon: a gilt sunburst turning behind everything, Deco fans in the corners, gold
  // pinstripes, champagne rising, and after midnight smoke drifting under a spotlight.
  const BUBBLES = Array.from({ length: 16 }, (_, i) => ({
    x: `${(i * 37 + 11) % 100}vw`,
    s: 3 + ((i * 7) % 6),
    d: 14 + ((i * 5) % 12),
    delay: -((i * 3.7) % 20),
  }));
</script>

<i class="light"></i>
<i class="sun"></i>
{#if device.grain}<i class="stripes"></i>{/if}
<i class="fan tr"></i><i class="fan bl"></i>
{#if app.night}<i class="smoke s1"></i><i class="smoke s2"></i><i class="smoke s3"></i>{/if}
{#if device.fireflies}
  {#each BUBBLES as b, i (i)}<i class="fizz" style:left={b.x} style:width="{b.s}px" style:height="{b.s}px" style:animation-duration="{b.d}s" style:animation-delay="{b.delay}s"></i>{/each}
{/if}
{#if route.name !== "chat"}<span class="sign">Salon Nº 17</span>{/if}

<style>
  .light {
    inset: 0;
    background: radial-gradient(50% 60% at 50% -10%, color-mix(in srgb, var(--gold-hi) 26%, transparent), transparent 70%);
  }
  :global(.amb.night) .light {
    background:
      radial-gradient(28% 70% at 50% -5%, rgb(255 236 190 / 12%), transparent 72%),
      radial-gradient(70% 60% at 50% 110%, rgb(201 164 90 / 8%), transparent 70%);
  }
  .sun {
    left: 50%;
    top: -60vmax;
    width: 120vmax;
    height: 120vmax;
    margin-left: -60vmax;
    border-radius: 50%;
    background: repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--gold) 16%, transparent) 0 2deg, transparent 2deg 9deg);
    -webkit-mask: radial-gradient(closest-side, transparent 8%, #000 9%, transparent 85%);
    mask: radial-gradient(closest-side, transparent 8%, #000 9%, transparent 85%);
    animation: turn 240s linear infinite;
  }
  :global(.amb.night) .sun {
    opacity: 0.55;
  }
  @keyframes turn {
    to {
      transform: rotate(1turn);
    }
  }
  .stripes {
    inset: 0;
    background: repeating-linear-gradient(90deg, transparent 0 46px, color-mix(in srgb, var(--gold) 9%, transparent) 46px 47px);
    -webkit-mask: linear-gradient(transparent, #000 30%, #000 70%, transparent);
    mask: linear-gradient(transparent, #000 30%, #000 70%, transparent);
  }
  .fan {
    width: 340px;
    height: 340px;
    opacity: 0.45;
    background:
      repeating-radial-gradient(circle at 100% 0, transparent 0 34px, var(--gold) 34px 35px),
      repeating-conic-gradient(from 180deg at 100% 0, var(--gold) 0 0.7deg, transparent 0.7deg 7.5deg);
    -webkit-mask: radial-gradient(circle at 100% 0, #000 69%, transparent 70%);
    mask: radial-gradient(circle at 100% 0, #000 69%, transparent 70%);
  }
  .fan.tr {
    right: 0;
    top: 0;
  }
  .fan.bl {
    left: 0;
    bottom: 0;
    transform: rotate(180deg);
  }
  .smoke {
    width: 620px;
    height: 360px;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgb(239 229 207 / 9%), transparent);
    filter: blur(24px);
    animation: drift 30s ease-in-out infinite alternate;
  }
  .smoke.s1 {
    left: 18vw;
    top: 42vh;
  }
  .smoke.s2 {
    left: 52vw;
    top: 8vh;
    width: 460px;
    animation-duration: 38s;
    animation-delay: -12s;
  }
  .smoke.s3 {
    left: 62vw;
    bottom: -60px;
    animation-duration: 34s;
    animation-delay: -20s;
  }
  @keyframes drift {
    from {
      transform: translate3d(-60px, 30px, 0) rotate(-6deg) scale(1);
    }
    to {
      transform: translate3d(80px, -50px, 0) rotate(8deg) scale(1.3);
    }
  }
  .fizz {
    bottom: -12px;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--gold-hi) 70%, transparent);
    background: radial-gradient(circle at 35% 30%, rgb(255 255 255 / 70%), transparent 60%);
    opacity: 0.55;
    animation: rise 18s linear infinite;
  }
  @keyframes rise {
    0% {
      transform: translate3d(0, 0, 0);
    }
    25% {
      transform: translate3d(6px, -27vh, 0);
    }
    50% {
      transform: translate3d(-5px, -54vh, 0);
    }
    75% {
      transform: translate3d(5px, -81vh, 0);
    }
    100% {
      transform: translate3d(0, -110vh, 0);
    }
  }
  .sign {
    right: 5vw;
    bottom: 7vh;
    font: 400 clamp(1.6rem, 3vw, 2.6rem) / 1 "Limelight", serif;
    letter-spacing: 0.08em;
    color: var(--gold);
    opacity: 0.4;
  }
  :global(.amb.still) .sun,
  :global(.amb.still) .smoke {
    animation: none;
  }
  @media (max-width: 760px) {
    .fan {
      width: 200px;
      height: 200px;
    }
    .sign {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sun,
    .smoke {
      animation: none;
    }
    .fizz {
      display: none;
    }
  }
</style>
