<script lang="ts">
  import { get } from "../lib/api";
  import { clock } from "../lib/format";
  import { Search } from "../lib/icons";
  import { navigate, route } from "../lib/router.svelte";
  import type { SearchResult } from "../lib/types";

  /** CHAT-18: search across every chat, with jump-to and highlight. */
  let q = $state(route.query.q ?? "");
  let results = $state<SearchResult[]>([]);
  let loading = $state(false);
  let timer: ReturnType<typeof setTimeout>;

  $effect(() => {
    const query = q.trim();
    clearTimeout(timer);
    if (query.length < 2) {
      results = [];
      return;
    }
    timer = setTimeout(async () => {
      loading = true;
      try {
        results = (await get<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}&limit=150`)).results;
        history.replaceState({}, "", `/search?q=${encodeURIComponent(query)}`);
      } finally {
        loading = false;
      }
    }, 300);
  });

  const parts = (r: SearchResult) => [r.snippet.slice(0, r.match.start), r.snippet.slice(r.match.start, r.match.start + r.match.length), r.snippet.slice(r.match.start + r.match.length)];
</script>

<div class="page">
  <h1>Search</h1>
  <label class="searchbox"><Search size={18} /><input class="input" bind:value={q} placeholder="Search every chat" /></label>
  <p class="tiny muted">{loading ? "Searching…" : q.trim().length >= 2 ? `${results.length} match${results.length === 1 ? "" : "es"}` : "Type at least two letters."}</p>
  <div class="results">
    {#each results as r (r.messageId)}
      {@const [a, m, b] = parts(r)}
      <button class="card hit" onclick={() => navigate(`/chat/${r.chatId}?at=${r.seq}&q=${encodeURIComponent(q.trim())}`)}>
        <div class="row between"><b class="small">{r.characterName ?? r.chatTitle}</b><span class="tiny muted">{r.chatTitle} · #{r.seq} · {clock(r.createdAt)}</span></div>
        <div class="small snippet"><span class="tiny muted">{r.name ?? r.role}:</span> {a}<mark>{m}</mark>{b}</div>
      </button>
    {/each}
  </div>
</div>

<style>
  .page {
    max-width: 48rem;
    margin: 0 auto;
    padding: 1.5rem clamp(1rem, 3vw, 2rem) 5rem;
    display: grid;
    gap: 0.8rem;
  }
  .searchbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .searchbox .input {
    flex: 1;
  }
  .results {
    display: grid;
    gap: 0.5rem;
  }
  .hit {
    text-align: left;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--border);
    cursor: pointer;
    color: inherit;
    display: grid;
    gap: 0.25rem;
  }
  .snippet {
    line-height: 1.5;
  }
</style>
