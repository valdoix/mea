<script lang="ts">
  import Module from "../desk/Module.svelte";
  import { get, patch, post } from "../../lib/api";
  import { promptText } from "../../lib/dialogs.svelte";
  import { onEvent } from "../../lib/events";
  import { History, Pencil, Plus, Undo } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { LoreFact } from "../../lib/types";

  /**
   * Since the card: this chat's note on how the character and your persona have changed since their
   * cards were written. The cards stay as they are (other chats share them); these lines win over
   * them here. The story proposes lines in the Inbox; ones you add or edit are kept as you wrote them.
   */
  let { chatId }: { chatId: string } = $props();

  interface SincePage {
    enabled: boolean;
    people: { who: "character" | "persona"; name: string; entryId: string | null; lines: LoreFact[] }[];
  }
  let page = $state<SincePage | null>(null);

  async function load() {
    try {
      page = await get<SincePage>(`/api/chats/${chatId}/since-card`);
    } catch {
      page = null;
    }
  }
  $effect(() => {
    void chatId;
    void load();
  });
  let timer: ReturnType<typeof setTimeout>;
  $effect(() =>
    onEvent((e) => {
      if ((e.type === "lore.facts" && e.chatId === chatId) || e.type === "reconnected") {
        clearTimeout(timer);
        timer = setTimeout(load, 600);
      }
    }),
  );

  const undoToast = (message: string, token: string) => toast(message, { kind: "ok", action: { label: "Undo", run: () => void post(`/api/undo/${token}`).then(load).catch(errorToast) } });
  async function add(who: "character" | "persona", name: string) {
    const value = await promptText({ title: `How has ${name} changed?`, value: "", multiline: true, confirmLabel: "Add" });
    if (!value?.trim()) return;
    try {
      const r = await post<{ undo: string }>(`/api/chats/${chatId}/since-card`, { who, value: value.trim() });
      await load();
      undoToast("Added to Since the card", r.undo);
    } catch (e) {
      errorToast(e);
    }
  }
  async function edit(f: LoreFact) {
    const value = await promptText({ title: "Edit this line", value: f.value, multiline: true, confirmLabel: "Save" });
    if (!value?.trim() || value.trim() === f.value) return;
    try {
      // Locked: the story won't rewrite your words.
      const r = await patch<{ undo: string }>(`/api/lore/facts/${f.id}`, { value: value.trim(), locked: true });
      await load();
      undoToast("Saved as you wrote it", r.undo);
    } catch (e) {
      errorToast(e);
    }
  }
  async function retire(f: LoreFact) {
    try {
      const r = await post<{ undo: string }>(`/api/lore/facts/${f.id}/retire`, { chatId });
      await load();
      undoToast("Retired (kept in History)", r.undo);
    } catch (e) {
      errorToast(e);
    }
  }
  const total = $derived(page ? page.people.reduce((n, p) => n + p.lines.length, 0) : 0);
</script>

{#if page?.people.length}
  <Module title="Since the card" fold peek={total ? String(total) : page.enabled ? "new" : "off"}>
    <p class="tiny muted">Who they are now, where the card no longer says it. The cards aren't changed; in this chat, these lines win.</p>
    {#each page.people as p (p.who)}
      <div class="sub row between">
        <span><History size={12} /> {p.name}{p.who === "persona" ? " (you)" : ""}</span>
        <button class="btn ghost icon small" onclick={() => add(p.who, p.name)} aria-label="Add a line" title="Add a line (kept as you write it)"><Plus size={12} /></button>
      </div>
      {#each p.lines as f (f.id)}
        <div class="listrow ic sline">
          <span class="grow">{#if f.slot}<b>{f.slot.charAt(0).toUpperCase()}{f.slot.slice(1)}:</b> {/if}{f.value}{#if f.sinceSeq}<a class="src" href="/chat/{chatId}?at={f.sinceSeq}" title="Where it changed"> · since #{f.sinceSeq}</a>{/if}</span>
          <button class="btn ghost icon small" onclick={() => edit(f)} aria-label="Edit" title="Edit (kept as you write it)"><Pencil size={12} /></button>
          <button class="btn ghost icon small" onclick={() => retire(f)} aria-label="Retire" title="Retire (kept in History)"><Undo size={12} /></button>
        </div>
      {:else}
        <p class="tiny muted">{page.enabled ? "Nothing yet. Changes the story shows come to the Inbox to keep." : "Off in Settings › Memory; you can still add lines."}</p>
      {/each}
    {/each}
  </Module>
{/if}

<style>
  .sub {
    margin: 0.55rem 0 0.15rem;
    font-size: var(--fs-xs, 0.75rem);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    gap: 0.3rem;
  }
  .sline .grow {
    flex: 1;
    min-width: 0;
  }
  .src {
    font-size: var(--fs-xs, 0.75rem);
    opacity: 0.7;
  }
</style>
