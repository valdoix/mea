<script lang="ts" generics="T extends string">
  /** A rocker: two (or three) big choices, the pressed one lit. */
  let { value, options, onchange, label }: { value: T; options: { value: T; label: string; sub?: string }[]; onchange: (v: T) => void; label: string } = $props();
</script>

<div class="st-rocker" role="radiogroup" aria-label={label} style:--n={options.length}>
  {#each options as o (o.value)}
    <button type="button" role="radio" aria-checked={value === o.value} onclick={() => value !== o.value && onchange(o.value)}>
      <span><span class="st-led"></span>{o.label}</span>
      {#if o.sub}<small>{o.sub}</small>{/if}
    </button>
  {/each}
</div>
