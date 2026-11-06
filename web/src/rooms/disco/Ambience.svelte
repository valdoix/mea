<script lang="ts">
  import { onMount } from "svelte";
  import { device } from "../../lib/device.svelte";
  import { app } from "../../lib/state.svelte";

  // Disco Inferno: a mirror ball with glints and slow sunburst rays, specks of light circling the
  // walls, spotlights at night, and a light-up floor that lights a new set of tiles twice a second
  // (well under three flashes a second). Everything holds still when drifting things are off.
  const COLS = 14;
  const ROWS = 6;
  const COLOURS = ["#ff4fa8", "#ff8a3d", "#2fe0d6", "#ffd24a"];
  const GLINTS = [
    { x: -110, y: 40, s: 16, d: 0 },
    { x: 88, y: 20, s: 12, d: -0.9 },
    { x: 60, y: 104, s: 18, d: -1.7 },
    { x: -74, y: 118, s: 10, d: -0.4 },
    { x: 136, y: 74, s: 9, d: -2.1 },
  ];
  let lit = $state<Record<number, string>>({});
  let canvas = $state<HTMLCanvasElement | null>(null);
  const moving = $derived(device.fireflies);

  onMount(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let n = 0;
    const tick = setInterval(() => {
      if (still || !moving || document.hidden) return;
      const next: Record<number, string> = {};
      for (let k = 0; k < 6; k++) next[(n * 7 + k * 17 + Math.floor(Math.random() * 5)) % (COLS * ROWS)] = COLOURS[(n + k) % 4]!;
      lit = next;
      n++;
    }, 500);

    const cv = canvas;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return () => clearInterval(tick);
    // One soft dot, drawn once and stamped for every speck.
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 32;
    const s = sprite.getContext("2d")!;
    const g = s.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgb(255 255 255 / 100%)");
    g.addColorStop(0.3, "rgb(255 255 255 / 70%)");
    g.addColorStop(1, "rgb(255 255 255 / 0%)");
    s.fillStyle = g;
    s.fillRect(0, 0, 32, 32);
    const tints = COLOURS.map((c) => {
      const t = document.createElement("canvas");
      t.width = t.height = 32;
      const x = t.getContext("2d")!;
      x.drawImage(sprite, 0, 0);
      x.globalCompositeOperation = "source-in";
      x.fillStyle = c;
      x.fillRect(0, 0, 32, 32);
      x.globalCompositeOperation = "lighter";
      x.globalAlpha = 0.5;
      x.drawImage(sprite, 0, 0);
      return t;
    });

    type P = { a: number; d: number; r: number; p: number };
    let w = 0;
    let h = 0;
    let ps: P[] = [];
    const size = () => {
      w = innerWidth;
      h = innerHeight;
      const d = Math.min(devicePixelRatio || 1, 1.5);
      cv.width = w * d;
      cv.height = h * d;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const count = Math.round(Math.min(80, (w * h) / 16000));
      ps = Array.from({ length: count }, () => ({ a: Math.random() * 6.28, d: 0.3 + Math.random() * 0.7, r: 1 + Math.random() * 2, p: Math.random() * 6.28 }));
    };
    size();
    addEventListener("resize", size);

    let raf = 0;
    const frame = (t: number) => {
      raf = still ? 0 : requestAnimationFrame(frame);
      if (document.hidden) return;
      ctx.clearRect(0, 0, w, h);
      const night = app.night;
      const cx = w * 0.69;
      ps.forEach((p, i) => {
        if (moving && !still) p.a += 0.0016 * (0.6 + p.d);
        const R = 140 + p.d * w * 0.55;
        const x = cx + Math.cos(p.a) * R;
        const y = 70 + Math.abs(Math.sin(p.a)) * R * 0.75;
        ctx.globalAlpha = (night ? 0.8 : 0.5) * (0.5 + 0.5 * Math.sin(t / 600 + p.p));
        const d = p.r * (night ? 5 : 3.6);
        ctx.drawImage(night ? tints[i % 4]! : sprite, x - d, y - d, d * 2, d * 2);
      });
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
    return () => {
      clearInterval(tick);
      cancelAnimationFrame(raf);
      removeEventListener("resize", size);
    };
  });
</script>

<i class="rays"></i>
<i class="spot l"></i>
<i class="spot r"></i>
<i class="arcs"></i>
<div class="floor"><div class="g">{#each { length: COLS * ROWS } as _, i (i)}<i class:lit={lit[i]} style:--c={lit[i]}></i>{/each}</div></div>
<canvas bind:this={canvas}></canvas>
<div class="ball"><i class="facets"></i></div>
<div class="glints">{#each GLINTS as g, i (i)}<i style:left="{g.x}px" style:top="{g.y}px" style:width="{g.s}px" style:height="{g.s}px" style:animation-delay="{g.d}s"></i>{/each}</div>
