<script lang="ts">
  import { X } from "../lib/icons";

  let { value = $bindable([]), suggestions = [], placeholder = "Add a tag…" }: { value: string[]; suggestions?: string[]; placeholder?: string } = $props();
  let draft = $state("");
  const listId = `tags-${Math.random().toString(36).slice(2)}`;

  function add(t: string) {
    const tag = t.trim().replace(/,$/, "");
    if (tag && !value.includes(tag)) value = [...value, tag];
    draft = "";
  }
  function onkey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) value = value.slice(0, -1);
  }
</script>

<div class="tags input">
  {#each value as t (t)}
    <span class="chip lavender">{t}<button type="button" onclick={() => (value = value.filter((x) => x !== t))} aria-label="Remove {t}"><X size={12} /></button></span>
  {/each}
  <input bind:value={draft} onkeydown={onkey} onblur={() => draft && add(draft)} {placeholder} list={listId} />
  <datalist id={listId}>
    {#each suggestions.filter((s) => !value.includes(s)) as s (s)}<option value={s}></option>{/each}
  </datalist>
</div>

<style>
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    padding: 0.4rem 0.5rem;
  }
  .tags input {
    flex: 1;
    min-width: 7rem;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    outline: none;
    padding: 0.2rem;
  }
  /* A long tag wraps inside its chip rather than running out of the box. */
  .tags .chip {
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .chip button {
    border: 0;
    background: none;
    color: inherit;
    display: grid;
    place-items: center;
    cursor: pointer;
    padding: 0;
    opacity: 0.7;
  }
</style>
