<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { route } from "../../lib/router.svelte";
  import { app } from "../../lib/state.svelte";

  // Sugar Rush's shop: a striped awning, sprinkles falling, gumdrops and lollipops bobbing, and a
  // neon sign in the window after dark.
  const DROPS = [
    { x: "4vw", y: "72vh", s: 64, c: "var(--c2)", d: 0 },
    { x: "11vw", y: "84vh", s: 46, c: "var(--c4)", d: -1.4 },
    { x: "90vw", y: "62vh", s: 58, c: "var(--c3)", d: -2.6 },
    { x: "83vw", y: "80vh", s: 40, c: "var(--c1)", d: -0.8 },
    { x: "94vw", y: "88vh", s: 34, c: "var(--c5)", d: -3.3 },
  ];
</script>

<i class="glow g1"></i><i class="glow g2"></i><i class="glow g3"></i>
{#if device.grain}<i class="dust"></i><i class="awning"></i>{/if}
{#if device.fireflies}<i class="sprinkles s1"></i><i class="sprinkles s2"></i>{/if}
<span class="pop p1"><b></b></span><span class="pop p2"><b></b></span>
{#each DROPS as d, i (i)}<i class="drop" style:left={d.x} style:top={d.y} style:width="{d.s}px" style:height="{d.s * 0.84}px" style:--c={d.c} style:animation-delay="{d.d}s"></i>{/each}
{#if route.name !== "chat"}<span class="sign" class:on={app.night}>{app.night ? "open late ♥" : "fresh daily"}</span>{/if}

<style>
  .glow {
    border-radius: 50%;
    filter: blur(80px);
    opacity: 0.5;
  }
  .glow.g1 {
    width: 560px;
    height: 460px;
    left: -160px;
    top: 10vh;
    background: var(--c1);
    opacity: 0.22;
  }
  .glow.g2 {
    width: 620px;
    height: 520px;
    right: -200px;
    bottom: -160px;
    background: var(--c2);
    opacity: 0.25;
  }
  .glow.g3 {
    width: 420px;
    height: 320px;
    left: 45%;
    top: 30vh;
    background: var(--c4);
    opacity: 0.18;
  }
  :global(.amb.night) .glow {
    opacity: 0.3;
  }
  .dust {
    inset: 0;
    opacity: 0.55;
    background-image:
      radial-gradient(1px 1px at 20px 30px, #fff 98%, transparent),
      radial-gradient(1.5px 1.5px at 90px 110px, var(--c3) 98%, transparent),
      radial-gradient(1px 1px at 150px 60px, var(--c1) 98%, transparent);
    background-size: 180px 160px;
  }
  /* a candy-striped awning with a scalloped hem */
  .awning {
    left: 0;
    right: 0;
    top: 0;
    height: 58px;
    background: repeating-linear-gradient(90deg, var(--c1) 0 44px, var(--cream) 44px 88px);
    -webkit-mask:
      linear-gradient(#000, #000) top / 100% 36px no-repeat,
      radial-gradient(circle at 22px 0, #000 21.5px, transparent 22px) 0 36px / 44px 22px repeat-x;
    mask:
      linear-gradient(#000, #000) top / 100% 36px no-repeat,
      radial-gradient(circle at 22px 0, #000 21.5px, transparent 22px) 0 36px / 44px 22px repeat-x;
    opacity: 0.9;
    filter: drop-shadow(0 6px 6px rgb(160 30 90 / 18%));
  }
  :global(.amb.night) .awning {
    background: repeating-linear-gradient(90deg, var(--c1) 0 44px, #3d1640 44px 88px);
    opacity: 0.75;
  }
  /* sprinkles: two tiles, a tile taller than the screen, falling by transform */
  .sprinkles {
    left: 0;
    right: 0;
    top: -240px;
    bottom: 0;
    background-image:
      radial-gradient(2px 7px at 20px 30px, var(--c1) 98%, transparent),
      radial-gradient(7px 2px at 90px 80px, var(--c2) 98%, transparent),
      radial-gradient(2px 7px at 160px 20px, var(--c3) 98%, transparent),
      radial-gradient(7px 2px at 60px 160px, var(--c4) 98%, transparent),
      radial-gradient(2px 7px at 200px 140px, var(--c5) 98%, transparent),
      radial-gradient(3px 3px at 130px 200px, var(--c1) 98%, transparent);
    background-size: 240px 240px;
    opacity: 0.6;
    animation: fall 26s linear infinite;
  }
  .sprinkles.s2 {
    top: -300px;
    background-size: 300px 300px;
    opacity: 0.35;
    rotate: 12deg;
    scale: 1.3;
    animation-duration: 38s;
    --tile: 300px;
  }
  @keyframes fall {
    to {
      transform: translate3d(0, var(--tile, 240px), 0);
    }
  }
  /* gumdrops */
  .drop {
    border-radius: 50% 50% 16px 16px;
    background: radial-gradient(circle at 35% 25%, color-mix(in srgb, var(--c) 50%, #fff), var(--c) 55%, color-mix(in srgb, var(--c) 80%, #000));
    box-shadow: 0 10px 14px -8px rgb(120 20 70 / 35%);
    animation: bob 5.5s ease-in-out infinite;
  }
  .drop::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: radial-gradient(1.5px 1.5px at 30% 40%, #fff 98%, transparent), radial-gradient(1.5px 1.5px at 62% 30%, #fff 98%, transparent), radial-gradient(1.5px 1.5px at 50% 64%, #fff 98%, transparent), radial-gradient(1.5px 1.5px at 74% 58%, #fff 98%, transparent);
    opacity: 0.8;
  }
  :global(.amb.night) .drop {
    box-shadow: 0 0 22px -4px var(--c);
  }
  @keyframes bob {
    50% {
      transform: translateY(-12px) rotate(-5deg);
    }
  }
  /* lollipops: a swirl on a stick, turning slowly */
  .pop {
    width: 120px;
    height: 230px;
    animation: bob 7s ease-in-out infinite;
  }
  .pop::after {
    content: "";
    position: absolute;
    left: 56px;
    top: 112px;
    width: 8px;
    height: 118px;
    border-radius: 4px;
    background: linear-gradient(90deg, #fff, #eadfe4);
    box-shadow: 0 6px 10px -6px rgb(0 0 0 / 30%);
  }
  .pop b {
    position: absolute;
    inset: 0 0 auto;
    height: 120px;
    border-radius: 50%;
    background: repeating-conic-gradient(from 0deg, var(--c1) 0 30deg, var(--cream) 30deg 60deg, var(--c4) 60deg 90deg, var(--cream) 90deg 120deg);
    -webkit-mask: radial-gradient(circle, #000 69%, transparent 70%);
    mask: radial-gradient(circle, #000 69%, transparent 70%);
    box-shadow: inset 0 0 0 6px rgb(255 255 255 / 30%);
    animation: twirl 14s linear infinite;
  }
  .pop.p1 {
    right: 5vw;
    top: 16vh;
    rotate: 14deg;
    opacity: 0.85;
  }
  .pop.p2 {
    left: 3vw;
    top: 22vh;
    rotate: -18deg;
    scale: 0.7;
    opacity: 0.7;
    animation-delay: -3s;
  }
  .pop.p2 b {
    background: repeating-conic-gradient(from 0deg, var(--c2) 0 30deg, var(--cream) 30deg 60deg, var(--c3) 60deg 90deg, var(--cream) 90deg 120deg);
    animation-direction: reverse;
  }
  @keyframes twirl {
    to {
      transform: rotate(1turn);
    }
  }
  .sign {
    right: 5vw;
    bottom: 9vh;
    rotate: -7deg;
    font: 400 clamp(2.6rem, 5vw, 4.6rem) / 1 "Chewy", cursive;
    color: var(--c1);
    opacity: 0.3;
    text-shadow:
      3px 3px 0 var(--cream),
      5px 5px 0 var(--c2);
  }
  .sign.on {
    color: #ffe0f0;
    opacity: 0.75;
    text-shadow:
      0 0 4px var(--c1),
      0 0 14px var(--c1),
      0 0 34px var(--c1),
      0 0 60px var(--c1);
    animation: buzz 7s steps(1) infinite;
  }
  @keyframes buzz {
    0%,
    46%,
    49%,
    52%,
    100% {
      opacity: 0.75;
    }
    47%,
    51% {
      opacity: 0.25;
    }
  }
  :global(.amb.still) .drop,
  :global(.amb.still) .pop,
  :global(.amb.still) .pop b {
    animation: none;
  }
  @media (max-width: 760px) {
    .pop,
    .sign {
      display: none;
    }
    .glow {
      filter: blur(50px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .drop,
    .pop,
    .pop b,
    .sign.on {
      animation: none;
    }
  }
</style>
