<script lang="ts">
  import Modal from "../Modal.svelte";
  import TagInput from "../TagInput.svelte";
  import { del, get, patch, post, put } from "../../lib/api";
  import { confirm, promptText } from "../../lib/dialogs.svelte";
  import { BookOpen, Merge, NotebookPen, Pencil, Trash } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { CodexPage, Entity, EntityKind } from "../../lib/types";

  let { chatId, entityId = $bindable(null), others = [], onchange }: { chatId: string; entityId: string | null; others?: { id: string; name: string; kind: string }[]; onchange?: () => void } = $props();

  let page = $state<CodexPage | null>(null);
  let editing = $state(false);
  let form = $state<{ name: string; kind: EntityKind; status: Entity["status"]; aliases: string[]; description: string; facts: string[] }>({ name: "", kind: "person", status: "active", aliases: [], description: "", facts: [] });
  let mergeWith = $state("");
  let journalText = $state("");
  let journalEditing = $state(false);
  let open = $state(false);

  async function load(id: string) {
    try {
      page = await get<CodexPage>(`/api/codex/${id}`);
      const e = page.entity;
      form = { name: e.name, kind: e.kind, status: e.status, aliases: [...e.aliases], description: e.description, facts: [...e.facts] };
      journalText = page.journal?.content ?? "";
    } catch (err) {
      errorToast(err);
    }
  }
  $effect(() => {
    open = Boolean(entityId);
    if (entityId) {
      editing = false;
      journalEditing = false;
      void load(entityId);
    }
  });
  $effect(() => {
    if (!open && entityId) entityId = null;
  });

  async function save() {
    if (!page) return;
    try {
      await patch(`/api/entities/${page.entity.id}`, $state.snapshot(form));
      editing = false;
      toast("Saved. Memory will use your version.", { kind: "ok" });
      await load(page.entity.id);
      onchange?.();
    } catch (err) {
      errorToast(err);
    }
  }
  async function merge() {
    if (!page || !mergeWith) return;
    try {
      await post(`/api/entities/${page.entity.id}/merge`, { ids: [mergeWith] });
      mergeWith = "";
      toast("Merged: the other name is now an alias", { kind: "ok" });
      await load(page.entity.id);
      onchange?.();
    } catch (err) {
      errorToast(err);
    }
  }
  async function editFact(id: string, content: string) {
    const next = await promptText({ title: "Edit this memory", value: content, multiline: true, confirmLabel: "Save" });
    if (!next?.trim() || !page) return;
    try {
      await patch(`/api/memories/${id}`, { content: next.trim() });
      await load(page.entity.id);
    } catch (err) {
      errorToast(err);
    }
  }
  async function removeEntity() {
    if (!page) return;
    const e = page.entity;
    if (!(await confirm({ title: `Delete ${e.name} from the Codex?`, message: "Their entry and card are gone, and the story won't add them back. Memories that mention them stay.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await del(`/api/entities/${e.id}`);
      open = false;
      onchange?.();
      toast(`${e.name} deleted`, {
        action: {
          label: "Undo",
          run: async () => {
            try {
              await post(`/api/entities/${e.id}/restore`);
              onchange?.();
            } catch (err) {
              errorToast(err);
            }
          },
        },
      });
    } catch (err) {
      errorToast(err);
    }
  }
  async function removeFact(id: string) {
    if (!page) return;
    const entity = page.entity.id;
    try {
      await del(`/api/memories/${id}`);
      await load(entity);
      onchange?.();
      toast("Memory deleted", {
        action: {
          label: "Undo",
          run: async () => {
            try {
              await post(`/api/memories/${id}/restore`);
              if (entityId === entity) await load(entity);
              onchange?.();
            } catch (err) {
              errorToast(err);
            }
          },
        },
      });
    } catch (err) {
      errorToast(err);
    }
  }
  async function addFact() {
    if (!page) return;
    const text = await promptText({ title: `Add a fact about ${page.entity.name}`, multiline: true, confirmLabel: "Add" });
    if (!text?.trim()) return;
    try {
      await post(`/api/chats/${chatId}/memories`, { type: "fact", content: text.trim(), entities: [page.entity.name], importance: 7 });
      await load(page.entity.id);
    } catch (err) {
      errorToast(err);
    }
  }
  async function saveJournal() {
    if (!page?.journal) return;
    try {
      await put(`/api/journals/${page.journal.id}`, { content: journalText });
      journalEditing = false;
      await load(page.entity.id);
    } catch (err) {
      errorToast(err);
    }
  }
  async function decide(accept: boolean) {
    if (!page?.journal) return;
    try {
      await post(`/api/journals/${page.journal.id}/proposal`, { accept });
      await load(page.entity.id);
    } catch (err) {
      errorToast(err);
    }
  }
  async function writeJournal() {
    if (!page) return;
    try {
      toast("Writing the journal…");
      await post(`/api/chats/${chatId}/journals/rebuild`, { name: page.entity.name, fromScratch: true });
      await load(page.entity.id);
    } catch (err) {
      errorToast(err);
    }
  }
  const KINDS: EntityKind[] = ["person", "place", "object", "group", "concept"];
  const STATUS: Entity["status"][] = ["active", "dead", "missing", "gone", "unknown"];
</script>

<Modal bind:open title={page?.entity.name ?? ""} size="lg">
  {#if page}
    {@const e = page.entity}
    <div class="stack">
      <div class="row wrap">
        <span class="chip">{e.kind}</span>
        {#if e.status !== "active"}<span class="chip warn">{e.status}</span>{/if}
        {#if e.isMain}<span class="chip">main character</span>{/if}
        {#if e.isUser}<span class="chip">you</span>{/if}
        {#if e.userEdited}<span class="chip mint" title="Your edits are locked against AI rewrites">yours</span>{/if}
        <span class="tiny faint">{e.mentions} mentions{#if e.firstSeq} · first #{e.firstSeq}{/if}{#if e.lastSeq} · last #{e.lastSeq}{/if}</span>
        <span class="grow"></span>
        {#if !editing}
          <button class="btn small" onclick={() => (editing = true)}><Pencil size={14} /> Edit</button>
          <button class="btn ghost small danger" onclick={removeEntity}><Trash size={14} /> Delete</button>
        {/if}
      </div>

      {#if editing}
        <div class="grid">
          <label class="field"><span class="label">Name</span><input class="input" bind:value={form.name} /></label>
          <label class="field"><span class="label">Kind</span><select class="select" bind:value={form.kind}>{#each KINDS as k (k)}<option value={k}>{k}</option>{/each}</select></label>
          <label class="field"><span class="label">Status</span><select class="select" bind:value={form.status}>{#each STATUS as k (k)}<option value={k}>{k}</option>{/each}</select></label>
        </div>
        <div class="field"><span class="label">Also called</span><TagInput bind:value={form.aliases} placeholder="the stranger, Captain…" /></div>
        <label class="field"><span class="label">Description</span><textarea class="textarea" rows="3" bind:value={form.description}></textarea></label>
        <div class="field">
          <span class="label">Facts you're sure of</span>
          <TagInput bind:value={form.facts} placeholder="Add a fact and press Enter" />
          <span class="hint">These ride with {e.name}'s card in recall, and your edits are never rewritten by the AI.</span>
        </div>
        <div class="row">
          <button class="btn ghost" onclick={() => (editing = false)}>Cancel</button>
          <button class="btn primary" onclick={save}>Save</button>
        </div>
      {:else}
        <p class="card-line">{page.card}</p>
        {#if e.aliases.length}<p class="tiny"><span class="muted">Also called</span> {e.aliases.join(", ")}</p>{/if}
        {#if e.path}<p class="tiny"><span class="muted">Where</span> {e.path.join(" › ")}</p>{/if}
        {#if e.holder}<p class="tiny"><span class="muted">Held by</span> {e.holder}</p>{/if}
      {/if}

      <section class="stack tight">
        <div class="row between"><h3>What the story knows ({page.facts.length})</h3><button class="btn ghost small" onclick={addFact}>Add a fact</button></div>
        {#each page.facts as f (f.id)}
          <div class="fact" class:disputed={f.status === "disputed"}>
            <span class="grow small">{f.content}{#if f.userEdited}<span class="tiny mint-t"> · yours</span>{/if}{#if f.status === "disputed"}<span class="tiny warn-t"> · disputed</span>{/if}</span>
            {#if f.maxSeq}<a class="tiny" href="/chat/{chatId}?at={f.maxSeq}">#{f.maxSeq}</a>{/if}
            <button class="btn ghost icon small" onclick={() => editFact(f.id, f.content)} aria-label="Edit"><Pencil size={13} /></button>
            <button class="btn ghost icon small" onclick={() => removeFact(f.id)} aria-label="Delete this memory" title="Delete this memory"><Trash size={13} /></button>
          </div>
        {:else}
          <p class="tiny muted">No memories name {e.name} yet.</p>
        {/each}
      </section>

      {#if page.ties.length}
        <section class="stack tight">
          <h3>Ties</h3>
          {#each page.ties as t, i (i)}
            <div class="small">{t.direction === "out" ? `${e.name} → ${t.other}` : `${t.other} → ${e.name}`} <span class="muted">· {t.label}</span>{#if t.kind === "bond"}<span class="tiny faint"> ({t.strength > 0 ? "+" : ""}{t.strength})</span>{/if}</div>
          {/each}
        </section>
      {/if}

      {#if page.appearances.length}
        <section class="stack tight">
          <h3>Appears in</h3>
          <div class="row wrap">
            {#each page.appearances as a (a.id)}<a class="chip" href="/chat/{chatId}?at={a.startSeq}">{a.title || "Scene"} · #{a.startSeq}</a>{/each}
          </div>
        </section>
      {/if}

      {#if e.kind === "person"}
        <section class="stack tight">
          <div class="row between"><h3><NotebookPen size={15} /> {e.name}'s journal</h3>{#if !page.journal}<button class="btn ghost small" onclick={writeJournal}>Write it now</button>{/if}</div>
          {#if page.journal}
            {#if page.journal.proposal}
              <div class="card proposal">
                <div class="tiny muted">A newer version is waiting (you edited this journal, so it wasn't replaced):</div>
                <p class="small pre">{page.journal.proposal.content}</p>
                <div class="row"><button class="btn small primary" onclick={() => decide(true)}>Use the new version</button><button class="btn small ghost" onclick={() => decide(false)}>Keep mine</button></div>
              </div>
            {/if}
            {#if journalEditing}
              <textarea class="textarea" rows="8" bind:value={journalText}></textarea>
              <div class="row"><button class="btn ghost small" onclick={() => (journalEditing = false)}>Cancel</button><button class="btn primary small" onclick={saveJournal}>Save</button></div>
            {:else}
              <p class="small pre journal">{page.journal.content}</p>
              <div class="row"><span class="tiny faint">through #{page.journal.throughSeq} · {page.journal.tokens} tokens</span><button class="btn ghost small" onclick={() => (journalEditing = true)}>Edit</button></div>
            {/if}
          {:else}
            <p class="tiny muted">Journals are kept for the main character and the people the story keeps returning to.</p>
          {/if}
        </section>
      {/if}

      {#if page.lore.length}
        <section class="stack tight">
          <h3><BookOpen size={15} /> Lore</h3>
          {#each page.lore as l (l.id)}
            <a class="lore card" href="/lorebooks/{l.bookId}?entry={l.id}"><b class="small">{l.title}</b> <span class="tiny muted">· {l.bookName}</span><div class="tiny muted">{l.content.slice(0, 200)}</div></a>
          {/each}
        </section>
      {/if}

      {#if others.length}
        <section class="row wrap merge">
          <Merge size={15} />
          <select class="select narrow" bind:value={mergeWith} aria-label="Merge another entity into this one">
            <option value="">Same as… (merge another into {e.name})</option>
            {#each others.filter((o) => o.id !== e.id) as o (o.id)}<option value={o.id}>{o.name} ({o.kind})</option>{/each}
          </select>
          <button class="btn small" onclick={merge} disabled={!mergeWith}>Merge</button>
        </section>
      {/if}
    </div>
  {/if}
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 0.6rem;
  }
  .card-line {
    margin: 0;
    line-height: 1.5;
  }
  .fact {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    padding: 0.3rem 0;
    border-top: 1px solid var(--border);
  }
  .fact.disputed {
    opacity: 0.75;
  }
  .pre {
    white-space: pre-wrap;
  }
  .journal {
    font-family: var(--font-story);
    font-style: italic;
    margin: 0;
  }
  .proposal {
    padding: 0.6rem;
    background: var(--surface-2);
  }
  .lore {
    display: block;
    padding: 0.5rem 0.6rem;
    color: inherit;
  }
  .narrow {
    width: auto;
    flex: 1;
    min-width: 12rem;
  }
  .merge {
    gap: 0.5rem;
    border-top: 1px solid var(--border);
    padding-top: 0.6rem;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    font-size: var(--fs-base);
  }
  .mint-t {
    color: var(--mint-text, var(--accent));
  }
  .warn-t {
    color: var(--danger);
  }
</style>
