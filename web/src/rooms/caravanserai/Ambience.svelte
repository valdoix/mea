<script lang="ts">
  // Caravanserai: a plastered courtyard wall with a tiled dado, a horseshoe doorway framed in
  // zellige onto the dunes (a caravan crossing the far ridge by day; stars, a crescent and a campfire
  // at night), and pierced brass lanterns that swing and, after dark, scatter points of light on the
  // wall. A flying carpet bobs across the sky in the doorway, and at night the constellations draw
  // themselves. The lanterns swing when the pointer sweeps past them and settle again. On the dado
  // stand the three glasses of welcome: each message you send pours one, and after the third they
  // start again. Styled in room.css.
  import { device } from "../../lib/device.svelte";
  const STARS = (() => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: 70 }, () => ({ x: rnd() * 240, y: rnd() * 250, r: rnd() < 0.15 ? 1.3 : rnd() * 0.8 + 0.3, o: 0.5 + rnd() * 0.5 }));
  })();
  const CAMEL = "M4 14C6 8 10 7 12 9C14 4 20 3 22 8C24 5 28 6 29 10H31C33 6 36 5 37 7L38 9L36 10L34 12L33 16L32 27H30L30 17L27 18L26 27H24L24 18H14L13 27H11L11 18L9 17L8 27H6L6 17C4 17 3 16 4 14Z";
  const ARCH = "M28 400V160C6 96 50 14 120 14S234 96 212 160V400";
  const CONS = [
    [[30, 70], [52, 58], [74, 66], [96, 50], [118, 62], [108, 92], [80, 98]],
    [[150, 150], [168, 172], [190, 160], [210, 184], [200, 210]],
  ];

  // the three glasses of welcome
  let poured = $state(0);
  // lanterns on springs: the pointer sweeping past pushes them, and they swing back and settle
  let lanterns = $state<SVGSVGElement[]>([]);
  $effect(() => {
    const click = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.(".send")) poured = poured >= 3 ? 1 : poured + 1;
    };
    addEventListener("click", click, true);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const state = lanterns.map(() => ({ a: 0, v: 0 }));
    let last: number | null = null;
    let raf = 0;
    let t0 = 0;
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - (t0 || t)) / 1000);
      t0 = t;
      let moving = false;
      state.forEach((s, i) => {
        s.v += (-s.a * 30 - s.v * 2.2) * dt;
        s.a = Math.max(-22, Math.min(22, s.a + s.v * dt * 6));
        if (Math.abs(s.a) > 0.05 || Math.abs(s.v) > 0.05) moving = true;
        lanterns[i]?.style.setProperty("--push", `${s.a.toFixed(2)}deg`);
      });
      raf = moving ? requestAnimationFrame(tick) : 0;
      if (!moving) t0 = 0;
    };
    const move = (e: PointerEvent) => {
      if (still || !device.fireflies) return;
      if (last !== null) {
        const dx = e.clientX - last;
        lanterns.forEach((el, i) => {
          const b = el.getBoundingClientRect();
          if (Math.abs(e.clientX - (b.left + b.width / 2)) < 120 && e.clientY < b.bottom + 60) state[i]!.v += dx * 0.25;
        });
        if (!raf) raf = requestAnimationFrame(tick);
      }
      last = e.clientX;
    };
    addEventListener("pointermove", move, { passive: true });
    return () => {
      removeEventListener("click", click, true);
      removeEventListener("pointermove", move);
      cancelAnimationFrame(raf);
    };
  });
</script>

