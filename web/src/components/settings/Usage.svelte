<script lang="ts">
  import QuotaRing from "../QuotaRing.svelte";
  import Segmented from "../Segmented.svelte";
  import { get } from "../../lib/api";
  import Modal from "../Modal.svelte";
  import { compact, timeAgo } from "../../lib/format";
  import { errorToast } from "../../lib/state.svelte";
  import type { RequestRow } from "../../lib/types";

  interface Summary {
    byDay: { day: string; requests: number; prompt: number; completion: number; cached: number; est: number }[];
    byModel: { model_id: string; billing: string; requests: number; prompt: number; completion: number }[];
    byKind: { kind: string; requests: number; prompt: number }[];
    byChat: { chat_id: string; title: string | null; requests: number; prompt: number }[];
    failures: number;
  }
  let days = $state("7");
  let data = $state<Summary | null>(null);

  interface CacheStats {
    rows: { chatId: string | null; title: string | null; model: string; billing: string; requests: number; promptTokens: number; cachedTokens: number; hitRate: number; cost: number; saved: { quotaTokens: number | null; usd: number | null } }[];
    total: { promptTokens: number; cachedTokens: number; hitRate: number };
  }
  let cache = $state<CacheStats | null>(null);
  let requests = $state<RequestRow[]>([]);
  let task = $state("");
  let more = $state(true);
  let detail = $state<any>(null);
  let detailOpen = $state(false);

  $effect(() => {
    get<Summary>(`/api/usage?days=${days}`)
      .then((d) => (data = d))
      .catch(errorToast);
    get<CacheStats>(`/api/cache-stats?days=${days}`)
      .then((d) => (cache = d))
      .catch(() => (cache = null));
  });

  async function loadRequests(append = false) {
    const before = append ? requests.at(-1)?.startedAt : undefined;
    try {
      const r = await get<{ requests: RequestRow[] }>(`/api/requests?limit=30${task ? `&task=${task}` : ""}${before ? `&before=${before}` : ""}`);
      requests = append ? [...requests, ...r.requests] : r.requests;
      more = r.requests.length === 30;
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void task;
    void loadRequests();
  });

  async function openRequest(r: RequestRow) {
    detail = null;
    detailOpen = true;
    try {
      detail = await get(`/api/requests/${r.id}`);
    } catch (e) {
      detailOpen = false;
      errorToast(e);
    }
  }
  const usd = (n: number | null | undefined) => (n == null ? "" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
  const secs = (ms: number | null) => (ms == null ? "" : `${(ms / 1000).toFixed(1)}s`);

  const max = $derived(Math.max(1, ...(data?.byDay.map((d) => d.prompt || d.est) ?? [1])));
  const total = $derived(data?.byDay.reduce((n, d) => n + (d.prompt || d.est), 0) ?? 0);
  const kindLabel: Record<string, string> = { new: "Replies", swipe: "Regenerations", continue: "Continues", impersonate: "Impersonate", expand: "Expand" };
</script>

<div class="stack">
  <section class="panel row between wrap">
    <div class="row"><QuotaRing size={48} /><div><b>Input tokens</b><div class="tiny muted">{compact(total)} in the last {days} days{data?.failures ? ` · ${data.failures} failed requests` : ""}</div></div></div>
    <Segmented bind:value={days} options={[{ value: "1", label: "Today" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }]} small />
  </section>

  {#if data}
    <section class="panel stack">
      <h2>By day</h2>
      <div class="bars">
        {#each data.byDay as d (d.day)}
          <div class="bar" title="{d.day}: {d.prompt.toLocaleString()} input tokens ({d.requests} requests){d.cached ? `, ${d.cached.toLocaleString()} cached` : ''}">
            <span class="fill" style:height="{((d.prompt || d.est) / max) * 100}%"></span>
            <span class="tiny muted lbl">{d.day.slice(5)}</span>
          </div>
        {:else}
          <p class="tiny muted">Nothing yet.</p>
        {/each}
      </div>
    </section>

    <section class="panel stack tight">
      <h2>By model</h2>
      {#each data.byModel as m (m.model_id + m.billing)}
        <div class="row small"><span class="grow mono truncate">{m.model_id}</span><span class="chip {m.billing === 'subscription' ? 'mint' : 'peach'}">{m.billing}</span><span class="tiny muted">{m.requests} req · {compact(m.prompt)} in · {compact(m.completion)} out</span></div>
      {/each}
    </section>

    {#if cache?.rows.length}
      <section class="panel stack tight">
        <h2>Prompt caching <span class="tiny muted">{Math.round(cache.total.hitRate * 100)}% of story input came from cache</span></h2>
        {#each cache.rows as r (`${r.chatId}:${r.model}:${r.billing}`)}
          <div class="row small wrap">
            <span class="grow truncate">{r.title ?? "Untitled chat"} <span class="tiny faint mono">{r.model}</span></span>
            <span class="tiny muted">{Math.round(r.hitRate * 100)}% cached · {r.requests} req{r.saved.usd ? ` · saved ${usd(r.saved.usd)}` : ""}{r.saved.quotaTokens ? ` · saved ${compact(r.saved.quotaTokens)} quota` : ""}</span>
          </div>
        {/each}
      </section>
    {/if}

    <section class="panel stack tight">
      <h2>By kind</h2>
      {#each data.byKind as k (k.kind)}
        <div class="row small"><span class="grow">{kindLabel[k.kind] ?? k.kind}</span><span class="tiny muted">{k.requests} · {compact(k.prompt)} tokens</span></div>
      {/each}
    </section>
  {/if}

  <section class="panel stack tight">
    <div class="row between wrap">
      <h2>Request history</h2>
      <select class="select narrow" bind:value={task}>
        <option value="">All tasks</option><option value="story">Story</option><option value="summarizer">Memory summaries</option><option value="helper">Helpers</option><option value="embeddings">Embeddings</option><option value="probe">Cache checks</option>
      </select>
    </div>
    {#each requests as r (r.id)}
      <button class="req" onclick={() => openRequest(r)}>
        <span class="chip {r.status === 'done' ? 'mint' : r.status === 'error' ? 'rose' : ''}">{r.task}</span>
        <span class="grow truncate small">{r.chatTitle ?? (r.chatId ? "Chat" : "—")} <span class="tiny faint mono">{r.model ?? ""}</span></span>
        <span class="tiny muted nowrap">{compact(r.promptTokens ?? r.estPromptTokens)} in{r.cachedTokens ? ` (${compact(r.cachedTokens)} cached)` : ""} · {compact(r.completionTokens)} out{r.cost ? ` · ${usd(r.cost)}` : ""} · {timeAgo(r.startedAt)}</span>
      </button>
      {#if r.error}<div class="tiny err">{r.error}</div>{/if}
    {:else}
      <p class="tiny muted">No requests yet.</p>
    {/each}
    {#if more && requests.length}<button class="btn ghost small" onclick={() => loadRequests(true)}>Load older</button>{/if}
  </section>
</div>

<Modal bind:open={detailOpen} title="Request" size="lg">
  {#if !detail}
    <p class="muted">Loading…</p>
  {:else}
    <div class="stack tight">
      <div class="row wrap">
        <span class="chip lavender">{detail.task ?? detail.kind}</span>
        {#if detail.model_id}<span class="chip mono">{detail.model_id}</span>{/if}
        <span class="chip">{detail.billing}</span>
        <span class="chip">{detail.status}</span>
        {#if detail.first_token_at}<span class="chip">first token {secs(detail.first_token_at - detail.started_at)}</span>{/if}
        {#if detail.finished_at}<span class="chip">total {secs(detail.finished_at - detail.started_at)}</span>{/if}
      </div>
      {#if detail.error}<div class="notice error tiny">{detail.error}</div>{/if}
      <pre>{JSON.stringify(detail.request ?? detail, null, 2)}</pre>
      {#if detail.response}<h4>Response</h4><pre>{typeof detail.response === "string" ? detail.response : JSON.stringify(detail.response, null, 2)}</pre>{/if}
    </div>
  {/if}
</Modal>

<style>
  .narrow {
    width: auto;
  }
  .req {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    border: 0;
    border-top: 1px solid var(--border);
    background: none;
    padding: 0.4rem 0;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }
  .nowrap {
    white-space: nowrap;
  }
  .err {
    color: var(--danger);
  }
  pre {
    white-space: pre-wrap;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    background: var(--surface-2);
    padding: 0.7rem;
    border-radius: var(--r-sm);
    max-height: 22rem;
    overflow: auto;
  }
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 0.4rem;
    height: 9rem;
    padding-bottom: 1.2rem;
  }
  .bar {
    flex: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    position: relative;
    max-width: 3rem;
  }
  .fill {
    display: block;
    border-radius: 6px 6px 2px 2px;
    background: linear-gradient(180deg, var(--accent), var(--lavender));
    min-height: 2px;
  }
  .lbl {
    position: absolute;
    bottom: -1.2rem;
    left: 50%;
    translate: -50% 0;
  }
</style>
