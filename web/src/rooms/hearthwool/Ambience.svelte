<script lang="ts">
  // Hearthwool: a knitted wall, two strands slowly unravelling toward a pile of yarn with the
  // needles stuck through, a few hearts drifting, and firelight from the corner at night.
  const HEARTS = [
    { x: 38, y: 14, s: 20, d: 0 },
    { x: 66, y: 30, s: 14, d: -2 },
    { x: 54, y: 62, s: 24, d: -4 },
    { x: 86, y: 10, s: 16, d: -1 },
    { x: 26, y: 84, s: 13, d: -3 },
    { x: 78, y: 52, s: 11, d: -5 },
  ];
</script>

<i class="fire"></i>
{#each HEARTS as h, i (i)}<i class="heart" style:left="{h.x}%" style:top="{h.y}%" style:font-size="{h.s}px" style:animation-delay="{h.d}s">♥</i>{/each}
<svg class="strand" viewBox="0 0 1000 600" preserveAspectRatio="none">
  <path d="M-20 90C140 20 210 230 340 170S540 40 640 190 860 420 920 500" />
  <path class="b" d="M-20 420C160 360 250 540 430 470S660 280 760 360 860 500 900 520" />
</svg>
<div class="basket">
  <i class="yarn y3"></i>
  <i class="yarn y2"></i>
  <i class="yarn y1"></i>
  <i class="needle n1"></i>
  <i class="needle n2"></i>
</div>
