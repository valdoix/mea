<script lang="ts">
  import { imageUrl } from "../lib/api";
  import { initials } from "../lib/format";
  import { backfillThumb } from "../lib/images";

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

  $effect(() => {
    void id;
    failed = false;
  });
</script>

<span class="avatar {shape}" style:width="{size}px" style:height="{height}px" style:background={bg} style:font-size="{Math.max(10, size * 0.38)}px">
  {#if id && !failed}
    <img
      src={imageUrl(id, thumb)}
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
