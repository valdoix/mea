<script lang="ts">
  import { onMount } from "svelte";
  import { device } from "../../lib/device.svelte";
  import { route } from "../../lib/router.svelte";

  // Aphelion: far out, but cosy. A bolted porthole looks out on a turning blue planet by day and a
  // ringed giant by night; a small astronaut drifts past, waving now and then; at night there are
  // stars and the odd shooting star. The mission clock counts since you opened Mea (on the rail,
  // under the patch), and sending launches a little rocket from the button.
  let secs = $state(0);
  onMount(() => {
    const tick = setInterval(() => secs++, 1000);
    return () => clearInterval(tick);
  });
  const two = (n: number) => String(n).padStart(2, "0");
  const clock = $derived(`T+${two(Math.floor(secs / 3600))}:${two(Math.floor(secs / 60) % 60)}:${two(secs % 60)}`);
  $effect(() => {
    document.documentElement.style.setProperty("--ap-clock", `"${clock}"`);
  });
  $effect(() => () => document.documentElement.style.removeProperty("--ap-clock"));

  const BOLTS = Array.from({ length: 12 }, (_, i) => i * 30);
  const SHOOTS = [
    { x: 30, y: 12, d: -2 },
    { x: 55, y: 34, d: -5 },
    { x: 14, y: 50, d: -8 },
  ];

  // sending launches a rocket from the button
  $effect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const click = (e: MouseEvent) => {
      const btn = (e.target as Element | null)?.closest?.(".send");
      if (!btn || still || !device.fireflies) return;
      const b = btn.getBoundingClientRect();
      const k = document.createElement("div");
      k.className = "ap-rocket";
      k.style.left = `${b.left + b.width / 2 - 14}px`;
      k.style.top = `${b.top - 40}px`;
      k.innerHTML = `<svg viewBox="0 0 28 52" width="28" height="52"><path class="fl" d="M9 38q5 16 10 0z" fill="#ffb020"/><path class="fl" d="M11 38q3 9 6 0z" fill="#fff3a8"/><path d="M14 2c8 8 8 24 6 36H8C6 26 6 10 14 2z" fill="#f4f6f8" stroke="#8a96a2"/><circle cx="14" cy="18" r="4" fill="#5fb8ff" stroke="#14213d"/><path d="M8 28l-6 10h7zM20 28l6 10h-7z" fill="#e2560f"/></svg>`;
      document.body.appendChild(k);
      setTimeout(() => k.remove(), 1900);
    };
    addEventListener("click", click, true);
    return () => removeEventListener("click", click, true);
  });
</script>

<i class="grid"></i>
<i class="field"></i>
{#each SHOOTS as s, i (i)}<i class="shoot" style:left="{s.x}%" style:top="{s.y}%" style:animation-delay="{s.d}s"></i>{/each}
<div class="port">
  <div class="space">
    <i class="sf"></i>
    <div class="earth"><i></i></div>
    <div class="giant"><b></b><svg viewBox="0 0 100 100" aria-hidden="true"><ellipse cx="50" cy="50" rx="46" ry="11" fill="none" stroke="#f3d9b0" stroke-width="3" opacity=".8" transform="rotate(-16 50 50)" /><ellipse cx="50" cy="50" rx="40" ry="9" fill="none" stroke="#c9a070" stroke-width="2" opacity=".7" transform="rotate(-16 50 50)" /></svg></div>
  </div>
  {#each BOLTS as a (a)}<b class="bolt" style:--a="{a}deg"></b>{/each}
</div>
{#if device.fireflies}
  <div class="naut">
    <svg viewBox="0 0 64 76" aria-hidden="true">
      <path d="M30 46q-14 10-26 2" stroke="#9aa5b0" stroke-width="1.5" fill="none" stroke-dasharray="3 2" />
      <rect x="20" y="30" width="24" height="26" rx="8" fill="#f4f6f8" stroke="#8a96a2" stroke-width="2" />
      <rect x="24" y="36" width="10" height="7" rx="2" fill="#e2560f" />
      <path class="arm" d="M44 36l10-8" stroke="#f4f6f8" stroke-width="7" stroke-linecap="round" />
      <path d="M20 38l-8 8" stroke="#f4f6f8" stroke-width="7" stroke-linecap="round" />
      <path d="M26 56l-2 12M38 56l2 12" stroke="#f4f6f8" stroke-width="8" stroke-linecap="round" />
      <circle cx="32" cy="20" r="15" fill="#f4f6f8" stroke="#8a96a2" stroke-width="2" />
      <rect x="21" y="13" width="22" height="14" rx="7" fill="#1b2a44" />
      <path d="M25 17q4-3 8-1" stroke="#7fd0ff" stroke-width="2" fill="none" stroke-linecap="round" />
    </svg>
  </div>
{/if}
<i class="hazard"></i>
{#if route.name !== "chat"}<div class="telem"><span>{clock}</span><span>RANGE 9.3 AU</span><span>SIGNAL LAG 4m 12s</span></div>{/if}
