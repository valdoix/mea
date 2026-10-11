<script lang="ts">
  import Module from "../desk/Module.svelte";
  import Seg from "../desk/Seg.svelte";
  import { get, post, put } from "../../lib/api";
  import { dockRequest } from "../../lib/dock.svelte";
  import { onEvent } from "../../lib/events";
  import { Plus, Sparkles, X } from "../../lib/icons";
  import { navigate } from "../../lib/router.svelte";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * C1: the canon cutoff, in the Chat tab. Which story this comes from and where it stands, what
   * hasn't happened yet (suggested from the wiki, or typed), and what won't happen here at all.
   */
  type Kind = "event" | "character" | "reveal" | "term";
  interface Later {
    id: string;
    kind: Kind;
    text: string;
    terms: string[];
    source?: string;
  }
  interface Canon {
    source?: string;
    point?: string;
    later?: Later[];
    wont?: { id: string; text: string }[];
    proposed?: Later[];
  }
  let { chatId }: { chatId: string } = $props();

  let canon = $state<Canon>({});
  let source = $state("");
  let point = $state("");
  let newLater = $state("");
  let newTerms = $state("");
  let kind = $state<Kind>("event");
  let newWont = $state("");
  let open = $state(false);
  let el = $state<HTMLElement | null>(null);
  let suggesting = $state(false);

  async function load() {
    try {
      canon = (await get<{ canon: Canon }>(`/api/chats/${chatId}/canon`)).canon;
      source = canon.source ?? "";
      point = canon.point ?? "";
    } catch {
      canon = {};
    }
  }
  $effect(() => {
    void chatId;
    void load();
  });
  $effect(() =>
    onEvent((e) => {
      if (e.type === "chat.changed" && e.chatId === chatId) void load();
    }),
  );
  $effect(() => {
    if (dockRequest.seq && dockRequest.section === "canon") {
      open = true;
      requestAnimationFrame(() => el?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  });

  async function save(next: Canon) {
    try {
      canon = (await put<{ canon: Canon }>(`/api/chats/${chatId}/canon`, next)).canon;
    } catch (e) {
      errorToast(e);
    }
  }
  let timer: ReturnType<typeof setTimeout>;
  function saveWhere() {
    clearTimeout(timer);
    timer = setTimeout(() => save({ ...canon, source: source.trim(), point: point.trim() }), 600);
  }
  async function add(list: "later" | "wont") {
    const text = (list === "later" ? newLater : newWont).trim();
    if (!text) return;
    try {
      canon = (await post<{ canon: Canon }>(`/api/chats/${chatId}/canon/items`, { list, kind, text, terms: newTerms.split(",").map((t) => t.trim()).filter(Boolean) })).canon;
      if (list === "later") {
        newLater = "";
        newTerms = "";
      } else newWont = "";
    } catch (e) {
      errorToast(e);
    }
  }
  async function suggest() {
    suggesting = true;
    try {
      if (source.trim() !== (canon.source ?? "") || point.trim() !== (canon.point ?? "")) await save({ ...canon, source: source.trim(), point: point.trim() });
      await post(`/api/chats/${chatId}/canon/suggest`);
      toast("Reading the wiki… suggestions arrive in the Inbox", { action: { label: "Open", run: () => navigate(`/inbox?chat=${encodeURIComponent(chatId)}&source=canon`) } });
    } catch (e) {
      errorToast(e);
    } finally {
      suggesting = false;
    }
  }
  const KINDS: { value: Kind; label: string }[] = [
    { value: "event", label: "Event" },
    { value: "character", label: "Person" },
    { value: "reveal", label: "Reveal" },
    { value: "term", label: "Word" },
  ];
  const later = $derived(canon.later ?? []);
  const wont = $derived(canon.wont ?? []);
  const waiting = $derived(canon.proposed?.length ?? 0);
</script>

<div bind:this={el} data-section="canon">
  <Module title="Canon" fold bind:open led={waiting ? "warm" : later.length ? "on" : null} peek={waiting ? `${waiting} suggested` : canon.source ? `${canon.source}${later.length ? ` · ${later.length} later` : ""}` : "For fandom stories"}>
    <div class="dymo-grid">
      <label><span class="st-k">Comes from</span><input class="dymo" bind:value={source} oninput={saveWhere} placeholder="Buffy the Vampire Slayer" maxlength="120" /></label>
      <label><span class="st-k">Stands at</span><input class="dymo" bind:value={point} oninput={saveWhere} placeholder="Season 2, after Innocence" maxlength="200" /></label>
    </div>
    <div class="st-keys">
      <button class="st-key" type="button" onclick={suggest} disabled={suggesting || !source.trim()}><Sparkles size={14} /> {suggesting ? "Asking…" : "Suggest from the wiki"}</button>
      {#if waiting}<a class="st-key" href="/inbox?chat={encodeURIComponent(chatId)}&source=canon">{waiting} to review</a>{/if}
    </div>

    <hr class="st-divider" />
    <span class="st-k">Hasn't happened · nobody knows it, nothing names it</span>
    {#if later.length}
      <ul class="st-pins">
        {#each later as i (i.id)}
          <li>
            <span><b class="kind">{KINDS.find((k) => k.value === i.kind)?.label}</b> {i.text}{#if i.terms.length}<small> · watching: {i.terms.join(", ")}</small>{/if}{#if i.source}<small> · {i.source}</small>{/if}</span>
            <button type="button" onclick={() => save({ ...canon, later: later.filter((x) => x.id !== i.id) })} aria-label="Remove: {i.text}"><X size={13} /></button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="st-seg-row"><span class="st-k">Kind</span><Seg label="Kind" value={kind} options={KINDS} onchange={(v) => (kind = v)} /></div>
    <label class="st-addline"><Plus size={14} /><input bind:value={newLater} placeholder={kind === "character" ? "Dawn" : kind === "term" ? "the Initiative" : "Angel loses his soul"} maxlength="300" onkeydown={(e) => e.key === "Enter" && add("later")} aria-label="Add something that hasn't happened" /></label>
    {#if kind !== "character" && kind !== "term"}<label class="st-addline"><input bind:value={newTerms} placeholder="Words that would give it away, with commas" maxlength="200" onkeydown={(e) => e.key === "Enter" && add("later")} aria-label="Words to watch for" /></label>{/if}

    <hr class="st-divider" />
    <span class="st-k">Won't happen here · this story's own way (also a story truth)</span>
    {#if wont.length}
      <ul class="st-pins">
        {#each wont as w (w.id)}<li><span>{w.text}</span><button type="button" onclick={() => save({ ...canon, wont: wont.filter((x) => x.id !== w.id) })} aria-label="Remove: {w.text}"><X size={13} /></button></li>{/each}
      </ul>
    {/if}
    <label class="st-addline"><Plus size={14} /><input bind:value={newWont} placeholder="Jenny lives. Enter to add" maxlength="300" onkeydown={(e) => e.key === "Enter" && add("wont")} aria-label="Add a canon event that won't happen here" /></label>
  </Module>
</div>

<style>
  .dymo-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 10px 8px;
    margin-bottom: 8px;
  }
  .dymo-grid label {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .dymo {
    width: 100%;
    min-width: 0;
    padding: 7px 10px;
    border: 0;
    border-radius: 3px;
    background: var(--st-well);
    color: var(--text);
    box-shadow: var(--st-inset-sm);
    font: 600 12.5px/1.2 var(--font-ui);
  }
  .kind {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
  }
  small {
    color: var(--text-faint);
  }
</style>
