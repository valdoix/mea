<script lang="ts">
  import Modal from "../Modal.svelte";
  import { post } from "../../lib/api";
  import { wordDiff } from "../../lib/diff";
  import { Loader } from "../../lib/icons";
  import { errorToast } from "../../lib/state.svelte";

  /**
   * Import messy notes (CHAR-12): paste anything; Mea sorts it into fields and says where each
   * piece went. You tick the fields to take; the rest of the card is untouched.
   */
  let {
    open = $bindable(false),
    kind,
    card,
    labels,
    onapply,
  }: {
    open?: boolean;
    kind: "character" | "persona";
    card: () => Record<string, unknown>;
    labels: Record<string, string>;
    onapply: (fields: Record<string, string>) => void;
  } = $props();

  let notes = $state("");
  let working = $state(false);
  let result = $state<{ fields: Record<string, string>; placements: { piece: string; field: string; why: string }[]; leftover: string[] } | null>(null);
  let take = $state<Record<string, boolean>>({});

  async function sort() {
    working = true;
    try {
      result = await post("/api/card-tools/sort", { kind, notes, card: card() });
      take = Object.fromEntries(Object.keys(result!.fields).map((k) => [k, true]));
    } catch (e) {
      errorToast(e);
    } finally {
      working = false;
    }
  }

  function apply() {
    if (!result) return;
    onapply(Object.fromEntries(Object.entries(result.fields).filter(([k]) => take[k])));
    open = false;
    result = null;
    notes = "";
  }
  const current = (k: string) => String(card()[k] ?? "");
</script>

<Modal bind:open title="Sort my notes into fields" size="lg">
  <div class="stack">
    {#if !result}
      <p class="small muted">Paste notes in any shape: bullet lists, a chat log with the creator, W++, half sentences. Mea merges them into the right fields, keeps your words, and invents nothing.</p>
      <textarea class="textarea" rows="10" bind:value={notes} placeholder={"tall, grey eyes, always in oilskins\nhates the Salt Guild\nsays 'aye' a lot\nTODO: a dog?"}></textarea>
    {:else}
      {#each Object.entries(result.fields) as [k, text] (k)}
        <label class="field-prop" class:off={!take[k]}>
          <input type="checkbox" bind:checked={take[k]} />
          <div class="grow">
            <b class="small">{labels[k] ?? k}</b>
            <p class="small diff">{#each wordDiff(current(k), text) as part, i (i)}<span class={part.type}>{part.text}</span>{/each}</p>
          </div>
        </label>
      {:else}
        <p class="small muted">Nothing in the notes fits a field.</p>
      {/each}
      {#if result.placements.length}
        <details>
          <summary class="small">Where each piece went</summary>
          <ul class="placements">
            {#each result.placements as p, i (i)}<li class="tiny"><span class="muted">“{p.piece}”</span> → <b>{labels[p.field] ?? p.field}</b>{p.why ? `: ${p.why}` : ""}</li>{/each}
          </ul>
        </details>
      {/if}
      {#if result.leftover.length}
        <div class="small"><span class="muted">Didn't fit a field (kept out):</span><ul class="placements">{#each result.leftover as l, i (i)}<li class="tiny">{l}</li>{/each}</ul></div>
      {/if}
    {/if}
  </div>
  {#snippet footer()}
    {#if !result}
      <button class="btn ghost" onclick={() => (open = false)}>Cancel</button>
      <button class="btn primary" onclick={sort} disabled={working || !notes.trim()}>{#if working}<span class="spin"><Loader size={14} /></span> Sorting…{:else}Sort them{/if}</button>
    {:else}
      <button class="btn ghost" onclick={() => (result = null)}>Back</button>
      <button class="btn primary" onclick={apply} disabled={!Object.values(take).some(Boolean)}>Use the ticked fields</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .field-prop {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    border: 1px solid var(--border);
    border-radius: var(--r-sm, 8px);
    padding: 0.5rem 0.6rem;
    cursor: pointer;
  }
  .field-prop.off {
    opacity: 0.55;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .diff {
    margin: 0.3rem 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 14rem;
    overflow: auto;
  }
  .del {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    text-decoration: line-through;
  }
  .add {
    background: color-mix(in srgb, var(--mint) 35%, transparent);
  }
  .placements {
    margin: 0.3rem 0 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.15rem;
  }
  .spin {
    display: inline-grid;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
