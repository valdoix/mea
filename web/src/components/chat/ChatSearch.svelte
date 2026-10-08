<script lang="ts">
  import { get } from "../../lib/api";
  import { ChevronDown, ChevronUp, Search, X } from "../../lib/icons";
  import type { SearchResult } from "../../lib/types";

  /** CHAT-18: search within this chat, step through hits, jump to each. */
  let { chatId, onclose, onjump }: { chatId: string; onclose: () => void; onjump: (seq: number, q: string) => void } = $props();

  let q = $state("");
  let results = $state<SearchResult[]>([]);
  let at = $state(0);
  let input = $state<HTMLInputElement | null>(null);
  let timer: ReturnType<typeof setTimeout>;

  $effect(() => {
    input?.focus();
  });
  $effect(() => {
    const query = q.trim();
    clearTimeout(timer);
    if (query.length < 2) {
      results = [];
      return;
    }
    timer = setTimeout(async () => {
      try {
        results = (await get<{ results: SearchResult[] }>(`/api/search?chatId=${chatId}&q=${encodeURIComponent(query)}&limit=200`)).results;
        at = results.length - 1;
        if (results[at]) onjump(results[at]!.seq, query);
      } catch {
        results = [];
      }
    }, 300);
  });

  function go(d: -1 | 1) {
    if (!results.length) return;
    at = (at + d + results.length) % results.length;
    onjump(results[at]!.seq, q.trim());
  }
</script>

<div class="search-bar">
  <Search size={16} />
  <input
    class="input"
    bind:this={input}
    bind:value={q}
    placeholder="Search this chat"
    onkeydown={(e) => {
      if (e.key === "Enter") go(e.shiftKey ? 1 : -1);
      if (e.key === "Escape") onclose();
    }}
  />
  <span class="tiny muted count">{results.length ? `${at + 1}/${results.length}` : q.trim().length >= 2 ? "0" : ""}</span>
  <button class="btn ghost icon small" onclick={() => go(-1)} disabled={!results.length} aria-label="Earlier match"><ChevronUp size={16} /></button>
  <button class="btn ghost icon small" onclick={() => go(1)} disabled={!results.length} aria-label="Later match"><ChevronDown size={16} /></button>
  <a class="tiny" href="/search?q={encodeURIComponent(q)}">All chats</a>
  <button class="btn ghost icon small" onclick={onclose} aria-label="Close search"><X size={16} /></button>
</div>

<style>
  .search-bar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.8rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .search-bar .input {
    flex: 1;
    min-width: 0;
    padding: 0.35rem 0.6rem;
  }
  .count {
    min-width: 2.5rem;
    text-align: right;
  }
</style>
