<script lang="ts">
  import CoverageMap from "./CoverageMap.svelte";
  import { get, post } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { compact, debounce } from "../../lib/format";
  import { Brain, RefreshCw } from "../../lib/icons";
  import { navigate } from "../../lib/router.svelte";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { MemoryOverview, Summary } from "../../lib/types";

  let { chatId }: { chatId: string } = $props();

  let overview = $state<MemoryOverview | null>(null);
  let story = $state<Summary | null>(null);

  async function load() {
    try {
      const [o, s] = await Promise.all([get<MemoryOverview>(`/api/chats/${chatId}/memory`), get<{ summaries: Summary[] }>(`/api/chats/${chatId}/summaries?level=story`)]);
      overview = o;
      story = s.summaries[0] ?? null;
    } catch (e) {
      errorToast(e);
    }
  }
  const soon = debounce(load, 800);
  $effect(() => {
    void load();
  });
  $effect(() => onEvent((e) => (e.type === "memory.changed" && e.chatId === chatId) || e.type === "reconnected" ? soon() : undefined));

  async function run() {
    await post(`/api/chats/${chatId}/memory/run`).catch(errorToast);
    toast("Catching up in the background…");
  }

  const busy = $derived(overview?.jobs.filter((j) => j.status !== "failed").reduce((n, j) => n + j.n, 0) ?? 0);
</script>

<div class="panel-body stack">
  {#if !overview}
    <p class="tiny muted">Loading…</p>
  {:else}
    {#if !overview.enabled}<div class="notice warn tiny">Memory is off (Settings → Memory).</div>{/if}
    {#if overview.paused}<div class="notice warn tiny">Memory is paused for this chat.</div>{/if}
    <section class="stack tight">
      <div class="row between">
        <h3 class="row"><Brain size={16} /> Memory</h3>
        {#if busy}<span class="chip sky tiny">weaving memories… {busy}</span>{/if}
      </div>
      <CoverageMap {overview} onpick={() => navigate(`/chat/${chatId}/memory`)} />
    </section>

    <div class="grid tiny">
      <div><b>{overview.stats.scenes}</b><span class="muted">scenes</span></div>
      <div><b>{overview.stats.chapters}</b><span class="muted">chapters</span></div>
      <div><b>{overview.stats.atoms}</b><span class="muted">memories</span></div>
      <div><b>{overview.stats.pinned}</b><span class="muted">pinned</span></div>
    </div>

    {#if overview.stats.summarizedSourceTokens}
      <p class="tiny muted">{compact(overview.stats.summarizedSourceTokens)} tokens of story kept in {compact(overview.stats.sceneSummaryTokens)} tokens of scene summaries. Messages from #{overview.evictedThrough + 1} are sent word for word.</p>
    {:else}
      <p class="tiny muted">Scenes are recorded in the background once the story moves past them. Until the chat outgrows the prompt, everything is sent word for word.</p>
    {/if}

    {#if overview.stats.review || overview.stats.errors || overview.stats.stale}
      <div class="notice warn tiny">
        {#if overview.stats.review}{overview.stats.review} update{overview.stats.review > 1 ? "s" : ""} to review. {/if}
        {#if overview.stats.stale}{overview.stats.stale} item{overview.stats.stale > 1 ? "s" : ""} need updating after edits. {/if}
        {#if overview.stats.errors}{overview.stats.errors} summar{overview.stats.errors > 1 ? "ies" : "y"} failed.{/if}
      </div>
    {/if}
    {#if overview.gaps.length}
      <div class="notice error tiny">Gaps: {overview.gaps.map((g) => `#${g.startSeq}–#${g.endSeq} (${g.reason})`).join(", ")}</div>
    {/if}

    {#if story?.content}
      <details class="ssf">
        <summary class="small"><b>Story so far</b>{story.title ? ` · ${story.title}` : ""}</summary>
        <p class="small">{story.content}</p>
      </details>
    {/if}

    <div class="row wrap">
      <a class="btn small primary" href="/chat/{chatId}/memory"><Brain size={14} /> Open memory</a>
      <button class="btn small" onclick={run}><RefreshCw size={14} /> Catch up</button>
    </div>
  {/if}
</div>

<style>
  .panel-body {
    gap: 1rem;
  }
  h3 {
    gap: 0.4rem;
    margin: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.4rem;
    text-align: center;
  }
  .grid div {
    display: grid;
    background: var(--surface);
    border-radius: var(--r-sm);
    padding: 0.4rem 0.2rem;
  }
  .grid b {
    font-size: var(--fs-md);
  }
  .ssf p {
    white-space: pre-wrap;
    margin: 0.4rem 0 0;
    font-family: var(--font-story);
  }
  .ssf summary {
    cursor: pointer;
  }
</style>
