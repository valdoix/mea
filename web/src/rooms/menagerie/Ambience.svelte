<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { route } from "../../lib/router.svelte";

  // Menagerie: a collector's palazzo, with residents. Gilt trellis on the walls, palm fronds swaying
  // in the corners, butterflies looping across the room and a morpho pinned under a bell jar. By night
  // it's aubergine and candlelight: the butterflies sleep and fireflies come out, in the room and in
  // the jar.
  // Bartholomew the parrot lives in the rail's cage and repeats a bit of each new reply, badly.
  const FRONDS = (() => {
    let s = "";
    for (let k = 0; k < 9; k++) {
      const a = ((-160 + k * (110 / 9)) * Math.PI) / 180;
      const len = 220 - Math.abs(k - 4.5) * 14;
      const ex = 300 + Math.cos(a) * len, ey = 300 + Math.sin(a) * len;
      const mx = 300 + Math.cos(a + 0.25) * len * 0.55, my = 300 + Math.sin(a + 0.25) * len * 0.55;
      s += `<path d="M300 300Q${mx.toFixed(0)} ${my.toFixed(0)} ${ex.toFixed(0)} ${ey.toFixed(0)}" stroke-width="2" fill="none"/>`;
      for (let t = 0.25; t < 1; t += 0.08) {
        const px = 300 + (ex - 300) * t + (mx - (300 + ex) / 2) * 2 * t * (1 - t);
        const py = 300 + (ey - 300) * t + (my - (300 + ey) / 2) * 2 * t * (1 - t);
        const w = 34 * (1 - t) + 8;
        s += `<path d="M${px.toFixed(0)} ${py.toFixed(0)}l${(Math.cos(a - 1.3) * w).toFixed(0)} ${(Math.sin(a - 1.3) * w).toFixed(0)}M${px.toFixed(0)} ${py.toFixed(0)}l${(Math.cos(a + 1.3) * w).toFixed(0)} ${(Math.sin(a + 1.3) * w).toFixed(0)}" stroke-width="5" stroke-linecap="round"/>`;
      }
    }
    return s;
  })();
  const FLY = ["#2f7fd0", "#f08a24", "#e9d24a", "#c45bd0", "#3fbfa6"].map((c, i) => {
    const y0 = 120 + ((i * 173) % 460), y1 = 90 + ((i * 251) % 520);
    return { c, p: `path("M-60 ${y0} C 260 ${y0 - 200}, 420 ${y1 + 200}, 640 ${y1} S 980 ${y0 - 120}, 1500 ${y1 - 60}")`, d: 24 + ((i * 5) % 14), dl: -((i * 7.3) % 30), s: 0.75 + ((i * 3) % 5) / 10 };
  });
  const FIREFLIES = Array.from({ length: 18 }, (_, i) => ({ x: (i * 41 + 13) % 100, y: (i * 59 + 9) % 92, d: 5 + ((i * 3) % 6), dl: -((i * 1.7) % 6), dx: ((i * 31) % 90) - 45, dy: ((i * 23) % 70) - 35 }));

  // Bartholomew repeats a bit of each new reply: a few words from what they said, then the last
  // one again. He waits for the reply to settle first.
  $effect(() => {
    if (!device.fireflies) return;
    const seen = new WeakSet<Element>();
    for (const m of document.querySelectorAll(".msg.assistant")) seen.add(m);
    let wait = 0;
    let hide = 0;
    const squawk = () => {
      const all = document.querySelectorAll(".msg.assistant");
      const m = all[all.length - 1];
      if (!m || seen.has(m)) return;
      seen.add(m);
      const text = (m.querySelector(".prose") as HTMLElement | null)?.innerText ?? "";
      const said = text.match(/[“"]([^”"]{3,80})[”"]/)?.[1] ?? text.split(/[.!?]/)[0] ?? "";
      const words = said.replace(/[^\p{L}\p{N}' ]/gu, " ").trim().split(/\s+/).filter(Boolean).slice(0, 4);
      if (!words.length) return;
      const last = words[words.length - 1]!;
      const line = `${words.join(" ")}! ${last[0]!.toUpperCase()}${last.slice(1)}!`;
      const logo = document.querySelector("nav.rail .logo")?.getBoundingClientRect();
      document.querySelector(".mn-squawk")?.remove();
      const b = document.createElement("div");
      b.className = "mn-squawk";
      b.setAttribute("role", "status");
      b.textContent = line;
      if (logo && logo.width) {
        b.style.left = `${logo.right + 12}px`;
        b.style.top = `${logo.top + 4}px`;
      } else {
        b.style.left = "16px";
        b.style.top = "16px";
      }
      document.body.appendChild(b);
      const d = document.documentElement.dataset;
      d.mnSquawk = "";
      clearTimeout(hide);
      hide = window.setTimeout(() => {
        b.remove();
        delete d.mnSquawk;
      }, 3200);
    };
    const watch = new MutationObserver(() => {
      clearTimeout(wait);
      wait = window.setTimeout(squawk, 2500);
    });
    watch.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      watch.disconnect();
      clearTimeout(wait);
      clearTimeout(hide);
      document.querySelector(".mn-squawk")?.remove();
      delete document.documentElement.dataset.mnSquawk;
    };
  });
  const MOTES = Array.from({ length: 16 }, (_, i) => ({
    x: `${(i * 43 + 11) % 100}vw`,
    y: `${(i * 61 + 7) % 95}vh`,
    s: 2 + (i % 3),
    d: 18 + ((i * 7) % 16),
    delay: -((i * 2.3) % 20),
  }));
</script>

<i class="wash"></i>
<i class="trellis"></i>
<i class="glow"></i>
<svg class="frond f1" viewBox="0 0 300 300" aria-hidden="true">{@html FRONDS}</svg>
<svg class="frond f2" viewBox="0 0 300 300" aria-hidden="true">{@html FRONDS}</svg>
<svg class="jar" viewBox="0 0 120 120" aria-hidden="true"><ellipse cx="60" cy="108" rx="44" ry="7" fill="#3a1f12" stroke="#c99a3e" stroke-width="2" /><rect x="18" y="100" width="84" height="8" rx="2" fill="#5a3220" stroke="#c99a3e" /><g class="pinned" transform="translate(60 72)"><path d="M0 0C-8-18-30-20-28-6c1 8 14 10 28 6zM0 0C8-18 30-20 28-6c-1 8-14 10-28 6zM0 2c-6 6-18 14-16 20 3 4 12-6 16-16zM0 2c6 6 18 14 16 20-3 4-12-6-16-16z" fill="#2f7fd0" stroke="#0e2a50" stroke-width="1" /><circle cx="-16" cy="-8" r="3" fill="#dff1ff" /><circle cx="16" cy="-8" r="3" fill="#dff1ff" /><path d="M0-6v18" stroke="#1a1010" stroke-width="2.4" stroke-linecap="round" /><path d="M0-36v30" stroke="#c99a3e" stroke-width="1" /><circle cx="0" cy="-37" r="2.4" fill="#e04a3a" /></g><g class="bugs"><circle cx="44" cy="70" r="3" /><circle cx="70" cy="58" r="2.6" /><circle cx="62" cy="84" r="2.2" /></g><path d="M22 100V46C22 18 98 18 98 46V100" fill="rgb(220 240 255 / 14%)" stroke="rgb(255 255 255 / 55%)" stroke-width="2" /><path d="M32 92V48c0-14 10-20 20-22" stroke="rgb(255 255 255 / 55%)" stroke-width="3" fill="none" stroke-linecap="round" /><circle cx="60" cy="18" r="5" fill="#c99a3e" /></svg>
{#if device.fireflies}
  {#each FLY as b, i (i)}<span class="bfly" style:--c={b.c} style:offset-path={b.p} style:animation-duration="{b.d}s" style:animation-delay="{b.dl}s" style:scale={b.s}><b></b><b></b></span>{/each}
  {#each FIREFLIES as f, i (i)}<i class="ffly" style:left="{f.x}%" style:top="{f.y}%" style:animation-duration="{f.d}s, 2.2s" style:animation-delay="{f.dl}s, {f.dl}s" style:--dx="{f.dx}px" style:--dy="{f.dy}px"></i>{/each}
{/if}
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
  .glow {
    inset: 0;
    background: radial-gradient(45% 40% at 50% 45%, rgb(251 244 228 / 40%), transparent 70%);
  }
  :global(.amb.night) .glow {
    background: radial-gradient(40% 35% at 50% 45%, rgb(255 190 120 / 8%), transparent 70%);
  }
  /* gilt trellis on the walls: a diamond lattice with a dot at every crossing */
  .trellis {
    inset: 0;
    background:
      radial-gradient(circle, #c99a3e 1.2px, transparent 1.8px) 0 0 / 36px 36px,
      repeating-linear-gradient(45deg, transparent 0 24.5px, rgb(160 120 50 / 14%) 24.5px 25.5px),
      repeating-linear-gradient(-45deg, transparent 0 24.5px, rgb(160 120 50 / 14%) 24.5px 25.5px);
  }
  :global(.amb.night) .trellis {
    background:
      radial-gradient(circle, rgb(216 170 76 / 50%) 1.2px, transparent 1.8px) 0 0 / 36px 36px,
      repeating-linear-gradient(45deg, transparent 0 24.5px, rgb(216 170 76 / 7%) 24.5px 25.5px),
      repeating-linear-gradient(-45deg, transparent 0 24.5px, rgb(216 170 76 / 7%) 24.5px 25.5px);
  }
  /* a morpho pinned under a bell jar; by night, fireflies in the jar */
  .jar {
    position: absolute;
    right: 3vw;
    bottom: 3vh;
    width: 130px;
    height: 130px;
    filter: drop-shadow(0 10px 12px rgb(0 0 0 / 30%));
  }
  .jar .bugs circle {
    fill: #fff3a8;
    opacity: 0;
    filter: drop-shadow(0 0 4px #ffe680);
  }
  :global(.amb.night) .jar .pinned {
    opacity: 0.15;
  }
  :global(.amb.night) .jar .bugs circle {
    opacity: 1;
    animation: jarbug 3s ease-in-out infinite alternate;
  }
  :global(.amb.night) .jar .bugs circle:nth-child(2) {
    animation-delay: -1s;
    animation-duration: 2.4s;
  }
  :global(.amb.night) .jar .bugs circle:nth-child(3) {
    animation-delay: -2s;
    animation-duration: 3.6s;
  }
  @keyframes jarbug {
    to {
      transform: translate(8px, -14px);
      opacity: 0.3;
    }
  }
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
  /* palm fronds in the corners, swaying */
  .frond {
    position: absolute;
    stroke: #1f5a45;
    opacity: 0.4;
    transform-origin: 100% 100%;
    animation: sway 7s ease-in-out infinite alternate;
  }
  .frond.f1 {
    right: -60px;
    bottom: -40px;
    width: 360px;
    height: 360px;
  }
  .frond.f2 {
    left: 40px;
    bottom: -60px;
    width: 260px;
    height: 260px;
    transform-origin: 0 100%;
    scale: -1 1;
    animation-delay: -3s;
  }
  :global(.amb.night) .frond {
    stroke: #2a6b55;
    opacity: 0.3;
  }
  @keyframes sway {
    from {
      transform: rotate(-2deg);
    }
    to {
      transform: rotate(3deg);
    }
  }
  /* butterflies looping across the room; by night they sleep */
  .bfly {
    left: 0;
    top: 0;
    width: 40px;
    height: 32px;
    offset-rotate: auto 90deg;
    animation: flit linear infinite;
    transition: opacity 0.6s;
  }
  .bfly b {
    position: absolute;
    top: 0;
    left: 0;
    width: 20px;
    height: 32px;
    border-radius: 80% 20% 60% 40% / 60% 30% 70% 40%;
    background: var(--c);
    box-shadow:
      inset 0 0 0 2px rgb(0 0 0 / 35%),
      inset 4px -4px 0 rgb(255 255 255 / 25%);
    transform-origin: 100% 50%;
    animation: flap 0.22s ease-in-out infinite alternate;
  }
  .bfly b + b {
    left: 20px;
    border-radius: 20% 80% 40% 60% / 30% 60% 40% 70%;
    transform-origin: 0 50%;
  }
  .bfly::after {
    content: "";
    position: absolute;
    left: 19px;
    top: 4px;
    width: 2.5px;
    height: 24px;
    border-radius: 1px;
    background: #2c1a14;
  }
  @keyframes flap {
    to {
      transform: scaleX(0.25);
    }
  }
  @keyframes flit {
    from {
      offset-distance: 0%;
    }
    to {
      offset-distance: 100%;
    }
  }
  :global(.amb.night) .bfly {
    opacity: 0;
  }
  .ffly {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #fff3a8;
    box-shadow: 0 0 10px 4px rgb(255 230 120 / 60%);
    opacity: 0;
  }
  :global(.amb.night) .ffly {
    animation:
      ffly ease-in-out infinite alternate,
      glowp ease-in-out infinite alternate;
  }
  @keyframes ffly {
    to {
      transform: translate(var(--dx), var(--dy));
    }
  }
  @keyframes glowp {
    from {
      opacity: 0.15;
    }
    to {
      opacity: 1;
    }
  }
  @media (max-width: 760px) {
    .sign,
    .jar {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mote,
    .frond,
    .jar .bugs circle,
    .bfly b {
      animation: none !important;
    }
    .bfly,
    .ffly {
      display: none;
    }
  }
</style>
