<script lang="ts">
  /**
   * An ordered choice as a fader with labelled stops. `base` is what applies when nothing is set
   * here (the preset's, the character's, or "normal"); moving off it lights a warm LED and offers a
   * way back. Dragging only commits when you let go, so one move is one save.
   */
  let {
    label,
    help = "",
    value,
    options,
    base = null,
    resetLabel = "",
    onchange,
    onreset,
  }: {
    label: string;
    help?: string;
    value: string;
    options: { value: string; label: string }[];
    base?: string | null;
    resetLabel?: string;
    onchange: (v: string) => void;
    onreset?: () => void;
  } = $props();

  let track = $state<HTMLDivElement | null>(null);
  let drag = $state<number | null>(null);
  const n = $derived(options.length);
  const at = $derived(Math.max(0, options.findIndex((o) => o.value === value)));
  const i = $derived(drag ?? at);
  const pct = $derived(n > 1 ? (i / (n - 1)) * 100 : 0);
  const changed = $derived(base != null && value !== base);
  /** Stops show the short form of a label: "Sealed — only I write them" reads "Sealed". */
  const short = (s: string) => s.split(/ — | \(/)[0]!.trim();
  /** With long or many labels, only the current stop (and the ends, when far from it) is spelled out. */
  const crowded = $derived(n > 5 || options.reduce((t, o) => t + short(o.label).length, 0) > 34);
  const quiet = (k: number) => crowded && k !== i && !((k === 0 || k === n - 1) && Math.abs(k - i) >= 2);
  const baseLabel = $derived(options.find((o) => o.value === base)?.label ?? "");

  function idxAt(x: number) {
    const r = track!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * (n - 1));
  }
  function commit(k: number) {
    const v = options[k]?.value;
    if (v != null && v !== value) onchange(v);
  }
  function down(e: PointerEvent) {
    if (e.button) return;
    track!.setPointerCapture(e.pointerId);
    drag = idxAt(e.clientX);
  }
  function move(e: PointerEvent) {
    if (drag == null || !track!.hasPointerCapture(e.pointerId)) return;
    drag = idxAt(e.clientX);
  }
  function up() {
    if (drag == null) return;
    const k = drag;
    drag = null;
    commit(k);
  }
  function key(e: KeyboardEvent) {
    let k = at;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") k = Math.min(n - 1, at + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") k = Math.max(0, at - 1);
    else if (e.key === "Home") k = 0;
    else if (e.key === "End") k = n - 1;
    else return;
    e.preventDefault();
    commit(k);
  }
</script>

<div class="st-fader">
  <div class="st-f-head">
    <span class="st-f-name">{label}{#if changed}<span class="st-led warm" title="Changed here"></span>{/if}</span>
    <span class="st-f-val" title={options[i]?.label}>{short(options[i]?.label ?? "—")}</span>
  </div>
  {#if help}<p class="st-f-help">{help}</p>{/if}
  <!-- svelte-ignore a11y_no_static_element_interactions (the slider is the cap; the track is a bigger target for the pointer) -->
  <div class="st-track" class:dragging={drag != null} bind:this={track} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={() => (drag = null)}>
    <span class="st-rail"></span>
    <span class="st-fill" style:width="calc({pct}% + 11px)"></span>
    {#each options as o, k (o.value)}<span class="st-tick" style:left="{n > 1 ? (k / (n - 1)) * 100 : 0}%"></span>{/each}
    <button
      class="st-cap"
      type="button"
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={n - 1}
      aria-valuenow={i}
      aria-valuetext={options[i]?.label}
      style:left="{pct}%"
      onkeydown={key}
    ></button>
  </div>
  <div class="st-stops">
    {#each options as o, k (o.value)}
      <button type="button" tabindex="-1" style:left="{n > 1 ? (k / (n - 1)) * 100 : 0}%" aria-current={k === i} class:quiet={quiet(k)} title={o.label} onclick={() => commit(k)}>{short(o.label)}</button>
    {/each}
  </div>
  {#if changed && onreset}<button class="st-link" type="button" onclick={onreset}>{resetLabel || `Back to ${baseLabel}`}</button>{/if}
</div>
