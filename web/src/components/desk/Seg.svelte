<script lang="ts" generics="T extends string">
  /** A segmented switch: a few short choices in a recessed well. */
  let { value, options, onchange, label }: { value: T; options: { value: T; label: string; title?: string }[]; onchange: (v: T) => void; label: string } = $props();

  function key(e: KeyboardEvent) {
    const i = options.findIndex((o) => o.value === value);
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = options[(i + d + options.length) % options.length]!;
    onchange(next.value);
    requestAnimationFrame(() => ((e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()));
  }
</script>

<div class="st-seg" role="radiogroup" aria-label={label} tabindex="-1" onkeydown={key}>
  {#each options as o (o.value)}
    <button type="button" role="radio" aria-checked={value === o.value} tabindex={value === o.value ? 0 : -1} title={o.title ?? o.label} onclick={() => value !== o.value && onchange(o.value)}>{o.label}</button>
  {/each}
</div>
