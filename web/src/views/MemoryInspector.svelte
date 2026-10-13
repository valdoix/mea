<script lang="ts">
  import { untrack } from "svelte";
  import AtomItem from "../components/memory/AtomItem.svelte";
  import CoverageMap from "../components/memory/CoverageMap.svelte";
  import SummaryCard from "../components/memory/SummaryCard.svelte";
  import Segmented from "../components/Segmented.svelte";
  import { get, patch, post } from "../lib/api";
  import { confirm, promptText } from "../lib/dialogs.svelte";
  import { onEvent } from "../lib/events";
  import { compact, debounce, timeAgo } from "../lib/format";
  import { ArrowLeft, Brain, Merge, Pause, Play, Plus, RefreshCw, Search } from "../lib/icons";
  import { route } from "../lib/router.svelte";
  import { errorToast, toast } from "../lib/state.svelte";
  import { ATOM_TYPES, type Atom, type ChatDetail, type JobRow, type MemoryOverview, type RebuildEstimate, type RebuildProgress, type RequestRow, type Summary } from "../lib/types";

  let { id }: { id: string } = $props();

  type Tab = "story" | "memories" | "activity";
  let tab = $state<Tab>("story");
  let detail = $state<ChatDetail | null>(null);
  let overview = $state<MemoryOverview | null>(null);
  let summaries = $state<Summary[]>([]);
  let attention = $state(false);
  let atoms = $state<Atom[]>([]);
  let total = $state(0);
  let q = $state("");
  let type = $state("");
  let status = $state("");
  let pinnedOnly = $state(false);
  let staleOnly = $state(false);
  let selected = $state<Record<string, boolean>>({});
  let jobs = $state<JobRow[]>([]);
  let requests = $state<RequestRow[]>([]);
  let error = $state("");

  // A Status tile in the chat's side panel opens this page with ?show=… to start on just what it counted.
  type Focus = "" | "review" | "stale" | "error" | "gaps";
  const FOCUS: Record<Exclude<Focus, "">, string> = { review: "Updates to review", stale: "Stale after edits", error: "Failed summaries", gaps: "Gaps in memory" };
  let focus = $state<Focus>("");
  let routed = false;
  $effect(() => {
    const f = route.query.show ?? "";
    if (!(f in FOCUS)) return;
    untrack(() => {
      focus = f as Focus;
      routed = false;
      tab = "story";
      attention = focus !== "gaps";
      staleOnly = focus === "stale";
    });
  });
  function clearFocus() {
    focus = "";
    if (route.query.show) history.replaceState(history.state, "", location.pathname);
  }

  async function loadOverview() {
    try {
      const [d, o, s] = await Promise.all([
        detail ? Promise.resolve(detail) : get<ChatDetail>(`/api/chats/${id}`),
        get<MemoryOverview>(`/api/chats/${id}/memory`),
        get<{ summaries: Summary[] }>(`/api/chats/${id}/summaries`),
      ]);
      detail = d;
      overview = o;
      summaries = s.summaries;
      // "Stale after edits" counts memories too: with no stale summary, those are what to open.
      if (focus === "stale" && !routed) {
        routed = true;
        if (!s.summaries.some((x) => x.state === "stale") && o.stats.stale) tab = "memories";
      }
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function loadAtoms(more = false) {
    const params = new URLSearchParams({ limit: "100", offset: String(more ? atoms.length : 0) });
    if (q.trim()) params.set("q", q.trim());
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    if (pinnedOnly) params.set("pinned", "1");
    if (staleOnly) params.set("stale", "1");
    try {
      const r = await get<{ atoms: Atom[]; total: number }>(`/api/chats/${id}/memories?${params}`);
      atoms = more ? [...atoms, ...r.atoms] : r.atoms;
      total = r.total;
    } catch (e) {
      errorToast(e);
    }
  }

  async function loadActivity() {
    try {
      const [j, r] = await Promise.all([get<{ jobs: JobRow[] }>(`/api/jobs?chatId=${id}&limit=60`), get<{ requests: RequestRow[] }>(`/api/requests?chatId=${id}&limit=60`)]);
      jobs = j.jobs;
      requests = r.requests.filter((x) => x.task !== "story");
    } catch (e) {
      errorToast(e);
    }
  }

  const reloadSoon = debounce(() => {
    void loadOverview();
    if (tab === "memories") void loadAtoms();
    if (tab === "activity") void loadActivity();
  }, 600);
  const searchSoon = debounce(() => loadAtoms(), 300);

  $effect(() => {
    void loadOverview();
  });
  $effect(() => {
    if (tab === "memories") void loadAtoms();
    if (tab === "activity") void loadActivity();
  });
  $effect(() =>
    onEvent((e) => {
      if ((e.type === "memory.changed" && e.chatId === id) || e.type === "reconnected") reloadSoon();
    }),
  );

  const story = $derived(summaries.find((s) => s.level === "story"));
  const arcs = $derived(summaries.filter((s) => s.level === "arc").sort((a, b) => a.startSeq - b.startSeq));
  const chapters = $derived(summaries.filter((s) => s.level === "chapter").sort((a, b) => a.startSeq - b.startSeq));
  const scenes = $derived(summaries.filter((s) => s.level === "scene").sort((a, b) => a.startSeq - b.startSeq));
  const needs = (s: Summary) => (focus && focus !== "gaps" ? s.state === focus : s.state === "stale" || s.state === "review" || s.state === "error");
  const staleSummaries = $derived(summaries.filter((s) => s.state === "stale").length);
  const staleMemories = $derived(Math.max(0, (overview?.stats.stale ?? 0) - staleSummaries));
  const scenesOf = (c: Summary) => scenes.filter((s) => s.startSeq >= c.startSeq && (c.endSeq == null || s.startSeq <= c.endSeq));
  const arcOf = (c: Summary) => [...arcs].reverse().find((a) => a.startSeq <= c.startSeq);
  const pickedIds = $derived(Object.entries(selected).filter(([, v]) => v).map(([k]) => k));

  async function run() {
    await post(`/api/chats/${id}/memory/run`).catch(errorToast);
    toast("Catching up in the background…");
  }

  async function togglePause() {
    if (!overview) return;
    overview = await patch<MemoryOverview>(`/api/chats/${id}/memory`, { paused: !overview.paused }).catch((e) => (errorToast(e), overview));
  }

  // SUM-19: an estimate first, then progress you can pause; it resumes by itself after a restart.
  let progress = $state<RebuildProgress | null>(null);
  async function loadProgress() {
    try {
      progress = await get<RebuildProgress>(`/api/chats/${id}/memory/progress`);
    } catch {
      progress = null;
    }
  }
  $effect(() => {
    void overview?.stats.scenes;
    void overview?.jobs.length;
    void loadProgress();
  });
  async function rebuildAll() {
    let est: RebuildEstimate | null = null;
    try {
      est = await get<RebuildEstimate>(`/api/chats/${id}/memory/rebuild-estimate`);
    } catch (e) {
      errorToast(e);
      return;
    }
    const share = est.quotaShare != null ? ` (about ${Math.max(0.1, Math.round(est.quotaShare * 1000) / 10)}% of your weekly quota)` : "";
    if (
      !(await confirm({
        title: "Rebuild this chat's memory from scratch?",
        message: `Every scene is summarized again from the messages, in the background, one scene at a time. Memories you edited or pinned are kept.\n\nEstimate: ${est.messages.toLocaleString()} messages (${compact(est.storyTokens)} tokens) → about ${est.scenes} scenes, ${est.chapters} chapters and ${est.arcs} arcs; ${est.calls} helper calls using about ${compact(est.inputTokens)} input tokens${share}. You can pause it any time; it carries on after a restart.`,
        confirmLabel: "Rebuild everything",
        danger: true,
      }))
    )
      return;
    await post(`/api/chats/${id}/memory/rebuild`, { keepUserWork: true }).catch(errorToast);
    toast("Rebuilding in the background…");
    void loadOverview();
    void loadProgress();
  }

  async function addMemory() {
    const content = await promptText({ title: "Add a memory", label: "Something Mea should remember", placeholder: "Mira is afraid of deep water.", multiline: true, confirmLabel: "Add" });
    if (!content?.trim()) return;
    try {
      await post(`/api/chats/${id}/memories`, { type: "fact", content: content.trim() });
      void loadAtoms();
    } catch (e) {
      errorToast(e);
    }
  }

  async function mergeSelected() {
    const ids = pickedIds;
    const first = atoms.filter((a) => ids.includes(a.id));
    const content = await promptText({ title: `Merge ${ids.length} memories`, label: "The merged memory", value: first.map((a) => a.content).join(" "), multiline: true, confirmLabel: "Merge" });
    if (content === null) return;
    try {
      await post("/api/memories/merge", { ids, content });
      selected = {};
      void loadAtoms();
    } catch (e) {
      errorToast(e);
    }
  }

  async function retry(j: JobRow) {
    await post(`/api/jobs/${j.id}/retry`).catch(errorToast);
    void loadActivity();
  }

  const JOB_LABEL: Record<string, string> = { "memory.segment": "Finding scene breaks", "memory.build": "Writing a summary", "memory.embed": "Indexing for search" };
</script>

<div class="page">
  <header class="row top">
    <a class="btn ghost icon" href="/chat/{id}" aria-label="Back to the chat"><ArrowLeft size={19} /></a>
    <div class="grow">
      <h1 class="row"><Brain size={22} /> Memory</h1>
      {#if detail}<div class="tiny muted">{detail.character?.name ?? ""} · {detail.chat.title}</div>{/if}
    </div>
    {#if overview}
      <button class="btn small" onclick={togglePause}>{#if overview.paused}<Play size={14} /> Resume{:else}<Pause size={14} /> Pause{/if}</button>
      <button class="btn small" onclick={run}><RefreshCw size={14} /> Catch up</button>
    {/if}
  </header>

  {#if error}
    <div class="notice error">{error}</div>
  {:else if overview}
    {#if !overview.enabled}<div class="notice warn tiny">Memory is turned off in Settings → Memory. Nothing new is summarized.</div>{/if}
    {#if overview.paused}<div class="notice warn tiny">Memory is paused for this chat.</div>{/if}

    {#if progress?.startedAt && !progress.done}
      <section class="panel stack tight rebuild">
        <div class="row between"><b class="small">Rebuilding memory</b><span class="tiny muted">{progress.scenes.ready} of {Math.max(progress.scenes.total, progress.estimate?.scenes ?? 0)} scenes{progress.paused ? " · paused" : ""}</span></div>
        <div class="bar"><span style:width="{Math.min(100, (progress.scenes.ready / Math.max(1, progress.scenes.total, progress.estimate?.scenes ?? 0)) * 100)}%"></span></div>
        <span class="tiny muted">Read through #{progress.segmentedThrough} of #{progress.lastSeq}{progress.scenes.failed ? ` · ${progress.scenes.failed} failed (retry from the scene)` : ""}</span>
      </section>
    {/if}
    <section class="panel stack tight">
      {#if overview.stats.messages && overview.stats.storyTokens}<p class="headline"><b>{overview.stats.messages.toLocaleString()}</b> messages · <b>{compact(overview.stats.storyTokens)}</b> tokens → <b>{compact(overview.stats.memoryTokens ?? overview.stats.telescopeTokens)}</b> tokens of memory</p>{/if}
      <CoverageMap {overview} onpick={() => (tab = "story")} />
      <div class="row wrap tiny muted stats">
        <span><b>{overview.stats.scenes}</b> scenes · <b>{overview.stats.chapters}</b> chapters · <b>{overview.stats.arcs}</b> arcs</span>
        <span><b>{overview.stats.atoms}</b> memories ({overview.stats.pinned} pinned)</span>
        {#if overview.stats.summarizedSourceTokens}<span>{compact(overview.stats.summarizedSourceTokens)} tokens of story → {compact(overview.stats.sceneSummaryTokens)} in scene summaries</span>{/if}
        {#if overview.stats.lastPromptMemoryTokens != null}<span>last prompt used {compact(overview.stats.lastPromptMemoryTokens)} memory tokens</span>{/if}
        <span>word for word from #{overview.evictedThrough + 1}</span>
        {#if overview.jobs.length}<span class="chip sky">{overview.jobs.reduce((n, j) => n + j.n, 0)} background tasks</span>{/if}
        {#if overview.stats.review}<span class="chip peach">{overview.stats.review} to review</span>{/if}
        {#if overview.stats.errors}<span class="chip rose">{overview.stats.errors} failed</span>{/if}
      </div>
    </section>

    <div class="row between wrap">
      <Segmented
        bind:value={tab}
        options={[
          { value: "story" as Tab, label: "Story" },
          { value: "memories" as Tab, label: "Memories" },
          { value: "activity" as Tab, label: "Activity" },
        ]}
      />
      {#if tab === "story"}
        <label class="switch tiny"><input type="checkbox" bind:checked={attention} onchange={() => !attention && clearFocus()} /> Only what needs attention</label>
      {/if}
    </div>

    {#if focus}
      <div class="notice tiny row between wrap focus">
        <span>
          Showing <b>{FOCUS[focus].toLowerCase()}</b>.
          {#if focus === "stale" && tab === "story" && staleMemories}<button class="link" onclick={() => (tab = "memories")}>{staleMemories} stale memor{staleMemories === 1 ? "y" : "ies"} →</button>{/if}
          {#if focus === "stale" && tab === "memories" && staleSummaries}<button class="link" onclick={() => (tab = "story")}>{staleSummaries} stale summar{staleSummaries === 1 ? "y" : "ies"} →</button>{/if}
        </span>
        <button class="btn small ghost" onclick={() => (clearFocus(), (attention = false), staleOnly && ((staleOnly = false), void loadAtoms()))}>Show everything</button>
      </div>
    {/if}

    {#if focus === "gaps" && tab === "story"}
      <section class="panel stack tight">
        <h3>Gaps in memory</h3>
        <p class="tiny muted">Stretches of the story the prompt no longer sends word for word and no summary covers yet. Catch up fills them; a failed one can be retried from its scene.</p>
        {#each overview.gaps as g (g.startSeq)}
          <div class="row between tiny gaprow">
            <span><b>#{g.startSeq}–#{g.endSeq}</b> · {g.reason}</span>
            <a class="btn small ghost" href="/chat/{id}?at={g.startSeq}">Read it</a>
          </div>
        {:else}
          <p class="tiny muted">No gaps right now.</p>
        {/each}
        {#if overview.gaps.length}<div class="row end"><button class="btn small" onclick={run}><RefreshCw size={14} /> Catch up</button></div>{/if}
      </section>
    {/if}

    {#if tab === "story"}
      <div class="stack tight">
        {#if story && (!attention || needs(story))}<SummaryCard summary={story} chatId={id} open onchange={loadOverview} />{/if}
        {#each chapters as c, i (c.id)}
          {@const arc = arcOf(c)}
          {@const kids = scenesOf(c)}
          {#if arc && arc.startSeq === c.startSeq && (!attention || needs(arc))}<SummaryCard summary={arc} chatId={id} onchange={loadOverview} />{/if}
          {#if !attention || needs(c) || kids.some(needs)}
            <div class="chapter">
              {#if !attention || needs(c)}<SummaryCard summary={c} chatId={id} open={i === chapters.length - 1} onchange={loadOverview} />{/if}
              <div class="scenes stack tight">
                {#each kids.filter((s) => !attention || needs(s)) as s (s.id)}<SummaryCard summary={s} chatId={id} open={!!focus && focus !== "gaps"} onchange={loadOverview} />{/each}
              </div>
            </div>
          {/if}
        {:else}
          <p class="muted small center">Nothing is summarized yet. Scenes are recorded in the background once the story moves past them.</p>
        {/each}
        {#if attention && chapters.length && !summaries.some(needs)}<p class="muted small center">Nothing here needs attention right now.</p>{/if}
        <div class="row end"><button class="btn small ghost danger" onclick={rebuildAll}><RefreshCw size={14} /> Rebuild everything…</button></div>
      </div>
    {:else if tab === "memories"}
      <div class="stack tight">
        <div class="row wrap filters">
          <label class="search grow"><Search size={15} /><input class="input" placeholder="Search memories" bind:value={q} oninput={searchSoon} /></label>
          <select class="select" bind:value={type} onchange={() => loadAtoms()} aria-label="Type"><option value="">All types</option>{#each ATOM_TYPES as t (t)}<option value={t}>{t}</option>{/each}</select>
          <select class="select" bind:value={status} onchange={() => loadAtoms()} aria-label="Status">
            <option value="">Any status</option><option value="active">Active</option><option value="superseded">Superseded</option><option value="resolved">Resolved</option><option value="disputed">Disputed</option>
          </select>
          <label class="switch tiny"><input type="checkbox" bind:checked={pinnedOnly} onchange={() => loadAtoms()} /> Pinned</label>
          <label class="switch tiny"><input type="checkbox" bind:checked={staleOnly} onchange={() => loadAtoms()} /> Needs update</label>
        </div>
        <div class="row between wrap">
          <span class="tiny muted">{total} memories</span>
          <div class="row">
            {#if pickedIds.length >= 2}<button class="btn small" onclick={mergeSelected}><Merge size={14} /> Merge {pickedIds.length}</button>{/if}
            <button class="btn small" onclick={addMemory}><Plus size={14} /> Add memory</button>
          </div>
        </div>
        {#each atoms as a (a.id)}
          <AtomItem atom={a} chatId={id} selectable bind:selected={() => selected[a.id] ?? false, (v) => (selected[a.id] = v)} onchange={() => (loadAtoms(), loadOverview())} />
        {:else}
          <p class="muted small center">No memories match.</p>
        {/each}
        {#if atoms.length < total}<button class="btn small" onclick={() => loadAtoms(true)}>Show more</button>{/if}
      </div>
    {:else}
      <div class="stack">
        <section class="stack tight">
          <h3>Background tasks</h3>
          {#each jobs as j (j.id)}
            <div class="job card row">
              <div class="grow">
                <div class="small"><b>{JOB_LABEL[j.kind] ?? j.kind}</b> <span class="chip {j.status === 'failed' ? 'rose' : j.status === 'running' ? 'sky' : j.status === 'done' ? 'mint' : ''}">{j.status}</span></div>
                <div class="tiny muted">
                  {timeAgo(j.updatedAt)}{j.inputTokens ? ` · ${compact(j.inputTokens)} in / ${compact(j.outputTokens)} out` : ""}{j.attempts > 1 ? ` · attempt ${j.attempts}` : ""}
                  {#if j.status === "queued" && j.runAfter > Date.now()} · waits until {new Date(j.runAfter).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}{/if}
                </div>
                {#if j.lastError}<div class="tiny" class:err={j.status === "failed"}>{j.lastError}</div>{/if}
              </div>
              {#if j.status === "failed"}<button class="btn small" onclick={() => retry(j)}>Retry</button>{/if}
            </div>
          {:else}
            <p class="tiny muted">Nothing running.</p>
          {/each}
        </section>
        <section class="stack tight">
          <h3>Helper requests</h3>
          {#each requests as r (r.id)}
            <div class="row tiny req">
              <span class="chip">{r.kind}</span>
              <span class="grow wraps muted">{r.model}</span>
              <span>{compact(r.promptTokens ?? r.estPromptTokens)} in</span>
              <span class="muted">{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)} s` : r.status}</span>
              {#if r.status === "error"}<span class="err" title={r.error ?? ""}>failed</span>{/if}
            </div>
          {:else}
            <p class="tiny muted">No helper requests yet.</p>
          {/each}
        </section>
      </div>
    {/if}
  {:else}
    <p class="muted">Loading…</p>
  {/if}
</div>

<style>
  .focus {
    gap: 0.5rem;
    align-items: center;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-ink);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
  .gaprow {
    align-items: center;
    gap: 0.5rem;
  }
  .headline {
    margin: 0 0 0.3rem;
    text-align: center;
  }
  .rebuild .bar {
    height: 0.45rem;
    border-radius: var(--r-pill);
    background: var(--surface-3);
    overflow: hidden;
  }
  .rebuild .bar span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--lavender), var(--accent));
    transition: width 0.5s var(--ease);
  }
  .page {
    max-width: 56rem;
    margin: 0 auto;
    padding: 1.2rem clamp(1rem, 3vw, 2rem) 5rem;
    display: grid;
    gap: 1rem;
  }
  .top {
    gap: 0.5rem;
    align-items: center;
  }
  h1 {
    gap: 0.5rem;
    margin: 0;
  }
  .stats {
    gap: 0.8rem;
  }
  .chapter {
    display: grid;
    gap: 0.4rem;
  }
  .scenes {
    padding-left: 1.2rem;
    border-left: 2px solid var(--border);
    margin-left: 0.6rem;
  }
  .filters {
    gap: 0.5rem;
  }
  .filters .select {
    width: auto;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 12rem;
  }
  .center {
    text-align: center;
    padding: 1.5rem 0;
  }
  .end {
    justify-content: flex-end;
  }
  .job {
    padding: 0.55rem 0.8rem;
    gap: 0.6rem;
  }
  .req {
    gap: 0.6rem;
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--border);
  }
  .err {
    color: var(--danger);
  }
  @media (max-width: 760px) {
    .scenes {
      padding-left: 0.6rem;
      margin-left: 0.2rem;
    }
  }
</style>
