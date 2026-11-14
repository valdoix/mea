<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { app } from "../../lib/state.svelte";

  // Overprint's press sheet: two halftone screens, halftone sunbursts turning in the corners, rings
  // and stickers of ink (stars, hearts, a bolt, a squiggle, a smiley) floating in two colours slightly
  // out of register, and the printer's marks. Sending stamps PRINTED! across the page and jolts the
  // plates out of register for a moment.
  const SHAPES = [
    { k: "star", x: 34, y: 8, s: 90, d: 0 },
    { k: "heart", x: 88, y: 24, s: 70, d: -3 },
    { k: "bolt", x: 58, y: 50, s: 80, d: -5 },
    { k: "squig", x: 66, y: 74, s: 110, d: -2 },
    { k: "smile", x: 80, y: 62, s: 84, d: -7 },
    { k: "star", x: 22, y: 40, s: 46, d: -4 },
  ];
  const PATH: Record<string, string> = {
    star: "M50 4l13 30 33 3-25 22 8 33-29-17-29 17 8-33L4 37l33-3z",
    heart: "M50 88C10 60 4 40 14 24s30-14 36 4c6-18 26-20 36-4s4 36-36 64z",
    bolt: "M58 2L18 56h26L34 98 82 40H56z",
    squig: "M4 60c12-30 22-30 30 0s18 30 30 0 22-30 32 0",
    smile: "M50 6a44 44 0 1 0 .1 0z",
  };

  $effect(() => {
    const d = document.documentElement;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let t = 0;
    const click = (e: MouseEvent) => {
      const btn = (e.target as Element | null)?.closest?.(".send");
      if (!btn || still || !device.fireflies) return;
      d.style.setProperty("--op-mis", "11px");
      clearTimeout(t);
      t = window.setTimeout(() => d.style.removeProperty("--op-mis"), 350);
      const b = btn.getBoundingClientRect();
      document.querySelector(".op-stamp")?.remove();
      const s = document.createElement("div");
      s.className = "op-stamp";
      s.textContent = "PRINTED!";
      s.style.left = `${b.left - 150}px`;
      s.style.top = `${b.top - 60}px`;
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 1700);
    };
    addEventListener("click", click, true);
    return () => {
      removeEventListener("click", click, true);
      clearTimeout(t);
      d.style.removeProperty("--op-mis");
    };
  });
</script>

<i class="burst b1"></i><i class="burst b2"></i>
<i class="dots pink"></i><i class="dots blue"></i>
{#each SHAPES as sh, i (i)}
  <svg class="shape {sh.k}" viewBox="0 0 100 100" style:left="{sh.x}%" style:top="{sh.y}%" style:width="{sh.s}px" style:height="{sh.s}px" style:animation-delay="{sh.d}s" aria-hidden="true">
    <path class="p" d={PATH[sh.k]} />
    {#if sh.k === "smile"}<g class="b face"><circle cx="36" cy="40" r="5" /><circle cx="64" cy="40" r="5" /><path d="M28 60q22 22 44 0" /></g>{:else}<path class="b" d={PATH[sh.k]} />{/if}
  </svg>
{/each}
<i class="ring r1"></i><i class="ring r2"></i><i class="ring r3"></i><i class="ring r4"></i>
<span class="reg rg1"></span><span class="reg rg2"></span>
<span class="slug">Mea · two-colour edition · pass {app.night ? "02" : "01"}</span>

<style>
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
  :global(.amb.night) .dots {
    opacity: 0.2;
  }
  @keyframes dots {
    to {
      transform: translate(33px, 22px);
    }
  }
  /* halftone sunbursts turning in the corners */
  .burst {
    border-radius: 50%;
    mix-blend-mode: multiply;
    -webkit-mask: radial-gradient(circle, #000 1.6px, transparent 2.4px) 0 0 / 7px 7px;
    mask: radial-gradient(circle, #000 1.6px, transparent 2.4px) 0 0 / 7px 7px;
    animation: spin 90s linear infinite;
  }
  .burst.b1 {
    right: -260px;
    bottom: -260px;
    width: 720px;
    height: 720px;
    background: repeating-conic-gradient(var(--accent) 0 7deg, transparent 7deg 18deg);
    opacity: 0.45;
  }
  .burst.b2 {
    left: -180px;
    top: -300px;
    width: 560px;
    height: 560px;
    background: repeating-conic-gradient(var(--sig2) 0 5deg, transparent 5deg 16deg);
    opacity: 0.3;
    animation-direction: reverse;
  }
  :global(.amb.night) .burst {
    mix-blend-mode: screen;
    filter: drop-shadow(0 0 6px var(--accent));
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* stickers of ink floating, printed twice: pink fill, a blue outline a little off */
  .shape {
    position: absolute;
    overflow: visible;
    animation: float 9s ease-in-out infinite alternate;
  }
  .shape .p {
    fill: var(--accent);
    mix-blend-mode: multiply;
    opacity: 0.85;
  }
  .shape.squig .p {
    fill: none;
    stroke: var(--accent);
    stroke-width: 12;
    stroke-linecap: round;
  }
  .shape .b {
    fill: none;
    stroke: var(--sig2);
    stroke-width: 3;
    stroke-linecap: round;
    mix-blend-mode: multiply;
    translate: var(--op-mis, 3px) calc(var(--op-mis, 3px) * -0.7);
    transition: translate 0.4s cubic-bezier(0.3, 1.6, 0.5, 1);
  }
  .shape .face {
    fill: var(--sig2);
  }
  .shape .face path {
    fill: none;
    stroke-width: 6;
  }
  :global(.amb.night) .shape .p,
  :global(.amb.night) .shape .b {
    mix-blend-mode: screen;
  }
  :global(.amb.night) .shape {
    filter: drop-shadow(0 0 6px var(--accent));
  }
  @keyframes float {
    from {
      transform: translate(0, 0) rotate(-6deg);
    }
    to {
      transform: translate(10px, -18px) rotate(8deg);
    }
  }
  .ring {
    border-radius: 50%;
    mix-blend-mode: multiply;
    opacity: 0.22;
    animation: register 9s ease-in-out infinite alternate;
  }
  :global(.amb.night) .ring {
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
  :global(.amb.night) .r3 {
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
  @media (max-width: 760px) {
    .shape,
    .burst {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .shape,
    .burst {
      animation: none;
    }
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
</style>
