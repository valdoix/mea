<script lang="ts">
  import { get, post } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { ArrowDown, ArrowUp, Plus, RefreshCw, X } from "../../lib/icons";
  import { app, errorToast, saveSetting, toast } from "../../lib/state.svelte";
  import type { Connection, EmbeddingStatus, Profile, Settings } from "../../lib/types";

  let { profiles, connections }: { profiles: Profile[]; connections: Connection[] } = $props();

  type Task = "story" | "summarizer" | "helper" | "tracker" | "world";
  const taskInfo: { id: Task; label: string; hint: string }[] = [
    { id: "story", label: "Story replies", hint: "uses the story default above, or the chat's own profile" },
    { id: "summarizer", label: "Memory summaries", hint: "scene records, verification, chapter and arc rollups" },
    { id: "helper", label: "Small helper checks", hint: "unclear scene breaks, /ask, and other short questions" },
    { id: "tracker", label: "Trackers", hint: "reads each reply for what changed (unset: the helper's profile)" },
    { id: "world", label: "The world off the page", hint: "tells what happened between scenes (unset: the summarizer's profile)" },
  ];

  const s = $derived(app.settings);
  let emb = $state<EmbeddingStatus | null>(null);

  async function loadEmb() {
    try {
      emb = await get<EmbeddingStatus>("/api/memory/embeddings");
    } catch {
      emb = null;
    }
  }
  $effect(() => {
    void loadEmb();
  });

  const nameOf = (id: string | null) => profiles.find((p) => p.id === id)?.name ?? "missing profile";
  const billingOf = (p: Profile) => connections.find((c) => c.id === p.connectionId)?.billing;

  async function save<K extends keyof Settings>(k: K, v: Settings[K]) {
    try {
      await saveSetting(k, v);
    } catch (e) {
      errorToast(e);
    }
  }

  function setTask(task: Exclude<Task, "story">, id: string) {
    if (!s) return;
    void save("routing.tasks", { ...s["routing.tasks"], [task]: id || null });
  }

  function chain(task: Task) {
    return s?.["routing.fallbacks"][task] ?? [];
  }
  function setChain(task: Task, list: string[]) {
    if (!s) return;
    void save("routing.fallbacks", { ...s["routing.fallbacks"], [task]: list });
  }
  function addFallback(task: Task, id: string) {
    if (id && !chain(task).includes(id)) setChain(task, [...chain(task), id]);
  }
  function move(task: Task, i: number, d: -1 | 1) {
    const list = [...chain(task)];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    setChain(task, list);
  }

  function setTimeoutFor(task: Task, v: string) {
    if (!s) return;
    const n = Math.max(10, Math.min(1800, Math.round(Number(v)) || 10));
    void save("routing.timeouts", { ...s["routing.timeouts"], [task]: n });
  }

  const paygo = $derived(connections.filter((c) => c.billing !== "subscription"));
  function setEmb(patch: Partial<Settings["routing.embeddings"]>) {
    if (!s) return;
    void save("routing.embeddings", { ...s["routing.embeddings"], ...patch }).then(loadEmb);
  }

  async function reembed() {
    if (!emb) return;
    if (!(await confirm({ title: "Re-embed all memories?", message: `${emb.mismatched + emb.missing} memories need a vector for ${emb.model}. This uses your pay-as-you-go key (embeddings are cheap).`, confirmLabel: "Re-embed" }))) return;
    try {
      emb = await post<EmbeddingStatus>("/api/memory/embeddings/reembed");
      toast("Re-embedding in the background", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }
</script>

{#if s}
  <section class="stack tight">
    <h2>Task routing</h2>
    <p class="tiny muted">
      Which profile does each job, and what to try next if it fails or times out. Mea never falls back from your subscription to a paid key on its own; paid profiles in a chain are used only
      when you put them there.
    </p>
    {#each taskInfo as t (t.id)}
      <div class="card task stack tight">
        <div class="row between wrap">
          <div><b>{t.label}</b><div class="tiny muted">{t.hint}</div></div>
          {#if t.id !== "story"}
            <select class="select narrow" value={s["routing.tasks"][t.id] ?? ""} onchange={(e) => setTask(t.id as Exclude<Task, "story">, e.currentTarget.value)}>
              <option value="">{t.id === "tracker" ? "Same as helper checks" : t.id === "world" ? "Same as memory summaries" : "Same as story"}</option>
              {#each profiles as p (p.id)}<option value={p.id}>{p.name}{billingOf(p) === "paygo" ? " (paid)" : ""}</option>{/each}
            </select>
          {/if}
        </div>
        {#if t.id === "helper" && !s["routing.tasks"].helper && profiles.length > 1}
          <!-- M15: helpers run several short calls per reply; on the story model they cost the most. -->
          <p class="notice warn tiny">
            Helper checks, trackers and the editor are using your story model. They run several short calls per reply, so a cheaper, faster profile here saves quota and time.
          </p>
        {/if}
        <div class="row wrap chain">
          <span class="tiny muted">Then try:</span>
          {#each chain(t.id) as id, i (id)}
            <span class="chip">
              {nameOf(id)}
              <button class="mini" onclick={() => move(t.id, i, -1)} disabled={i === 0} aria-label="Earlier"><ArrowUp size={11} /></button>
              <button class="mini" onclick={() => move(t.id, i, 1)} disabled={i === chain(t.id).length - 1} aria-label="Later"><ArrowDown size={11} /></button>
              <button class="mini" onclick={() => setChain(t.id, chain(t.id).filter((x) => x !== id))} aria-label="Remove"><X size={11} /></button>
            </span>
          {:else}
            <span class="tiny faint">nothing</span>
          {/each}
          {#if profiles.some((p) => !chain(t.id).includes(p.id))}
            <label class="add">
              <Plus size={13} />
              <select class="select tiny" value="" onchange={(e) => { addFallback(t.id, e.currentTarget.value); e.currentTarget.value = ""; }} aria-label="Add fallback">
                <option value="">Add fallback</option>
                {#each profiles.filter((p) => !chain(t.id).includes(p.id)) as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
              </select>
            </label>
          {/if}
        </div>
        <label class="row tiny muted">
          {t.id === "story" ? "Give up waiting for the first word after" : "Time limit"}
          <input class="input sec" type="number" min="10" max="1800" value={s["routing.timeouts"][t.id]} onchange={(e) => setTimeoutFor(t.id, e.currentTarget.value)} /> seconds
        </label>
      </div>
    {/each}
  </section>

  <section class="stack tight">
    <h2>Embeddings</h2>
    <p class="tiny muted">Lets memory find details by meaning, not just keywords. Needs a pay-as-you-go key; without one, recall uses keywords only.</p>
    <div class="card task stack tight">
      <div class="grid">
        <label class="field">
          <span class="label">Connection</span>
          <select class="select" value={s["routing.embeddings"].connectionId ?? ""} onchange={(e) => setEmb({ connectionId: e.currentTarget.value || null })}>
            <option value="">Off (keywords only)</option>
            {#each paygo as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
          </select>
        </label>
        <label class="field"><span class="label">Model</span><input class="input" value={s["routing.embeddings"].model} onchange={(e) => setEmb({ model: e.currentTarget.value.trim() || "text-embedding-3-large" })} /></label>
        <label class="field">
          <span class="label">Dimensions</span>
          <input class="input" type="number" min="64" max="4096" step="64" value={s["routing.embeddings"].dims} onchange={(e) => setEmb({ dims: Math.round(Number(e.currentTarget.value)) || 1024 })} />
        </label>
      </div>
      {#if emb}
        <div class="row between wrap tiny muted">
          <span>{emb.current} of {emb.total} memories have a {emb.model} vector{emb.mismatched ? ` · ${emb.mismatched} from an older model` : ""}{emb.missing ? ` · ${emb.missing} missing` : ""}</span>
          {#if emb.enabled && emb.mismatched + emb.missing > 0}<button class="btn small" onclick={reembed}><RefreshCw size={13} /> Re-embed</button>{/if}
        </div>
      {/if}
    </div>
  </section>
{/if}

<style>
  .task {
    padding: 0.8rem 1rem;
  }
  .narrow {
    max-width: 16rem;
  }
  .chain {
    gap: 0.35rem;
  }
  .chip .mini {
    border: 0;
    background: none;
    padding: 0 0.1rem;
    cursor: pointer;
    color: inherit;
    opacity: 0.7;
    display: inline-flex;
  }
  .chip .mini:disabled {
    opacity: 0.25;
    cursor: default;
  }
  .add {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    color: var(--text-muted);
  }
  .add .select {
    padding: 0.2rem 2rem 0.2rem 0.5rem;
    width: auto;
  }
  .sec {
    width: 5.5rem;
    padding: 0.25rem 0.5rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 0.8rem;
  }
</style>
