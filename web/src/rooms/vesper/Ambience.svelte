<script lang="ts">
  import { onMount } from "svelte";

  // Vesper: a great rose window turning very slowly over the nave, shafts of its light with dust
  // drifting through them, and coloured pools sliding over the stone. The light moves with your
  // clock, east in the morning, west by evening. Sending (and a new chapter) rings the bell on the
  // rail and the window flares in answer. Styled in room.css.
  const BEAMS = [
    { c: "#a51c30", l: 3, w: 11 },
    { c: "#1c3f94", l: 18, w: 15 },
    { c: "#d8921a", l: 36, w: 8 },
    { c: "#17694c", l: 50, w: 12 },
    { c: "#7a2f8f", l: 68, w: 14 },
  ];
  const POOLS = [
    { c: "#a51c30", x: 52, y: -4, w: 420, d: 0 },
    { c: "#1c3f94", x: 70, y: 6, w: 360, d: -6 },
    { c: "#d8921a", x: 36, y: 12, w: 300, d: -12 },
    { c: "#5b2a86", x: 82, y: -8, w: 340, d: -18 },
  ];
  const MOTES = Array.from({ length: 26 }, (_, i) => ({ x: 40 + ((i * 37) % 58), y: 18 + ((i * 53) % 72), d: 8 + ((i * 7) % 10), dl: -((i * 2.9) % 18), dx: ((i * 23) % 60) - 30 }));

  // the rose window, drawn once: sixteen lancets, two rings of roundels, eight petals and a star
  const ROSE = (() => {
    const R = "#a51c30", S = "#1c3f94", G = "#e0a127", M = "#2d6a3e", V = "#5b2a86", L = "#2a2018";
    const at = (r: number, a: number) => [200 + Math.cos(a) * r, 200 + Math.sin(a) * r].map((v) => v.toFixed(1));
    let s = `<circle cx="200" cy="200" r="196" fill="#b7aa8c" stroke="${L}" stroke-width="4"/><circle cx="200" cy="200" r="186" fill="${S}" stroke="${L}" stroke-width="3"/>`;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const [x1, y1] = at(128, a - Math.PI / 16), [x2, y2] = at(182, a - 0.03), [x3, y3] = at(190, a), [x4, y4] = at(182, a + 0.03), [x5, y5] = at(128, a + Math.PI / 16);
      s += `<path d="M${x1} ${y1}L${x2} ${y2}Q${x3} ${y3} ${x4} ${y4}L${x5} ${y5}Z" fill="${[R, S, V, R][i % 4]}" stroke="${L}" stroke-width="3"/>`;
      const [cx, cy] = at(158, a);
      s += `<circle cx="${cx}" cy="${cy}" r="9" fill="${i % 2 ? "#e8d58a" : G}" stroke="${L}" stroke-width="2.5"/>`;
      const [ox, oy] = at(116, ((i + 0.5) / 16) * Math.PI * 2);
      s += `<circle cx="${ox}" cy="${oy}" r="13" fill="${i % 2 ? M : G}" stroke="${L}" stroke-width="2.5"/>`;
    }
    for (let i = 0; i < 8; i++) s += `<ellipse cx="200" cy="148" rx="20" ry="46" transform="rotate(${i * 45} 200 200)" fill="${i % 2 ? S : R}" stroke="${L}" stroke-width="3"/>`;
    s += `<circle cx="200" cy="200" r="30" fill="${G}" stroke="${L}" stroke-width="3"/><path d="M200 176l6 18 18 6-18 6-6 18-6-18-18-6 18-6z" fill="#fff4cf" stroke="${L}" stroke-width="2"/>`;
    return s;
  })();

  let hour = $state(new Date().getHours());
  onMount(() => {
    const tick = setInterval(() => (hour = new Date().getHours()), 300000);
    return () => clearInterval(tick);
  });
  const shift = $derived((Math.min(20, Math.max(6, hour)) - 13) * 2.4);

  // ring the bell: on send, and when a new chapter heading appears
  $effect(() => {
    const d = document.documentElement;
    let t = 0;
    const ring = () => {
      delete d.dataset.vsRing;
      void d.offsetWidth;
      d.dataset.vsRing = "";
      clearTimeout(t);
      t = window.setTimeout(() => delete d.dataset.vsRing, 1800);
    };
    const click = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.(".send")) ring();
    };
    let chapters = document.querySelectorAll(".chapter-h").length;
    const seen = new MutationObserver(() => {
      const n = document.querySelectorAll(".chapter-h").length;
      if (n > chapters && chapters > 0) ring();
      chapters = n;
    });
    seen.observe(document.body, { childList: true, subtree: true });
    addEventListener("click", click, true);
    return () => {
      removeEventListener("click", click, true);
      seen.disconnect();
      clearTimeout(t);
      delete d.dataset.vsRing;
    };
  });
</script>

<i class="stone"></i>
<div class="beams" style:transform="translateX({shift}vw)">
  {#each BEAMS as b, i (i)}<i style:left="{b.l}%" style:width="{b.w}%" style:background={b.c}></i>{/each}
</div>
<div class="pools" style:transform="translateX({shift * 1.5}vw)">
  {#each POOLS as p, i (i)}<i style:left="{p.x}%" style:bottom="{p.y}%" style:width="{p.w}px" style:height="{p.w * 0.45}px" style:background={p.c} style:animation-delay="{p.d}s"></i>{/each}
</div>
<svg class="rose" viewBox="0 0 400 400" aria-hidden="true">{@html ROSE}<circle class="glow" cx="200" cy="200" r="190" fill="url(#vs-glow)" /><defs><radialGradient id="vs-glow"><stop offset="0" stop-color="#fff8e0" stop-opacity=".85" /><stop offset=".55" stop-color="#fff2c8" stop-opacity=".25" /><stop offset="1" stop-color="#fff" stop-opacity="0" /></radialGradient></defs></svg>
<i class="shaft s1"></i><i class="shaft s2"></i><i class="shaft s3"></i>
{#each MOTES as m, i (i)}<i class="mote" style:left="{m.x}%" style:top="{m.y}%" style:animation-duration="{m.d}s" style:animation-delay="{m.dl}s" style:--dx="{m.dx}px"></i>{/each}
<i class="candle"></i>
