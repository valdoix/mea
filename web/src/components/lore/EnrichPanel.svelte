<script lang="ts">
  import { get, post } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { CircleCheck, Loader, RotateCcw, Sparkles, Square, TriangleAlert } from "../../lib/icons";
  import { confirm } from "../../lib/dialogs.svelte";
  import { errorToast } from "../../lib/state.svelte";
  import type { EnrichRun } from "../../lib/types";

  /** "Enrich the entries": each entry deepened in place; one that doesn't come out better keeps its original. */
  let { bookId, onchanged, onopen }: { bookId: string; onchanged: () => void; onopen: (entryId: string) => void } = $props();
  let run = $state<EnrichRun | null>(null);
  let busy = $state(false);
  let lastDone = 0;

  async function load() {
    try {
      run = (await get<{ run: EnrichRun | null }>(`/api/lorebooks/${bookId}/enrich`)).run;
      const done = run?.items.filter((i) => i.status === "enriched").length ?? 0;
      if (done !== lastDone) {
        lastDone = done;
        onchanged();
      }
    } catch {
      // optional
    }
  }
  $effect(() => {
    void load();
    let t: ReturnType<typeof setTimeout>;
    const off = onEvent((e) => {
      if (e.type === "library.changed") {
        clearTimeout(t);
        t = setTimeout(() => void load(), 300);
      }
    });
    return () => {
      off();
      clearTimeout(t);
    };
  });

  async function start() {
    if (!(await confirm({ title: "Enrich every entry?", message: "Each entry is rewritten deeper, one at a time, with the rest of the book in view. One that doesn't come out better keeps its original, and you can put any enriched entry back.", confirmLabel: "Enrich" }))) return;
    busy = true;
    try {
      run = (await post<{ run: EnrichRun }>(`/api/lorebooks/${bookId}/enrich`)).run;
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
  async function act(path: string) {
    try {
      run = (await post<{ run: EnrichRun }>(`/api/lorebooks/${bookId}/enrich${path}`)).run;
      onchanged();
    } catch (e) {
      errorToast(e);
    }
  }
  const done = $derived(run ? run.items.filter((i) => i.status !== "pending" && i.status !== "working").length : 0);
</script>

<section class="panel stack">
  <div class="row between wrap">
    <h3><Sparkles size={16} /> Enrich the entries</h3>
    {#if run?.state === "running"}
      <button class="btn small" onclick={() => act("/stop")}><Square size={13} /> Stop</button>
    {:else}
      <button class="btn small" onclick={start} disabled={busy}>{run ? "Enrich again" : "Enrich"}</button>
    {/if}
  </div>
  {#if !run}
    <p class="tiny muted">Deepen thin entries into rich ones, still making the original's claims. An entry that doesn't come out better keeps its original.</p>
  {:else}
    <span class="tiny muted">{done} of {run.items.length}{run.state === "running" ? " · stopping keeps everything finished so far" : run.state === "stopped" ? " · stopped" : " · done"}</span>
    <ul class="items">
      {#each run.items as it (it.entryId)}
        <li class="tiny">
          {#if it.status === "working"}<span class="spin"><Loader size={12} /></span>{:else if it.status === "enriched"}<CircleCheck size={12} />{:else if it.status === "kept" || it.status === "error"}<TriangleAlert size={12} />{/if}
          <button class="link" onclick={() => onopen(it.entryId)}>{it.title}</button>
          <span class="muted">{it.status === "enriched" ? "Enriched" : it.status === "kept" ? `Kept the original${it.why ? `: ${it.why}` : ""}` : it.status === "restored" ? "Put back" : it.status === "error" ? `Failed: ${it.why}` : it.status}</span>
          {#if it.status === "enriched"}<button class="btn ghost small" onclick={() => act(`/${it.entryId}/restore`)}><RotateCcw size={11} /> Put back</button>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  h3 {
    margin: 0;
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.25rem;
    max-height: 18rem;
    overflow: auto;
  }
  .items li {
    display: flex;
    gap: 0.35rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    font: inherit;
  }
  .spin {
    display: inline-grid;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
