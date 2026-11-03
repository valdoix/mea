<script lang="ts">
  import { onMount } from "svelte";

  // Vesper: light through a window that moves with your clock, east in the morning, west by evening.
  const BEAMS = [
    { c: "#a51c30", l: 3, w: 11 },
    { c: "#1c3f94", l: 18, w: 15 },
    { c: "#d8921a", l: 36, w: 8 },
    { c: "#17694c", l: 50, w: 12 },
    { c: "#7a2f8f", l: 68, w: 14 },
  ];
  let hour = $state(new Date().getHours());
  onMount(() => {
    const tick = setInterval(() => (hour = new Date().getHours()), 300000);
    return () => clearInterval(tick);
  });
  const shift = $derived((Math.min(20, Math.max(6, hour)) - 13) * 2.4);
</script>

<i class="stone"></i>
<div class="beams" style:transform="translateX({shift}vw)">
  {#each BEAMS as b, i (i)}<i style:left="{b.l}%" style:width="{b.w}%" style:background={b.c}></i>{/each}
</div>
<i class="candle"></i>
