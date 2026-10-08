<script lang="ts">
  import { del, patch, post } from "../../lib/api";
  import { promptText } from "../../lib/dialogs.svelte";
  import { autosize } from "../../lib/gestures";
  import { Pencil, Pin, PinOff, Scissors, Trash } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import { ATOM_TYPES, type Atom, type AtomType } from "../../lib/types";

  let {
    atom,
    chatId,
    onchange,
    selectable = false,
    selected = $bindable(false),
  }: { atom: Atom; chatId: string; onchange: () => void; selectable?: boolean; selected?: boolean } = $props();

  let editing = $state(false);
  let draft = $state({ content: "", type: "fact" as AtomType, importance: 5, entities: "", knownBy: "" });

  const TYPE_CHIP: Record<string, string> = { event: "sky", fact: "", trait: "lavender", preference: "mint", promise: "rose", secret: "peach", quote: "butter", plan: "sky", relationship: "rose" };

  function startEdit() {
    draft = { content: atom.content, type: atom.type, importance: atom.importance, entities: atom.entities.join(", "), knownBy: atom.knownBy.join(", ") };
    editing = true;
  }

  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  async function save() {
    try {
      await patch(`/api/memories/${atom.id}`, { content: draft.content, type: draft.type, importance: Number(draft.importance), entities: list(draft.entities), knownBy: list(draft.knownBy) });
      editing = false;
      onchange();
    } catch (e) {
      errorToast(e);
    }
  }

  async function togglePin() {
    try {
      await patch(`/api/memories/${atom.id}`, { pinned: !atom.pinned });
      toast(atom.pinned ? "Unpinned" : "Pinned: always in the prompt", { kind: "ok" });
      onchange();
    } catch (e) {
      errorToast(e);
    }
  }

  async function setStatus(status: Atom["status"]) {
    await patch(`/api/memories/${atom.id}`, { status }).catch(errorToast);
    onchange();
  }

  async function remove() {
    try {
      await del(`/api/memories/${atom.id}`);
      onchange();
      toast("Memory deleted", { action: { label: "Undo", run: () => void post(`/api/memories/${atom.id}/restore`).then(onchange) } });
    } catch (e) {
      errorToast(e);
    }
  }

  async function split() {
    const second = await promptText({ title: "Split this memory", label: "Text for the new, second memory (edit the first one afterwards)", value: atom.content, multiline: true, confirmLabel: "Split" });
    if (!second?.trim()) return;
    try {
      await post(`/api/memories/${atom.id}/split`, { parts: [atom.content, second.trim()] });
      onchange();
    } catch (e) {
      errorToast(e);
    }
  }
</script>

<div class="atom" class:pinned={atom.pinned} class:muted-row={atom.status === "superseded"}>
  {#if selectable}<input type="checkbox" class="pick" bind:checked={selected} aria-label="Select for merging" />{/if}
  <div class="grow main">
    {#if editing}
      <textarea class="textarea" use:autosize={240} bind:value={draft.content} aria-label="Memory"></textarea>
      <div class="edit-grid">
        <label class="field"><span class="label">Type</span><select class="select" bind:value={draft.type}>{#each ATOM_TYPES as t (t)}<option value={t}>{t}</option>{/each}</select></label>
        <label class="field"><span class="label">Importance</span><input class="input" type="number" min="1" max="10" bind:value={draft.importance} /></label>
        <label class="field"><span class="label">Who / what it's about</span><input class="input" bind:value={draft.entities} placeholder="Mira, the lighthouse" /></label>
        <label class="field"><span class="label">Known by</span><input class="input" bind:value={draft.knownBy} placeholder="for secrets" /></label>
      </div>
      <div class="row end">
        <button class="btn ghost small" onclick={() => (editing = false)}>Cancel</button>
        <button class="btn primary small" onclick={save}>Save</button>
      </div>
    {:else}
      <p class="content">{atom.content}</p>
      <div class="row wrap tiny meta">
        <span class="chip {TYPE_CHIP[atom.type] ?? ''}">{atom.type}</span>
        <span class="muted" title="Importance">★ {atom.importance}</span>
        {#if atom.status !== "active"}<span class="chip {atom.status === 'disputed' ? 'peach' : ''}">{atom.status}</span>{/if}
        {#if atom.stale}<span class="chip peach" title="A message it came from changed">needs update</span>{/if}
        {#if atom.userEdited}<span class="chip lavender">edited by you</span>{/if}
        {#if atom.storyTime}<span class="muted">{atom.storyTime}</span>{/if}
        {#if atom.entities.length}<span class="muted">· {atom.entities.join(", ")}</span>{/if}
        {#if atom.knownBy.length}<span class="muted">· known by {atom.knownBy.join(", ")}</span>{/if}
        {#each atom.sources ?? [] as s (s.messageId)}<a href="/chat/{chatId}?at={s.seq}">#{s.seq}</a>{/each}
      </div>
    {/if}
  </div>
  {#if !editing}
    <div class="tools">
      <button class="btn ghost icon small" onclick={togglePin} aria-label={atom.pinned ? "Unpin" : "Pin"} title={atom.pinned ? "Unpin" : "Pin: always in the prompt"}>
        {#if atom.pinned}<PinOff size={14} />{:else}<Pin size={14} />{/if}
      </button>
      <button class="btn ghost icon small" onclick={startEdit} aria-label="Edit"><Pencil size={14} /></button>
      <button class="btn ghost icon small" onclick={split} aria-label="Split"><Scissors size={14} /></button>
      {#if atom.status === "superseded" || atom.status === "disputed"}
        <button class="btn ghost small" onclick={() => setStatus("active")}>Make active</button>
      {:else if atom.type === "promise" || atom.type === "plan"}
        <button class="btn ghost small" onclick={() => setStatus("resolved")}>Resolved</button>
      {/if}
      <button class="btn ghost icon small" onclick={remove} aria-label="Delete"><Trash size={14} /></button>
    </div>
  {/if}
</div>

<style>
  .atom {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 0.5rem 0.6rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .atom.pinned {
    border-color: var(--accent);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .muted-row {
    opacity: 0.6;
  }
  .pick {
    margin-top: 0.3rem;
  }
  .main {
    min-width: 0;
    display: grid;
    gap: 0.3rem;
  }
  .content {
    margin: 0;
    font-size: var(--fs-sm);
    line-height: 1.5;
  }
  .meta {
    gap: 0.35rem;
    align-items: center;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.05rem;
    max-width: 9rem;
  }
  .edit-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    gap: 0.5rem;
  }
  .end {
    justify-content: flex-end;
  }
</style>
