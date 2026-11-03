<script lang="ts">
  import Menu, { type MenuItem } from "../../Menu.svelte";
  import { promptText } from "../../../lib/dialogs.svelte";
  import { READING, deleteWorkspace, folio, saveWorkspace, toggleFilter, useWorkspace, type NoteKind } from "../../../lib/folio.svelte";
  import { ChevronDown, Columns2 } from "../../../lib/icons";
  import { toast } from "../../../lib/state.svelte";

  /** Folio's header: which notes the margin shows, and the workspace you're in. */
  let { chatId, spine = false }: { chatId: string; spine?: boolean } = $props();

  const KINDS: { id: NoteKind; label: string }[] = [
    { id: "memory", label: "Memory" },
    { id: "story", label: "Story" },
    { id: "world", label: "World" },
    { id: "meus", label: "Meus" },
    { id: "notes", label: "Notes" },
  ];

  let open = $state(false);
  let at = $state<HTMLElement | null>(null);
  async function saveAs() {
    const name = await promptText({ title: "Save this arrangement", label: "The workspace's name", placeholder: "Lore pass" });
    if (name && saveWorkspace(name)) toast(`Saved “${name.trim()}”`, { kind: "ok" });
  }
  const items = $derived<MenuItem[]>([
    { label: READING, hint: "the margin alone", onclick: () => useWorkspace(READING, chatId), disabled: folio.active === READING },
    ...folio.workspaces.map((w) => ({ label: w.name, hint: `${w.columns.length} column${w.columns.length === 1 ? "" : "s"}`, onclick: () => useWorkspace(w.name, chatId), disabled: folio.active === w.name })),
    { label: "Save as a new workspace…", onclick: () => void saveAs() },
    ...(folio.workspaces.some((w) => w.name === folio.active) ? [{ label: `Delete “${folio.active}”`, danger: true, onclick: () => deleteWorkspace(folio.active!) }] : []),
  ]);
</script>

<div class="f-filter" role="group" aria-label="Show in the margin">
  {#if !spine}
    {#each KINDS as k (k.id)}
      <button class="kchip {k.id}" aria-pressed={folio.filters[k.id]} onclick={() => toggleFilter(k.id)}><span class="d"></span>{k.label}</button>
    {/each}
  {/if}
</div>
<button class="ws-pill" bind:this={at} onclick={() => (open = !open)} aria-expanded={open} aria-label="Workspace: {folio.active ?? 'unsaved'}"><Columns2 size={14} /><span>{folio.active ?? "Unsaved"}</span><ChevronDown size={14} /></button>
<Menu bind:open {items} anchor={at} title="Workspaces" />
