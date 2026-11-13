<script lang="ts">
  import { route } from "../../lib/router.svelte";
  import { trk } from "../../lib/trackers.svelte";
  import { orchardSeason } from "./season";

  // Orchard: a woodcut apple bough over rows of trees, leaves falling in the colours of the story's
  // season (blossom in spring). By day a robin hops along the bough and pecks, apples let go and
  // bounce away, and bees loop over a basket of windfalls. By night string lights twinkle under a
  // harvest moon, bats flit across it and a hedgehog trundles through the grass. Styled in room.css.
  const when = $derived(route.name === "chat" ? (trk.data?.when ?? null) : null);
  const season = $derived(orchardSeason(when?.season, when?.month));

  let root = $state<HTMLElement | null>(null);
  $effect(() => {
    const frame = root?.parentElement;
    if (!frame) return;
    for (const s of ["blossom", "summer", "early", "peak", "late"]) frame.classList.toggle(`s-${s}`, s === season);
  });

  const LEAVES = Array.from({ length: 20 }, (_, i) => ({ x: (i * 53) % 100, s: 14 + ((i * 7) % 14), d: 10 + ((i * 13) % 10), dl: -((i * 2.3) % 20), w: ((i * 37) % 260) - 90, c: 1 + (i % 3) }));
  const BULBS = (() => {
    const out: { x: number; y: number; d: number; k: number }[] = [];
    for (const [k, y0, sag] of [[0, 10, 70], [1, 44, 60]] as const) for (let t = 0.03; t < 1; t += 0.05) out.push({ x: t * 1200, y: y0 + 4 * sag * t * (1 - t) + 5, d: 1.2 + ((t * 97) % 2), k });
    return out;
  })();
  const ROWS = Array.from({ length: 16 }, (_, i) => ({ x: i * 80 + (i % 2) * 20, y: 120 + (i % 3) * 6, r: 34 + (i % 4) * 4 }));
  const APPLE = (fill: string) => `<path d="M0 -8c-3-3-12-3-12 7 0 8 6 14 9 14 1.5 0 2-1 3-1s1.5 1 3 1c3 0 9-6 9-14 0-10-9-10-12-7z" fill="${fill}" stroke="#3a2418" stroke-width="1.6"/><path d="M-7 -3c1-3 4-4 6-3M-8 2l3 2M-9 6l3 2" stroke="#3a2418" stroke-width=".9" fill="none"/><path d="M0 -8c0-3 1-5 2-7" stroke="#3a2418" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M2 -12c3-3 7-2 8-1-2 2.5-6 3-8 1z" fill="#6b7f2e" stroke="#3a2418" stroke-width="1"/>`;
  const BOUGH_LEAVES = [[30, 22, -30], [60, 30, 40], [120, 30, -50], [150, 44, 30], [200, 52, -20], [230, 54, 50], [110, 44, 80], [270, 50, -40], [310, 46, 30]] as const;
</script>

