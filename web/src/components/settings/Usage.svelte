<script lang="ts">
  import QuotaRing from "../QuotaRing.svelte";
  import Segmented from "../Segmented.svelte";
  import { get } from "../../lib/api";
  import { compact } from "../../lib/format";
  import { errorToast } from "../../lib/state.svelte";

  interface Summary {
    byDay: { day: string; requests: number; prompt: number; completion: number; cached: number; est: number }[];
    byModel: { model_id: string; billing: string; requests: number; prompt: number; completion: number }[];
    byKind: { kind: string; requests: number; prompt: number }[];
    byChat: { chat_id: string; title: string | null; requests: number; prompt: number }[];
    failures: number;
  }
  let days = $state("7");
  let data = $state<Summary | null>(null);

  $effect(() => {
    get<Summary>(`/api/usage?days=${days}`)
      .then((d) => (data = d))
      .catch(errorToast);
  });

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

    <section class="panel stack tight">
      <h2>By kind</h2>
      {#each data.byKind as k (k.kind)}
        <div class="row small"><span class="grow">{kindLabel[k.kind] ?? k.kind}</span><span class="tiny muted">{k.requests} · {compact(k.prompt)} tokens</span></div>
      {/each}
    </section>
  {/if}
</div>

<style>
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
