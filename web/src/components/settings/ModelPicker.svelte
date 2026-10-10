<script lang="ts">
  import { post } from "../../lib/api";
  import { compact } from "../../lib/format";
  import { Search, Star } from "../../lib/icons";
  import type { ModelInfo } from "../../lib/types";

  let { models, value = $bindable(), onpick }: { models: ModelInfo[]; value: string | null; onpick?: (m: ModelInfo) => void } = $props();

  let q = $state("");
  const filtered = $derived.by(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return models
      .filter((m) => words.every((w) => `${m.id} ${m.name}`.toLowerCase().includes(w)))
      .sort((a, b) => Number(b.starred) - Number(a.starred) || Number(b.id === value) - Number(a.id === value) || a.name.localeCompare(b.name));
  });

  async function star(m: ModelInfo, e: Event) {
    e.stopPropagation();
    m.starred = !m.starred;
    await post("/api/models/star", { connectionId: m.connectionId, modelId: m.id, starred: m.starred }).catch(() => (m.starred = !m.starred));
  }
</script>

<div class="picker">
  <label class="search input"><Search size={15} /><input bind:value={q} placeholder="Search {models.length} models (e.g. glm 5.3)" /></label>
  <div class="list">
    {#each filtered.slice(0, 120) as m (m.connectionId + m.id)}
      <div
        class="m"
        class:on={m.id === value}
        role="option"
        tabindex="0"
        aria-selected={m.id === value}
        onclick={() => {
          value = m.id;
          onpick?.(m);
        }}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            value = m.id;
            onpick?.(m);
          }
        }}
      >
        <button class="star" class:on={m.starred} onclick={(e) => star(m, e)} aria-label={m.starred ? "Unstar" : "Star"}><Star size={14} fill={m.starred ? "currentColor" : "none"} /></button>
        <span class="grow">
          <span class="name truncate">{m.name}</span>
          <span class="id truncate">{m.id}</span>
        </span>
        <span class="badges">
          {#if m.subscription}<span class="chip mint">subscription</span>{:else}<span class="chip peach">pay-as-you-go</span>{/if}
          {#if m.contextLength}<span class="chip">{compact(m.contextLength)} ctx</span>{/if}
          {#if m.capabilities.reasoning}<span class="chip lavender">thinks</span>{/if}
          {#if m.capabilities.vision}<span class="chip sky">vision</span>{/if}
        </span>
      </div>
    {:else}
      <p class="tiny muted" style="padding:.8rem">No models. Try syncing the connection.</p>
    {/each}
    {#if filtered.length > 120}<p class="tiny muted" style="padding:.5rem .8rem">{filtered.length - 120} more: refine your search.</p>{/if}
  </div>
</div>

<style>
  .picker {
    display: grid;
    gap: 0.5rem;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    border-radius: var(--r-pill);
    padding: 0.45rem 0.85rem;
  }
  .search input {
    border: 0;
    background: none;
    outline: none;
    font: inherit;
    color: var(--text);
    width: 100%;
  }
  .list {
    max-height: 18rem;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
  }
  .m {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
  }
  .m:last-child {
    border-bottom: 0;
  }
  .m:hover {
    background: var(--surface-2);
  }
  .m.on {
    background: color-mix(in srgb, var(--accent) 22%, var(--surface));
  }
  .grow {
    display: grid;
    min-width: 0;
  }
  .name {
    font-weight: 700;
    font-size: var(--fs-sm);
  }
  .id {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--text-muted);
  }
  .badges {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    justify-content: flex-end;
    max-width: 50%;
  }
  .star {
    border: 0;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
    display: grid;
    place-items: center;
    padding: 0.2rem;
  }
  .star.on {
    color: var(--accent-ink);
  }
  @media (max-width: 760px) {
    .badges .chip:nth-child(n + 3) {
      display: none;
    }
  }
</style>