<div class="haze" bind:this={root}></div>
<i class="moon"></i>
<svg class="rows" viewBox="0 0 1200 180" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <path d="M0 160h1200v20H0z" fill="currentColor" />
  {#each ROWS as r, i (i)}<circle cx={r.x} cy={r.y} r={r.r} fill="currentColor" /><rect x={r.x - 4} y="140" width="8" height="40" fill="currentColor" />{/each}
</svg>
<svg class="lights" viewBox="0 0 1200 130" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 10Q600 150 1200 10M0 44Q600 164 1200 44" stroke="#120a06" stroke-width="1.5" fill="none" />
  {#each BULBS as b, i (i)}<circle class="bulb" cx={b.x} cy={b.y} r="4" fill={b.k ? "#ffd27a" : "#ffb35a"} style:animation-duration="{b.d}s" />{/each}
</svg>
<div class="boughbox" aria-hidden="true">
  <svg class="bough" viewBox="0 0 360 130">
    <path d="M370 14C320 22 280 18 230 34S140 58 60 50 0 40-10 46" stroke="currentColor" stroke-width="7" fill="none" stroke-linecap="round" />
    <path d="M250 30c-8 14-10 30-6 44M160 52c4 10 4 22-2 30" stroke="currentColor" stroke-width="3.5" fill="none" stroke-linecap="round" />
    {#each BOUGH_LEAVES as [x, y, a], i (i)}<g transform="translate({x} {y}) rotate({a})"><path class="bl" d="M0 0c6-10 18-12 26-8-4 8-16 14-26 8z" stroke="currentColor" stroke-width="1.4" /><path d="M2 -1l20-6" stroke="currentColor" stroke-width=".8" /></g>{/each}
    {#each Array.from({ length: 16 }, (_, i) => i) as i (i)}<path d="M{40 + i * 18} {46 - i * 1.6}l4 6" stroke="#f6ecd6" stroke-width=".8" opacity=".45" />{/each}
  </svg>
  {#each [{ x: 244, y: 80, c: "#b8352a", k: "a" }, { x: 158, y: 86, c: "#c8541f", k: "b" }, { x: 96, y: 58, c: "#d39a2b", k: "c" }] as a (a.k)}
    <span class="apple {a.k}" style:left="{a.x}px" style:top="{a.y}px"><svg viewBox="-14 -18 28 34">{@html APPLE(a.c)}</svg></span>
  {/each}
  <span class="robin"><svg viewBox="0 0 40 30"><path class="tail" d="M8 16L0 12l2 8z" fill="#5a3a24" /><ellipse cx="18" cy="17" rx="11" ry="8" fill="#6a4630" /><path d="M24 12c5 0 8 4 7 9-3 2-7 2-10 0z" fill="#e0562a" /><circle cx="27" cy="10" r="6" fill="#6a4630" /><path d="M27 12c2 0 4 2 4 4-2 1-4 0-5-1z" fill="#e0562a" /><path d="M32 9l5 1-5 2z" fill="#3a2418" /><circle cx="29" cy="8.5" r="1.2" fill="#120a06" /><path d="M16 24v5M20 24v5" stroke="#3a2418" stroke-width="1.2" /></svg></span>
</div>
<svg class="basket" viewBox="0 0 120 80" aria-hidden="true">
  <g transform="translate(34 22)">{@html APPLE("#b8352a")}</g>
  <g transform="translate(58 16)">{@html APPLE("#d39a2b")}</g>
  <g transform="translate(82 22)">{@html APPLE("#c8541f")}</g>
  <path d="M10 32h100l-10 44H20z" fill="#b8874f" stroke="#3a2418" stroke-width="2" />
  <path d="M14 44h92M17 56h86M19 68h82M30 32l4 44M50 32l2 44M70 32l-2 44M90 32l-4 44" stroke="#7a5430" stroke-width="1.6" />
  <path d="M16 32c4-26 84-26 88 0" stroke="#7a5430" stroke-width="4" fill="none" />
</svg>
{#each [0, 1] as b (b)}<span class="bee b{b}" aria-hidden="true"><svg viewBox="0 0 20 14"><ellipse class="wing" cx="8" cy="3" rx="4" ry="3" fill="#fff" opacity=".8" /><ellipse cx="10" cy="8" rx="7" ry="5" fill="#f2b632" /><path d="M8 3.5v9M11 3.2v9.6" stroke="#2a1d10" stroke-width="1.8" /><circle cx="16" cy="7" r="2.6" fill="#2a1d10" /></svg></span>{/each}
{#each [0, 1] as b (b)}<span class="bat t{b}" aria-hidden="true"><svg viewBox="0 0 40 18"><path class="wl" d="M20 8C16 2 8 0 0 4c4 1 6 4 5 7 3-2 6-1 8 2 2-3 5-4 7-5z" /><path class="wr" d="M20 8c4-6 12-8 20-4-4 1-6 4-5 7-3-2-6-1-8 2-2-3-5-4-7-5z" /><ellipse cx="20" cy="9" rx="3" ry="4" /></svg></span>{/each}
<span class="hog" aria-hidden="true"><svg viewBox="0 0 60 34"><path d="M6 28C4 14 16 4 30 4s26 8 26 18c0 4-2 6-6 6z" fill="#6a4a30" /><g stroke="#3a2418" stroke-width="1.6">{#each Array.from({ length: 11 }, (_, i) => i) as i (i)}<path d="M{10 + i * 4} {22 - Math.sin((i / 10) * Math.PI) * 14}l{-3} {-5}" />{/each}</g><path d="M46 20c6 0 12 4 13 8l-4 1c-3 0-8-2-9-4z" fill="#c9a07a" /><circle cx="58" cy="28" r="1.8" fill="#120a06" /><circle cx="51" cy="22" r="1.1" fill="#120a06" /><path class="feet" d="M16 28v4M26 28v4M38 28v4M46 28v4" stroke="#3a2418" stroke-width="2" stroke-linecap="round" /></svg></span>
{#each LEAVES as l, i (i)}
  <span class="leaf" style:left="{l.x}%" style:width="{l.s}px" style:height="{l.s}px" style:color="var(--l{l.c})" style:animation-duration="{l.d}s" style:animation-delay="{l.dl}s" style:--w="{l.w}px"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="lf" d="M12 2c4 4 9 6 9 12a9 9 0 01-9 8 9 9 0 01-9-8c0-6 5-8 9-12z" fill="currentColor" /><path class="vein" d="M12 6v16M12 12l4-3M12 16l-4-3" stroke="rgb(0 0 0 / 25%)" stroke-width="1" fill="none" /></svg></span>
{/each}
