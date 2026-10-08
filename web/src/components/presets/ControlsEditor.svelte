<script lang="ts">
  import { autosize } from "../../lib/gestures";
  import { ChevronDown, ChevronRight, Plus, Trash } from "../../lib/icons";
  import type { PresetControl } from "../../lib/types";

  /**
   * Preset controls (PROMPT-07): friendly switches a preset offers every chat ("More dialogue",
   * "Slow burn"), each with the instruction it adds. Chats and characters flip them without opening
   * the builder; their values land in the "Preset controls" block.
   */
  let { controls = $bindable() }: { controls: PresetControl[] } = $props();
  let open = $state<Record<string, boolean>>({});

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || `c${Date.now().toString(36)}`;

  function add(type: "toggle" | "choice") {
    const id = `${type}-${Date.now().toString(36)}`;
    controls = [
      ...controls,
      type === "toggle"
        ? { id, label: "New switch", help: "", type, default: false, text: "", options: [] }
        : { id, label: "New choice", help: "", type, default: "off", text: "", options: [{ value: "off", label: "Off", text: "" }, { value: "on", label: "On", text: "" }] },
    ];
    open[id] = true;
  }
</script>

<section class="panel stack">
  <div class="row between wrap">
    <h2>Controls</h2>
    <div class="row">
      <button class="btn small" onclick={() => add("toggle")}><Plus size={14} /> Switch</button>
      <button class="btn small" onclick={() => add("choice")}><Plus size={14} /> Choice</button>
    </div>
  </div>
  <p class="tiny muted">Friendly switches every chat using this preset can flip in its panel, and a character can set for all its chats. What's switched on goes into the “Preset controls” block.</p>
  {#each controls as c, i (c.id)}
    <div class="control">
      <div class="row">
        <button class="expand" onclick={() => (open[c.id] = !open[c.id])} aria-expanded={Boolean(open[c.id])}>
          {#if open[c.id]}<ChevronDown size={15} />{:else}<ChevronRight size={15} />{/if}
          <b>{c.label}</b>
          <span class="tiny muted">{c.type === "toggle" ? `switch · ${c.default ? "on" : "off"} by default` : `choice · ${c.options.length} options`}</span>
        </button>
        <button class="btn ghost icon small" onclick={() => (controls = controls.filter((_, j) => j !== i))} aria-label="Remove control"><Trash size={14} /></button>
      </div>
      {#if open[c.id]}
        <div class="stack tight body">
          <div class="row wrap">
            <label class="field grow"><span class="label">Label</span><input class="input" bind:value={c.label} onchange={() => c.id.startsWith(c.type) && (c.id = slug(c.label))} /></label>
            <label class="field grow"><span class="label">Help <span class="faint">shown under the switch</span></span><input class="input" bind:value={c.help} /></label>
          </div>
          {#if c.type === "toggle"}
            <label class="switch"><input type="checkbox" checked={c.default === true} onchange={(e) => (c.default = e.currentTarget.checked)} /> On by default</label>
            <label class="field"><span class="label">Instruction while it's on</span><textarea class="textarea" use:autosize={{ max: 240, value: c.text }} bind:value={c.text}></textarea></label>
          {:else}
            {#each c.options as o, k (k)}
              <div class="row wrap opt">
                <input type="radio" name="def-{c.id}" checked={c.default === o.value} onchange={() => (c.default = o.value)} aria-label="Default" title="Default" />
                <input class="input lbl" bind:value={o.label} onchange={() => (o.value = slug(o.label))} aria-label="Option label" />
                <textarea class="textarea grow" rows="1" bind:value={o.text} placeholder="Instruction (empty adds nothing)"></textarea>
                <button class="btn ghost icon small" onclick={() => (c.options = c.options.filter((_, j) => j !== k))} disabled={c.options.length <= 2} aria-label="Remove option"><Trash size={13} /></button>
              </div>
            {/each}
            <div class="row"><button class="btn ghost small" onclick={() => (c.options = [...c.options, { value: `o${c.options.length + 1}`, label: "Option", text: "" }])}><Plus size={13} /> Option</button><span class="tiny muted">The dot marks the default.</span></div>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <p class="small muted">No controls.</p>
  {/each}
</section>

<style>
  .control {
    border-top: 1px solid var(--border);
    padding-top: 0.4rem;
  }
  .expand {
    flex: 1;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    border: 0;
    background: none;
    font: inherit;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    padding: 0.3rem 0;
    flex-wrap: wrap;
  }
  .body {
    padding: 0.3rem 0 0.6rem 1.4rem;
  }
  .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .opt {
    align-items: center;
  }
  .lbl {
    width: 9rem;
  }
</style>
