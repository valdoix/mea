<script lang="ts">
  import { folio } from "../../../lib/folio.svelte";

  /** Folio on a phone: the story and each column are pages across the top. */
  let { titles }: { titles: Record<string, string> } = $props();
</script>

<div class="pager" role="tablist" aria-label="Columns">
  <button role="tab" aria-selected={folio.page === 0} onclick={() => (folio.page = 0)}>Story</button>
  {#each folio.columns as c, i (c.key)}<button role="tab" aria-selected={folio.page === i + 1} onclick={() => (folio.page = i + 1)}>{c.title ?? titles[c.kind] ?? "Codex"}</button>{/each}
</div>
