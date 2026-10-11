<script lang="ts" module>
  /**
   * A status lamp: a count (or a short value) that lights when it needs a look, and opens what it
   * counts. Shared by the Memory panel and the Chat tab's Status (P1).
   */
  export type Lamp = {
    n: number;
    label: string;
    tone: "amber" | "red" | "blue";
    href?: string;
    onclick?: () => void;
    title?: string;
    /** Shown instead of the count ("5/6", "20 min"). The lamp still lights by `n`. */
    value?: string;
  };
</script>

<script lang="ts">
  let { lamps }: { lamps: Lamp[] } = $props();
</script>

<div class="annun">
  {#each lamps as l (l.label)}
    {#if l.href && l.n}
      <a class="lamp {l.tone}" href={l.href} title={l.title}><span class="st-led" class:warm={l.tone === "amber"} class:bad={l.tone === "red"} class:on={l.tone === "blue"}></span><b>{l.value ?? l.n}</b>{l.label}</a>
    {:else if l.onclick && l.n}
      <button type="button" class="lamp {l.tone}" onclick={l.onclick} title={l.title}><span class="st-led" class:warm={l.tone === "amber"} class:bad={l.tone === "red"} class:on={l.tone === "blue"}></span><b>{l.value ?? l.n}</b>{l.label}</button>
    {:else}
      <div class="lamp" class:amber={l.n && l.tone === "amber"} class:red={l.n && l.tone === "red"} class:blue={l.n && l.tone === "blue"} title={l.n ? l.title : undefined}><span class="st-led" class:warm={l.n && l.tone === "amber"}></span><b>{l.value ?? l.n}</b>{l.label}</div>
    {/if}
  {/each}
</div>

<style>
  .annun {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }
  .lamp {
    position: relative;
    display: grid;
    align-content: start;
    justify-items: start;
    gap: 3px;
    min-width: 0;
    padding: 8px 9px 7px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: var(--st-inset-sm);
    color: var(--text-faint);
    font-size: 10.5px;
    font-weight: 700;
    line-height: 1.2;
    text-decoration: none;
    overflow-wrap: anywhere;
    border: 0;
    font-family: inherit;
    text-align: start;
  }
  .lamp b {
    font: 400 calc(15px * var(--st-lcd-k)) / 1 var(--st-lcd);
    color: var(--text-faint);
  }
  .lamp .st-led {
    position: absolute;
    top: 8px;
    right: 8px;
  }
  .lamp.amber {
    background: color-mix(in srgb, var(--st-warm) 22%, var(--st-well));
    color: var(--text);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--st-warm) 70%, transparent),
      0 0 14px -4px var(--st-warm);
  }
  .lamp.amber b {
    color: var(--warn);
  }
  .lamp.red {
    background: color-mix(in srgb, var(--danger) 16%, var(--st-well));
    color: var(--text);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--danger) 70%, transparent),
      0 0 14px -4px var(--danger);
  }
  .lamp.red b {
    color: var(--danger);
  }
  .lamp.blue {
    background: color-mix(in srgb, var(--accent) 14%, var(--st-well));
    color: var(--text);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent);
  }
  .lamp.blue b {
    color: var(--accent-ink);
  }
  a.lamp,
  button.lamp {
    cursor: pointer;
  }
  a.lamp:hover,
  button.lamp:hover {
    filter: brightness(1.06);
  }
  a.lamp:focus-visible,
  button.lamp:focus-visible {
    outline: 1.5px solid var(--text);
    outline-offset: 1px;
  }

</style>
