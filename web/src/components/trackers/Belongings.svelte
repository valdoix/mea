<script lang="ts">
  import { get } from "../../lib/api";
  import { History, Plus } from "../../lib/icons";
  import { trackerEdit } from "../../lib/trackers.svelte";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * E2: a person's rooms and belongings on the Story page. Add a room or a thing, set something as
   * theirs, and move a thing by dragging it onto someone or somewhere (or with "Move to…").
   * Every change is a ledger line, so it holds when you rewind or swipe.
   */
  interface Belonging {
    id: string;
    name: string;
    mine: boolean;
    holder: string;
    held: boolean;
    gone: boolean;
    gift: string | null;
    condition: string | null;
    history: { from: string; to: string; how: string | null; seq: number; at: string | null }[];
  }
  interface Data {
    rooms: { id: string; name: string; path: string; kind: string; items: string[] }[];
    items: Belonging[];
    places: { id: string; name: string; path: string; owner: string | null }[];
  }
  let { chatId, charId, name, people }: { chatId: string; charId: string; name: string; people: string[] } = $props();
  let data = $state<Data | null>(null);
  let addingRoom = $state(false);
  let roomPath = $state("");
  let roomKind = $state("room");
  let addingItem = $state(false);
  let itemName = $state("");
  let itemPlace = $state("");
  let open = $state<string | null>(null);
  let dragging = $state<string | null>(null);
  let over = $state<string | null>(null);

  async function load() {
    try {
      data = await get<Data>(`/api/chats/${chatId}/belongings/${encodeURIComponent(charId)}`);
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void charId;
    void load();
  });

  async function write(lines: string[], done: string) {
    if (await trackerEdit(chatId, lines)) {
      toast(done, { kind: "ok" });
      await load();
    }
  }
  function addRoom() {
    if (!roomPath.trim()) return;
    void write([`room ${name}: ${roomPath.trim()} | ${roomKind.trim() || "room"} — you set it`], `${roomPath.split("›").at(-1)!.trim()}: ${name}'s ${roomKind || "room"}`);
    addingRoom = false;
    roomPath = "";
  }
  function addItem() {
    if (!itemName.trim()) return;
    const line = itemPlace.trim() ? `keeps ${name}: ${itemName.trim()} @ ${itemPlace.trim()} — you added it` : `item ${itemName.trim()}: +${name} — you added it`;
    void write([line, `item ${itemName.trim()}: owner ${name}`], `${itemName.trim()}: ${name}'s`);
    addingItem = false;
    itemName = "";
    itemPlace = "";
  }
  /** To a person (they hold it) or a place (it's kept there, still whoever's it was). */
  function moveTo(it: Belonging, target: string) {
    const [kind, value] = [target.slice(0, 2), target.slice(2)];
    if (!value) return;
    if (kind === "p:") void write([`item ${it.name}: → ${value} — you moved it`], `${it.name} → ${value}`);
    else if (it.mine) void write([`keeps ${name}: ${it.name} @ ${value} — you moved it`], `${it.name} → ${value.split("›").at(-1)!.trim()}`);
    else errorToast(new Error(`Set ${it.name} as ${name}'s first, then keep it somewhere`));
  }
  const targets = $derived([
    ...people.map((p) => ({ key: `p:${p}`, label: p })),
    ...(data?.places ?? []).map((p) => ({ key: `l:${p.path}`, label: p.name + (p.owner ? ` (${p.owner}'s)` : "") })),
  ]);
  function drop(e: DragEvent, key: string) {
    e.preventDefault();
    over = null;
    const it = data?.items.find((x) => x.id === (e.dataTransfer?.getData("text/plain") || dragging));
    dragging = null;
    if (it) moveTo(it, key);
  }
</script>

