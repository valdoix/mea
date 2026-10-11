<script lang="ts">
  import { app, saveSetting } from "../../lib/state.svelte";
  import { COLOR_TOKENS, contrast } from "../../lib/roomcolors";

  /**
   * J2: Customise colours: a picker for each colour of the room you're in (paper, text, quiet text,
   * lines, accents, good, warning, danger), separately by day and by night, with Reset for each
   * and Reset all. Contrast is checked as you pick: a warning when text would be hard to read.
   */
  const room = $derived(app.theme);
  let mode = $state<"day" | "night">(app.night || app.dark ? "night" : "day");
  const all = $derived(app.settings?.["appearance.colors"] ?? {});
  const mine = $derived(all[room]?.[mode] ?? {});
  // What the room shows now (yours, or its own), read from the page; refreshed when anything changes.
  let shown = $state<Record<string, string>>({});
  $effect(() => {
    void mine;
    void room;
    void app.night;
    // After the page has taken the new colours.
    const timer = setTimeout(() => {
      const cs = getComputedStyle(document.documentElement);
      shown = Object.fromEntries(COLOR_TOKENS.map((t) => [t.id, toHex(cs.getPropertyValue(`--${t.id}`).trim())]));
    }, 0);
    return () => clearTimeout(timer);
  });
  const live = $derived((app.night || app.dark ? "night" : "day") === mode);

  function toHex(v: string) {
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join("")}`.toLowerCase();
    const m = v.match(/rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/);
    if (m) return `#${[m[1], m[2], m[3]].map((x) => Math.round(Number(x)).toString(16).padStart(2, "0")).join("")}`;
    return "#888888";
  }
  const value = (id: string) => mine[id] ?? shown[id] ?? "#888888";
  function set(id: string, v: string | null) {
    const cur = { ...mine };
    if (v) cur[id] = v;
    else delete cur[id];
    const next = { ...all, [room]: { ...(all[room] ?? {}), [mode]: cur } };
    void saveSetting("appearance.colors", next);
  }
  function resetAll() {
    const next = { ...all, [room]: { ...(all[room] ?? {}), [mode]: {} } };
    void saveSetting("appearance.colors", next);
  }
  const checks = $derived([
    { label: "Text on paper", ratio: contrast(value("text"), value("bg")), min: 4.5 },
    { label: "Quiet text on paper", ratio: contrast(value("text-muted"), value("bg")), min: 3 },
    { label: "Accent on paper", ratio: contrast(value("accent"), value("bg")), min: 3 },
  ]);
</script>

<div class="stack tight">
  <div class="row between wrap">
    <span class="small">Colours of <b>{room}</b>{live ? "" : " (not showing now)"}</span>
    <div class="seg" role="radiogroup" aria-label="Day or night">
      <button type="button" role="radio" aria-checked={mode === "day"} class:on={mode === "day"} onclick={() => (mode = "day")}>Day</button>
      <button type="button" role="radio" aria-checked={mode === "night"} class:on={mode === "night"} onclick={() => (mode = "night")}>Night</button>
    </div>
  </div>
  <div class="grid">
    {#each COLOR_TOKENS as t (t.id)}
      <label class="tok">
        <input type="color" value={value(t.id)} onchange={(e) => set(t.id, e.currentTarget.value)} aria-label={t.label} />
        <span class="grow small">{t.label}{#if mine[t.id]}<span class="tiny faint"> · yours</span>{/if}</span>
        {#if mine[t.id]}<button type="button" class="btn ghost small" onclick={() => set(t.id, null)}>Reset</button>{/if}
      </label>
    {/each}
  </div>
  <div class="checks tiny">
    {#each checks as c (c.label)}<span class:bad={c.ratio < c.min}>{c.label}: {c.ratio.toFixed(1)}:1{c.ratio < c.min ? " — hard to read" : ""}</span>{/each}
  </div>
  {#if Object.keys(mine).length}<button type="button" class="btn ghost small start" onclick={resetAll}>Reset all ({mode})</button>{/if}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    gap: 0.35rem;
  }
  .tok {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.25rem 0.4rem;
    border-radius: 10px;
    background: var(--surface-2, var(--surface));
  }
  .tok input[type="color"] {
    width: 2rem;
    height: 1.6rem;
    border: 0;
    padding: 0;
    background: none;
    cursor: pointer;
  }
  .grow {
    flex: 1;
  }
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    color: var(--text-muted);
  }
  .checks .bad {
    color: var(--danger);
    font-weight: 600;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
  }
  .seg button {
    border: 0;
    background: none;
    color: var(--text-muted);
    padding: 0.2rem 0.7rem;
    cursor: pointer;
  }
  .seg button.on {
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
  .start {
    justify-self: start;
  }
</style>
