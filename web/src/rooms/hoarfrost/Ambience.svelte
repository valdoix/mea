<script lang="ts">
  import { device } from "../../lib/device.svelte";

  // Hoarfrost: an inn on a mountain pass. Pale peaks and pines, snow falling; by night a moon,
  // stars and one lit window. Frost feathers in from the corners while you're quiet and thaws when
  // you type, and your breath fogs over the box as you write. Styled in room.css.
  const FROST = (() => {
    let seed = 77;
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let s = "";
    const grow = (x: number, y: number, a: number, len: number, depth: number, w: number) => {
      if (!depth || len < 6) return;
      const x2 = x + Math.cos(a) * len;
      const y2 = y + Math.sin(a) * len;
      s += `<path d="M${x.toFixed(1)} ${y.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke-width="${w.toFixed(2)}"/>`;
      for (let t = 0.2; t < 1; t += 0.2) {
        const bx = x + (x2 - x) * t;
        const by = y + (y2 - y) * t;
        const bl = len * 0.18 * (1 - t * 0.5);
        for (const d of [-1, 1]) {
          const ba = a + d * (0.9 + r() * 0.3);
          s += `<path d="M${bx.toFixed(1)} ${by.toFixed(1)}l${(Math.cos(ba) * bl).toFixed(1)} ${(Math.sin(ba) * bl).toFixed(1)}" stroke-width="${(w * 0.55).toFixed(2)}"/>`;
        }
      }
      grow(x2, y2, a + (r() - 0.5) * 0.35, len * 0.82, depth - 1, w * 0.8);
      if (r() < 0.75) grow(x2, y2, a + 0.55 + r() * 0.3, len * 0.58, depth - 1, w * 0.7);
      if (r() < 0.75) grow(x2, y2, a - 0.55 - r() * 0.3, len * 0.58, depth - 1, w * 0.7);
    };
    for (const [x, y, a0, a1] of [[0, 0, 0, Math.PI / 2], [1200, 0, Math.PI / 2, Math.PI], [0, 760, -Math.PI / 2, 0], [1200, 760, Math.PI, Math.PI * 1.5]] as const) {
      for (let k = 0; k < 7; k++) grow(x, y, a0 + ((a1 - a0) * (k + 0.5)) / 7 + (r() - 0.5) * 0.15, 70 + r() * 40, 5, 2.4);
    }
    return s;
  })();
  const PINES = Array.from({ length: 34 }, (_, i) => ({ x: (i * 353) % 1200, y: 350 + ((i * 17) % 40), h: 22 + ((i * 13) % 30) }));
  const FLAKES = Array.from({ length: 70 }, (_, i) => ({ x: (i * 37) % 100, s: 2 + (i % 4), o: 0.5 + ((i * 7) % 5) / 10, d: 8 + ((i * 11) % 12), dl: -((i * 3.7) % 20), w: ((i * 29) % 120) - 60 }));

  // The frost sits over the whole window (body::after in room.css, like the grain), drawn from this
  // picture; the backdrop is behind the panels, where it would hardly show.
  const FROST_IMG = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760" preserveAspectRatio="none"><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="1.2" flood-color="#4f7aa0" flood-opacity=".7"/></filter><g fill="none" stroke="#ffffff" stroke-linecap="round" filter="url(#s)">${FROST}</g></svg>`)}")`;

  // The frost: grows while you're quiet, thaws when you type. Breath fogs over the composer.
  $effect(() => {
    const frame = document.documentElement;
    frame.style.setProperty("--frost-img", FROST_IMG);
    let frost = 0.35;
    let last = 0;
    let breathAt = 0;
    const set = (v: number) => {
      frost = Math.max(0, Math.min(1, v));
      frame.style.setProperty("--frost", frost.toFixed(3));
    };
    set(frost);
    const typed = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t || !(t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || t.isContentEditable)) return;
      last = Date.now();
      frame.dataset.thaw = "";
      set(frost - 0.45);
      if (last - breathAt > 900) {
        breathAt = last;
        const d = document.documentElement;
        delete d.dataset.breath;
        void d.offsetWidth;
        d.dataset.breath = "";
      }
    };
    document.addEventListener("input", typed, true);
    const tick = setInterval(() => {
      if (!device.fireflies) return;
      if (Date.now() - last < 1400) return;
      delete frame.dataset.thaw;
      set(frost + 0.012);
    }, 400);
    return () => {
      document.removeEventListener("input", typed, true);
      clearInterval(tick);
      frame.style.removeProperty("--frost");
      frame.style.removeProperty("--frost-img");
      delete frame.dataset.thaw;
      delete frame.dataset.breath;
    };
  });
</script>

<i class="stars"></i>
<i class="moon"></i>
<svg class="peaks" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <path class="r1" d="M0 260L120 170 210 220 330 90 450 200 560 130 690 230 800 110 930 210 1050 140 1200 230V420H0z" />
  <path class="caps" d="M330 90l-30 40 22-6 14 18 18-28zM800 110l-26 34 18-4 14 14 16-24zM560 130l-22 28 14-3 10 10 12-18z" />
  <path class="r2" d="M0 320L140 240 260 300 400 200 520 290 640 230 760 300 900 220 1020 290 1200 250V420H0z" />
  <path class="r3" d="M0 380L180 330 360 370 540 320 720 372 900 330 1080 368 1200 340V420H0z" />
  <g class="pines">{#each PINES as p, i (i)}<path d="M{p.x} {p.y - p.h}l{p.h * 0.32} {p.h}h{-p.h * 0.64}z" />{/each}</g>
  <path class="cabin" d="M936 360h6v6h-6zM944 360h6v6h-6z" />
</svg>
{#each FLAKES as f, i (i)}<i class="flake" style:left="{f.x}%" style:width="{f.s}px" style:height="{f.s}px" style:opacity={f.o} style:animation-duration="{f.d}s" style:animation-delay="{f.dl}s" style:--w="{f.w}px"></i>{/each}
