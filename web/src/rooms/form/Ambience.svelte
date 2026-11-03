<script lang="ts">
  import { onMount } from "svelte";
  import { device } from "../../lib/device.svelte";

  // Form: five shapes changing places every so often. They only move when drifting things are on.
  const SHAPES = ["c", "q", "t", "k", "o"];
  const seat = () => `translate(${Math.round(4 + Math.random() * 74)}vw, ${Math.round(-6 + Math.random() * 74)}vh) rotate(${Math.floor(Math.random() * 4) * 90}deg)`;
  let seats = $state(SHAPES.map(seat));
  onMount(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tick = setInterval(() => {
      if (device.fireflies && !document.hidden) seats = SHAPES.map(seat);
    }, 7000);
    return () => clearInterval(tick);
  });
</script>

{#each SHAPES as s, i (s)}<i class="sh {s}" style:transform={seats[i]}></i>{/each}
