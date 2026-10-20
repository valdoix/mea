<script lang="ts">
  import { kindsByShelf } from "../../lib/lorecats";

  /** docs/17: a `<select>`'s kinds, grouped by shelf. Put it inside the select. */
  let { none = "" }: { none?: string } = $props();
</script>

{#if none}<option value="">{none}</option>{/if}
{#each kindsByShelf as s (s.id)}
  <optgroup label={s.label}>
    {#each s.kinds as c (c.id)}<option value={c.id} title={c.hint}>{c.label}</option>{/each}
  </optgroup>
{/each}
