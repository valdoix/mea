<script lang="ts">
  import { onMount } from "svelte";
  import { device } from "../../lib/device.svelte";
  import { app } from "../../lib/state.svelte";

  // The Deep End: bubbles rising by day, plankton by night. The plankton scatters from your cursor
  // and from the send button. Drawn from one small glow sprite, so a full-screen canvas stays cheap.
  let canvas = $state<HTMLCanvasElement | null>(null);
  const moving = $derived(device.fireflies);

  onMount(() => {
    const cv = canvas;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 32;
    const s = sprite.getContext("2d")!;
    const glow = s.createRadialGradient(16, 16, 0, 16, 16, 16);
    glow.addColorStop(0, "rgb(170 255 240 / 100%)");
    glow.addColorStop(0.25, "rgb(110 245 225 / 75%)");
    glow.addColorStop(1, "rgb(98 244 220 / 0%)");
    s.fillStyle = glow;
    s.fillRect(0, 0, 32, 32);

    type P = { x: number; y: number; r: number; vx: number; vy: number; p: number };
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
      const n = Math.round(Math.min(130, (w * h) / 11000));
      ps = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, r: 0.8 + Math.random() * 2.4, vx: 0, vy: 0, p: Math.random() * 6.28 }));
    };
    size();

    let mx = -999;
    let my = -999;
    const onMove = (e: PointerEvent) => ((mx = e.clientX), (my = e.clientY));
    const onClick = (e: MouseEvent) => {
      const b = (e.target as Element | null)?.closest?.(".send")?.getBoundingClientRect();
      if (!b) return;
      const X = b.left + b.width / 2;
      const Y = b.top;
      for (const p of ps) {
        const dx = p.x - X;
        const dy = p.y - Y;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < 520) {
          const f = (520 - dist) / 50;
          p.vx += (dx / dist) * f;
          p.vy += (dy / dist) * f;
        }
      }
    };
    addEventListener("resize", size);
    addEventListener("pointermove", onMove, { passive: true });
    addEventListener("click", onClick, true);

    let raf = 0;
    const frame = (t: number) => {
      raf = still ? 0 : requestAnimationFrame(frame);
      if (document.hidden) return;
      ctx.clearRect(0, 0, w, h);
      if (!moving && !still) return;
      for (const p of ps) {
        if (!app.night) {
          p.y -= 0.25 + p.r * 0.14;
          p.x += Math.sin(t / 900 + p.p) * 0.25;
          if (p.y < -6) ((p.y = h + 6), (p.x = Math.random() * w));
          if (p.r > 2.2) {
            ctx.strokeStyle = "rgb(255 255 255 / 60%)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * 1.9, 0, 6.28);
            ctx.stroke();
          }
          continue;
        }
        const dx = p.x - mx;
        const dy = p.y - my;
        const dist = Math.hypot(dx, dy);
        if (dist < 120 && dist > 0) {
          p.vx += (dx / dist) * 0.5;
          p.vy += (dy / dist) * 0.5;
        }
        p.vx *= 0.95;
        p.vy *= 0.95;
        p.x = (p.x + p.vx + Math.sin(t / 2600 + p.p) * 0.12 + w) % w;
        p.y = (p.y + p.vy + Math.cos(t / 3100 + p.p) * 0.1 + h) % h;
        const lit = Math.min(1, Math.hypot(p.vx, p.vy) / 2);
        ctx.globalAlpha = Math.min(1, 0.32 + 0.42 * Math.abs(Math.sin(t / 1400 + p.p)) + lit);
        const d = p.r * (3.4 + 2.4 * lit);
        ctx.drawImage(sprite, p.x - d, p.y - d, d * 2, d * 2);
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", size);
      removeEventListener("pointermove", onMove);
      removeEventListener("click", onClick, true);
    };
  });
</script>

<canvas bind:this={canvas}></canvas>
<i class="caus"></i>
<i class="caus b"></i>
<i class="shaft s1"></i>
<i class="shaft s2"></i>
<i class="shaft s3"></i>
<i class="sand"></i>
<i class="gauge"></i>
