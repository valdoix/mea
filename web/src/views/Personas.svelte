<script lang="ts">
  import Avatar from "../components/Avatar.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import ImageCropper from "../components/ImageCropper.svelte";
  import Modal from "../components/Modal.svelte";
  import { del, get, post, put } from "../lib/api";
  import { confirm } from "../lib/dialogs.svelte";
  import { autosize } from "../lib/gestures";
  import { ArrowLeft, BookOpen, ImageIcon, Plus, Star, Trash, Unlink } from "../lib/icons";
  import { uploadImage } from "../lib/images";
  import { navigate } from "../lib/router.svelte";
  import { app, errorToast, toast } from "../lib/state.svelte";
  import type { LorebookSummary, Persona } from "../lib/types";

  let { selectedId }: { selectedId?: string } = $props();

  let personas = $state<Persona[]>([]);
  let current = $state<Persona | null>(null);
  let saved = $state("");
  let books = $state<LorebookSummary[]>([]);
  let cropFile = $state<Blob | null>(null);
  let cropOpen = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);
  let loaded = $state(false);

  const dirty = $derived(current ? JSON.stringify({ n: current.name, d: current.data }) !== saved : false);

  async function load() {
    try {
      personas = (await get<{ personas: Persona[] }>("/api/personas")).personas;
      books = (await get<{ lorebooks: LorebookSummary[] }>("/api/lorebooks")).lorebooks;
      const id = selectedId ?? (app.isMobile ? undefined : personas[0]?.id);
      if (id) await select(id);
    } catch (e) {
      errorToast(e);
    }
    loaded = true;
  }
  $effect(() => {
    void load();
  });

  async function select(id: string) {
    current = await get<Persona>(`/api/personas/${id}`);
    saved = JSON.stringify({ n: current.name, d: current.data });
  }

  async function create() {
    const p = await post<Persona>("/api/personas", { name: personas.length ? "New persona" : "You" });
    navigate(`/personas/${p.id}`);
  }

  async function save() {
    if (!current) return;
    try {
      current = await put<Persona>(`/api/personas/${current.id}`, { name: current.name, data: $state.snapshot(current.data) });
      saved = JSON.stringify({ n: current.name, d: current.data });
      personas = (await get<{ personas: Persona[] }>("/api/personas")).personas;
      toast("Saved ✿", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }

  async function makeDefault() {
    if (!current) return;
    current = await put<Persona>(`/api/personas/${current.id}`, { isDefault: true });
    personas = (await get<{ personas: Persona[] }>("/api/personas")).personas;
  }

  async function remove() {
    if (!current) return;
    if (!(await confirm({ title: `Move ${current.name} to the trash?`, confirmLabel: "Move to trash", danger: true }))) return;
    const id = current.id;
    await del(`/api/personas/${id}`);
    toast("Persona moved to trash", { action: { label: "Undo", run: () => void post(`/api/personas/${id}/restore`).then(() => navigate(`/personas/${id}`)) } });
    current = null;
    navigate("/personas");
  }

  async function onCropped(blob: Blob, img: HTMLImageElement) {
    cropOpen = false;
    if (!current) return;
    try {
      const avatarId = await uploadImage(blob, img);
      current = await put<Persona>(`/api/personas/${current.id}`, { avatarId });
      personas = (await get<{ personas: Persona[] }>("/api/personas")).personas;
    } catch (e) {
      errorToast(e);
    }
  }

  async function linkBook(id: string) {
    if (!current) return;
    await post(`/api/lorebooks/${id}/links`, { type: "persona", id: current.id });
    await select(current.id);
  }
  async function unlinkBook(id: string) {
    if (!current) return;
    await del(`/api/lorebooks/${id}/links`, { type: "persona", id: current.id });
    await select(current.id);
  }
  async function newBook() {
    if (!current) return;
    const b = await post<{ id: string }>("/api/lorebooks", { name: `${current.name} — about me`, links: [{ type: "persona", id: current.id }] });
    navigate(`/lorebooks/${b.id}`);
  }
</script>

<div class="personas" class:detail={app.isMobile && current}>
  <aside class="list">
    <div class="row between head">
      <h1>Personas</h1>
      <button class="btn primary small" onclick={create}><Plus size={15} /> New</button>
    </div>
    <p class="tiny muted">Who you are in a story. Each chat can use a different one.</p>
    {#each personas as p (p.id)}
      <a href="/personas/{p.id}" class="item card" class:on={current?.id === p.id}>
        <Avatar id={p.avatarId} name={p.name} size={42} />
        <span class="grow">
          <b class="truncate">{p.name}</b>
          <span class="tiny muted truncate">{p.data.description || "No description yet"}</span>
        </span>
        {#if p.isDefault}<Star size={15} class="star" fill="currentColor" />{/if}
      </a>
    {/each}
  </aside>

  <section class="editor">
    {#if current}
      {#if app.isMobile}<button class="btn ghost small" onclick={() => ((current = null), navigate("/personas"))}><ArrowLeft size={15} /> All personas</button>{/if}
      <div class="top">
        <button class="avatar-btn" onclick={() => fileInput?.click()} aria-label="Change avatar">
          <Avatar id={current.avatarId} name={current.name} size={96} />
          <span class="tiny muted"><ImageIcon size={12} /> Change</span>
        </button>
        <input
          bind:this={fileInput}
          type="file"
          accept="image/*"
          hidden
          onchange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) {
              cropFile = f;
              cropOpen = true;
            }
            e.currentTarget.value = "";
          }}
        />
        <div class="grow stack tight">
          <input class="input name" bind:value={current.name} aria-label="Name" />
          <div class="row wrap">
            {#if current.isDefault}<span class="chip rose"><Star size={12} /> Default persona</span>{:else}<button class="btn small" onclick={makeDefault}><Star size={14} /> Make default</button>{/if}
            <button class="btn ghost small danger" onclick={remove}><Trash size={14} /> Delete</button>
          </div>
        </div>
      </div>
      <div class="stack">
        <label class="field"><span class="label">Pronouns</span><input class="input" bind:value={current.data.pronouns} placeholder="she/her, he/him, they/them…" /></label>
        <label class="field"><span class="label">Description</span><textarea class="textarea story" use:autosize={500} bind:value={current.data.description} placeholder="Who you are in the story"></textarea></label>
        <label class="field"><span class="label">Appearance</span><textarea class="textarea story" use:autosize={400} bind:value={current.data.appearance}></textarea></label>
        <label class="field"><span class="label">Personality</span><textarea class="textarea story" use:autosize={400} bind:value={current.data.personality}></textarea></label>
        <label class="field"><span class="label">Background</span><textarea class="textarea story" use:autosize={400} bind:value={current.data.background}></textarea></label>
        <div class="field">
          <span class="label">Lorebooks</span>
          {#each current.lorebooks ?? [] as b (b.id)}
            <div class="row"><a href="/lorebooks/{b.id}" class="grow row"><BookOpen size={15} /> {b.name}</a><button class="btn ghost icon small" onclick={() => unlinkBook(b.id)} aria-label="Unlink"><Unlink size={14} /></button></div>
          {/each}
          <div class="row wrap">
            <button class="btn small" onclick={newBook}><Plus size={14} /> New</button>
            <select class="select" style="width:auto" onchange={(e) => e.currentTarget.value && linkBook(e.currentTarget.value)}>
              <option value="">Link existing…</option>
              {#each books.filter((b) => !current?.lorebooks?.some((l) => l.id === b.id)) as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
            </select>
          </div>
        </div>
      </div>
      {#if dirty}
        <div class="savebar card"><span class="small">Unsaved changes</span><button class="btn primary small" onclick={save}>Save</button></div>
      {/if}
    {:else if loaded && !personas.length}
      <EmptyState title="Create your first persona" text="Tell your characters who they're talking to. You can make as many as you like.">
        <button class="btn primary" onclick={create}><Plus size={16} /> New persona</button>
      </EmptyState>
    {:else if !app.isMobile}
      <p class="muted" style="padding:3rem">Pick a persona to edit.</p>
    {/if}
  </section>
</div>

<Modal bind:open={cropOpen} title="Crop avatar" size="md">
  {#if cropFile}<ImageCropper file={cropFile} aspect={1} outWidth={512} onconfirm={onCropped} oncancel={() => (cropOpen = false)} />{/if}
</Modal>

<style>
  .personas {
    display: grid;
    grid-template-columns: 20rem 1fr;
    gap: 1.5rem;
    max-width: 64rem;
    margin: 0 auto;
    padding: 1.5rem clamp(1rem, 3vw, 2rem) 6rem;
  }
  .list {
    display: grid;
    gap: 0.5rem;
    align-content: start;
  }
  .head {
    margin-bottom: 0.2rem;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.6rem 0.75rem;
    color: var(--text);
    text-decoration: none !important;
  }
  .item .grow {
    display: grid;
  }
  .item.on {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .item :global(.star) {
    color: var(--accent-strong);
  }
  .editor {
    min-width: 0;
  }
  .top {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin-bottom: 1.2rem;
  }
  .avatar-btn {
    border: 0;
    background: none;
    display: grid;
    justify-items: center;
    gap: 0.3rem;
    cursor: pointer;
    padding: 0;
  }
  .name {
    font-family: var(--font-display);
    font-size: 1.4rem;
    font-weight: 600;
  }
  .savebar {
    position: fixed;
    bottom: calc(1rem + var(--safe-bottom));
    right: 2rem;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.5rem 0.6rem 0.5rem 1rem;
    border-radius: var(--r-pill);
    box-shadow: var(--shadow-2);
  }
  @media (max-width: 760px) {
    .personas {
      grid-template-columns: 1fr;
    }
    .personas.detail .list {
      display: none;
    }
    .personas:not(.detail) .editor {
      display: none;
    }
    .savebar {
      left: 50%;
      right: auto;
      translate: -50% 0;
    }
  }
</style>
