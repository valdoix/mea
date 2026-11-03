<script lang="ts">
  import type { Component, Snippet } from "svelte";
  import Menu, { type MenuItem } from "../../Menu.svelte";
  import { closeColumn, folio, moveColumn, openColumn, togglePin, type FolioColumn } from "../../../lib/folio.svelte";
  import { swipe } from "../../../lib/gestures";
  import { ChevronLeft, ChevronRight, GripVertical, Pin, Plus, X } from "../../../lib/icons";
  import { app } from "../../../lib/state.svelte";
  import type { DockTab } from "../../../lib/dock.svelte";

  /** Folio: the columns beside the story, or on a phone the column page that's showing. */
  let {
    options,
    body,
    addOpen = $bindable(false),
    addAt = $bindable(null),
    onjump,
  }: {
    options: { value: DockTab; label: string; icon: Component<any> }[];
    body: Snippet<[FolioColumn]>;
    addOpen?: boolean;
    addAt?: HTMLElement | null;
    onjump: (seq: number) => void;
  } = $props();

  const items = $derived<MenuItem[]>(options.map((o) => ({ label: o.label, icon: o.icon, disabled: folio.columns.some((c) => c.kind === o.value), onclick: () => openColumn(o.value) })));
  const title = (c: FolioColumn) => c.title ?? (c.kind === "entity" ? "Codex" : options.find((o) => o.value === c.kind)?.label ?? "Column");

  let dragKey: string | null = null;
  let dropKey = $state<string | null>(null);
  function dropOn(i: number) {
    if (dragKey) moveColumn(dragKey, i);
    dragKey = null;
    dropKey = null;
  }
  const page = $derived(folio.columns[folio.page - 1]);
</script>

{#if app.isMobile}
  {#if page}
    <div class="fp-page studio" use:swipe={{ enabled: true, onLeft: () => (folio.page = Math.min(folio.columns.length, folio.page + 1)), onRight: () => (folio.page = Math.max(0, folio.page - 1)) }}>
      <div class="fp-page-h"><button class="btn ghost small" onclick={() => closeColumn(page.key)}><X size={14} /> Close {title(page)}</button></div>
      {@render body(page)}
    </div>
  {/if}
{:else if folio.columns.length}
  {#each folio.columns as c, i (c.key)}
    <aside class="dock fcol" class:drop={dropKey === c.key} aria-label={title(c)} ondragover={(e) => (e.preventDefault(), (dropKey = c.key))} ondragleave={() => (dropKey = null)} ondrop={() => dropOn(i)}>
      <!-- svelte-ignore a11y_no_static_element_interactions (the arrows below move a column by keyboard) -->
      <div class="fcol-h" draggable="true" ondragstart={() => (dragKey = c.key)} ondragend={() => ((dragKey = null), (dropKey = null))}>
        <span class="grip" aria-hidden="true"><GripVertical size={14} /></span>
        <span class="ttl">{title(c)}</span>
        {#if c.from}<button class="from linkish" onclick={() => onjump(c.from!)}>from #{c.from}</button>{/if}
        <span class="col-tools">
          <button class="btn ghost icon small" disabled={i === 0} onclick={() => moveColumn(c.key, i - 1)} aria-label="Move left"><ChevronLeft size={15} /></button>
          <button class="btn ghost icon small" disabled={i === folio.columns.length - 1} onclick={() => moveColumn(c.key, i + 1)} aria-label="Move right"><ChevronRight size={15} /></button>
          <button class="btn ghost icon small" class:on={c.pinned} aria-pressed={c.pinned} onclick={() => togglePin(c.key)} aria-label={c.pinned ? "Unpin column" : "Pin column: keep it when you change story or workspace"} title={c.pinned ? "Pinned" : "Pin"}><Pin size={15} /></button>
          <button class="btn ghost icon small" onclick={() => closeColumn(c.key)} aria-label="Close column"><X size={15} /></button>
        </span>
      </div>
      <div class="dock-scroll studio">{@render body(c)}</div>
    </aside>
  {/each}
  <button class="add-col" onclick={(e) => ((addAt = e.currentTarget), (addOpen = true))} aria-label="Add a column"><Plus size={18} /><span>Add column</span></button>
{/if}
<Menu bind:open={addOpen} {items} anchor={addAt} title="Open as a column" />
