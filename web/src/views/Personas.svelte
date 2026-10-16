<script lang="ts">
  import Avatar from "../components/Avatar.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import ImageCropper from "../components/ImageCropper.svelte";
  import Modal from "../components/Modal.svelte";
  import CardCheck from "../components/cardtools/CardCheck.svelte";
  import FieldTools from "../components/cardtools/FieldTools.svelte";
  import NotesSorter from "../components/cardtools/NotesSorter.svelte";
  import VariantsPanel from "../components/cardtools/VariantsPanel.svelte";
  import VersionsPanel from "../components/cardtools/VersionsPanel.svelte";
  import { del, get, post, put } from "../lib/api";
  import { confirm } from "../lib/dialogs.svelte";
  import { autosize } from "../lib/gestures";
  import { ArrowLeft, BookOpen, GitBranch, ImageIcon, Plus, Star, Trash, Unlink, WandSparkles } from "../lib/icons";
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

  // PER-04: the character tools work on personas too; PER-05: variants.
  let notesOpen = $state(false);
  let variantsOpen = $state(false);
  const LABELS: Record<string, string> = { name: "Name", pronouns: "Pronouns", description: "Description", appearance: "Appearance", personality: "Personality", background: "Background" };
  const personaNow = () => (current ? { name: current.name, ...$state.snapshot(current.data) } : { name: "" }) as Record<string, unknown>;
  function setField(field: string, text: string) {
    if (!current) return;
    if (field === "name") current.name = text;
    else (current.data as unknown as Record<string, string>)[field] = text;
  }

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

  /** PER-04: the same studio as characters, starting from this persona (unsaved edits go first). */
  async function rework() {
    if (!current) return;
    try {
      if (dirty) await save();
      const r = await post<{ draft: { id: string } }>("/api/creator", { kind: "persona", baseId: current.id });
      navigate(`/creator/${r.draft.id}`);
    } catch (e) {
      errorToast(e);
    }
  }

  /** A version's own lorebook (docs/14): its original's lore, translated through the version's map. */
  async function versionLore() {
    if (!current) return;
    try {
      const r = await post<{ draft: { id: string } }>("/api/lore-studio/version", { kind: "persona", id: current.id });
      navigate(`/lore-studio/${r.draft.id}`);
    } catch (e) {
      errorToast(e);
    }
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
    const n = current.link?.versions.length ?? 0;
    const message = n ? `Its ${n === 1 ? "version" : `${n} versions`} (${current.link!.versions.map((v) => v.label || v.name).join(", ")}) keep working; they're detached only if this persona is deleted for good.` : undefined;
    if (!(await confirm({ title: `Move ${current.name} to the trash?`, message, confirmLabel: "Move to trash", danger: true }))) return;
    const id = current.id;
    try {
      await del(`/api/personas/${id}`);
    } catch (err) {
      errorToast(err);
      return;
    }
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
      <a class="btn small" href="/creator?kind=persona" title="Expand an idea into a full persona with the Creator Studio"><WandSparkles size={15} /> Create</a>
      <button class="btn primary small" onclick={create}><Plus size={15} /> New</button>
    </div>
    <p class="tiny muted">Who you are in a story. Each chat can use a different one.</p>
    {#each personas as p (p.id)}
      <a href="/personas/{p.id}" class="item card" class:on={current?.id === p.id}>
        <Avatar id={p.avatarId} name={p.name} size={42} />
        <span class="grow">
          <b class="wraps">{p.name}</b>
          <span class="tiny muted wraps">{#if p.version}<GitBranch size={11} /> {p.version.label || `Version of ${p.version.originName}`} · {/if}{p.data.description || "No description yet"}</span>
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
          {#if current.link?.origin}<a class="chip lavender verchip" href="/personas/{current.link.origin.id}" title="Open the original"><GitBranch size={12} /> Version of {current.link.origin.name}{current.link.label ? ` · ${current.link.label}` : ""}</a>{/if}
          <div class="row wrap">
            {#if current.isDefault}<span class="chip rose"><Star size={12} /> Default persona</span>{:else}<button class="btn small" onclick={makeDefault}><Star size={14} /> Make default</button>{/if}
            <button class="btn small" onclick={rework} title="Expand, deepen and rewrite this persona with the Creator Studio"><WandSparkles size={14} /> Rework in the studio</button>
            <button class="btn ghost small danger" onclick={remove}><Trash size={14} /> Delete</button>
          </div>
        </div>
      </div>
      <div class="stack">
        <div class="row wrap"><button class="btn small" onclick={() => (notesOpen = true)}>Sort my notes</button><button class="btn small" onclick={() => (variantsOpen = !variantsOpen)}>{variantsOpen ? "Hide versions and looks" : current.link?.versions.length ? `Versions and looks · ${current.link.versions.length}` : "Versions and looks"}</button></div>
        <label class="field"><span class="label">Pronouns <span class="faint">subject/object/possessive; fills {"{{user_they}}"}, {"{{user_them}}"}, {"{{user_their}}"}</span></span><input class="input" bind:value={current.data.pronouns} placeholder="she/her/her, he/him/his, they/them/their…" /></label>
        <label class="field"><span class="label">Description <FieldTools kind="persona" field="description" label="Description" text={current.data.description} card={personaNow} onapply={(t) => setField("description", t)} /></span><textarea class="textarea story" use:autosize={500} bind:value={current.data.description} placeholder="Who you are in the story"></textarea></label>
        <label class="field"><span class="label">Appearance <FieldTools kind="persona" field="appearance" label="Appearance" text={current.data.appearance} card={personaNow} onapply={(t) => setField("appearance", t)} /></span><textarea class="textarea story" use:autosize={400} bind:value={current.data.appearance}></textarea></label>
        <label class="field"><span class="label">Personality <FieldTools kind="persona" field="personality" label="Personality" text={current.data.personality} card={personaNow} onapply={(t) => setField("personality", t)} /></span><textarea class="textarea story" use:autosize={400} bind:value={current.data.personality}></textarea></label>
        <label class="field"><span class="label">Background <FieldTools kind="persona" field="background" label="Background" text={current.data.background} card={personaNow} onapply={(t) => setField("background", t)} /></span><textarea class="textarea story" use:autosize={400} bind:value={current.data.background}></textarea></label>
        <CardCheck kind="persona" card={personaNow} labels={LABELS} onapply={setField} />
        {#if variantsOpen}
          <VersionsPanel kind="persona" id={current.id} name={current.name} link={current.link} beforeLeave={async () => { if (dirty) await save(); }} onchanged={() => current && select(current.id)} />
          <h3 class="looks">Looks</h3>
          <VariantsPanel ownerType="persona" ownerId={current.id} base={personaNow} />
        {/if}
        <NotesSorter bind:open={notesOpen} kind="persona" card={personaNow} labels={LABELS} onapply={(f) => Object.entries(f).forEach(([k, v]) => setField(k, v))} />
        <div class="field">
          <span class="label">Lorebooks</span>
          {#each current.lorebooks ?? [] as b (b.id)}
            <div class="row"><a href="/lorebooks/{b.id}" class="grow row"><BookOpen size={15} /> {b.name}</a><button class="btn ghost icon small" onclick={() => unlinkBook(b.id)} aria-label="Unlink"><Unlink size={14} /></button></div>
          {/each}
          <div class="row wrap">
            {#if current.link?.origin}<button class="btn small" onclick={versionLore} disabled={dirty} title={dirty ? "Save your changes first" : `${current.link.origin.name}'s lorebooks, translated into this version through its map`}><GitBranch size={14} /> Write this version's lorebook</button>{/if}
            <button class="btn small" onclick={() => navigate(`/lore-studio?persona=${current!.id}`)} disabled={dirty} title={dirty ? "Save your changes first" : "Plan and draft your persona's family, home and history with the Lore Studio"}><WandSparkles size={14} /> Build with the studio</button>
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
        <a class="btn primary" href="/creator?kind=persona"><WandSparkles size={16} /> Create one with the studio</a>
        <button class="btn" onclick={create}><Plus size={16} /> Blank persona</button>
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
  .verchip {
    align-self: flex-start;
    text-decoration: none;
    gap: 0.3rem;
  }
  .looks {
    margin: 1rem 0 0.2rem;
  }
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
    grid-template-columns: minmax(0, 1fr);
    gap: 0.5rem;
    align-content: start;
    min-width: 0;
  }
  .head {
    flex-wrap: wrap;
    margin-bottom: 0.2rem;
  }
  .head h1 {
    margin-right: auto;
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
    color: var(--accent-ink);
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