<i class="warm"></i>
<i class="dots"></i>
<svg class="door" viewBox="0 0 240 400" aria-hidden="true">
  <defs>
    <clipPath id="ca-arch"><path d="{ARCH}Z" /></clipPath>
    <linearGradient id="ca-sky" x1="0" y1="0" x2="0" y2="1"><stop class="sky-a" offset="0" /><stop class="sky-b" offset=".72" /></linearGradient>
    <radialGradient id="ca-sun"><stop offset="0" stop-color="#fffbe6" /><stop offset=".35" stop-color="#fff0c0" /><stop offset="1" stop-color="#ffe3a0" stop-opacity="0" /></radialGradient>
    <radialGradient id="ca-fire"><stop offset="0" stop-color="#ffd27a" /><stop offset=".4" stop-color="#ff8a3a" stop-opacity=".6" /><stop offset="1" stop-color="#ff6a2a" stop-opacity="0" /></radialGradient>
    <mask id="ca-cres"><circle cx="160" cy="92" r="17" fill="#fff" /><circle cx="168" cy="86" r="15" fill="#000" /></mask>
    <filter id="ca-blur"><feGaussianBlur stdDeviation="6" /></filter>
    <pattern id="ca-tile" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#1f3c8c" /><g fill="#238a83"><rect x="5" y="5" width="10" height="10" /><rect x="5" y="5" width="10" height="10" transform="rotate(45 10 10)" /></g><circle cx="10" cy="10" r="2.6" fill="#e1a43a" /><path d="M0 0h3L0 3zM20 0h-3l3 3zM0 20h3l-3-3zM20 20h-3l3-3z" fill="#f6ead0" /></pattern>
  </defs>
  <g clip-path="url(#ca-arch)">
    <rect width="240" height="400" fill="url(#ca-sky)" />
    <g class="stars">
      <ellipse cx="110" cy="120" rx="140" ry="22" fill="#c8c8ff" opacity=".18" transform="rotate(-28 110 120)" filter="url(#ca-blur)" />
      {#each STARS as s, i (i)}<circle cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} />{/each}
    </g>
    <g class="cons">{#each CONS as c, i (i)}<polyline points={c.map((p) => p.join(",")).join(" ")} style:animation-delay="{-i * 4}s" />{#each c as [x, y], j (j)}<circle cx={x} cy={y} r="1.8" />{/each}{/each}</g>
    <g class="sun"><circle cx="150" cy="110" r="46" fill="url(#ca-sun)" /><circle cx="150" cy="110" r="16" fill="#fffbe8" /></g>
    <g class="carpet"><g class="bob"><path d="M0 10C10 14 18 6 28 10S44 14 52 10L52 18C44 22 36 14 28 18S10 22 0 18Z" fill="#ad4c25" stroke="#e1a43a" stroke-width="1.5" /><path d="M14 13l3 1.5-3 1.5-3-1.5zM26 12l4 2.5-4 2.5-4-2.5zM38 13l3 1.5-3 1.5-3-1.5z" fill="#1f7a74" /><path d="M0 11l-3-1M0 14h-3M0 17l-3 1M52 11l3-1M52 14h3M52 17l3 1" stroke="#e1a43a" /></g></g>
    <g class="moon"><circle cx="160" cy="92" r="17" fill="#f6ecd0" mask="url(#ca-cres)" /></g>
    <path class="d1 shim" d="M0 268C40 250 80 244 120 252S200 240 240 250V400H0Z" />
    <g class="sil caravan">
      <path d={CAMEL} transform="translate(40 230) scale(.62)" />
      <path d={CAMEL} transform="translate(66 232) scale(.6)" />
      <path d={CAMEL} transform="translate(91 233) scale(.58)" />
      <path d="M119 236a2 2 0 1 1 0 .1zM117 240h4l1 6-1 6h-1l-1-5-1 5h-1l-1-6z" />
    </g>
    <path class="d2" d="M0 300C50 280 90 286 130 296S200 280 240 286V400H0Z" />
    <g class="sil">
      <path class="palm" d="M196 300c0-18 2-34 6-46" stroke-width="3" />
      <path d="M202 254c-10-6-22-4-28 2 8-2 18-2 28-2zM202 254c-4-10-14-16-24-14 8 2 16 8 24 14zM202 254c4-10 14-14 24-12-8 2-16 6-24 12zM202 254c10-4 22 0 26 6-8-4-18-6-26-6zM202 254c-2-12 2-22 8-26-2 8-4 18-8 26z" />
      <path class="palm" d="M214 304c0-14 1-26 4-36" stroke-width="2.4" />
      <path d="M218 268c-8-4-17-2-21 2 6-1 14-2 21-2zM218 268c4-8 11-11 19-9-6 2-13 5-19 9zM218 268c8-3 17 0 20 5-6-3-14-5-20-5z" />
    </g>
    <g class="fire">
      <circle cx="62" cy="352" r="40" fill="url(#ca-fire)" />
      <path class="sil" d="M20 366l22-34 22 34z" />
      <path class="flame" d="M62 340c-5 6-6 10-3 14h6c3-4 2-8-3-14z" fill="#ffd27a" />
    </g>
    <path class="d3" d="M0 350C60 332 120 344 170 352S220 346 240 342V400H0Z" />
  </g>
  <path d={ARCH} fill="none" stroke="url(#ca-tile)" stroke-width="18" />
  <path d="M19 400V160C-4 92 44 4 120 4S244 92 221 160V400" fill="none" stroke="#e1a43a" stroke-width="1.6" />
  <path d="M37 400V160C17 100 56 24 120 24S223 100 203 160V400" fill="none" stroke="#e1a43a" stroke-width="1.6" />
</svg>
{#each ["a", "b", "c"] as k, i (k)}
  <svg class="lan {k}" viewBox="0 0 30 150" aria-hidden="true" bind:this={lanterns[i]}>
    <line x1="15" y1="0" x2="15" y2="92" stroke="#8a6a3a" stroke-width="1.2" stroke-dasharray="3 2" />
    <g transform="translate(0 90)">
      <circle class="halo" cx="15" cy="30" r="30" fill="url(#ca-halo-{k})" />
      <radialGradient id="ca-halo-{k}"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".75" /><stop offset=".45" stop-color="#f6a54a" stop-opacity=".25" /><stop offset="1" stop-color="#f6a54a" stop-opacity="0" /></radialGradient>
      <path d="M11 0h8l-1 4h-6z" fill="#b8862e" />
      <path d="M8 12Q15 1 22 12z" fill="#b8862e" />
      <path class="body" d="M7 12h16l3 16-3 16H7L4 28z" />
      <g class="holes"><circle cx="11" cy="20" r="1.3" /><circle cx="15" cy="18" r="1.3" /><circle cx="19" cy="20" r="1.3" /><path d="M15 23l2 4-2 4-2-4z" /><circle cx="9" cy="29" r="1.2" /><circle cx="21" cy="29" r="1.2" /><circle cx="11" cy="37" r="1.3" /><circle cx="15" cy="39" r="1.3" /><circle cx="19" cy="37" r="1.3" /></g>
      <path d="M7 44h16l-4 6h-8z" fill="#b8862e" />
      <path d="M15 50v8" stroke="#b8862e" stroke-width="2" />
    </g>
  </svg>
{/each}
<i class="dado"></i>
<svg class="tea" viewBox="0 0 110 50" aria-hidden="true">
  <rect x="2" y="44" width="106" height="5" rx="2.5" class="tray" />
  {#each [0, 1, 2] as n (n)}
    <g transform="translate({8 + n * 34} 6)">
      <rect class="fill" class:on={poured > n} x="3" y="12" width="16" height="24" />
      <rect class="foam" class:on={poured > n} x="3" y="10" width="16" height="4" />
      <path d="M0 2h22l-3 36H3z" class="glass" />
      <path d="M1 10h20" class="band" />
    </g>
  {/each}
</svg>
