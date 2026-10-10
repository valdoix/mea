<script lang="ts">
  import type { Snippet } from "svelte";
  import { ChevronDown } from "../../lib/icons";

  /**
   * A module in the Studio rack: a card with screws, a small-caps header and a peek on the right
   * (a short summary, with an optional LED). `fold` makes it a <details> you can close.
   */
  let {
    title,
    peek = "",
    led = null,
    lit = false,
    fold = false,
    open = $bindable(true),
    aside,
    children,
  }: {
    title?: string;
    peek?: string;
    led?: "on" | "ok" | "warm" | "bad" | null;
    lit?: boolean;
    fold?: boolean;
    open?: boolean;
    aside?: Snippet;
    children: Snippet;
  } = $props();
</script>

{#snippet head()}
  <span>{#if lit}<span class="st-led on"></span>{/if}{title}</span>
  <span class="st-peek">
    {#if led}<span class="st-led {led}"></span>{/if}
    {#if aside}{@render aside()}{:else}{peek}{/if}
    {#if fold}<ChevronDown size={14} class="st-chev" />{/if}
  </span>
{/snippet}

{#if fold}
  <details class="st-mod" bind:open>
    <summary class="st-mod-h">{@render head()}</summary>
    {#if open}{@render children()}{/if}
  </details>
{:else}
  <section class="st-mod" aria-label={title}>
    {#if title}<div class="st-mod-h" role="heading" aria-level="3">{@render head()}</div>{/if}
    {@render children()}
  </section>
{/if}
