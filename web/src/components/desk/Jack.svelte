<script lang="ts">
  import { ChevronDown } from "../../lib/icons";

  /** A routing row: a label, a jack and an LCD that opens a select. */
  let { label, value, options, onchange }: { label: string; value: string; options: { value: string; label: string }[]; onchange: (v: string) => void } = $props();

  const shown = $derived(options.find((o) => o.value === value)?.label ?? options[0]?.label ?? "—");
</script>

<label class="st-jack">
  <span class="st-hole" aria-hidden="true"></span>
  <span class="st-jk">{label}</span>
  <span class="st-jv"><span>{shown}</span><ChevronDown size={14} /></span>
  <select {value} aria-label={label} onchange={(e) => onchange(e.currentTarget.value)}>
    {#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
  </select>
</label>
