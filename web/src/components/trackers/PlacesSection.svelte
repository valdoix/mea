<script lang="ts">
  import { get, put } from "../../lib/api";
  import { Pin } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * docs/30 2.6: the story's places on the Story page, between Factions and People. A tree (town ›
   * building › room) folded at the building, and a card for the place you pick: its names, kind, who
   * owns it and lives there, what it looks like now and what's kept there. Every action is an edit to
   * the place (place_profiles), so it holds through every refold. Mockup: mockups/10-places.html.
   */
  interface PlaceRow {
    id: string;
    name: string;
    path: string;
    parent: string | null;
    kind: string | null;
    aliases: string[];
    address: string | null;
    owner: string | null;
    residents: { name: string; guess: boolean }[];
    pinned: boolean;
    visits: number;
    lastSeq: number;
    notes: { text: string; seq: number }[];
    items: string[];
    here: boolean;
    lore?: { id: string; title: string } | null;
    profile: { name?: string; aliases?: string[]; into?: string; parent?: string; notPlace?: boolean; pinned?: boolean } | null;
  }
  let { chatId }: { chatId: string } = $props();
  let places = $state<PlaceRow[]>([]);
  /** Phrases you said aren't places, to take back. */
  let notPlaces = $state<{ id: string; name: string }[]>([]);
  let open = $state<Record<string, boolean>>({});
  let picked = $state<string | null>(null);
  let action = $state<"" | "rename" | "merge" | "move">("");
  let draft = $state("");

  async function load() {
    try {
      const r = await get<{ places: PlaceRow[]; notPlaces?: { id: string; name: string }[] }>(`/api/chats/${chatId}/places`);
      places = r.places;
      notPlaces = r.notPlaces ?? [];
      const here = places.find((p) => p.here);
      // The scene's place starts open, and picked.
      if (here && picked == null) {
        for (let p: PlaceRow | undefined = here; p; p = p.parent ? byId.get(p.parent) : undefined) open[p.id] = true;
        picked = here.id;
      }
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void chatId;
    void load();
  });

  const byId = $derived(new Map(places.map((p) => [p.id, p])));
  const kids = $derived.by(() => {
    const m = new Map<string, PlaceRow[]>();
    for (const p of places) m.set(p.parent ?? "", [...(m.get(p.parent ?? "") ?? []), p]);
    return m;
  });
  /** Visits to a place and everything in it, so a mall counts its food court. */
  const total = $derived.by(() => {
    const t = new Map<string, number>();
    const sum = (p: PlaceRow): number => t.get(p.id) ?? (t.set(p.id, p.visits + (kids.get(p.id) ?? []).reduce((n, k) => n + sum(k), 0)), t.get(p.id)!);
    for (const p of places) sum(p);
    return t;
  });
  const childrenOf = (id: string) => [...(kids.get(id) ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (total.get(b.id) ?? 0) - (total.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  const tops = $derived(childrenOf(""));
  const card = $derived(picked ? byId.get(picked) : undefined);
  const chain = (p: PlaceRow) => {
    const out: PlaceRow[] = [];
    for (let x = p.parent ? byId.get(p.parent) : undefined, i = 0; x && i < 12; x = x.parent ? byId.get(x.parent) : undefined, i++) out.unshift(x);
    return out;
  };
  /** Places a place can go into: anything not inside it (nor it). */
  const targets = (p: PlaceRow) => places.filter((x) => x.id !== p.id && !chain(x).some((c) => c.id === p.id)).sort((a, b) => a.path.localeCompare(b.path));

  async function edit(p: PlaceRow, patch: Record<string, unknown>, done: string) {
    try {
      await put(`/api/chats/${chatId}/places/${encodeURIComponent(p.id)}`, patch);
      toast(done, { kind: "ok" });
      action = "";
      draft = "";
      await load();
    } catch (e) {
      errorToast(e);
    }
  }
  /** The old name stays another name for it, so the story's lines still find it. */
  function rename(p: PlaceRow) {
    const name = draft.trim();
    if (!name || name === p.name) return;
    void edit(p, { name, aliases: [...new Set([...(p.profile?.aliases ?? []), p.name])] }, `Renamed to ${name}`);
  }
  async function undoNotPlace(x: { id: string; name: string }) {
    try {
      await put(`/api/chats/${chatId}/places/${encodeURIComponent(x.id)}`, { notPlace: false });
      toast(`${x.name} is a place again`, { kind: "ok" });
      await load();
    } catch (e) {
      errorToast(e);
    }
  }
  function start(a: typeof action, p: PlaceRow) {
    action = action === a ? "" : a;
    draft = a === "rename" ? p.name : "";
  }
  const KIND: Record<string, string> = { home: "home", building: "building", room: "room", spot: "spot", town: "town", district: "area", street: "street", floor: "floor", vehicle: "vehicle", outdoors: "outdoors" };
</script>

<div class="row between">
  <h2 class="section">Places</h2>
  <span class="tiny muted">{places.length} {places.length === 1 ? "place" : "places"}</span>
</div>
{#if !places.length}
  <p class="tiny muted">Places appear as the story goes somewhere. One place stays one place however it's written.</p>
{:else}
  <p class="tiny muted">Every place the story has been, one place however it was written. Buildings are folded: open one for its rooms. Pinned places are always kept in mind.</p>
  <div class="places">
    <div class="tree card" role="tree" aria-label="Places">
      {#each tops as p (p.id)}{@render node(p, 0)}{/each}
    </div>
    {#if card}
      <div class="card place">
        <div class="row between">
          <div class="grow">
            {#if chain(card).length}<div class="tiny faint wraps">{chain(card).map((x) => x.name).join(" › ")} ›</div>{/if}
            <b class="title">{card.name}</b>
          </div>
          <button class="btn ghost small" class:on={card.pinned} onclick={() => edit(card!, { pinned: !card!.pinned }, card!.pinned ? `${card!.name}: unpinned` : `${card!.name}: always kept in mind`)} aria-pressed={card.pinned} title="Always keep in mind"><Pin size={14} /> {card.pinned ? "Pinned" : "Pin"}</button>
        </div>
        <div class="row wrap">
          {#if card.kind}<span class="chip tiny">{KIND[card.kind] ?? card.kind}</span>{/if}
          {#if card.here}<span class="chip mint tiny">here now</span>{/if}
          {#if card.aliases.length}<span class="tiny faint wraps">also {card.aliases.join(", ")}</span>{/if}
        </div>
        <div class="tiny">
          <span class="muted">Visits</span> {card.visits}{#if total.get(card.id) !== card.visits}<span class="faint"> ({total.get(card.id)} with what's in it)</span>{/if}{#if card.lastSeq}{" · "}<a href="/chat/{chatId}?at={card.lastSeq}">last here at #{card.lastSeq}</a>{/if}
          {#if card.address}<span> · <span class="muted">on</span> {card.address}</span>{/if}
        </div>
        {#if card.owner || card.residents.length}
          <div class="tiny wraps">
            {#if card.owner}<span class="muted">Whose</span> {card.owner}{/if}
            {#if card.owner && card.residents.length}{" · "}{/if}
            {#if card.residents.length}<span class="muted">Lives here</span> {#each card.residents as r, i (r.name)}{i ? ", " : ""}{r.name}{#if r.guess}<span class="faint" title="Guessed from the story: set it on their sheet with Lives here"> (a guess)</span>{/if}{/each}{/if}
          </div>
        {/if}
        {#if card.notes.length}
          <div class="tiny">
            <span class="muted">What it looks like now</span>
            {#each card.notes.slice(0, 5) as n (n.seq + n.text)}<div class="wraps">· {n.text} <a class="faint" href="/chat/{chatId}?at={n.seq}">#{n.seq}</a></div>{/each}
          </div>
        {/if}
        {#if card.items.length}<div class="tiny wraps"><span class="muted">Kept here</span> {card.items.join(" · ")}</div>{/if}
        {#if card.lore}<div class="tiny"><span class="muted">Lore</span> <a href="/lore?entry={card.lore.id}">{card.lore.title}</a></div>{/if}
        {#if childrenOf(card.id).length}<div class="tiny wraps"><span class="muted">In it</span> {childrenOf(card.id).map((x) => x.name).join(", ")}</div>{/if}
        <div class="row wrap actions">
          <button class="btn small" class:on={action === "rename"} onclick={() => start("rename", card!)}>Rename</button>
          <button class="btn small" class:on={action === "merge"} onclick={() => start("merge", card!)}>Merge into…</button>
          <button class="btn small" class:on={action === "move"} onclick={() => start("move", card!)}>Move under…</button>
          {#if card.profile?.parent}<button class="btn ghost small" onclick={() => edit(card!, { parent: null }, `${card!.name} is back where the story put it`)}>Undo the move</button>{/if}
          <button class="btn ghost small danger" onclick={() => edit(card!, { notPlace: true, name: card!.name }, `${card!.name} isn't a place: paths through it skip it`)}>Not a place</button>
        </div>
        {#if action === "rename"}
          <div class="row">
            <input class="input grow" bind:value={draft} aria-label="New name" onkeydown={(e) => e.key === "Enter" && rename(card!)} />
            <button class="btn small primary" disabled={!draft.trim() || draft.trim() === card.name} onclick={() => rename(card!)}>Rename</button>
          </div>
          <span class="hint">The old name stays another name for it, so the story's lines still find it.</span>
        {:else if action === "merge" || action === "move"}
          <div class="row">
            <select class="select grow" bind:value={draft} aria-label={action === "merge" ? "Merge into" : "Move under"}>
              <option value="">{action === "merge" ? "The same place as…" : "Put it under…"}</option>
              {#each targets(card) as t (t.id)}<option value={t.id}>{t.path}</option>{/each}
            </select>
            <button
              class="btn small primary"
              disabled={!draft}
              onclick={() => {
                const t = byId.get(draft);
                if (!t) return;
                if (action === "merge") void edit(card!, { into: t.id }, `${card!.name} is ${t.name} now`);
                else void edit(card!, { parent: t.id }, `${card!.name} is under ${t.name} now`);
              }}>{action === "merge" ? "Merge" : "Move"}</button
            >
          </div>
          <span class="hint">{action === "merge" ? "Everything written for this place goes to that one, its rooms with it." : "It keeps its name and rooms; its path follows the tree."}</span>
        {/if}
      </div>
    {/if}
  </div>
{/if}
{#if notPlaces.length}
  <p class="tiny muted row wrap">
    Not places:
    {#each notPlaces as x (x.id)}<span class="chip tiny">{x.name} <button class="btn ghost small" onclick={() => undoNotPlace(x)}>Undo</button></span>{/each}
  </p>
{/if}

{#snippet node(p: PlaceRow, depth: number)}
  {@const ks = childrenOf(p.id)}
  <div class="node" class:sel={picked === p.id} role="treeitem" aria-selected={picked === p.id} aria-expanded={ks.length ? Boolean(open[p.id] ?? depth === 0) : undefined}>
    <button class="twisty" disabled={!ks.length} onclick={() => (open[p.id] = !(open[p.id] ?? depth === 0))} aria-label={ks.length ? (open[p.id] ?? depth === 0 ? `Fold ${p.name}` : `Open ${p.name}`) : undefined} tabindex={ks.length ? 0 : -1}>{ks.length ? (open[p.id] ?? depth === 0 ? "▾" : "▸") : ""}</button>
    <button class="name" onclick={() => ((picked = p.id), (action = ""))}>
      {#if depth === 0}<b>{p.name}</b>{:else}{p.name}{/if}
    </button>
    {#if p.here}<span class="chip mint tiny">here</span>{/if}
    {#if p.pinned}<span class="on" title="Always kept in mind"><Pin size={12} /></span>{/if}
    <span class="count" title="Visits, with what's in it">{total.get(p.id) || ""}</span>
  </div>
  {#if ks.length && (open[p.id] ?? depth === 0)}
    <div class="kids" role="group">
      {#each ks as k (k.id)}{@render node(k, depth + 1)}{/each}
    </div>
  {/if}
{/snippet}

<style>
  .places {
    display: grid;
    grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }
  @media (max-width: 720px) {
    .places {
      grid-template-columns: minmax(0, 1fr);
    }
    .tree {
      max-height: 340px;
    }
  }
  .tree {
    padding: 6px;
    max-height: 520px;
    overflow: auto;
  }
  .node {
    display: flex;
    align-items: center;
    gap: 4px;
    border-radius: 8px;
    padding: 1px 4px;
  }
  .node:hover {
    background: var(--surface-2);
  }
  .node.sel {
    background: var(--tint-char);
    outline: 1px solid var(--accent);
  }
  .twisty {
    width: 18px;
    flex: none;
    border: 0;
    background: none;
    color: var(--text-faint);
    font-size: 11px;
    cursor: pointer;
    padding: 2px 0;
  }
  .twisty:disabled {
    cursor: default;
  }
  .name {
    flex: 1;
    min-width: 0;
    text-align: left;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 14px;
    padding: 3px 0;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kids {
    margin-left: 12px;
    border-left: 1px solid var(--border);
    padding-left: 4px;
  }
  .count {
    font-size: 11px;
    color: var(--text-faint);
  }
  .on {
    color: var(--accent-ink);
  }
  .place {
    display: grid;
    gap: 8px;
  }
  .title {
    font-size: 17px;
  }
  .actions {
    border-top: 1px solid var(--border);
    padding-top: 8px;
  }
  .wraps {
    overflow-wrap: anywhere;
  }
</style>
