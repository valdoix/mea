<script lang="ts" generics="Id extends string">
  import { FONT_GROUPS, ensureFont, type FontChoice, type FontGroup } from "../../lib/fontcatalog";

  /** A long list of fonts: filter by kind or name; each font's files load as its card scrolls into view. */
  let { label, fonts, value, sample, onpick }: { label: string; fonts: FontChoice<Id>[]; value: string | undefined; sample: string; onpick: (id: Id) => void } = $props();

  let q = $state("");
  let group = $state<FontGroup | "all">("all");
  let more = $state(false);

  const current = $derived(fonts.find((f) => f.id === value) ?? fonts[0]);
  const groups = $derived(FONT_GROUPS.filter((g) => fonts.some((f) => f.group === g.id)));
  const shown = $derived(
    fonts.filter((f) => (group === "all" || !f.group || f.group === group) && (!q.trim() || `${f.label} ${f.note}`.toLowerCase().includes(q.trim().toLowerCase()))),
  );
  const list = $derived(more || q.trim() || group !== "all" ? shown : shown.slice(0, 9));

  function inView(el: HTMLElement, f: FontChoice<Id>) {
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        ensureFont(f);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return { destroy: () => io.disconnect() };
  }
</script>

<div class="field">
  <span class="label">{label} <span class="faint">{current?.label}</span></span>
  <div class="filters">
    <input class="input find" type="search" placeholder="Find a font" aria-label="Find a font: {label}" bind:value={q} />
    <div class="kinds" role="group" aria-label="Kinds of font">
      <button type="button" class="kind" class:on={group === "all"} onclick={() => (group = "all")}>All</button>
      {#each groups as g (g.id)}<button type="button" class="kind" class:on={group === g.id} onclick={() => (group = g.id)}>{g.label}</button>{/each}
    </div>
  </div>
  <div class="fonts" role="radiogroup" aria-label={label}>
    {#each list as f (f.id)}
      <button type="button" class="font" class:on={value === f.id} role="radio" aria-checked={value === f.id} onclick={() => onpick(f.id)} use:inView={f}>
        <span class="face" style:font-family={f.family || undefined}>{sample}</span>
        <b>{f.label}</b><span class="note">{f.note}</span>
      </button>
    {:else}
      <p class="tiny muted">No font by that name.</p>
    {/each}
  </div>
  {#if list.length < shown.length}<button type="button" class="btn ghost small all" onclick={() => (more = true)}>Show all {shown.length}</button>{/if}
</div>

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .find {
    flex: 0 1 12rem;
    min-width: 8rem;
  }
  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .kind {
    min-height: 2rem;
    padding: 0 0.7rem;
    border-radius: var(--r-pill);
    border: 1px solid var(--border);
    background: none;
    color: var(--text-muted);
    font: 600 var(--fs-xs) var(--font-ui);
    cursor: pointer;
  }
  .kind:hover {
    color: var(--text);
  }
  .kind.on {
    background: var(--surface-2);
    border-color: var(--accent);
    color: var(--text);
  }
  .fonts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
    gap: 0.5rem;
  }
  .font {
    display: grid;
    gap: 0.15rem;
    align-content: start;
    text-align: left;
    padding: 0.65rem 0.75rem;
    border-radius: var(--r-md, 14px);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    font: inherit;
    transition: border-color 0.2s, background 0.2s;
  }
  .font:hover {
    background: var(--surface-2);
  }
  .font.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .face {
    font-size: 1.15rem;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .font b {
    font-size: var(--fs-sm);
  }
  .note {
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .all {
    justify-self: start;
    margin-top: 0.4rem;
  }
</style>
