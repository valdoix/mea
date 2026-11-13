<script lang="ts">
  // Hollow: a fairy-tale forest floor. Tree trunks in soft focus, dappled light moving over moss
  // and ferns by day, toadstools and roots along the bottom, spores drifting up. By night the caps
  // glow cyan and chartreuse and fireflies wander on slow, offset loops. Styled in room.css.
  const DAPPLES = Array.from({ length: 8 }, (_, i) => ({ x: (i * 13) % 90, y: (i * 23) % 60, s: 90 + ((i * 37) % 120), dl: -i * 1.3 }));
  const FLIES = Array.from({ length: 24 }, (_, i) => ({ x: (i * 41) % 96, y: 18 + ((i * 29) % 72), d: 5 + ((i * 7) % 8), dl: -((i * 3.1) % 10), dx: ((i * 53) % 140) - 70, dy: ((i * 31) % 90) - 45 }));
  const SPORES = Array.from({ length: 12 }, (_, i) => ({ x: 8 + ((i * 17) % 88), d: 14 + ((i * 5) % 12), dl: -i * 2.2 }));
  const SHROOMS = [
    { x: 300, y: 178, s: 1.4, c: 1 },
    { x: 332, y: 184, s: 0.9, c: 2 },
    { x: 880, y: 176, s: 1.7, c: 1 },
    { x: 920, y: 186, s: 1, c: 1 },
    { x: 948, y: 182, s: 0.7, c: 2 },
    { x: 1100, y: 180, s: 1.2, c: 2 },
    { x: 150, y: 184, s: 0.8, c: 1 },
    { x: 620, y: 186, s: 0.75, c: 3 },
    { x: 650, y: 188, s: 0.55, c: 3 },
  ];
  const FERNS = [40, 210, 470, 560, 760, 1000, 1160, 1060, 380];
</script>

<i class="trunk t1"></i>
<i class="trunk t2"></i>
<i class="trunk t3"></i>
{#each DAPPLES as d, i (i)}<i class="dapple" style:left="{d.x}%" style:top="{d.y}%" style:width="{d.s}px" style:height="{d.s * 0.7}px" style:animation-delay="{d.dl}s"></i>{/each}
<svg class="floor" viewBox="0 0 1200 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <path class="hill1" d="M0 200V150Q120 120 240 150T520 140T820 150T1200 135V200z" />
  <path class="hill2" d="M0 200V170Q160 150 320 172T680 166T1020 172T1200 160V200z" />
  <path class="root" d="M380 200c20-60 80-90 140-80M420 200c10-40 40-60 80-62M760 200c-10-50-60-70-110-64" />
  {#each FERNS as x, i (i)}<path class="fern" d="M{x} 190q-10-{50 + (i % 3) * 12} 20-{70 + (i % 3) * 12}M{x} 190q14-{40 + (i % 4) * 8} 40-{36 + (i % 4) * 8}M{x} 190q-24-{30 + (i % 2) * 10} -40-{20 + (i % 2) * 8}" />{/each}
  {#each SHROOMS as m, i (i)}
    <g class="shroom c{m.c}" transform="translate({m.x} {m.y}) scale({m.s})">
      <path class="stem" d="M-5 0c0-10 2-16 1-22h8c-1 6 1 12 1 22z" />
      <path class="cap" d="M-16 -20c0-12 8-18 16-18s16 6 16 18c-6 3-26 3-32 0z" />
      {#if m.c !== 3}<circle class="dot" cx="-7" cy="-28" r="2.4" /><circle class="dot" cx="3" cy="-32" r="2" /><circle class="dot" cx="9" cy="-24" r="1.8" />{/if}
    </g>
  {/each}
</svg>
{#each SPORES as s, i (i)}<i class="spore" style:left="{s.x}%" style:animation-duration="{s.d}s" style:animation-delay="{s.dl}s"></i>{/each}
{#each FLIES as f, i (i)}<i class="fly" style:left="{f.x}%" style:top="{f.y}%" style:animation-duration="{f.d}s" style:animation-delay="{f.dl}s" style:--dx="{f.dx}px" style:--dy="{f.dy}px"></i>{/each}
