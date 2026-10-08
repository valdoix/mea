<script lang="ts">
  import { api, get, post, put } from "../lib/api";
  import { timeAgo } from "../lib/format";
  import { Import, Plus, SlidersHorizontal, Star } from "../lib/icons";
  import { navigate } from "../lib/router.svelte";
  import { app, errorToast, saveSetting, toast } from "../lib/state.svelte";

  let presets = $state<{ id: string; name: string; mode: string; isDefault: boolean; updatedAt: number }[]>([]);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function load() {
    try {
      presets = (await get<{ presets: typeof presets }>("/api/presets")).presets;
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void app.libraryVersion;
    void load();
  });

  async function create() {
    const p = await post<{ id: string }>("/api/presets", { name: "New preset" });
    navigate(`/presets/${p.id}`);
  }

  async function importFile(f: File) {
    const form = new FormData();
    form.append("file", f);
    try {
      const p = await api<{ id: string; name: string; importNotes?: string[] }>("POST", "/api/presets/import", form);
      toast(`Imported ${p.name}${p.importNotes?.length ? ` (${p.importNotes.length} notes)` : ""}`, { kind: "ok" });
      navigate(`/presets/${p.id}`);
    } catch (e) {
      errorToast(e);
    }
  }

  async function makeDefault(id: string, e: Event) {
    e.preventDefault();
    await saveSetting("chat.defaultPresetId", id);
    await load();
  }
</script>

<div class="page">
  <div class="row between wrap head">
    <div>
      <h1>Presets</h1>
      <p class="muted small">How prompts are put together and how the model is tuned.</p>
    </div>
    <div class="row">
      <button class="btn" onclick={() => fileInput?.click()}><Import size={16} /> Import from SillyTavern</button>
      <button class="btn primary" onclick={create}><Plus size={16} /> New</button>
      <input bind:this={fileInput} type="file" accept=".json,application/json" hidden onchange={(e) => e.currentTarget.files?.[0] && importFile(e.currentTarget.files[0])} />
    </div>
  </div>
  <div class="list">
    {#each presets as p (p.id)}
      <a href="/presets/{p.id}" class="item card">
        <span class="icon"><SlidersHorizontal size={18} /></span>
        <span class="grow"><b>{p.name}</b> <span class="tiny muted">· {p.mode} · edited {timeAgo(p.updatedAt)}</span></span>
        {#if p.isDefault}<span class="chip rose"><Star size={12} /> Default</span>{:else}<button class="btn small ghost" onclick={(e) => makeDefault(p.id, e)}>Make default</button>{/if}
      </a>
    {/each}
  </div>
</div>

<style>
  .page {
    max-width: 50rem;
    margin: 0 auto;
    padding: 1.5rem clamp(1rem, 3vw, 2rem) 4rem;
  }
  .head {
    gap: 1rem;
    margin-bottom: 1.2rem;
  }
  .list {
    display: grid;
    gap: 0.6rem;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem 1rem;
    color: var(--text);
    text-decoration: none !important;
  }
  .icon {
    width: 2.2rem;
    height: 2.2rem;
    display: grid;
    place-items: center;
    border-radius: 30%;
    background: color-mix(in srgb, var(--sky) 45%, var(--surface));
  }
</style>
