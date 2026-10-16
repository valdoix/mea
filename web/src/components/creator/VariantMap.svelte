<script lang="ts">
  import type { CreatorSession } from "../../lib/creator.svelte";
  import { ArrowDown, Loader, Plus, Sparkles, StepForward, X } from "../../lib/icons";
  import type { MapRow, MapRowState, MapRowType } from "../../lib/types";

  /**
   * A version's map (docs/14): every person, place, group, thing and event from the original's card
   * and lorebooks, and what each becomes here. Everything after this is written through it.
   */
  let { session }: { session: CreatorSession } = $props();
  const draft = $derived(session.draft!);
  const v = $derived(draft.variant!);

  const STATES: { id: MapRowState; label: string }[] = [
    { id: "open", label: "Not decided" },
    { id: "kept", label: "The same" },
    { id: "changed", label: "Becomes…" },
    { id: "dropped", label: "Not here" },
    { id: "new", label: "New here" },
  ];
  const TYPES: { id: MapRowType; label: string }[] = [
    { id: "person", label: "Person" },
    { id: "place", label: "Place" },
    { id: "group", label: "Group" },
    { id: "thing", label: "Thing" },
    { id: "event", label: "Event" },
    { id: "idea", label: "Idea" },
  ];
  const typeLabel = (t: MapRowType) => (t === "self" ? "Them" : (TYPES.find((x) => x.id === t)?.label ?? t));

  let filter = $state<MapRowState | "all">("all");
  let newName = $state("");
  let newType = $state<MapRowType>("person");
  let newIsNew = $state(false);

  const counts = $derived(Object.fromEntries(STATES.map((s) => [s.id, v.map.filter((r) => r.state === s.id).length])) as Record<MapRowState, number>);
  const rows = $derived(filter === "all" ? v.map : v.map.filter((r) => r.state === filter));

  function edit(row: MapRow, patch: Partial<MapRow>) {
    const r = session.draft!.variant!.map.find((x) => x.id === row.id);
    if (!r) return;
    Object.assign(r, patch);
    if (patch.state && patch.state !== "changed" && patch.state !== "new") r.to = "";
    session.save({ variant: { map: [{ id: r.id, type: r.type, from: r.from, to: r.to, state: r.state, note: r.note }] } }, `row:${r.id}`, patch.state ? 0 : 500);
  }

  async function removeRow(row: MapRow) {
    session.draft!.variant!.map = session.draft!.variant!.map.filter((x) => x.id !== row.id);
    session.save({ variant: { map: [{ id: row.id, remove: true }] } }, `row:${row.id}`, 0);
  }

  async function addRow() {
    const name = newName.trim();
    if (!name) return;
    newName = "";
    session.save({ variant: { map: [newIsNew ? { from: "", to: name, type: newType, state: "new" } : { from: name, type: newType, state: "open" }] } }, `newrow:${Date.now()}`, 0);
    await session.flush();
    await session.load();
  }

  const placeholder = (r: MapRow) => (r.type === "self" ? `Who ${r.from} is in this version` : r.state === "new" ? "What it is" : `What ${r.from} becomes`);
</script>

