<script lang="ts">
  import EmptyState from "../components/EmptyState.svelte";
  import { get, post } from "../lib/api";
  import { confirm } from "../lib/dialogs.svelte";
  import { timeAgo } from "../lib/format";
  import { Undo } from "../lib/icons";
  import { errorToast, toast } from "../lib/state.svelte";

  interface Item {
    id: string;
    name?: string;
    title?: string;
    deleted_at: number;
  }
  let trash = $state<{ characters: Item[]; chats: Item[]; personas: Item[]; lorebooks: Item[]; retentionDays: number } | null>(null);

  async function load() {
    try {
      trash = await get("/api/trash");
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void load();
  });

  const restorePath: Record<string, string> = { characters: "characters", chats: "chats", personas: "personas", lorebooks: "lorebooks" };

  async function restore(kind: string, item: Item) {
    await post(`/api/${restorePath[kind]}/${item.id}/restore`);
    toast(`Restored ${item.name ?? item.title}`, { kind: "ok" });
    await load();
  }

  async function empty() {
    if (!(await confirm({ title: "Empty the trash?", message: "Everything here is deleted for good. This can't be undone (except from a backup).", confirmLabel: "Delete forever", danger: true }))) return;
    await post("/api/trash/empty");
    toast("Trash emptied");
    await load();
  }

  const groups = $derived(trash ? ([["characters", "Characters"], ["chats", "Chats"], ["personas", "Personas"], ["lorebooks", "Lorebooks"]] as const) : []);
  const count = $derived(trash ? trash.characters.length + trash.chats.length + trash.personas.length + trash.lorebooks.length : 0);
</script>

<div class="page">
  <div class="row between wrap">
    <div>
      <h1>Trash</h1>
      <p class="muted small">Deleted things wait here for {trash?.retentionDays ?? 30} days before they're gone for good.</p>
    </div>
    {#if count}<button class="btn danger" onclick={empty}>Empty trash</button>{/if}
  </div>
  {#if trash && !count}
    <EmptyState icon="🧺" title="The trash is empty" text="Nothing to see here." />
  {:else if trash}
    {#each groups as [kind, label] (kind)}
      {#if trash[kind].length}
        <section class="stack tight group">
          <h2>{label}</h2>
          {#each trash[kind] as item (item.id)}
            <div class="row card item">
              <span class="grow"><b>{item.name ?? item.title}</b> <span class="tiny muted">· deleted {timeAgo(item.deleted_at)}</span></span>
              <button class="btn small" onclick={() => restore(kind, item)}><Undo size={14} /> Restore</button>
            </div>
          {/each}
        </section>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .page {
    max-width: 46rem;
    margin: 0 auto;
    padding: 1.5rem clamp(1rem, 3vw, 2rem) 4rem;
    display: grid;
    gap: 1.2rem;
  }
  .item {
    padding: 0.7rem 0.9rem;
  }
</style>
