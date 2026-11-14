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

  // The weather house on the rail: the lady with the parasol comes out for fair weather, the man with
  // the umbrella for foul, and in between they're both half out. It hangs under the barometer at the
  // top of the rail (on a short window it steps aside), and reads the same sky as everything else.
  const LADY = `<g class="fig lady"><path d="M58 128l8-26 8 26z" fill="#e88aa0" stroke="#8a3a50"/><circle cx="66" cy="96" r="5" fill="#f3d1bb"/><path d="M61 93c2-5 9-5 10 0z" fill="#c9963a"/><path d="M74 100l10-14" stroke="#7a5418" stroke-width="1.4"/><path d="M74 86c4-8 16-8 20 0z" fill="#ffd65a" stroke="#b5853a"/></g>`;
  const MAN = `<g class="fig man"><path d="M106 128l2-24h12l2 24z" fill="#2f5f88" stroke="#1c3a54"/><circle cx="114" cy="98" r="5" fill="#efc7a8"/><path d="M108 95h12l-2-5h-8z" fill="#3a2a1a"/><path d="M104 104v16" stroke="#3a2a1a" stroke-width="1.4"/><path d="M92 102c2-12 22-12 24 0q-3-2-6 0q-3-2-6 0q-3-2-6 0q-3-2-6 0z" fill="#3a3f48" stroke="#1d2228"/></g>`;
  const HOUSE = `<svg viewBox="0 0 180 150" aria-hidden="true"><path d="M20 64L90 8l70 56" fill="none" stroke="#7a5418" stroke-width="10" stroke-linejoin="round"/><path d="M28 60L90 14l62 46v74H28z" fill="#f6ead2" stroke="#7a5418" stroke-width="2"/><path d="M28 60L90 14l62 46" fill="none" stroke="#c4553f" stroke-width="5" stroke-dasharray="6 4"/><circle cx="90" cy="44" r="10" fill="#fff" stroke="#7a5418" stroke-width="2"/><path d="M90 37v7l5 3" stroke="#1d2a36" stroke-width="1.6" fill="none"/><path d="M50 134V96a16 16 0 0132 0v38zM98 134V96a16 16 0 0132 0v38z" fill="#3a2a1a"/><path d="M20 134h140v8H20z" fill="#7a5418"/><path d="M36 72h14v12H36zM130 72h14v12h-14z" fill="#9fc6df" stroke="#7a5418" stroke-width="1.5"/><path d="M36 84h14M130 84h14" stroke="#5aa86a" stroke-width="4"/>${LADY}${MAN}</svg>`;
  let house: HTMLDivElement | null = null;
  $effect(() => {
    const rail = document.querySelector("nav.rail") as HTMLElement | null;
    if (!rail) return;
    const el = document.createElement("div");
    el.className = "wg-house";
    el.innerHTML = HOUSE;
    rail.appendChild(el);
    house = el;
    const place = () => {
      const logo = rail.querySelector(".logo") as HTMLElement | null;
      if (logo) el.style.top = `${logo.offsetTop + logo.offsetHeight + 6}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(rail);
    return () => {
      ro.disconnect();
      el.remove();
      house = null;
    };
  });
  $effect(() => {
    const w = wx;
    const el = house;
    if (!el) return;
    el.dataset.out = w === "fair" ? "lady" : w === "cloudy" ? "both" : "man";
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
<i class="bow"></i>
<svg class="kite" viewBox="0 0 70 150" aria-hidden="true"><path d="M35 58C30 100 20 120 0 150" stroke="#7a6a50" stroke-width="1" fill="none" /><path class="tail" d="M35 58c8 14-10 20 0 34s-8 18 0 34" stroke="#c4553f" stroke-width="2" fill="none" stroke-dasharray="2 6" /><path d="M35 2L62 30 35 58 8 30z" fill="#ffd65a" stroke="#7a5418" stroke-width="1.5" /><path d="M35 2v56M8 30h54" stroke="#7a5418" /><path d="M35 2L62 30H35z" fill="#c4553f" /><path d="M35 58L8 30h27z" fill="#2f6fb0" /></svg>
<svg class="roofs" viewBox="0 0 900 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <path d="M0 120V70h60V50l30-24 30 24v20h40V40h20V20h12v20h18v80zM200 120V80l50-40 50 40v40zM300 120V60h70v60zM370 120V74l40-30 40 30v46zM450 120V50h20V32h12v18h50v70zM532 120V84l60-46 60 46v36zM652 120V64h80v56zM732 120V78l44-34 44 34v42zM820 120V58h80v62z" class="town" />
  {#each [[80, 70], [100, 70], [226, 90], [262, 90], [320, 80], [346, 80], [392, 84], [480, 66], [506, 66], [560, 96], [610, 96], [676, 80], [706, 80], [756, 90], [846, 74], [876, 74]] as [x, y], i (i)}<rect class="win" x={x} y={y} width="9" height="12" rx="1" />{/each}
  <g class="smoke"><circle cx="186" cy="16" r="6" /><circle cx="186" cy="16" r="6" /><circle cx="186" cy="16" r="6" /></g>
  <g class="smoke"><circle cx="476" cy="28" r="6" /><circle cx="476" cy="28" r="6" /><circle cx="476" cy="28" r="6" /></g>
  <path d="M592 38V6M584 14h16" class="post" />
  <g class="vane"><path d="M584 4c2-6 8-6 10-2l4-1-3 3c1 4-2 6-6 6l-6-1 3-2c-3-1-3-3-2-3z" /><path d="M582 6l-8-4 2 6z" /></g>
</svg>
<i class="mull"></i>
