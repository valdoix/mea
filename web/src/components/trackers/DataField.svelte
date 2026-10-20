<script lang="ts">
  import { opened } from "../../lib/gestures";
  import Self from "./DataField.svelte";
  import { PERSON_KEYS } from "../../lib/dataedit";
  import { Plus, X } from "../../lib/icons";

  /** One field of a record, edited in place on `obj[k]` (a $state draft): text, numbers, switches, lists and nested records. */
  let { obj, k, people, depth = 0, onremove }: { obj: any; k: string | number; people: { id: string; name: string }[]; depth?: number; onremove?: () => void } = $props();

  const v = $derived(obj[k]);
  const kind = $derived(v === null || v === undefined ? "empty" : Array.isArray(v) ? "list" : typeof v);
  const label = $derived(typeof k === "number" ? `#${k + 1}` : k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());
  const personRef = $derived(typeof k === "string" && PERSON_KEYS.has(k));
  const long = $derived(typeof v === "string" && (v.length > 70 || v.includes("\n")));
  // Long histories start folded so a record stays readable.
  const folded = $derived(depth > 0 || k === "history" || k === "custody" || k === "journal" || k === "stances");
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name;

  function addItem() {
    const list = obj[k] as unknown[];
    const sample = list.find((x) => x != null);
    if (sample && typeof sample === "object") list.push(Object.fromEntries(Object.entries(sample).map(([kk, vv]) => [kk, typeof vv === "number" ? 0 : typeof vv === "boolean" ? false : Array.isArray(vv) ? [] : typeof vv === "object" ? null : ""])));
    else list.push(typeof sample === "number" ? 0 : "");
  }
</script>

{#if kind === "object" || kind === "list"}
  <details class="group" use:opened={!folded}>
    <summary class="tiny">
      <b>{label}</b>
      <span class="faint">{kind === "list" ? `${v.length} ${v.length === 1 ? "entry" : "entries"}` : ""}</span>
      {#if onremove}<button type="button" class="btn ghost icon tiny-b" onclick={onremove} aria-label="Remove {label}"><X size={12} /></button>{/if}
    </summary>
    <div class="kids">
      {#if kind === "list"}
        {#each v as _, i (i)}
          <Self obj={v} k={i} {people} depth={depth + 1} onremove={() => v.splice(i, 1)} />
        {/each}
        <button type="button" class="btn ghost small add" onclick={addItem}><Plus size={12} /> Add</button>
      {:else}
        {#each Object.keys(v) as kk (kk)}
          <Self obj={v} k={kk} {people} depth={depth + 1} onremove={() => delete v[kk]} />
        {/each}
      {/if}
    </div>
  </details>
{:else}
  <div class="row field-row">
    <span class="tiny key" title={String(k)}>{label}</span>
    {#if kind === "boolean"}
      <input type="checkbox" checked={v} onchange={(e) => (obj[k] = e.currentTarget.checked)} />
    {:else if kind === "number"}
      <input class="input small grow" type="number" step="any" value={v} oninput={(e) => (obj[k] = e.currentTarget.value === "" ? null : Number(e.currentTarget.value))} />
    {:else if personRef && people.length}
      <input class="input small grow" list="data-people" value={v ?? ""} oninput={(e) => (obj[k] = e.currentTarget.value)} />
      {#if v && nameOf(v)}<span class="tiny faint">{nameOf(v)}</span>{/if}
    {:else if long}
      <textarea class="textarea small grow" rows="3" value={v ?? ""} oninput={(e) => (obj[k] = e.currentTarget.value)}></textarea>
    {:else}
      <input class="input small grow" value={v ?? ""} oninput={(e) => (obj[k] = e.currentTarget.value)} />
    {/if}
    {#if onremove}<button type="button" class="btn ghost icon tiny-b" onclick={onremove} aria-label="Remove {label}"><X size={12} /></button>{/if}
  </div>
{/if}

<style>
  .group {
    border-left: 2px solid var(--border);
    padding-left: 0.5rem;
    margin: 0.15rem 0;
  }
  summary {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.15rem 0;
  }
  .kids {
    display: grid;
    gap: 0.25rem;
    padding: 0.2rem 0 0.3rem;
  }
  .field-row {
    gap: 0.5rem;
    align-items: center;
  }
  .key {
    width: 7.5rem;
    flex: none;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .input.small,
  .textarea.small {
    padding: 0.3rem 0.5rem;
    font-size: 0.85rem;
    min-width: 0;
  }
  .tiny-b {
    width: 1.4rem;
    height: 1.4rem;
    min-height: 0;
    padding: 0;
    flex: none;
  }
  .add {
    justify-self: start;
  }
  @media (max-width: 560px) {
    .key {
      width: 5.5rem;
    }
  }
</style>
