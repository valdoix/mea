<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { route } from "../../lib/router.svelte";
  import { app } from "../../lib/state.svelte";

  // Marquee's street: a brick wall, neon spill, searchlights, and a sign when you're not in a chat.
</script>

{#if device.grain}<i class="brick"></i>{/if}
<i class="spill s1"></i><i class="spill s2"></i><i class="spill s3"></i>
{#if device.fireflies}<i class="beam b1"></i><i class="beam b2"></i>{/if}
{#if route.name !== "chat"}<span class="sign">{app.night ? "open late" : "now showing"}</span>{/if}

<style>
  .brick {
    inset: 0;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='56'%3E%3Cpath d='M0 .5H64M0 28.5H64M.5 0V28M32.5 28V56' fill='none' stroke='%231b1630' stroke-opacity='.06'/%3E%3C/svg%3E");
  }
  :global(.amb.night) .brick {
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
  :global(.amb:not(.night)) .spill {
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
  :global(.amb:not(.night)) .beam {
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
  :global(.amb:not(.night)) .sign {
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
  @media (max-width: 760px) {
    .spill {
      filter: blur(48px);
    }
    .sign {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .beam {
      display: none;
    }
  }
</style>
