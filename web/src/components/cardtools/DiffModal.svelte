<script lang="ts">
  import Modal from "../Modal.svelte";
  import { mergeHunks, paragraphHunks, wordDiff } from "../../lib/diff";

  /**
   * A proposal shown as a diff (CHAR-11): accept it whole, or only the changed paragraphs you tick.
   * Nothing changes until you press a button.
   */
  let {
    open = $bindable(false),
    title,
    before,
    after,
    note = "",
    onaccept,
  }: { open?: boolean; title: string; before: string; after: string; note?: string; onaccept: (text: string) => void } = $props();

  const hunks = $derived(paragraphHunks(before, after));
  const changed = $derived(hunks.filter((h) => !h.same));
  let accepted = $state(new Set<number>());
  $effect(() => {
    accepted = new Set(changed.map((h) => h.id));
  });

  function toggle(id: number) {
    const next = new Set(accepted);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    accepted = next;
  }
  function done(text: string | null) {
    if (text !== null) onaccept(text);
    open = false;
  }
</script>

<Modal bind:open {title} size="lg">
  <div class="stack">
    {#if note}<p class="small muted">{note}</p>{/if}
    {#if !changed.length}
      <p class="small muted">No changes: the proposal is the same as what you have.</p>
    {:else}
      <span class="tiny muted">{changed.length} change{changed.length === 1 ? "" : "s"}. Untick any you don't want; unchanged paragraphs stay as they are.</span>
      <div class="hunks">
        {#each hunks as h (h.id)}
          {#if h.same}
            <p class="same small">{h.before.join("\n\n")}</p>
          {:else}
            <label class="hunk" class:off={!accepted.has(h.id)}>
              <input type="checkbox" checked={accepted.has(h.id)} onchange={() => toggle(h.id)} aria-label="Use this change" />
              <p class="small diff">{#each wordDiff(h.before.join("\n\n"), h.after.join("\n\n")) as part, k (k)}<span class={part.type}>{part.text}</span>{/each}</p>
            </label>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
  {#snippet footer()}
    <button class="btn ghost" onclick={() => done(null)}>Keep mine</button>
    {#if changed.length > 1}<button class="btn" onclick={() => done(mergeHunks(hunks, accepted))} disabled={!accepted.size}>Use the ticked changes</button>{/if}
    <button class="btn primary" onclick={() => done(after)} disabled={!changed.length}>Use it all</button>
  {/snippet}
</Modal>

<style>
  .hunks {
    display: grid;
    gap: 0.5rem;
    max-height: min(60vh, 36rem);
    overflow: auto;
  }
  .same {
    margin: 0;
    color: var(--text-muted);
    white-space: pre-wrap;
    padding: 0 0.4rem 0 2rem;
  }
  .hunk {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    padding: 0.5rem;
    border-radius: var(--r-sm, 8px);
    border: 1px solid var(--border);
    cursor: pointer;
  }
  .hunk.off {
    opacity: 0.55;
  }
  .hunk input {
    margin-top: 0.2rem;
  }
  .diff {
    margin: 0;
    white-space: pre-wrap;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .del {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--danger) 60%, transparent);
  }
  .add {
    background: color-mix(in srgb, var(--mint) 35%, transparent);
  }
</style>
