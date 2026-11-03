<script lang="ts">
  import { onMount } from "svelte";
  import { route } from "../../lib/router.svelte";

  // Aphelion: a porthole by day, open space by night, and a mission clock counting since you opened Mea.
  let secs = $state(0);
  onMount(() => {
    const tick = setInterval(() => secs++, 1000);
    return () => clearInterval(tick);
  });
  const two = (n: number) => String(n).padStart(2, "0");
  const clock = $derived(`T+${two(Math.floor(secs / 3600))}:${two(Math.floor(secs / 60) % 60)}:${two(secs % 60)}`);
</script>

<i class="grid"></i>
<i class="field"></i>
<div class="port"><i class="planet"></i></div>
{#if route.name !== "chat"}<div class="telem"><span>{clock}</span><span>RANGE 9.3 AU</span><span>SIGNAL LAG 4m 12s</span></div>{/if}
