<script lang="ts">
  import Segmented from "../../Segmented.svelte";
  import { SlidersHorizontal } from "../../../lib/icons";
  import { LORE_TYPES, type StudioSession } from "../../../lib/studio.svelte";
  import type { LoreType, StudioOptions } from "../../../lib/types";

  let { session, open = false }: { session: StudioSession; open?: boolean } = $props();
  const o = $derived(session.draft!.options);

  function set<K extends keyof StudioOptions>(k: K, v: StudioOptions[K], delay = 0) {
    session.draft!.options[k] = v;
    session.save({ options: { ...$state.snapshot(session.draft!.options) } }, "options", delay);
  }
  function toggleType(t: LoreType) {
    set("types", o.types.includes(t) ? o.types.filter((x) => x !== t) : [...o.types, t]);
  }
</script>

<details class="panel" {open}>
  <summary class="small"><SlidersHorizontal size={15} /> <b>Shape of the lorebook</b> <span class="muted">{o.size === "complete" ? "everything" : o.size} · {o.length} entries{session.draft!.basedOn ? ` · ${session.draft!.basedOn}` : ""}{o.types.length ? ` · ${o.types.length} kinds` : ""}{o.tone ? ` · ${o.tone}` : ""}</span></summary>
  <div class="stack body">
    <div class="grid">
      <div class="field">
        <span class="label">How many entries</span>
        <Segmented value={o.size} options={[{ value: "small", label: "About 8" }, { value: "medium", label: "About 15" }, { value: "large", label: "About 26" }, { value: "complete", label: "Everything" }]} onchange={(v) => set("size", v)} small />
        {#if o.size === "complete"}<span class="hint">Every person, place and thing the census finds (canon included), planned in batches.</span>{/if}
      </div>
      <div class="field">
        <span class="label">Entry length</span>
        <Segmented value={o.length} options={[{ value: "lean", label: "Lean" }, { value: "standard", label: "Standard" }, { value: "rich", label: "Rich" }]} onchange={(v) => set("length", v)} small />
      </div>
    </div>
    <div class="field">
      <span class="label">Kinds of entries <span class="faint">none picked = any</span></span>
      <div class="row wrap types">
        {#each LORE_TYPES as t (t.value)}
          <button class="chip toggle {o.types.includes(t.value) ? t.chip || 'butter' : ''}" class:on={o.types.includes(t.value)} onclick={() => toggleType(t.value)} aria-pressed={o.types.includes(t.value)}><t.icon size={12} /> {t.plural}</button>
        {/each}
      </div>
    </div>
    <label class="field">
      <span class="label">Based on <span class="faint">an existing work; its canon fills the gaps</span></span>
      <input class="input" value={session.draft!.basedOn} oninput={(e) => { session.draft!.basedOn = e.currentTarget.value; session.save({ basedOn: e.currentTarget.value }, "basedOn"); }} placeholder="Yellowjackets (TV series) · empty for an original world" />
    </label>
    <div class="grid">
      <label class="field"><span class="label">Tone and genre</span><input class="input" value={o.tone} oninput={(e) => set("tone", e.currentTarget.value, 600)} placeholder="quiet gothic, cozy fantasy, hard sci-fi…" /></label>
      <label class="field"><span class="label">Style notes for entries</span><input class="input" value={o.style} oninput={(e) => set("style", e.currentTarget.value, 600)} placeholder="British spelling; no modern slang" /></label>
    </div>
    <div class="row wrap toggles">
      <label class="switch"><input type="checkbox" checked={o.secrets} onchange={(e) => set("secrets", e.currentTarget.checked)} /> Invent secrets (with who knows them)</label>
      <label class="switch"><input type="checkbox" checked={o.faithful} onchange={(e) => set("faithful", e.currentTarget.checked)} /> Only what the source says</label>
      <label class="switch"><input type="checkbox" checked={o.overview} onchange={(e) => set("overview", e.currentTarget.checked)} /> Save the overview as an always-on entry</label>
    </div>
  </div>
</details>

<style>
  summary {
    cursor: pointer;
  }
  .body {
    margin-top: 0.8rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.8rem;
  }
  .types {
    gap: 0.35rem;
  }
  .toggle {
    cursor: pointer;
    border: 1px solid var(--border);
    font: inherit;
    font-size: var(--fs-xs);
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    opacity: 0.75;
  }
  .toggle.on {
    opacity: 1;
    border-color: transparent;
    font-weight: 700;
  }
  .toggles {
    gap: 1rem;
  }
</style>
