<script lang="ts">
  import { filed, undoFiled } from "../../lib/filings.svelte";
  import { Undo, X } from "../../lib/icons";

  /** P1: what Mea filed from this message, each with Undo (and "That's not what I meant" for guesses). */
  let { messageId }: { messageId: string } = $props();
  const list = $derived(filed.byMessage[messageId] ?? []);
  const icon: Record<string, string> = { lesson: "📏", promise: "🤝", truth: "📌", calendar: "📅", motif: "🔁", plant: "🌱", offpage: "🔒", owner: "🏷", clock: "🕰", canon: "📚" };
</script>

{#if list.length}
  <div class="filed" aria-label="Filed from this message">
    {#each list as f (f.id)}
      <span class="fchip" title={f.data.guess ? "Mea read this from the message" : "Filed from this message"}>
        <span aria-hidden="true">{icon[f.kind] ?? "✓"}</span>
        {f.label}
        <button type="button" onclick={() => undoFiled(f)} aria-label="Undo: {f.label}" title="Undo"><Undo size={12} /></button>
        {#if f.data.guess}<button type="button" onclick={() => undoFiled(f, true)} aria-label="That's not what I meant" title="That's not what I meant"><X size={12} /></button>{/if}
      </span>
    {/each}
  </div>
{/if}

<style>
  .filed {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    padding-top: 0.4rem;
  }
  .fchip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    max-width: 24rem;
    padding: 0.18rem 0.3rem 0.18rem 0.55rem;
    border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--border));
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    color: var(--text-muted);
    font: 600 var(--fs-xs) / 1.2 var(--font-ui);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .fchip button {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
  }
  .fchip button:hover {
    background: var(--surface-2);
    color: var(--text);
  }
</style>
