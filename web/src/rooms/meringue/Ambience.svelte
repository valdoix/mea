<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { route } from "../../lib/router.svelte";

  // Meringue: a patisserie window. A striped awning scallops along the top, sprinkles fall like slow
  // snow and meringue-kiss clouds drift past a cake stand of macarons. A cup of tea on the sill takes
  // a sugar cube every time you send. By night it's lavender dusk: fairy lights on the awning, stars,
  // and a chocolate-chip cookie moon with a bite out of it. Sending throws sprinkles from the button.
  const SPRINKLES = ["#f6a9c0", "#8a8ff0", "#f3d27a", "#9ccf8a", "#d4587f", "#bfa8ff", "#7fd3e6"];
  const FALL = Array.from({ length: 34 }, (_, i) => ({
    x: (i * 37 + 5) % 100,
    c: SPRINKLES[i % SPRINKLES.length],
    d: 14 + ((i * 7) % 14),
    dl: -((i * 2.3) % 28),
    r: (i * 47) % 180,
    w: ((i * 29) % 120) - 60,
  }));
  const KISSES = [
    { x: "62vw", y: "16vh", s: 1, d: 70, delay: 0 },
    { x: "18vw", y: "11vh", s: 0.7, d: 85, delay: -30 },
    { x: "80vw", y: "48vh", s: 0.6, d: 78, delay: -12 },
    { x: "6vw", y: "62vh", s: 0.8, d: 92, delay: -50 },
  ];
  const STAND = [
    [42, 72, "#f29bb8"],
    [64, 70, "#b5df9f"],
    [86, 72, "#a9adf6"],
    [108, 70, "#f6dd78"],
    [128, 72, "#ecb877"],
    [70, 28, "#f29bb8"],
    [92, 28, "#bfa8ff"],
    [110, 28, "#b5df9f"],
  ] as const;

  // a sugar cube for the cup each time you send, and sprinkles from the button
  let sugars = $state(0);
  let drop = $state(0);
  $effect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const click = (e: MouseEvent) => {
      const btn = (e.target as Element | null)?.closest?.(".send");
      if (!btn) return;
      sugars = Math.min(sugars + 1, 9);
      drop++;
      if (still) return;
      const b = btn.getBoundingClientRect();
      const burst = document.createElement("div");
      burst.className = "mg-burst";
      burst.style.left = `${b.left + b.width / 2}px`;
      burst.style.top = `${b.top + b.height / 2}px`;
      for (let i = 0; i < 22; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 40 + Math.random() * 50;
        const bit = document.createElement("i");
        bit.style.setProperty("--c", SPRINKLES[i % SPRINKLES.length]!);
        bit.style.setProperty("--dx", `${(Math.cos(a) * d).toFixed(0)}px`);
        bit.style.setProperty("--dy", `${(Math.sin(a) * d - 30).toFixed(0)}px`);
        bit.style.setProperty("--r", `${(Math.random() * 720 - 360).toFixed(0)}deg`);
        burst.appendChild(bit);
      }
      document.body.appendChild(burst);
      setTimeout(() => burst.remove(), 1100);
    };
    addEventListener("click", click, true);
    return () => removeEventListener("click", click, true);
  });
</script>

