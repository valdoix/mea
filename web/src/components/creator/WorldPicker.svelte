<script lang="ts">
  import { get } from "../../lib/api";
  import type { CreatorSession } from "../../lib/creator.svelte";
  import { BookOpen, Globe2, X } from "../../lib/icons";
  import { app } from "../../lib/state.svelte";
  import type { LorebookSummary, StudioDraft } from "../../lib/types";

  /** The world a character or persona lives in: lorebooks (and an unsaved Lore Studio draft). */
  let { session }: { session: CreatorSession } = $props();
  const draft = $derived(session.draft!);
  let books = $state<LorebookSummary[]>([]);
  let loreDraft = $state<StudioDraft | null>(null);

  $effect(() => {
    void app.libraryVersion;
    get<{ lorebooks: LorebookSummary[] }>("/api/lorebooks").then((r) => (books = r.lorebooks.filter((b) => !b.settings.chronicleFor)), () => {});
  });
  $effect(() => {
    const id = draft.loreDraftId;
    if (id) get<{ draft: StudioDraft }>(`/api/lore-studio/${id}`).then((r) => (loreDraft = r.draft), () => (loreDraft = null));
    else loreDraft = null;
  });

  const chosen = $derived(books.filter((b) => draft.worldBookIds.includes(b.id)));
  function set(ids: string[]) {
    draft.worldBookIds = ids;
    session.save({ worldBookIds: ids }, "world", 0);
  }
</script>

<div class="panel stack tight">
  <span class="label"><Globe2 size={14} /> The world {draft.kind === "persona" ? "you" : "they"} live in <span class="faint">every step writes against it, and it's linked on save</span></span>
  <div class="row wrap">
    {#if loreDraft}
      <a class="chip lavender" href="/lore-studio/{loreDraft.id}" title="A Lore Studio draft, not saved yet"><BookOpen size={12} /> {loreDraft.title} <span class="faint">(draft)</span></a>
    {/if}
    {#each chosen as b (b.id)}
      <span class="chip butter"><BookOpen size={12} /> {b.name}<button class="x" onclick={() => set(draft.worldBookIds.filter((x) => x !== b.id))} aria-label="Remove {b.name}"><X size={11} /></button></span>
    {/each}
    <select class="select mini" onchange={(e) => { if (e.currentTarget.value) { set([...draft.worldBookIds, e.currentTarget.value]); e.currentTarget.value = ""; } }} aria-label="Add a lorebook">
      <option value="">Add a lorebook…</option>
      {#each books.filter((b) => !draft.worldBookIds.includes(b.id)) as b (b.id)}<option value={b.id}>{b.name} ({b.entryCount})</option>{/each}
    </select>
    <a class="tiny" href="/lore-studio">Build a new world →</a>
  </div>
  {#if !chosen.length && !loreDraft}<span class="tiny muted">No world yet: the model invents what it needs. Pick a lorebook to keep names, places and rules consistent.</span>{/if}
</div>

<style>
  .label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    text-decoration: none;
    color: var(--text);
  }
  .mini {
    width: auto;
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
    font-size: var(--fs-xs);
  }
  .x {
    border: 0;
    background: none;
    display: grid;
    place-items: center;
    cursor: pointer;
    color: inherit;
    padding: 0;
  }
</style>
