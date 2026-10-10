<script lang="ts">
  import Drum from "../desk/Drum.svelte";
  import Fader from "../desk/Fader.svelte";
  import Flip from "../desk/Flip.svelte";
  import { ChevronDown } from "../../lib/icons";
  import type { ControlValues, PresetControl } from "../../lib/types";

  /**
   * A preset's controls on the Studio desk (PROMPT-07): ordered choices are faders, long lists of
   * choices (genres) a drum, toggles flip switches. `values` are this chat's own choices;
   * `inherited` are what applies without them (the character's, then the preset's defaults).
   */
  let {
    controls,
    values,
    inherited = {},
    inheritedLabel = "default",
    onchange,
  }: { controls: PresetControl[]; values: ControlValues; inherited?: ControlValues; inheritedLabel?: string; onchange: (id: string, value: boolean | string | null) => void } = $props();

  const base = (c: PresetControl) => inherited[c.id] ?? c.default;
  const effective = (c: PresetControl) => values[c.id] ?? base(c);
  const own = (c: PresetControl) => values[c.id] !== undefined && values[c.id] !== base(c);
  const main = $derived(controls.filter((c) => !c.advanced));
  const more = $derived(controls.filter((c) => c.advanced));
  const reset = (c: PresetControl) => {
    const o = c.options.find((x) => x.value === base(c));
    return `Back to the ${inheritedLabel}${o ? `: ${o.label}` : ""}`;
  };
</script>

{#snippet control(c: PresetControl)}
  {#if c.type === "toggle"}
    <div class="st-fader">
      <Flip checked={effective(c) === true} onchange={(on) => onchange(c.id, on)}><b class="ctl-name">{c.label}</b>{#if own(c)}<span class="st-led warm" title="Changed here"></span>{/if}</Flip>
      {#if c.help}<p class="st-f-help">{c.help}</p>{/if}
      {#if own(c)}<button class="st-link" type="button" onclick={() => onchange(c.id, null)}>Back to the {inheritedLabel}</button>{/if}
    </div>
  {:else if c.type === "text"}
    <div class="st-fader">
      <div class="st-f-head"><span class="st-f-name">{c.label}{#if own(c)}<span class="st-led warm" title="Changed here"></span>{/if}</span></div>
      {#if c.help}<p class="st-f-help">{c.help}</p>{/if}
      <textarea class="st-plain" rows="2" aria-label={c.label} value={String(effective(c) ?? "")} onchange={(e) => onchange(c.id, e.currentTarget.value.trim())}></textarea>
      {#if own(c)}<button class="st-link" type="button" onclick={() => onchange(c.id, null)}>Back to the {inheritedLabel}</button>{/if}
    </div>
  {:else if c.options.length > 6}
    <Drum label={c.label} help={c.help} value={String(effective(c))} options={c.options} base={String(base(c))} resetLabel={reset(c)} onchange={(v) => onchange(c.id, v)} onreset={() => onchange(c.id, null)} />
  {:else}
    <Fader label={c.label} help={c.help} value={String(effective(c))} options={c.options} base={String(base(c))} resetLabel={reset(c)} onchange={(v) => onchange(c.id, v)} onreset={() => onchange(c.id, null)} />
  {/if}
{/snippet}

<div class="desk">
  {#each main as c (c.id)}{@render control(c)}{/each}
  {#if more.length}
    <details class="rack">
      <summary class="st-key"><span>Advanced rack · {more.length} more</span><ChevronDown size={14} /></summary>
      <div class="desk inner">{#each more as c (c.id)}{@render control(c)}{/each}</div>
    </details>
  {/if}
  {#if !controls.length}<p class="st-hint">This preset has no controls.</p>{/if}
</div>

<style>
  .desk {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .desk > :global(.st-fader + .st-fader) {
    margin-top: 16px;
  }
  .rack {
    margin-top: 16px;
  }
  .rack > summary {
    list-style: none;
    width: 100%;
    justify-content: space-between;
  }
  .rack > summary::-webkit-details-marker {
    display: none;
  }
  .rack > summary :global(svg) {
    transition: transform 0.2s var(--ease);
  }
  .rack[open] > summary :global(svg) {
    transform: rotate(180deg);
  }
  .inner {
    margin-top: 14px;
  }
  .ctl-name {
    font-size: 13px;
  }
</style>
