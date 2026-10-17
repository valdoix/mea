<script lang="ts">
  import Segmented from "../Segmented.svelte";
  import { del, get, patch, post } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { Lock, LockOpen, Plus, Trash } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { LoreFact } from "../../lib/types";

  /**
   * Living lore (docs/15, 1.3): the facts under an entry's text. Each says what it is, since when,
   * where it came from (the card, you, or a message you can open), and whether it's locked.
   * In a chat (the Codex) it shows that chat's facts and canon; in the lorebook editor, canon and
   * every chat's. A fact you add here is canon; one added in a chat belongs to that chat.
   */
  let { entryId, chatId = null, compact = false }: { entryId: string; chatId?: string | null; compact?: boolean } = $props();

  let facts = $state<LoreFact[]>([]);
  let loaded = $state(false);
  let view = $state<"now" | "history">("now");
  let draft = $state("");
  let busy = $state(false);

  async function load() {
    try {
      facts = (await get<{ facts: LoreFact[] }>(`/api/lore/entries/${entryId}/facts${chatId ? `?chatId=${chatId}` : ""}`)).facts;
    } catch (e) {
      errorToast(e);
    } finally {
      loaded = true;
    }
  }
  $effect(() => {
    void entryId;
    void chatId;
    void load();
  });
  $effect(() => {
    const id = entryId;
    return onEvent((e) => {
      if ((e.type === "lore.facts" && e.entryId === id && (!chatId || !e.chatId || e.chatId === chatId)) || e.type === "reconnected") void load();
    });
  });

  const shown = $derived(view === "now" ? facts.filter((f) => f.now) : facts.filter((f) => !f.now));
  const history = $derived(facts.filter((f) => !f.now).length);
  $effect(() => {
    if (!history && view === "history") view = "now";
  });

  function undoToast(message: string, token: string) {
    toast(message, { kind: "ok", action: { label: "Undo", run: () => void post(`/api/undo/${token}`).then(load).catch(errorToast) } });
  }
  async function add() {
    const value = draft.trim();
    if (!value || busy) return;
    busy = true;
    try {
      const r = await post<{ fact: LoreFact; undo: string }>(`/api/lore/entries/${entryId}/facts`, { value, chatId });
      draft = "";
      view = "now";
      await load();
      undoToast(chatId ? "Fact added for this chat" : "Fact added", r.undo);
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
  async function toggleLock(f: LoreFact) {
    try {
      const r = await patch<{ undo: string }>(`/api/lore/facts/${f.id}`, { locked: !f.locked });
      await load();
      undoToast(f.locked ? "Unlocked" : "Locked: the story won't change it without asking", r.undo);
    } catch (e) {
      errorToast(e);
    }
  }
  async function retire(f: LoreFact) {
    try {
      const r = await post<{ undo: string }>(`/api/lore/facts/${f.id}/retire`, { chatId });
      await load();
      undoToast(f.chatId || !chatId ? "Retired; it's kept in History" : "Retired everywhere; it's kept in History", r.undo);
    } catch (e) {
      errorToast(e);
    }
  }
  async function remove(f: LoreFact) {
    try {
      const r = await del<{ undo: string }>(`/api/lore/facts/${f.id}`);
      await load();
      undoToast("Fact deleted", r.undo);
    } catch (e) {
      errorToast(e);
    }
  }

  const ORIGIN: Record<LoreFact["origin"], string> = { card: "from the card", you: "yours", story: "from the story", tracker: "from the trackers", invented: "drafted, not confirmed" };
  const label = (f: LoreFact) => (f.slot ? `${f.slot.charAt(0).toUpperCase()}${f.slot.slice(1)}: ${f.value}` : f.value);
  const where = (f: LoreFact) => f.chatId ?? chatId;
</script>

<div class="facts stack tight" class:compact>
  <div class="row between head">
    <span class="label">Facts <span class="faint">{chatId ? "true now in this chat, and canon" : "small, exact, dated; sent after the text when it fires"}</span></span>
    {#if history}<Segmented options={[{ value: "now", label: "Now" }, { value: "history", label: `History (${history})` }]} bind:value={view} small />{/if}
  </div>
  {#each shown as f (f.id)}
    <div class="fact" class:old={!f.now}>
      <span class="grow small">
        {label(f)}
        {#if f.knownBy.length}<span class="tiny faint"> · secret, known to {f.knownBy.join(", ")}</span>{/if}
      </span>
      <span class="tiny faint meta">
        {#if !f.chatId}canon{:else if !chatId && f.chatTitle}{f.chatTitle || "a chat"}{/if}
        {#if f.sinceSeq && where(f)}
          · since <a href="/chat/{where(f)}?at={f.sinceSeq}" title="Open the message it came from">#{f.sinceSeq}</a>
        {/if}
        {#if !f.now && f.supersededBy}· replaced{:else if !f.now && f.untilSeq != null}· retired{/if}
        · {ORIGIN[f.origin]}
      </span>
      <button class="btn ghost icon small" onclick={() => toggleLock(f)} aria-label={f.locked ? "Unlock" : "Lock"} title={f.locked ? "Locked: the story won't change it without asking" : "Lock it"}>
        {#if f.locked}<Lock size={13} />{:else}<LockOpen size={13} />{/if}
      </button>
      {#if f.now}
        <button class="btn ghost small" onclick={() => retire(f)} title="It stops being true now; kept in History">Retire</button>
      {:else}
        <button class="btn ghost icon small" onclick={() => remove(f)} aria-label="Delete this fact" title="Delete this fact"><Trash size={13} /></button>
      {/if}
    </div>
  {:else}
    {#if loaded}<p class="tiny muted">{view === "now" ? "No facts yet." : "Nothing retired or replaced."}</p>{/if}
  {/each}
  <form class="row add" onsubmit={(e) => (e.preventDefault(), void add())}>
    <input class="input grow" bind:value={draft} maxlength="500" placeholder={chatId ? "Add a fact for this chat: Scar on her left hand" : "Add a fact: Eyes are grey · Can't swim"} />
    <button class="btn small" type="submit" disabled={!draft.trim() || busy}><Plus size={13} /> Add a fact</button>
  </form>
</div>

<style>
  .head {
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .fact {
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
    padding: 0.25rem 0;
    border-top: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .fact.old {
    opacity: 0.7;
  }
  .fact .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .meta {
    white-space: nowrap;
  }
  .add {
    gap: 0.4rem;
  }
  .add .grow {
    flex: 1;
    min-width: 0;
  }
  @media (max-width: 640px) {
    .meta {
      white-space: normal;
    }
  }
</style>
