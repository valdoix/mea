<script lang="ts">
  import { filed, undoFiled } from "../../lib/filings.svelte";
  import { Undo, X } from "../../lib/icons";

  /** P1: what Mea filed from this message, each with Undo (and "That's not what I meant" for guesses). */
  let { messageId }: { messageId: string } = $props();
  const list = $derived(filed.byMessage[messageId] ?? []);
  const icon: Record<string, string> = { lesson: "📏", promise: "🤝", truth: "📌", calendar: "📅", motif: "🔁", plant: "🌱", offpage: "🔒", owner: "🏷", clock: "🕰", canon: "📚", lore_update: "📖", "note-know": "👁", "note-truth": "📌", "lesson-fact": "👁" };
  // docs/19 5.1: a fact saved from your note for a reply can be taken back as only meant for that reply.
  const fromNote = (kind: string) => kind === "note-know" || kind === "note-truth";
</script>

{#if list.length}
  <div class="filed" aria-label="Filed from this message">
    {#each list as f (f.id)}
      <span class="fchip" title={f.data.guess ? "Mea read this from the message" : fromNote(f.kind) ? "Saved from your note for this reply: it holds from now on" : "Filed from this message"}>
        <span aria-hidden="true">{icon[f.kind] ?? "✓"}</span>
        {f.label}
        <button type="button" onclick={() => undoFiled(f)} aria-label="Undo: {f.label}" title="Undo"><Undo size={12} /></button>
        {#if f.data.guess}<button type="button" onclick={() => undoFiled(f, true)} aria-label="That's not what I meant" title="That's not what I meant"><X size={12} /></button>{/if}
        {#if f.kind === "lesson-fact"}<button type="button" class="keep" onclick={() => undoFiled(f, true)} title="Keep as a lesson">Keep as a lesson</button>{/if}
        {#if fromNote(f.kind)}<button type="button" onclick={() => undoFiled(f, true)} aria-label="That's only for this reply" title="That's only for this reply"><X size={12} /></button>{/if}
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
    max-width: 100%;
    padding: 0.18rem 0.3rem 0.18rem 0.55rem;
    border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--border));
    border-radius: var(--r, 12px);
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    color: var(--text-muted);
    font: 600 var(--fs-xs) / 1.35 var(--font-ui);
    overflow-wrap: anywhere;
  }
  .fchip button {
    flex: none;
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
  .fchip button.keep {
    width: auto;
    padding: 0 0.4rem;
    border-radius: var(--r, 12px);
    font: inherit;
  }
  .fchip button:hover {
    background: var(--surface-2);
    color: var(--text);
  }
</style>
