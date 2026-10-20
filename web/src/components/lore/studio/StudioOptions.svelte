<script lang="ts">
  import Segmented from "../../Segmented.svelte";
  import { get } from "../../../lib/api";
  import { SlidersHorizontal } from "../../../lib/icons";
  import { kindsByShelf, type Shelf } from "../../../lib/lorecats";
  import type { StudioSession } from "../../../lib/studio.svelte";
  import type { MixLevel, StudioOptions, StudioRecipe } from "../../../lib/types";

  let { session, open = false }: { session: StudioSession; open?: boolean } = $props();
  const o = $derived(session.draft!.options);

  function set<K extends keyof StudioOptions>(k: K, v: StudioOptions[K], delay = 0) {
    session.draft!.options[k] = v;
    session.save({ options: { ...$state.snapshot(session.draft!.options) } }, "options", delay);
  }

  // ---------- docs/17: recipes and the mix ----------
  let recipes = $state<StudioRecipe[]>([]);
  $effect(() => {
    get<{ recipes: StudioRecipe[] }>("/api/lore-studio-recipes").then((r) => (recipes = r.recipes), () => {});
  });
  // Solid shelf colours (a room's chips can be see-through).
  const HUE: Record<Shelf, string> = { ground: "var(--butter)", people: "var(--rose)", world: "var(--sky)", time: "var(--mint)", scenes: "var(--lavender)" };
  const STEPS: (MixLevel | undefined)[] = [undefined, "few", "each", "all"];
  const LEVEL: Record<MixLevel, string> = { few: "a few", each: "each", all: "all" };
  const LEVEL_HINT: Record<MixLevel, string> = { few: "a handful", each: "one per core person (or place, or group)", all: "every one the material supports" };
  const mixCount = $derived(Object.keys(o.mix ?? {}).length);
  const estimate = $derived(Object.values(o.mix ?? {}).reduce((n, l) => n + ({ few: 2, each: 4, all: 7 } as const)[l!], 0));
  const recipeName = $derived(recipes.find((r) => r.id === o.recipe)?.label ?? "");

  function pickRecipe(r: StudioRecipe) {
    const same = o.recipe === r.id;
    session.draft!.options.mix = same ? {} : { ...r.mix };
    session.draft!.options.recipe = same ? "" : r.id;
    session.save({ options: { ...$state.snapshot(session.draft!.options) } }, "options", 0);
  }
  function step(kind: string) {
    const cur = o.mix?.[kind];
    const next = STEPS[(STEPS.indexOf(cur) + 1) % STEPS.length];
    const mix = { ...o.mix };
    if (next) mix[kind] = next;
    else delete mix[kind];
    session.draft!.options.mix = mix;
    session.draft!.options.recipe = "";
    session.save({ options: { ...$state.snapshot(session.draft!.options) } }, "options", 300);
  }
</script>

<details class="panel" {open}>
  <summary class="small"><SlidersHorizontal size={15} /> <b>Shape of the lorebook</b> <span class="muted">{o.size === "complete" ? "everything" : o.size} · {o.length} entries{recipeName ? ` · ${recipeName}` : ""}{mixCount ? ` · ${mixCount} kinds, about ${estimate} entries` : ""}{session.draft!.basedOn ? ` · ${session.draft!.basedOn}` : ""}{o.tone ? ` · ${o.tone}` : ""}</span></summary>
  <div class="stack body">
    <div class="field">
      <span class="label">Recipe <span class="faint">sets the mix below; tap again to clear</span></span>
      <div class="recipes">
        {#each recipes as r (r.id)}
          <button class="recipe" class:on={o.recipe === r.id} onclick={() => pickRecipe(r)} aria-pressed={o.recipe === r.id}><b>{r.label}</b><span class="tiny muted">{r.blurb}</span></button>
        {/each}
      </div>
    </div>
    <div class="field">
      <span class="label">The mix <span class="faint">{mixCount ? "tap a kind to step it: off, a few, each, all" : "none picked: the planner decides. Tap a kind to step it"}</span></span>
      <div class="shelves">
        {#each kindsByShelf as s (s.id)}
          <div class="shelf">
            <span class="sname small">{s.label}</span>
            <div class="row wrap kinds">
              {#each s.kinds as k (k.id)}
                {@const lvl = o.mix?.[k.id]}
                <button class="kind" style:--hue={HUE[s.id]} class:on={Boolean(lvl)} onclick={() => step(k.id)} title={`${k.hint}${lvl ? ` · ${LEVEL_HINT[lvl]}` : ""}`} aria-label={`${k.label}: ${lvl ? LEVEL[lvl] : "off"}`}>
                  {k.label}<span class="dial" aria-hidden="true">{#each [1, 2, 3] as n (n)}<i class:lit={lvl && STEPS.indexOf(lvl) >= n}></i>{/each}</span>{#if lvl}<span class="lvl">{LEVEL[lvl]}</span>{/if}
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
      {#if mixCount}<span class="hint">People, places, groups and things the census finds are always planned.</span>{/if}
    </div>
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
  .recipes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: 0.4rem;
  }
  .recipe {
    display: grid;
    align-content: start;
    gap: 0.1rem;
    text-align: left;
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .recipe.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent);
  }
  .shelves {
    display: grid;
    gap: 0.35rem;
  }
  .shelf {
    display: grid;
    grid-template-columns: 7rem 1fr;
    gap: 0.5rem;
    align-items: start;
    padding-top: 0.35rem;
    border-top: 1px solid var(--border);
  }
  .sname {
    font-weight: 600;
    padding-top: 0.2rem;
  }
  .kinds {
    gap: 0.3rem;
  }
  .kind {
    cursor: pointer;
    border: 1px solid var(--border);
    border-radius: var(--r-pill);
    padding: 0.15rem 0.6rem;
    background: var(--surface);
    color: var(--text-muted, inherit);
    font: inherit;
    font-size: var(--fs-xs);
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .kind.on {
    background: color-mix(in srgb, var(--hue) 45%, var(--surface));
    font-weight: 700;
    color: var(--text);
  }
  .dial {
    display: inline-flex;
    gap: 2px;
  }
  .dial i {
    width: 4px;
    height: 9px;
    border-radius: 2px;
    background: color-mix(in srgb, currentColor 22%, transparent);
  }
  .dial i.lit {
    background: currentColor;
  }
  .lvl {
    font-weight: 600;
    opacity: 0.8;
  }
  .toggles {
    gap: 1rem;
  }
  @media (max-width: 560px) {
    .shelf {
      grid-template-columns: 1fr;
      gap: 0.25rem;
    }
  }
</style>
