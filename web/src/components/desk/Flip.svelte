<script lang="ts">
  import type { Snippet } from "svelte";

  /** A flip switch with its label on the left. */
  let { checked, onchange, disabled = false, children }: { checked: boolean; onchange: (on: boolean) => void; disabled?: boolean; children: Snippet } = $props();
</script>

<label class="st-flip" class:off={disabled}>
  <span>{@render children()}</span>
  <span class="st-toggle"><input type="checkbox" {checked} {disabled} onchange={(e) => onchange(e.currentTarget.checked)} /><span></span></span>
</label>