{#if data}
  <div class="stack tight">
    <div class="row between">
      <span class="label">Rooms</span>
      <button class="btn ghost small" onclick={() => (addingRoom = !addingRoom)}><Plus size={13} /> Add</button>
    </div>
    {#each data.rooms as r (r.id)}
      <div class="small">{r.name} <span class="tiny faint">{r.kind} · {r.path}</span>{#if r.items.length}<div class="tiny muted">Keeps here: {r.items.join(", ")}</div>{/if}</div>
    {:else}
      <p class="tiny muted">No room of their own yet.</p>
    {/each}
    {#if addingRoom}
      <div class="row wrap">
        <input class="input grow" bind:value={roomPath} list="belong-places" placeholder="Town › Place" aria-label="Which place" />
        <input class="input narrow" bind:value={roomKind} placeholder="room, home, shop…" aria-label="What kind of place" />
        <button class="btn small" disabled={!roomPath.trim()} onclick={addRoom}>Set as theirs</button>
      </div>
    {/if}

    <div class="row between">
      <span class="label">Belongings</span>
      <button class="btn ghost small" onclick={() => (addingItem = !addingItem)}><Plus size={13} /> Add</button>
    </div>
    {#each data.items as it (it.id)}
      <div class="item" class:gone={it.gone} draggable="true" role="listitem" ondragstart={(e) => ((dragging = it.id), e.dataTransfer?.setData("text/plain", it.id))} ondragend={() => (dragging = null)}>
        <div class="row wrap">
          <b class="small">{it.name}</b>
          {#if it.gift}<span class="chip tiny" title="A gift">from {it.gift}</span>{/if}
          {#if it.condition}<span class="tiny faint">{it.condition}</span>{/if}
          <span class="tiny muted grow">{it.gone ? "gone" : it.held ? "carries it" : it.holder ? `with ${it.holder}` : ""}{!it.mine ? " · not theirs" : ""}</span>
          {#if !it.mine}<button class="btn ghost small" onclick={() => write([`item ${it.name}: owner ${name}`], `${it.name}: ${name}'s`)}>Set as theirs</button>{/if}
          <select class="select tiny pick" value="" onchange={(e) => moveTo(it, e.currentTarget.value)} aria-label="Move {it.name} to">
            <option value="">Move to…</option>
            {#each targets as t (t.key)}<option value={t.key}>{t.label}</option>{/each}
          </select>
          <button class="btn ghost icon small" onclick={() => (open = open === it.id ? null : it.id)} aria-label="History of {it.name}" aria-expanded={open === it.id}><History size={13} /></button>
        </div>
        {#if open === it.id}
          <ol class="history tiny">
            {#each it.history as h, i (i)}
              <li><a href="/chat/{chatId}?at={h.seq}">#{h.seq}</a> {h.from || "—"} → {h.to || h.how || "—"}{h.at ? ` · at ${h.at.split(" › ").at(-1)}` : ""}{h.how && h.to ? ` — ${h.how}` : ""}</li>
            {:else}
              <li class="faint">No history yet.</li>
            {/each}
          </ol>
        {/if}
      </div>
    {:else}
      <p class="tiny muted">Nothing of theirs yet.</p>
    {/each}
    {#if dragging}
      <div class="drops" role="list" aria-label="Drop on someone or somewhere">
        {#each targets as t (t.key)}
          <span class="chip tiny drop" class:over={over === t.key} role="listitem" ondragover={(e) => (e.preventDefault(), (over = t.key))} ondragleave={() => (over = null)} ondrop={(e) => drop(e, t.key)}>{t.label}</span>
        {/each}
      </div>
    {/if}
    {#if addingItem}
      <div class="row wrap">
        <input class="input grow" bind:value={itemName} placeholder="a brass telescope" aria-label="What" />
        <input class="input narrow" bind:value={itemPlace} list="belong-places" placeholder="kept at (optional)" aria-label="Kept where" />
        <button class="btn small" disabled={!itemName.trim()} onclick={addItem}>Add</button>
      </div>
    {/if}
    <datalist id="belong-places">{#each data.places as p (p.id)}<option value={p.path}></option>{/each}</datalist>
  </div>
{/if}

<style>
  .item {
    padding: 0.3rem 0.45rem;
    border-radius: var(--radius-sm, 8px);
    background: var(--surface-2);
    cursor: grab;
  }
  .item.gone {
    opacity: 0.6;
  }
  .row {
    align-items: center;
    gap: 0.35rem;
  }
  .narrow {
    max-width: 11rem;
  }
  .pick {
    max-width: 8.5rem;
  }
  .history {
    margin: 0.3rem 0 0;
    padding-left: 1.1rem;
  }
  .drops {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    padding: 0.4rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm, 8px);
  }
  .drop.over {
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
</style>
