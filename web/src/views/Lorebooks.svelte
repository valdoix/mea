<script lang="ts">
  import EmptyState from "../components/EmptyState.svelte";
  import { api, get, post } from "../lib/api";
  import { timeAgo } from "../lib/format";
  import { BookOpen, Globe, Import, Plus, WandSparkles } from "../lib/icons";
  import { navigate } from "../lib/router.svelte";
  import { app, errorToast, toast } from "../lib/state.svelte";
  import type { LorebookSummary, StudioDraftSummary } from "../lib/types";

  let books = $state<LorebookSummary[]>([]);
  let drafts = $state<StudioDraftSummary[]>([]);
  const waiting = $derived(drafts.filter((d) => d.stage !== "done"));
  let loaded = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function load() {
    try {
      [books, drafts] = await Promise.all([get<{ lorebooks: LorebookSummary[] }>("/api/lorebooks").then((r) => r.lorebooks), get<{ drafts: StudioDraftSummary[] }>("/api/lore-studio").then((r) => r.drafts)]);
    } catch (e) {
      errorToast(e);
    }
    loaded = true;
  }
  $effect(() => {
    void app.libraryVersion;
    void load();
  });

  async function create() {
    const b = await post<{ id: string }>("/api/lorebooks", { name: "New lorebook" });
    navigate(`/lorebooks/${b.id}`);
  }

  async function importFile(f: File) {
    const form = new FormData();
    form.append("file", f);
    try {
      const b = await api<{ id: string; name: string }>("POST", "/api/lorebooks/import", form);
      toast(`Imported ${b.name}`, { kind: "ok" });
      navigate(`/lorebooks/${b.id}`);
    } catch (e) {
      errorToast(e);
    }
  }

  const scopeLabel = (b: LorebookSummary) => {
    if (b.links.some((l) => l.type === "global")) return "Global";
    const counts = { character: 0, persona: 0, chat: 0 };
    for (const l of b.links) if (l.type !== "global") counts[l.type]++;
    const parts = [];
    if (counts.character) parts.push(`${counts.character} character${counts.character > 1 ? "s" : ""}`);
    if (counts.persona) parts.push(`${counts.persona} persona${counts.persona > 1 ? "s" : ""}`);
    if (counts.chat) parts.push(`${counts.chat} chat${counts.chat > 1 ? "s" : ""}`);
    return parts.join(" · ") || "Not linked";
  };
</script>

<div class="page">
  <div class="row between wrap head">
    <div>
      <h1>Lorebooks</h1>
      <p class="muted small">World facts that slip into the prompt when they're relevant. SillyTavern World Info compatible.</p>
    </div>
    <div class="row">
      <button class="btn" onclick={() => fileInput?.click()}><Import size={16} /> Import</button>
      <button class="btn" onclick={create}><Plus size={16} /> New</button>
      <a class="btn primary" href="/lore-studio"><WandSparkles size={16} /> Lore Studio</a>
      <input bind:this={fileInput} type="file" accept=".json,application/json" hidden onchange={(e) => e.currentTarget.files?.[0] && importFile(e.currentTarget.files[0])} />
    </div>
  </div>

  {#if waiting.length}
    <a class="notice small drafts" href={waiting.length === 1 ? `/lore-studio/${waiting[0]!.id}` : "/lore-studio"}><WandSparkles size={15} /> {waiting.length === 1 ? `“${waiting[0]!.title}” is waiting in the Lore Studio` : `${waiting.length} lorebooks are waiting in the Lore Studio`}{waiting.some((d) => d.writing) ? " (writing now)" : ""} →</a>
  {/if}

  {#if loaded && !books.length}
    <EmptyState icon="📖" title="No lorebooks yet" text="Create one for a world, a character's backstory, or notes for a single chat. Cards with embedded lore create one automatically.">
      <a class="btn primary" href="/lore-studio"><WandSparkles size={16} /> Build one with the Lore Studio</a>
      <button class="btn" onclick={create}><Plus size={16} /> Empty lorebook</button>
    </EmptyState>
  {:else}
    <div class="grid">
      {#each books as b (b.id)}
        <a href="/lorebooks/{b.id}" class="book card">
          <div class="row between">
            <span class="icon">{#if b.links.some((l) => l.type === "global")}<Globe size={18} />{:else}<BookOpen size={18} />{/if}</span>
            <span class="tiny faint">{timeAgo(b.updatedAt)}</span>
          </div>
          <b class="wraps">{b.name}</b>
          {#if b.description}<p class="tiny muted">{b.description}</p>{/if}
          <div class="row wrap" style="margin-top:auto">
            <span class="chip butter">{b.entryCount} entries</span>
            <span class="chip">{scopeLabel(b)}</span>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page {
    max-width: 64rem;
    margin: 0 auto;
    padding: 1.5rem clamp(1rem, 3vw, 2rem) 4rem;
  }
  .head {
    margin-bottom: 1.2rem;
    gap: 1rem;
  }
  .drafts {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 1rem;
    text-decoration: none;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.9rem;
  }
  .book {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 1rem;
    min-height: 9rem;
    color: var(--text);
    text-decoration: none !important;
    transition: transform var(--t) var(--ease);
  }
  .book:hover {
    transform: translateY(-2px);
  }
  .icon {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 30%;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--butter) 50%, var(--surface));
  }
</style>
