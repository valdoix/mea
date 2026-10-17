<script lang="ts">
  import Module from "../desk/Module.svelte";
  import { get, patch, post } from "../../lib/api";
  import { promptText } from "../../lib/dialogs.svelte";
  import { onEvent } from "../../lib/events";
  import { Heart, Pencil, Repeat, Star, Undo } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { LoreFact } from "../../lib/types";

  /**
   * The Bond (docs/15, part 4), for companion chats: where things stand, what they call each other,
   * the running bits with where each began, open promises and kept secrets, the milestones, and what
   * {{char}} knows about you. Each line is a fact on the Bond entry: Edit locks it as you wrote it,
   * Retire takes it off (kept in History), and a swipe takes away what that reply added.
   */
  let { chatId }: { chatId: string } = $props();

  interface BondPage {
    entryId: string | null;
    companion: boolean;
    personaFacts: boolean;
    stands: LoreFact | null;
    calls: LoreFact | null;
    jokes: LoreFact[];
    threads: LoreFact[];
    milestones: LoreFact[];
    knows: LoreFact[];
  }
  let page = $state<BondPage | null>(null);

  async function load() {
    try {
      page = await get<BondPage>(`/api/chats/${chatId}/bond`);
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
      if ((e.type === "lore.facts" && e.chatId === chatId) || (e.type === "trackers.changed" && e.chatId === chatId && !e.running) || e.type === "reconnected") {
        clearTimeout(timer);
        timer = setTimeout(load, 600);
      }
    }),
  );

  const undoToast = (message: string, token: string) => toast(message, { kind: "ok", action: { label: "Undo", run: () => void post(`/api/undo/${token}`).then(load).catch(errorToast) } });
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
      undoToast("Retired from the Bond", r.undo);
    } catch (e) {
      errorToast(e);
    }
  }
  async function setPersonaFacts(on: boolean) {
    try {
      page = await post<BondPage>(`/api/chats/${chatId}/bond/settings`, { personaFacts: on });
    } catch (e) {
      errorToast(e);
    }
  }
  const total = $derived(page ? [page.stands, page.calls].filter(Boolean).length + page.jokes.length + page.threads.length + page.milestones.length + page.knows.length : 0);
</script>

{#snippet line(f: LoreFact, icon?: "joke" | "star")}
  <div class="listrow ic bline">
    {#if icon === "joke"}<Repeat size={13} />{:else if icon === "star"}<Star size={13} />{/if}
    <span class="grow">{f.value.replace(/\s*\(since #\d+\)$/, "")}{#if f.sinceSeq}<a class="src" href="/chat/{chatId}?at={f.sinceSeq}" title="Where it began"> · since #{f.sinceSeq}</a>{/if}</span>
    <button class="btn ghost icon small" onclick={() => edit(f)} aria-label="Edit" title="Edit (kept as you write it)"><Pencil size={12} /></button>
    <button class="btn ghost icon small" onclick={() => retire(f)} aria-label="Retire" title="Retire (kept in History)"><Undo size={12} /></button>
  </div>
{/snippet}

{#if page?.companion}
  <Module title="Bond" fold peek={total ? String(total) : "new"}>
    {#if !total}
      <p class="tiny muted">The Bond fills in from the story's records after the first scene: where things stand, running bits, promises and what they've been told about you.</p>
    {/if}
    {#if page.stands}<div class="sub">Where things stand</div>{@render line(page.stands)}{/if}
    {#if page.calls}<div class="sub">What they call each other</div>{@render line(page.calls)}{/if}
    {#if page.jokes.length}<div class="sub">Inside jokes</div>{#each page.jokes as f (f.id)}{@render line(f, "joke")}{/each}{/if}
    {#if page.threads.length}<div class="sub">Open threads</div>{#each page.threads as f (f.id)}{@render line(f)}{/each}{/if}
    {#if page.milestones.length}<div class="sub">Milestones</div>{#each page.milestones as f (f.id)}{@render line(f, "star")}{/each}{/if}
    <div class="sub row between">
      <span><Heart size={12} /> Knows about you</span>
      <label class="switch tiny"><input type="checkbox" checked={page.personaFacts} onchange={(e) => setPersonaFacts(e.currentTarget.checked)} /> Persona facts</label>
    </div>
    {#each page.knows as f (f.id)}{@render line(f)}{:else}<p class="tiny muted">{page.personaFacts ? "Nothing you've told them yet." : "Off for this chat."}</p>{/each}
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
  .bline .grow {
    flex: 1;
    min-width: 0;
  }
  .src {
    font-size: var(--fs-xs, 0.75rem);
    opacity: 0.7;
  }
</style>
