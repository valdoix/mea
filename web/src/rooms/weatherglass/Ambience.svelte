<script lang="ts">
  import { device } from "../../lib/device.svelte";
  import { route } from "../../lib/router.svelte";
  import { readWeather } from "../../lib/scenery";
  import { trk } from "../../lib/trackers.svelte";
  import { resolveWeather, type RoomWeather } from "./weather";

  // Weatherglass: the sky follows the scene you're in, unless Appearance pins it. Everything is drawn
  // all the time and faded in by a class on the frame; the rail's barometer, the header's barograph
  // and the cards (beaded with rain, capped with snow) read the same value.
  const scene = $derived(route.name === "chat" && trk.data?.state?.weather?.now ? readWeather(trk.data.state.weather.now) : null);
  const wx = $derived(resolveWeather(device.roomWeather, scene));

  let root = $state<HTMLElement | null>(null);
  // The barometer's brass set hand stays on the reading before this one, so you can see which way
  // the glass moved.
  let last: RoomWeather | null = null;
  $effect(() => {
    const frame = root?.parentElement;
    if (!frame) return;
    for (const w of ["fair", "cloudy", "rain", "fog", "snow", "storm"]) frame.classList.toggle(`w-${w}`, w === wx);
    const d = document.documentElement.dataset;
    if (last && last !== wx) d.wxPrev = last;
    else if (!last) d.wxPrev = wx;
    last = wx;
    d.wx = wx;
    return () => {
      delete d.wx;
    };
  });
  $effect(() => () => {
    delete document.documentElement.dataset.wxPrev;
  });
</script>

<div class="sky" bind:this={root}>
  {#each ["fair", "cloudy", "rain", "fog", "snow", "storm"] as w (w)}<i class={w} class:on={w === wx}></i>{/each}
</div>
<i class="sun"></i>
<div class="cloud"><b></b><b></b></div>
<div class="fog"><b></b><b></b><b></b></div>
<i class="streaks"></i>
<i class="drops"></i>
<i class="flakes"></i>
<i class="flash"></i>
<i class="bolt"></i>
<i class="mist"></i>
<i class="mull"></i>
