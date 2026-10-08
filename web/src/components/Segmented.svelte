<script lang="ts" generics="T extends string">
  let { value = $bindable(), options, onchange, small = false }: { value: T; options: { value: T; label: string }[]; onchange?: (v: T) => void; small?: boolean } = $props();
</script>

<div class="seg" class:small role="radiogroup">
  {#each options as o (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === o.value}
      class:on={value === o.value}
      onclick={() => {
        value = o.value;
        onchange?.(o.value);
      }}>{o.label}</button
    >
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    background: var(--surface-2);
    border-radius: var(--r-pill);
    padding: 3px;
    gap: 2px;
    flex-wrap: wrap;
  }
  button {
    border: 0;
    background: none;
    color: var(--text-muted);
    font: 700 var(--fs-sm) / 1 var(--font-ui);
    padding: 0.5rem 0.9rem;
    border-radius: var(--r-pill);
    cursor: pointer;
    transition:
      background var(--t-fast),
      color var(--t-fast);
  }
  .small button {
    padding: 0.38rem 0.7rem;
    font-size: var(--fs-xs);
  }
  button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-1);
  }
</style>
