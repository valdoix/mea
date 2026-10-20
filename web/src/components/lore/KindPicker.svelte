<script lang="ts">
  import Modal from "../Modal.svelte";
  import { kindsByShelf, type LoreCategory, type Shelf } from "../../lib/lorecats";

  /**
   * docs/17: pick what kind of entry to start. The kinds sit on their shelves with a line on what
   * each is for; picking one starts the entry in its place with its parts to fill in.
   */
  let { open = $bindable(false), onpick }: { open?: boolean; onpick: (kind: LoreCategory | null, title: string) => void } = $props();

  let title = $state("");
  const CHIP: Record<Shelf, string> = { ground: "butter", people: "rose", world: "sky", time: "mint", scenes: "lavender" };

  function pick(kind: LoreCategory | null) {
    onpick(kind, title.trim());
    title = "";
    open = false;
  }
</script>

<Modal bind:open title="New entry" size="lg">
  <div class="stack">
    <label class="field">
      <span class="label">Title <span class="faint">optional</span></span>
      <input class="input" bind:value={title} placeholder="Mira Vell · Harbour slang · Who relit the lamp?" />
    </label>
    {#each kindsByShelf as s (s.id)}
      <section class="shelf">
        <h3 class="small"><span class="chip tiny {CHIP[s.id]}">{s.label}</span></h3>
        <div class="kinds">
          {#each s.kinds as k (k.id)}
            <button class="kind" onclick={() => pick(k.id)}>
              <b>{k.label}</b>
              <span class="tiny muted">{k.hint}</span>
            </button>
          {/each}
        </div>
      </section>
    {/each}
    <button class="btn ghost blank" onclick={() => pick(null)}>A blank entry, no kind</button>
  </div>
</Modal>

<style>
  .shelf h3 {
    margin: 0 0 0.4rem;
  }
  .kinds {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 0.4rem;
  }
  .kind {
    display: grid;
    align-content: start;
    gap: 0.1rem;
    text-align: left;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface, transparent);
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .kind:hover,
  .kind:focus-visible {
    border-color: var(--accent);
  }
  .blank {
    justify-self: start;
  }
</style>
