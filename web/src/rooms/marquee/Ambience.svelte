<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { route } from "../../lib/router.svelte";
  import { app } from "../../lib/state.svelte";

  // Marquee: the picture palace. A brick wall with neon spill, an art-deco sunburst, red velvet
  // curtains drawn back at the sides under a scalloped valance, searchlights, and by night a smear
  // of neon on the wet street at the foot of the room. Sending pops popcorn out of the button.
  const KERNELS = 9;
  $effect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const click = (e: MouseEvent) => {
      const btn = (e.target as Element | null)?.closest?.(".send");
      if (!btn || still || !device.fireflies) return;
      const b = btn.getBoundingClientRect();
      const pop = document.createElement("div");
      pop.className = "mq-pop";
      pop.style.left = `${b.left + b.width / 2}px`;
      pop.style.top = `${b.top + 6}px`;
      for (let i = 0; i < KERNELS; i++) {
        const k = document.createElement("i");
        k.style.setProperty("--dx", `${(Math.random() * 110 - 55).toFixed(0)}px`);
        k.style.setProperty("--up", `${(-50 - Math.random() * 60).toFixed(0)}px`);
        k.style.setProperty("--r", `${(Math.random() * 540).toFixed(0)}deg`);
        k.style.animationDelay = `${i * 30}ms`;
        pop.appendChild(k);
      }
      document.body.appendChild(pop);
      setTimeout(() => pop.remove(), 1400);
    };
    addEventListener("click", click, true);
    return () => removeEventListener("click", click, true);
  });
</script>

{#if device.grain}<i class="brick"></i>{/if}
<i class="deco"></i>
<i class="spill s1"></i><i class="spill s2"></i><i class="spill s3"></i>
{#if device.fireflies}<i class="beam b1"></i><i class="beam b2"></i>{/if}
<i class="wet"></i>
<i class="cur l"></i><i class="cur r"></i>
<i class="valance"></i>
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
  /* an art-deco sunburst behind everything */
  .deco {
    inset: 0;
    background: repeating-conic-gradient(from -90deg at 50% 0, rgb(212 164 64 / 16%) 0 2deg, transparent 2deg 9deg);
    -webkit-mask: radial-gradient(70% 80% at 50% 0, #000, transparent 75%);
    mask: radial-gradient(70% 80% at 50% 0, #000, transparent 75%);
  }
  :global(.amb.night) .deco {
    opacity: 0.4;
  }
  /* red velvet curtains drawn back at the sides, under a scalloped valance with a gold fringe */
  .cur {
    top: 0;
    bottom: 0;
    width: 7vw;
    max-width: 90px;
    background: repeating-linear-gradient(90deg, #5e0718 0, #a3122e 10px, #d02a48 16px, #a3122e 22px, #5e0718 32px);
    box-shadow: inset 0 -60px 40px -30px rgb(0 0 0 / 50%);
  }
  .cur.l {
    left: 0;
    clip-path: polygon(0 0, 100% 0, 55% 100%, 0 100%);
  }
  .cur.r {
    right: 0;
    clip-path: polygon(0 0, 100% 0, 100% 100%, 45% 100%);
  }
  :global(.amb.night) .cur {
    filter: brightness(0.6);
  }
  .valance {
    left: 0;
    right: 0;
    top: 0;
    height: 40px;
    background: radial-gradient(40px 24px at 40px 0, #a3122e 98%, transparent) 0 0 / 80px 40px repeat-x;
    filter: drop-shadow(0 3px 2px rgb(0 0 0 / 35%));
  }
  .valance::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 20px;
    height: 6px;
    background: radial-gradient(circle, #d4a440 2.5px, transparent 3px) 0 0 / 10px 6px repeat-x;
  }
  :global(.amb.night) .valance {
    filter: brightness(0.6) drop-shadow(0 3px 2px rgb(0 0 0 / 35%));
  }
  /* by night, neon smeared across the wet street */
  .wet {
    left: 0;
    right: 0;
    bottom: 0;
    height: 120px;
    opacity: 0;
    background: linear-gradient(90deg, transparent 10%, rgb(255 79 176 / 35%) 25%, transparent 35%, transparent 60%, rgb(62 232 255 / 30%) 72%, transparent 85%);
    filter: blur(16px);
    -webkit-mask: repeating-linear-gradient(180deg, #000 0 3px, transparent 3px 7px);
    mask: repeating-linear-gradient(180deg, #000 0 3px, transparent 3px 7px);
  }
  :global(.amb.night) .wet {
    opacity: 1;
    animation: shim 3s ease-in-out infinite alternate;
  }
  @keyframes shim {
    to {
      transform: translateX(20px);
      opacity: 0.7;
    }
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
    .wet {
      animation: none !important;
    }
  }
</style>