<i class="wash"></i>
<i class="glow"></i>
<i class="stars"></i>
<i class="moon"></i>
{#each KISSES as c, i (i)}<i class="kiss" style:left={c.x} style:top={c.y} style:scale={c.s} style:animation-duration="{c.d}s" style:animation-delay="{c.delay}s"></i>{/each}
{#if device.fireflies}
  {#each FALL as f, i (i)}<i class="spr" style:left="{f.x}%" style:background={f.c} style:animation-duration="{f.d}s" style:animation-delay="{f.dl}s" style:--r="{f.r}deg" style:--w="{f.w}px"></i>{/each}
{/if}
<i class="awning"></i>
<i class="bulbs"></i>
{#if device.grain}<i class="gingham"></i>{/if}
<svg class="stand" viewBox="0 0 170 150" aria-hidden="true">
  <path d="M85 146V80M50 146h70" stroke="#c9a2b8" stroke-width="5" stroke-linecap="round" />
  <ellipse cx="85" cy="80" rx="74" ry="9" class="plate" />
  <path d="M85 80V36" stroke="#c9a2b8" stroke-width="4" />
  <ellipse cx="85" cy="36" rx="46" ry="7" class="plate" />
  <circle cx="85" cy="16" r="7" fill="#e7c3d3" />
  {#each STAND as [x, y, c], i (i)}<g transform="translate({x} {y})"><path d="M-10 -4q10-9 20 0z" fill={c} /><rect x="-9" y="-4" width="18" height="3.5" rx="1.6" fill="#fff6e8" /><path d="M-10 -.5q10 7 20 0z" fill={c} /></g>{/each}
</svg>
<div class="cup" title="{sugars} sugar{sugars === 1 ? '' : 's'}">
  {#key drop}{#if drop}<i class="cube"></i><i class="splash"></i>{/if}{/key}
  <svg viewBox="0 0 86 70" aria-hidden="true">
    <g class="steam"><path d="M32 22c-6-6 6-10 0-18" /><path d="M48 22c-6-6 6-10 0-18" /></g>
    <path d="M64 34c12-2 14 12 2 16" fill="none" stroke="#e7a8bd" stroke-width="4" />
    <path d="M14 26h56c0 22-10 34-28 34S14 48 14 26z" fill="#fff" stroke="#e7a8bd" stroke-width="2" />
    <ellipse cx="42" cy="27" rx="27" ry="5" fill="#c98a5a" />
    <path d="M22 40q10 4 20 0t20 0" stroke="#f29bb8" stroke-width="2.4" fill="none" stroke-dasharray="1 5" stroke-linecap="round" />
    <ellipse cx="42" cy="64" rx="34" ry="5" fill="#fff" stroke="#e7a8bd" stroke-width="2" />
  </svg>
</div>
{#if route.name !== "chat"}<span class="sign">A cup of something warm</span>{/if}

<style>
  .wash {
    inset: 0;
    background:
      radial-gradient(55% 45% at 92% 0%, rgb(255 206 184 / 75%), transparent 70%),
      radial-gradient(50% 50% at 0% 100%, rgb(211 235 222 / 80%), transparent 70%),
      repeating-linear-gradient(90deg, rgb(255 180 200 / 12%) 0 34px, transparent 34px 68px),
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
  /* the moon: a chocolate-chip cookie with a bite out of it */
  :global(.amb.night) .moon {
    display: block;
    right: 7vw;
    top: 13vh;
    width: 76px;
    height: 76px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 30% 35%, #6b3f2f 0 4px, transparent 5px),
      radial-gradient(circle at 62% 28%, #6b3f2f 0 3px, transparent 4px),
      radial-gradient(circle at 48% 62%, #6b3f2f 0 5px, transparent 6px),
      radial-gradient(circle at 26% 70%, #6b3f2f 0 3px, transparent 4px),
      radial-gradient(circle at 40% 40%, #f6d9a4, #e2b071);
    -webkit-mask:
      radial-gradient(circle 18px at 92% 22%, transparent 98%, #000),
      radial-gradient(circle 14px at 98% 46%, transparent 98%, #000);
    -webkit-mask-composite: source-in;
    mask:
      radial-gradient(circle 18px at 92% 22%, transparent 98%, #000),
      radial-gradient(circle 14px at 98% 46%, transparent 98%, #000);
    mask-composite: intersect;
    filter: drop-shadow(0 0 18px rgb(255 220 160 / 50%));
  }
  /* clouds are meringue kisses: three soft swirls with a peak */
  .kiss {
    width: 150px;
    height: 92px;
    background:
      radial-gradient(50% 60% at 30% 72%, #fff 60%, transparent 62%),
      radial-gradient(40% 80% at 55% 48%, #fff 60%, transparent 62%),
      radial-gradient(35% 60% at 78% 72%, #fff 60%, transparent 62%),
      radial-gradient(12% 30% at 58% 14%, #fff 60%, transparent 62%);
    filter: drop-shadow(0 6px 6px rgb(200 120 150 / 18%));
    opacity: 0.9;
    animation: drift 70s linear infinite alternate;
  }
  :global(.amb.night) .kiss {
    opacity: 0;
  }
  :global(.amb.still) .kiss {
    animation: none;
  }
  @keyframes drift {
    to {
      transform: translate3d(-14vw, 1vh, 0);
    }
  }
  /* sprinkles falling like slow snow */
  .spr {
    top: -20px;
    width: 4px;
    height: 11px;
    border-radius: 2px;
    opacity: 0.85;
    animation: fall linear infinite;
  }
  @keyframes fall {
    from {
      transform: translate(0, 0) rotate(var(--r));
    }
    to {
      transform: translate(var(--w), 108vh) rotate(calc(var(--r) + 540deg));
    }
  }
  /* the awning: candy stripes with a scalloped edge; by night lavender, with fairy lights */
  .awning {
    left: 0;
    right: 0;
    top: 0;
    height: 46px;
    background: repeating-linear-gradient(90deg, #f6a9c0 0 32px, #fff7f0 32px 64px);
    -webkit-mask:
      radial-gradient(16px 12px at 16px 34px, #000 98%, transparent) 0 0 / 32px 46px repeat-x,
      linear-gradient(#000 0 34px, transparent 0);
    mask:
      radial-gradient(16px 12px at 16px 34px, #000 98%, transparent) 0 0 / 32px 46px repeat-x,
      linear-gradient(#000 0 34px, transparent 0);
    filter: drop-shadow(0 4px 4px rgb(120 40 70 / 18%));
  }
  :global(.amb.night) .awning {
    background: repeating-linear-gradient(90deg, #8a6fc4 0 32px, #4a4380 32px 64px);
  }
  .bulbs {
    display: none;
  }
  :global(.amb.night) .bulbs {
    display: block;
    left: 0;
    right: 0;
    top: 40px;
    height: 22px;
    background: radial-gradient(circle at 16px 10px, #ffe9a8 0 4px, transparent 5px) 0 0 / 32px 22px repeat-x;
    filter: drop-shadow(0 0 6px #ffe39a);
    animation: twinkle 2.4s ease-in-out infinite alternate;
  }
  @keyframes twinkle {
    to {
      opacity: 0.6;
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
  .stand {
    position: absolute;
    right: 3vw;
    bottom: 2vh;
    width: clamp(120px, 12vw, 180px);
    height: auto;
    filter: drop-shadow(0 8px 8px rgb(120 60 80 / 18%));
  }
  .stand .plate {
    fill: #fff;
    stroke: #e7c3d3;
    stroke-width: 2;
  }
  :global(.amb.night) .stand {
    opacity: 0.75;
  }
  :global(.amb.night) .stand .plate {
    fill: #4a4370;
    stroke: #7c6fa8;
  }
  /* your cup: a sugar cube drops in every time you send */
  .cup {
    left: 3vw;
    bottom: 3vh;
    width: 86px;
    height: 70px;
  }
  .cup svg {
    width: 86px;
    height: 70px;
    overflow: visible;
  }
  .steam path {
    fill: none;
    stroke: #b49aa8;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: 30 30;
    animation: steam 2.6s linear infinite;
  }
  .steam path:nth-child(2) {
    animation-delay: -1.3s;
  }
  @keyframes steam {
    from {
      stroke-dashoffset: 60;
      opacity: 0;
    }
    40% {
      opacity: 0.6;
    }
    to {
      stroke-dashoffset: 0;
      opacity: 0;
    }
  }
  .cube {
    position: absolute;
    left: 34px;
    top: -40px;
    width: 12px;
    height: 12px;
    border-radius: 2px;
    background: #fff;
    box-shadow:
      inset -2px -2px 0 #e9e2f2,
      0 0 0 1px rgb(0 0 0 / 8%);
    opacity: 0;
    animation: plop 0.7s cubic-bezier(0.5, 0, 1, 0.6);
  }
  @keyframes plop {
    0% {
      transform: translate(0, 0) rotate(0);
      opacity: 1;
    }
    85% {
      transform: translate(6px, 64px) rotate(200deg);
      opacity: 1;
    }
    100% {
      transform: translate(6px, 68px) rotate(220deg);
      opacity: 0;
    }
  }
  .splash {
    position: absolute;
    left: 28px;
    top: 20px;
    width: 30px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid #fff;
    opacity: 0;
    animation: splash 0.5s ease-out 0.6s;
  }
  @keyframes splash {
    0% {
      opacity: 0.9;
      transform: scale(0.3);
    }
    100% {
      opacity: 0;
      transform: scale(1.4, 1.6);
    }
  }
  :global(.amb.night) .cup {
    opacity: 0.8;
  }
  .sign {
    left: 5vw;
    bottom: 14vh;
    font: 400 clamp(1.6rem, 3vw, 2.6rem) / 1 "Young Serif", Georgia, serif;
    color: #d2789a;
    opacity: 0.45;
  }
  :global(.amb.night) .sign {
    color: #f5a8c5;
    opacity: 0.35;
  }
  @media (max-width: 760px) {
    .stand,
    .cup,
    .sign {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .kiss,
    .spr,
    .bulbs,
    .steam path,
    .cube,
    .splash {
      animation: none;
    }
    .spr {
      display: none;
    }
  }
</style>
