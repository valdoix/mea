<script lang="ts">
  // Herbarium: a botanist's folio. Foxed paper with a pressed fern that sways a little, a ladybird
  // climbing its stem (stopping now and then), a specimen tag swinging on its string, dandelion
  // seeds drifting across and a cabbage-white butterfly passing through. By night a green banker's
  // lamp lights the desk: moths circle it and dust turns in the beam. Styled in room.css.
  const STEM = "M190 676C182 560 200 430 188 300S196 120 190 24";
  const FERN = (() => {
    let out = "";
    for (let y = 40; y < 650; y += 15) {
      const t = (y - 20) / 660;
      const w = 22 + 120 * Math.sin(Math.PI * Math.min(1, t * 1.08));
      const cx = 190 + Math.sin(y / 90) * 5;
      for (const d of [-1, 1]) {
        let p = `M${cx.toFixed(1)} ${y}`;
        for (let k = 1; k <= 6; k++) p += ` L${(cx + (d * w * k) / 6).toFixed(1)} ${(y - k * 3.4 + Math.sin(k) * 1.5).toFixed(1)}`;
        out += `<path d="${p}" stroke="currentColor" stroke-width="1.6" fill="none"/>`;
        for (let k = 1; k < 6; k++) {
          const x = cx + (d * w * k) / 6;
          const yy = y - k * 3.4 + 3;
          out += `<ellipse cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" rx="${(w / 15).toFixed(1)}" ry="2.6" fill="currentColor" transform="rotate(${d * -20} ${x.toFixed(1)} ${yy.toFixed(1)})"/>`;
        }
      }
    }
    return out;
  })();
  const SEEDS = [
    { y: 18, d: 34, dl: 0, s: 1 },
    { y: 32, d: 41, dl: -9, s: 0.8 },
    { y: 52, d: 37, dl: -21, s: 1.15 },
    { y: 26, d: 46, dl: -30, s: 0.7 },
    { y: 64, d: 39, dl: -14, s: 0.9 },
    { y: 44, d: 50, dl: -38, s: 0.75 },
    { y: 74, d: 43, dl: -5, s: 1 },
  ];
  const MOTES = Array.from({ length: 14 }, (_, i) => ({ x: 22 + ((i * 37) % 22), d: 9 + (i % 5) * 2.4, dl: -i * 1.7, s: 1.5 + (i % 3) }));
  const SEED = '<path d="M14 40V14" stroke="currentColor" stroke-width=".9"/><g stroke="currentColor" stroke-width=".7">' + Array.from({ length: 14 }, (_, i) => { const a = -Math.PI + (Math.PI * i) / 13; return `<path d="M14 14l${(Math.cos(a) * 11).toFixed(1)} ${(Math.sin(a) * 11).toFixed(1)}"/>`; }).join("") + '</g><ellipse cx="14" cy="42" rx="1.6" ry="3" fill="currentColor"/>';
</script>

<i class="foxing"></i>
<i class="lamp"></i>
<div class="fernbox">
  <svg class="fern" viewBox="0 0 380 690" aria-hidden="true">
    <path d={STEM} stroke="currentColor" stroke-width="3.2" fill="none" />
    {@html FERN}
  </svg>
  <span class="bug" aria-hidden="true">
    <svg viewBox="0 0 20 24"><g class="legs" stroke="#2a1d10" stroke-width="1.2"><path d="M4 9l-3-2M4 13H0M4 17l-3 2M16 9l3-2M16 13h4M16 17l3 2" /></g><ellipse cx="10" cy="5" rx="4" ry="3.4" fill="#2a1d10" /><ellipse cx="10" cy="14" rx="7" ry="8.5" fill="#c2321f" /><path d="M10 6v16.5" stroke="#2a1d10" stroke-width="1" /><circle cx="6.6" cy="11" r="1.6" fill="#2a1d10" /><circle cx="13.4" cy="11" r="1.6" fill="#2a1d10" /><circle cx="6" cy="17" r="1.4" fill="#2a1d10" /><circle cx="14" cy="17" r="1.4" fill="#2a1d10" /><circle cx="8.2" cy="3.6" r=".8" fill="#fff" /><circle cx="11.8" cy="3.6" r=".8" fill="#fff" /></svg>
  </span>
</div>
<svg class="sprig" viewBox="0 0 120 180" aria-hidden="true">
  <path d="M60 176C56 130 70 90 62 48" stroke="#5d6b3a" stroke-width="2" fill="none" />
  <path d="M60 130q-22-12-30-2 14 8 30 2zM62 98q22-14 30-4-14 8-30 4z" fill="#7b8a4a" />
  {#each [0, 60, 120, 180, 240, 300] as a (a)}<ellipse cx="62" cy="34" rx="7" ry="13" transform="rotate({a} 62 46)" fill="currentColor" opacity=".8" />{/each}
  <circle cx="62" cy="46" r="5" fill="#e2c15a" />
</svg>
<div class="tag" aria-hidden="true"><b>Herb. Mea</b><span>No. 0412</span><i>Lunaria nocturna</i></div>
{#each SEEDS as s, i (i)}
  <span class="seed" style:top="{s.y}%" style:animation-duration="{s.d}s" style:animation-delay="{s.dl}s"><svg viewBox="0 0 28 46" style:scale={s.s} aria-hidden="true">{@html SEED}</svg></span>
{/each}
<span class="fly" aria-hidden="true"><svg viewBox="0 0 40 30"><g class="w l"><path d="M20 15C14 2 2 0 3 9c1 5 7 7 17 6z" /><path d="M20 16C12 18 6 24 10 28c4 2 9-3 10-12z" /><circle cx="9" cy="8" r="2" class="spot" /></g><g class="w r"><path d="M20 15C26 2 38 0 37 9c-1 5-7 7-17 6z" /><path d="M20 16c8 2 14 8 10 12-4 2-9-3-10-12z" /><circle cx="31" cy="8" r="2" class="spot" /></g><path d="M20 8v16" stroke="#2a1d10" stroke-width="2" stroke-linecap="round" /><path d="M20 8c-2-4-4-6-6-6M20 8c2-4 4-6 6-6" stroke="#2a1d10" stroke-width=".8" fill="none" /></svg></span>
<div class="moths" aria-hidden="true">
  {#each [0, 1, 2] as m (m)}<span class="orbit o{m}"><i class="moth"><svg viewBox="0 0 22 16"><path d="M11 8C7 1 1 2 1 6s5 6 10 2c5 4 10 2 10-2S15 1 11 8z" /></svg></i></span>{/each}
</div>
{#each MOTES as m, i (i)}<i class="mote" style:left="{m.x}%" style:width="{m.s}px" style:height="{m.s}px" style:animation-duration="{m.d}s" style:animation-delay="{m.dl}s"></i>{/each}
