<script lang="ts">
  // Y2K Dream: a bright sky with clouds drifting and chrome soap bubbles rising, a lens flare
  // winking now and then. At night it's a screensaver: a starfield rushing past and a chrome "mea"
  // that bounces off the edges, changing colour each time it hits one. Styled in room.css.
  const BUBBLES = Array.from({ length: 12 }, (_, i) => ({ x: (i * 41) % 100, s: 22 + ((i * 17) % 48), d: 18 + ((i * 7) % 18), dl: -((i * 5.3) % 30), w: ((i * 29) % 160) - 80 }));
  const STARS = Array.from({ length: 90 }, (_, i) => {
    const a = (i * 2.399963) % (Math.PI * 2);
    const r = 55 + ((i * 37) % 45);
    return { tx: Math.cos(a) * r, ty: Math.sin(a) * r, d: 3 + ((i * 13) % 40) / 10, dl: -((i * 7) % 70) / 10 };
  });
</script>

<i class="cloud c1"></i>
<i class="cloud c2"></i>
<i class="cloud c3"></i>
<i class="cloud c4"></i>
{#each BUBBLES as b, i (i)}<i class="bub" style:left="{b.x}%" style:width="{b.s}px" style:height="{b.s}px" style:animation-duration="{b.d}s" style:animation-delay="{b.dl}s" style:--w="{b.w}px"></i>{/each}
<i class="flare"></i>
<div class="warp">
  {#each STARS as s, i (i)}<i style:--tx="{s.tx}vmax" style:--ty="{s.ty}vmax" style:animation-duration="{s.d}s" style:animation-delay="{s.dl}s"></i>{/each}
</div>
<div class="dvd"><span><b>mea</b></span></div>
