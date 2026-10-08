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
</script>

<div class="controls">
  {#each controls as c (c.id)}
    <div class="ctl">
      {#if c.type === "toggle"}
        <label class="switch"><input type="checkbox" checked={effective(c) === true} onchange={(e) => onchange(c.id, e.currentTarget.checked)} /> {c.label}</label>
      {:else}
        <label class="row choice"><span class="small">{c.label}</span>
          <select class="select mini" value={String(effective(c))} onchange={(e) => onchange(c.id, e.currentTarget.value)}>
            {#each c.options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
          </select>
        </label>
      {/if}
      <span class="tiny muted">{c.help}{#if own(c)}{" "}<button class="link" onclick={() => onchange(c.id, null)}>Use the {inheritedLabel}</button>{/if}</span>
    </div>
  {:else}
    <span class="tiny muted">This preset has no controls.</span>
  {/each}
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
