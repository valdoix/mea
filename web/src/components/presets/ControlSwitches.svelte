<script lang="ts">
  import type { ControlValues, PresetControl } from "../../lib/types";

  /**
   * A preset's controls as switches (PROMPT-07). `values` are this layer's own choices; `inherited`
   * are what applies without them (the character's, then the preset's defaults).
   */
  let {
    controls,
    values,
    inherited = {},
    inheritedLabel = "default",
    onchange,
  }: { controls: PresetControl[]; values: ControlValues; inherited?: ControlValues; inheritedLabel?: string; onchange: (id: string, value: boolean | string | null) => void } = $props();

  const effective = (c: PresetControl) => values[c.id] ?? inherited[c.id] ?? c.default;
  const own = (c: PresetControl) => values[c.id] !== undefined;
  const main = $derived(controls.filter((c) => !c.advanced));
  const more = $derived(controls.filter((c) => c.advanced));
</script>

{#snippet control(c: PresetControl)}
  <div class="ctl">
    {#if c.type === "toggle"}
      <label class="switch"><input type="checkbox" checked={effective(c) === true} onchange={(e) => onchange(c.id, e.currentTarget.checked)} /> {c.label}</label>
    {:else if c.type === "text"}
      <label class="field"><span class="small">{c.label}</span>
        <textarea class="textarea mini" rows="2" aria-label={c.label} value={String(effective(c) ?? "")} onchange={(e) => onchange(c.id, e.currentTarget.value.trim())}></textarea>
      </label>
    {:else}
      <label class="row choice"><span class="small">{c.label}</span>
        <select class="select mini" value={String(effective(c))} onchange={(e) => onchange(c.id, e.currentTarget.value)}>
          {#each c.options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
        </select>
      </label>
    {/if}
    <span class="tiny muted">{c.help}{#if own(c)}{" "}<button class="link" onclick={() => onchange(c.id, null)}>Use the {inheritedLabel}</button>{/if}</span>
  </div>
{/snippet}

<div class="controls">
  {#each main as c (c.id)}{@render control(c)}{/each}
  {#if more.length}
    <details class="more">
      <summary class="small">More controls ({more.length})</summary>
      <div class="controls">{#each more as c (c.id)}{@render control(c)}{/each}</div>
    </details>
  {/if}
  {#if !controls.length}<span class="tiny muted">This preset has no controls.</span>{/if}
</div>

<style>
  .controls {
    display: grid;
    gap: 0.55rem;
  }
  .ctl {
    display: grid;
    gap: 0.1rem;
  }
  .choice {
    gap: 0.5rem;
    align-items: center;
  }
  .more > summary {
    cursor: pointer;
    color: var(--text-muted);
    margin-bottom: 0.55rem;
  }
  textarea.mini {
    width: 100%;
  }
  .mini {
    width: auto;
    padding-top: 0.25rem;
    padding-bottom: 0.25rem;
    font-size: var(--fs-xs);
  }
  .link {
    border: 0;
    background: none;
    color: var(--accent-ink);
    cursor: pointer;
    padding: 0;
    font: inherit;
    text-decoration: underline;
  }
</style>
