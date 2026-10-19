<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { route } from "../../lib/router.svelte";

  // Menagerie: a collector's palazzo. Chintz on the walls, a salon hang of gilt frames down the
  // right, a velvet pelmet with tassels along the top, a kilim underfoot, and gold dust turning in
  // the lamplight. By night it's aubergine and candlelight, and the candles under the frames are lit.
  const petals = (x: number, y: number, r = 7, d = 8) =>
    [0, 72, 144, 216, 288]
      .map((t) => {
        const q = ((t - 90) * Math.PI) / 180;
        return `<circle cx="${(x + d * Math.cos(q)).toFixed(1)}" cy="${(y + d * Math.sin(q)).toFixed(1)}" r="${r}"/>`;
      })
      .join("");
  const leaf = (x: number, y: number, rx: number, ry: number, r: number) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${r} ${x} ${y})"/>`;
  function chintz(L: string, F: string, C: string, a: number) {
    const s =
      `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><g opacity="${a}">` +
      `<path d="M0 75C30 60 50 90 75 75S120 60 150 75" fill="none" stroke="${L}" stroke-width="1.6"/>` +
      `<g fill="${L}">${leaf(22, 30, 15, 5.5, -30)}${leaf(62, 26, 14, 5, 30)}${leaf(58, 60, 13, 5, -40)}${leaf(88, 96, 15, 5.5, 30)}${leaf(128, 96, 14, 5, -30)}${leaf(110, 130, 13, 5, 80)}${leaf(70, 68, 9, 3.5, -20)}${leaf(140, 68, 9, 3.5, 25)}</g>` +
      `<g fill="${F}">${petals(42, 42)}${petals(108, 108)}${petals(128, 30, 4.5, 5)}${petals(22, 118, 4.5, 5)}</g>` +
      `<g fill="${C}"><circle cx="42" cy="42" r="4.5"/><circle cx="108" cy="108" r="4.5"/><circle cx="128" cy="30" r="2.5"/><circle cx="22" cy="118" r="2.5"/><circle cx="16" cy="96" r="3"/><circle cx="22" cy="102" r="3"/><circle cx="12" cy="104" r="3"/><circle cx="90" cy="20" r="3"/></g></g></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
  }
  const CHINTZ_DAY = chintz("#2f5d46", "#b9432c", "#c99a3e", 0.42);
  const CHINTZ_NIGHT = chintz("#2f6b5e", "#9c3d5e", "#c99a3e", 0.4);
  const MOTES = Array.from({ length: 16 }, (_, i) => ({
    x: `${(i * 43 + 11) % 100}vw`,
    y: `${(i * 61 + 7) % 95}vh`,
    s: 2 + (i % 3),
    d: 18 + ((i * 7) % 16),
    delay: -((i * 2.3) % 20),
  }));
</script>

<i class="wash"></i>
{#if device.grain}<i class="chintz" style:--day={CHINTZ_DAY} style:--night={CHINTZ_NIGHT}></i>{/if}
<i class="glow"></i>
<div class="salon">
  <i class="fr f1"><b></b></i>
  <i class="fr f2"><b></b></i>
  <i class="fr f3"><b></b></i>
  <i class="fr f4"><b></b></i>
  <i class="candle" style:left="34px"></i><i class="candle" style:left="96px" style:animation-delay="-0.7s"></i><i class="candle" style:left="158px" style:animation-delay="-1.3s"></i>
</div>
<i class="pelmet"></i>
<i class="rug"></i>
{#if device.fireflies}
  {#each MOTES as m, i (i)}<i class="mote" style:left={m.x} style:top={m.y} style:width="{m.s}px" style:height="{m.s}px" style:animation-duration="{m.d}s" style:animation-delay="{m.delay}s"></i>{/each}
{/if}
{#if route.name !== "chat"}<span class="sign">A cabinet of curiosities</span>{/if}

<style>
  .wash {
    inset: 0;
    background:
      radial-gradient(60% 50% at 80% 10%, rgb(243 217 160 / 55%), transparent 70%),
      radial-gradient(130% 100% at 55% 40%, transparent 50%, rgb(60 20 10 / 22%) 100%),
      #eadcc0;
  }
  :global(.amb.night) .wash {
    background:
      radial-gradient(45% 40% at 82% 60%, rgb(255 180 100 / 22%), transparent 70%),
      radial-gradient(130% 100% at 55% 40%, transparent 45%, rgb(10 2 8 / 60%) 100%),
      #231229;
  }
  .chintz {
    inset: 0;
    background: var(--day) 0 0 / 150px 150px;
  }
  :global(.amb.night) .chintz {
    background: var(--night) 0 0 / 150px 150px;
  }
  .glow {
    inset: 0;
    background: radial-gradient(45% 40% at 50% 45%, rgb(251 244 228 / 40%), transparent 70%);
  }
  :global(.amb.night) .glow {
    background: radial-gradient(40% 35% at 50% 45%, rgb(255 190 120 / 8%), transparent 70%);
  }
  /* a salon hang: four gilt frames and three candles beneath them */
  .salon {
    right: 2.5vw;
    top: 18vh;
    width: 210px;
    height: 320px;
  }
  :global(.amb.night) .salon {
    filter: brightness(0.8);
  }
  .fr {
    position: absolute;
    padding: 7px;
    background: linear-gradient(135deg, #7a5519, #f7e6ad 30%, #c99a3e 55%, #f7e6ad 75%, #7a5519);
    box-shadow:
      0 0 0 1px #7a5519,
      inset 0 0 0 2px rgb(0 0 0 / 20%),
      0 14px 20px -12px rgb(30 10 5 / 60%);
  }
  .fr b {
    display: block;
    box-shadow:
      inset 0 0 0 2px rgb(0 0 0 / 35%),
      inset 0 0 18px rgb(0 0 0 / 35%);
  }
  .f1 {
    left: 0;
    top: 0;
  }
  .f1 b {
    width: 110px;
    height: 78px;
    background:
      radial-gradient(circle at 74% 30%, #f3e2b8 0 6px, transparent 7px),
      radial-gradient(14px 20px at 26% 54%, #2f4a2c 90%, transparent),
      linear-gradient(180deg, #c9a77a, #e6cf9e 50%, #6f7f4c 51%, #3f4f2a);
  }
  .f2 {
    right: 0;
    top: 22px;
    border-radius: 50%;
  }
  .f2 b {
    width: 66px;
    height: 84px;
    border-radius: 50%;
    background:
      radial-gradient(14px 17px at 50% 40%, #c9a07a 92%, transparent),
      radial-gradient(30px 22px at 50% 100%, #1a120c 92%, transparent),
      radial-gradient(18px 16px at 50% 30%, #2a1a10 92%, transparent),
      radial-gradient(circle at 50% 40%, #4a3622, #140c08 75%);
  }
  .f3 {
    left: 22px;
    top: 110px;
  }
  .f3 b {
    width: 92px;
    height: 116px;
    background:
      radial-gradient(circle at 40% 64%, #b9432c 0 11px, transparent 12px),
      radial-gradient(circle at 60% 68%, #d9a24a 0 9px, transparent 10px),
      radial-gradient(circle at 50% 56%, #6a8a4a 0 7px, transparent 8px),
      linear-gradient(transparent 78%, #3a2414 78%),
      radial-gradient(circle at 50% 50%, #3a2a1a, #140c08 70%);
  }
  .f4 {
    right: 12px;
    top: 148px;
  }
  .f4 b {
    width: 62px;
    height: 62px;
    background:
      radial-gradient(10px 6px at 50% 58%, #3a2414 90%, transparent),
      linear-gradient(#9fb3b0 0 58%, #2c4a52 58%);
  }
  .candle {
    position: absolute;
    top: 268px;
    width: 9px;
    height: 36px;
    border-radius: 2px;
    background: linear-gradient(90deg, #e8dcc0, #fff8e8, #d4c6a8);
  }
  .candle::after {
    content: "";
    position: absolute;
    left: -8px;
    right: -8px;
    bottom: -8px;
    height: 8px;
    border-radius: 2px;
    background: linear-gradient(#f7e6ad, #c99a3e 60%, #7a5519);
  }
  .candle::before {
    content: "";
    position: absolute;
    left: 50%;
    top: -16px;
    width: 9px;
    height: 15px;
    margin-left: -4.5px;
    border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%;
    background: radial-gradient(circle at 50% 70%, #fffbe0, #ffc35c 55%, #ff8a2a);
    box-shadow: 0 0 16px 6px rgb(255 170 80 / 55%);
    opacity: 0;
  }
  :global(.amb.night) .candle::before {
    opacity: 1;
    animation: flame 1.8s ease-in-out infinite alternate;
    animation-delay: inherit;
  }
  :global(.amb.still) .candle::before {
    animation: none;
  }
  @keyframes flame {
    to {
      transform: scale(0.9, 1.08) rotate(3deg);
    }
  }
  /* a velvet pelmet: a band, a gold braid, swags edged in gold and tassels between them */
  .pelmet {
    left: 0;
    right: 0;
    top: 0;
    height: 50px;
    background:
      radial-gradient(42px 30px at 50% 0, #6a1c22 97%, transparent 100%) 0 16px / 84px 30px repeat-x,
      radial-gradient(44px 33px at 50% 0, #c99a3e 97%, transparent 100%) 0 16px / 84px 34px repeat-x,
      linear-gradient(#5a161c 0 13px, #c99a3e 13px 16px, transparent 16px);
    filter: drop-shadow(0 6px 6px rgb(30 10 5 / 30%));
  }
  .pelmet::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 16px;
    height: 34px;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='84' height='34'%3E%3Cpath d='M42 0v9' stroke='%23c99a3e' stroke-width='1.5'/%3E%3Ccircle cx='42' cy='11' r='3.2' fill='%23e9c977'/%3E%3Cpath d='M38.5 13h7l3 18h-13z' fill='%23c99a3e'/%3E%3Cpath d='M39.5 15l-1 15M42 15v15M44.5 15l1 15' stroke='%237a5519' stroke-width='.8'/%3E%3C/svg%3E") -42px 0 / 84px 34px repeat-x;
  }
  :global(.amb.night) .pelmet {
    background:
      radial-gradient(42px 30px at 50% 0, #4a1220 97%, transparent 100%) 0 16px / 84px 30px repeat-x,
      radial-gradient(44px 33px at 50% 0, #b08a3a 97%, transparent 100%) 0 16px / 84px 34px repeat-x,
      linear-gradient(#3a0e18 0 13px, #b08a3a 13px 16px, transparent 16px);
  }
  /* a kilim underfoot */
  .rug {
    left: 0;
    right: 0;
    bottom: 0;
    height: 5vh;
    min-height: 34px;
    opacity: 0.9;
    background:
      linear-gradient(#6a1c22 0 5px, #c99a3e 5px 7px, transparent 7px),
      radial-gradient(circle, #6a1c22 2.5px, transparent 3px) 13px 20px / 26px 26px,
      repeating-conic-gradient(from 45deg, #1f5a45 0 25%, #c48a2c 0 50%) 0 7px / 26px 26px;
  }
  :global(.amb.night) .rug {
    opacity: 0.6;
  }
  /* gold dust turning in the lamplight */
  .mote {
    border-radius: 50%;
    background: #f7e6ad;
    box-shadow: 0 0 6px 1px rgb(247 230 173 / 60%);
    opacity: 0.55;
    animation: dust 24s ease-in-out infinite alternate;
  }
  @keyframes dust {
    to {
      transform: translate3d(40px, -70px, 0);
      opacity: 0.15;
    }
  }
  .sign {
    right: 4vw;
    bottom: 8vh;
    font: italic 900 clamp(1.7rem, 3.2vw, 2.8rem) / 1 "Playfair Display Variable", Georgia, serif;
    color: #7a1f24;
    opacity: 0.4;
  }
  :global(.amb.night) .sign {
    color: #d8aa4c;
    opacity: 0.35;
  }
  @media (max-width: 1100px) {
    .salon {
      display: none;
    }
  }
  @media (max-width: 760px) {
    .sign {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mote,
    .candle::before {
      animation: none !important;
    }
  }
</style>
