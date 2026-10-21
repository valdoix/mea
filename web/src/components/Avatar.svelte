<script lang="ts">
  import { imageUrl } from "../lib/api";
  import { initials } from "../lib/format";
  import { backfillThumb } from "../lib/images";
  import { app } from "../lib/state.svelte";

  let {
    id = null,
    name = "",
    size = 40,
    shape = "round",
    thumb = true,
    palette = [],
    portrait = false,
  }: { id?: string | null; name?: string; size?: number; shape?: "round" | "squircle"; thumb?: boolean; palette?: string[]; portrait?: boolean } = $props();

  let failed = $state(false);
  const bg = $derived(
    palette.length >= 2 ? `linear-gradient(135deg, ${palette[0]}, ${palette[1]})` : "linear-gradient(135deg, var(--peach), var(--lavender))",
  );
  const height = $derived(portrait ? Math.round(size * 1.5) : size);
  // Rooms, frames and pages often resize the avatar with CSS, so the drawn box can be much bigger
  // than `size`. Measure it; only ever grow, so a resize never swaps in a smaller image.
  let el = $state<HTMLSpanElement>();
  let drawn = $state({ w: 0, h: 0 });
  $effect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const { width: w, height: h } = e!.contentRect;
      if (w > drawn.w || h > drawn.h) drawn = { w: Math.max(w, drawn.w), h: Math.max(h, drawn.h) };
    });
    ro.observe(el);
    return () => ro.disconnect();
  });
  // PERF-08 / MOB-12: the smallest size that stays sharp here (one size smaller in data-light mode).
  // Sizes are capped on the image's long side, but object-fit: cover fills the box with its short
  // side, so a 2:3 card in a square frame needs 1.5x the box width along its long side.
  const want = $derived.by(() => {
    if (!thumb) return false as const;
    const w = Math.max(size, drawn.w),
      h = Math.max(height, drawn.h);
    const box = Math.max(w, h, Math.min(w, h) * 1.5);
    const px = box * (typeof devicePixelRatio === "number" ? devicePixelRatio : 1) * (app.dataLight ? 0.5 : 1);
    return px <= 128 ? ("s" as const) : px <= 320 ? ("m" as const) : ("l" as const);
  });

  $effect(() => {
    void id;
    failed = false;
  });
</script>

<span bind:this={el} class="avatar {shape}" style:width="{size}px" style:height="{height}px" style:background={bg} style:font-size="{Math.max(10, size * 0.38)}px">
  {#if id && !failed}
    <img
      src={imageUrl(id, want)}
      alt={name}
      loading="lazy"
      decoding="async"
      draggable="false"
      onload={(e) => thumb && backfillThumb(id!, e.currentTarget as HTMLImageElement)}
      onerror={() => (failed = true)}
    />
  {:else}
    <span class="initials" aria-label={name}>{initials(name) || "✿"}</span>
  {/if}
</span>

<style>
  .avatar {
    display: inline-grid;
    place-items: center;
    flex: none;
    overflow: hidden;
    color: var(--text);
    font-family: var(--font-display);
    font-weight: 600;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 5%);
  }
  .round {
    border-radius: 50%;
  }
  .squircle {
    border-radius: 28%;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 20%;
    display: block;
  }
  .initials {
    opacity: 0.75;
  }
</style>
