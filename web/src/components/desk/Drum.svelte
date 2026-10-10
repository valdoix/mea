<script lang="ts">
  /** Many unordered choices (genres) on a strip you scroll sideways; the chosen one sits in the middle. */
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

  let row = $state<HTMLDivElement | null>(null);
  const changed = $derived(base != null && value !== base);
  const current = $derived(options.find((o) => o.value === value));

  function center(smooth: boolean) {
    const b = row?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!row || !b) return;
    row.scrollTo({ left: b.offsetLeft - row.clientWidth / 2 + b.offsetWidth / 2, behavior: smooth ? "smooth" : "auto" });
  }
  let first = true;
  $effect(() => {
    void value;
    const smooth = !first;
    first = false;
    requestAnimationFrame(() => center(smooth));
  });
  function key(e: KeyboardEvent) {
    const i = options.findIndex((o) => o.value === value);
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = options[Math.max(0, Math.min(options.length - 1, i + d))];
    if (next && next.value !== value) onchange(next.value);
    requestAnimationFrame(() => row?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  }
</script>

<div class="st-fader">
  <div class="st-f-head">
    <span class="st-f-name">{label}{#if changed}<span class="st-led warm" title="Changed here"></span>{/if}</span>
    <span class="st-f-val">{current?.label ?? "—"}</span>
  </div>
  {#if help}<p class="st-f-help">{help}</p>{/if}
  <div class="st-drum">
    <div class="st-drum-row" role="radiogroup" aria-label={label} tabindex="-1" bind:this={row} onkeydown={key}>
      {#each options as o (o.value)}
        <button type="button" role="radio" aria-checked={o.value === value} tabindex={o.value === value ? 0 : -1} onclick={() => o.value !== value && onchange(o.value)}>{o.label}</button>
      {/each}
    </div>
  </div>
  {#if changed && onreset}<button class="st-link" type="button" onclick={onreset}>{resetLabel || `Back to ${options.find((o) => o.value === base)?.label ?? "the default"}`}</button>{/if}
</div>
