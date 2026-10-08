<script lang="ts">
  import Segmented from "../components/Segmented.svelte";
  import { get } from "../lib/api";
  import { clock } from "../lib/format";
  import { Search } from "../lib/icons";
  import { navigate, route } from "../lib/router.svelte";
  import type { GlobalHit, SearchResult } from "../lib/types";

  /** CHAT-18 / LIB-05: search every chat word for word, or everything you've made at once. */
  let q = $state(route.query.q ?? "");
  let mode = $state<"all" | "messages">((route.query.mode as "messages") === "messages" ? "messages" : "all");
  let results = $state<SearchResult[]>([]);
  let hits = $state<GlobalHit[]>([]);
  let counts = $state<Record<string, number>>({});
  let loading = $state(false);
  let timer: ReturnType<typeof setTimeout>;

  $effect(() => {
    const query = q.trim();
    const m = mode;
    clearTimeout(timer);
    if (query.length < 2) {
      results = [];
      hits = [];
      return;
    }
    timer = setTimeout(async () => {
      loading = true;
      try {
        if (m === "messages") results = (await get<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}&limit=150`)).results;
        else {
          const r = await get<{ results: GlobalHit[]; counts: Record<string, number> }>(`/api/search/all?q=${encodeURIComponent(query)}&limit=20`);
          hits = r.results;
          counts = r.counts;
        }
        history.replaceState({}, "", `/search?q=${encodeURIComponent(query)}${m === "messages" ? "&mode=messages" : ""}`);
      } finally {
        loading = false;
      }
    }, 300);
  });
  const KIND: Record<string, string> = { message: "Messages", character: "Characters", lore: "Lore", memory: "Memories", summary: "Scenes & chapters" };
  const groups = $derived((["character", "lore", "memory", "summary", "message"] as const).map((k) => ({ k, items: hits.filter((h) => h.kind === k) })).filter((g) => g.items.length));
  const total = $derived(Object.values(counts).reduce((n, x) => n + x, 0));

  const parts = (r: SearchResult) => [r.snippet.slice(0, r.match.start), r.snippet.slice(r.match.start, r.match.start + r.match.length), r.snippet.slice(r.match.start + r.match.length)];
</script>

<div class="page">
  <div class="row between wrap"><h1>Search</h1><Segmented bind:value={mode} small options={[{ value: "all" as const, label: "Everything" }, { value: "messages" as const, label: "Exact words in chats" }]} /></div>
  <label class="searchbox"><Search size={18} /><input class="input" bind:value={q} placeholder={mode === "all" ? "Search chats, characters, lore and memories" : "Search every chat word for word"} /></label>
  <p class="tiny muted">{loading ? "Searching…" : q.trim().length >= 2 ? (mode === "all" ? `${total} result${total === 1 ? "" : "s"}` : `${results.length} match${results.length === 1 ? "" : "es"}`) : "Type at least two letters."}</p>
  {#if mode === "all"}
    {#each groups as g (g.k)}
      <section class="group">
        <h2 class="small muted">{KIND[g.k]} <span class="faint">{g.items.length}</span></h2>
        <div class="results">
          {#each g.items as h (h.kind + h.id)}
            <button class="card hit" onclick={() => navigate(h.link)}>
              <b class="small">{h.title}</b>
              <div class="small snippet muted">{h.snippet}</div>
            </button>
          {/each}
        </div>
      </section>
    {/each}
  {/if}
  <div class="results" class:hidden={mode === "all"}>
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
  .group {
    display: grid;
    gap: 0.4rem;
  }
  .group h2 {
    margin: 0.4rem 0 0;
  }
  .hidden {
    display: none;
  }
</style>