<section class="stack">
  {#if !v.mapBuilt && !v.map.length}
    <div class="panel stack tight">
      <span class="small">Mea reads {v.originName}'s card{draft.worldBookIds.length ? " and lorebooks" : ""} for every person, place, group, thing and event, then suggests what each becomes in this version.</span>
      <div class="row"><button class="btn primary" onclick={() => session.act("map", "/variant/map")} disabled={Boolean(session.busy)}>{#if session.busy === "map"}<span class="spin"><Loader size={14} /></span> Reading…{:else}<Sparkles size={14} /> Read the original's world{/if}</button></div>
    </div>
  {:else}
    <div class="panel stack tight">
      <span class="small"><b>{v.map.length} rows</b> <span class="muted">· the version's bible and every field are written through this map, and anything from the original that slips through is flagged.</span></span>
      <div class="row wrap">
        <button class="chip" class:lavender={filter === "all"} onclick={() => (filter = "all")}>All {v.map.length}</button>
        {#each STATES as s (s.id)}
          {#if counts[s.id]}<button class="chip" class:lavender={filter === s.id} onclick={() => (filter = s.id)}>{s.label} {counts[s.id]}</button>{/if}
        {/each}
      </div>
      <div class="row wrap">
        {#if counts.open}<button class="btn small primary" onclick={() => session.act("fill", "/variant/map/fill", { all: true })} disabled={Boolean(session.busy)}>{#if session.busy === "fill"}<span class="spin"><Loader size={14} /></span> Filling…{:else}<Sparkles size={14} /> Fill the {counts.open} open{/if}</button>{/if}
        <button class="btn small" onclick={() => session.act("map", "/variant/map")} disabled={Boolean(session.busy)} title="Adds anything new in the original's card and lorebooks; rows already here stay as they are">{session.busy === "map" ? "Reading…" : "Read the original again"}</button>
      </div>
    </div>

    {#each rows as r (r.id)}
      <div class="row-card card" class:open={r.state === "open"} class:dropped={r.state === "dropped"}>
        <div class="top">
          <span class="chip tiny">{typeLabel(r.type)}</span>
          {#if r.state === "new"}
            <span class="tiny muted grow">Only in this version{r.source === "mea" ? " · Mea's suggestion" : ""}</span>
          {:else}
            <b class="grow from">{r.from}</b>
          {/if}
          <select class="select mini" value={r.state} onchange={(e) => edit(r, { state: e.currentTarget.value as MapRowState })} aria-label="What happens to {r.from || r.to}">
            {#each STATES.filter((s) => (r.from ? s.id !== "new" : s.id === "new")) as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
          </select>
          {#if r.type !== "self"}<button class="btn ghost icon small" onclick={() => removeRow(r)} aria-label="Remove row"><X size={13} /></button>{/if}
        </div>
        {#if r.state === "changed" || r.state === "new"}
          <div class="to">
            {#if r.state === "changed"}<ArrowDown size={13} />{/if}
            <input class="input" value={r.to} oninput={(e) => edit(r, { to: e.currentTarget.value })} placeholder={placeholder(r)} maxlength="300" aria-label={placeholder(r)} />
          </div>
        {/if}
        {#if r.note || r.state !== "open"}
          <input class="input note" value={r.note} oninput={(e) => edit(r, { note: e.currentTarget.value })} placeholder="Note (optional)" maxlength="300" aria-label="Note" />
        {/if}
      </div>
    {:else}
      <p class="small muted">Nothing here.</p>
    {/each}

    <div class="panel stack tight">
      <span class="label">Add a row</span>
      <div class="row wrap">
        <input class="input grow" bind:value={newName} placeholder={newIsNew ? "The rival ranch next door" : "A name from the original"} maxlength="200" onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), void addRow())} aria-label="Row name" />
        <select class="select mini" bind:value={newType} aria-label="Type">{#each TYPES as t (t.id)}<option value={t.id}>{t.label}</option>{/each}</select>
        <label class="switch tiny"><input type="checkbox" bind:checked={newIsNew} /> New in this version</label>
        <button class="btn small" onclick={addRow} disabled={!newName.trim()}><Plus size={13} /> Add</button>
      </div>
    </div>
  {/if}

  <div class="row actions">
    <span class="tiny muted grow">{counts.open ? `${counts.open} still open: Mea decides them from the premise.` : "Every row decided."}</span>
    <button class="btn primary" onclick={() => session.act("bible", "/bible")} disabled={Boolean(session.busy) || !v.map.length}>
      {#if session.busy === "bible"}<span class="spin"><Loader size={14} /></span> Writing the bible…{:else}<StepForward size={16} /> {draft.bible.length ? "Rewrite the version's bible" : "Write the version's bible"}{/if}
    </button>
  </div>
</section>

<style>
  .grow {
    flex: 1 1 8rem;
    min-width: 0;
  }
  .row-card {
    padding: 0.55rem 0.7rem;
    display: grid;
    gap: 0.4rem;
  }
  .row-card.open {
    border-left: 3px solid var(--butter, #f5d77a);
  }
  .row-card.dropped .from {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .from {
    overflow-wrap: anywhere;
  }
  .to {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text-muted);
  }
  .to .input {
    flex: 1;
    min-width: 0;
  }
  .note {
    font-size: var(--fs-xs);
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
  }
  .mini {
    width: auto;
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
    font-size: var(--fs-xs);
  }
  .spin {
    display: inline-grid;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
