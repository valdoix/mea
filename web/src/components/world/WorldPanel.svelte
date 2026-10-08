<script lang="ts">
  import { get, post } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { Dices, ExternalLink } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { Arc, WorldViewData } from "../../lib/types";

  let { chatId }: { chatId: string } = $props();
  let w = $state<WorldViewData | null>(null);
  let busy = $state(false);

  async function load() {
    try {
      w = await get<WorldViewData>(`/api/chats/${chatId}/world`);
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void load();
  });
  $effect(() =>
    onEvent((e) => {
      if (e.type === "trackers.changed" && e.chatId === chatId && !e.running) void load();
    }),
  );

  async function step() {
    busy = true;
    try {
      const r = await post<{ summary: string[] }>(`/api/chats/${chatId}/world/tick`);
      toast(r.summary.length ? r.summary.slice(0, 3).join(" · ") : "A quiet stretch: nothing moved", { kind: "ok" });
      await load();
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
  async function decide(url: string, body: unknown) {
    try {
      w = await post<WorldViewData>(url, body);
    } catch (e) {
      errorToast(e);
    }
  }

  const live = $derived((w?.arcs ?? []).filter((a) => a.status === "running" || a.status === "held"));
  const fates = $derived((w?.arcs ?? []).filter((a) => a.status === "fate"));
  const pending = $derived((w?.arrivals ?? []).filter((a) => a.status === "pending" || a.status === "offered").slice(0, 4));
  const last = $derived(w?.tension.at(-1));
  const spark = $derived.by(() => {
    const t = (w?.tension ?? []).slice(-24);
    if (t.length < 2) return "";
    const x = (i: number) => (i / (t.length - 1)) * 100;
    const y = (v: number) => 24 - (v / 10) * 22;
    return { value: t.map((p, i) => `${x(i)},${y(p.value)}`).join(" "), target: t.map((p, i) => `${x(i)},${y(p.target)}`).join(" ") };
  });
  const stageIcon: Record<string, string> = { hook: "○", rising: "◔", reversal: "◑", crisis: "◕", climax: "●", aftermath: "✓" };
  const surprise = $derived(w?.config.view === "surprise");
  const clockDots = (a: Arc) => Array.from({ length: a.clock.max }, (_, i) => i < a.clock.cur);
</script>

{#if !w}
  <p class="tiny muted pad">Loading the world…</p>
{:else if w.config.mode === "off"}
  <div class="pad stack tight">
    <p class="small muted">The world off the page is off for this chat. People only act when they're in a scene.</p>
    <a class="btn small" href="/chat/{chatId}/world">Turn it on</a>
  </div>
{:else}
  <div class="wpanel stack tight">
    <div class="row between top">
      <span class="tiny muted">{w.time ?? "No story time yet"}{w.lastTickAt ? ` · last moved ${w.lastTickAt}` : ""}</span>
      <span class="row">
        <button class="btn ghost icon small" onclick={step} disabled={busy || !w.time} title="Move the world a step now" aria-label="Move the world a step"><Dices size={15} /></button>
        <a class="btn ghost icon small" href="/chat/{chatId}/world" title="Open the world" aria-label="Open the world"><ExternalLink size={14} /></a>
      </span>
    </div>
    {#if w.sky}<div class="tiny sky">{w.sky.line.replace(/^SKY: /, "")}{w.sky.moon ? ` · ${w.sky.moon}` : ""}</div>{/if}
    {#if spark}
      <div class="tension" title="Story tension (line) against where the director wants it (dashes)">
        <svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><polyline points={spark.target} class="target" /><polyline points={spark.value} class="value" /></svg>
        <span class="tiny muted">{w.personalities[w.config.director]?.label} · tension {last?.value ?? 0} → {last?.target ?? 0}</span>
      </div>
    {/if}

    {#each w.proposals as p (p.id)}
      <div class="card prop">
        <div class="tiny muted">New subplot? · {w.kinds[p.kind]?.label} · {p.why}</div>
        <div class="small"><b>{p.leadName}</b>: {p.premise}</div>
        <div class="row"><button class="btn small primary" onclick={() => decide(`/api/chats/${chatId}/world/proposals/${encodeURIComponent(p.id)}`, { accept: true })}>Let it happen</button><button class="btn small ghost" onclick={() => decide(`/api/chats/${chatId}/world/proposals/${encodeURIComponent(p.id)}`, { accept: false })}>Not this</button></div>
      </div>
    {/each}
    {#each fates as a (a.id)}
      <div class="card fate">
        <div class="tiny muted">An ending that can't be undone · {a.leadName}</div>
        <div class="small">{a.fate?.text}</div>
        <div class="row wrap">
          <button class="btn small" onclick={() => decide(`/api/chats/${chatId}/world/fates/${encodeURIComponent(a.id)}`, { choice: "accept" })}>Accept</button>
          <button class="btn small" onclick={() => decide(`/api/chats/${chatId}/world/fates/${encodeURIComponent(a.id)}`, { choice: "soften" })}>Soften</button>
          <button class="btn small ghost" onclick={() => decide(`/api/chats/${chatId}/world/fates/${encodeURIComponent(a.id)}`, { choice: "page" })}>Keep it for the page</button>
        </div>
      </div>
    {/each}

    <div class="tiny label-s">Subplots ({live.length})</div>
    {#each live as a (a.id)}
      <a class="arc" href="/chat/{chatId}/world#{encodeURIComponent(a.id)}">
        <span class="stage" title={a.stage}>{stageIcon[a.stage]}</span>
        <span class="grow">
          <span class="small"><b>{a.leadName}</b> · {w.kinds[a.kind]?.label}{a.status === "held" ? " (held)" : ""}</span>
          {#if !surprise}<span class="tiny muted truncate block">{a.beats.at(-1)?.text ?? a.premise}</span>{/if}
        </span>
        <span class="dots">{#each clockDots(a) as on, i (i)}<span class:on></span>{/each}</span>
      </a>
    {:else}
      <p class="tiny faint">Nothing is moving off the page yet. Subplots grow out of the story's loose ends as story time passes.</p>
    {/each}

    {#if pending.length}
      <div class="tiny label-s">On its way to the scene</div>
      {#each pending as a (a.id)}<div class="tiny line">{a.route === "omen" ? "🌘" : a.route === "entrance" ? "🚪" : a.route === "signal" ? "📨" : a.route === "trace" ? "👣" : a.route === "ambient" ? "📣" : "🗣"} {a.text}</div>{/each}
    {/if}
    {#if w.news.length && !surprise}
      <div class="tiny label-s">News off the page</div>
      {#each w.news.slice(0, 3) as n, i (i)}<div class="tiny line">{n.to} heard from {n.from} ({n.medium}){n.distorted ? ", garbled" : ""}: {n.statement}</div>{/each}
    {/if}
  </div>
{/if}

<style>
  .pad {
    padding: 0.8rem;
  }
  .wpanel {
    padding: 0.2rem 0.1rem 2rem;
  }
  .top {
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 1;
  }
  .sky {
    color: var(--text-muted);
  }
  .tension svg {
    width: 100%;
    height: 2rem;
    display: block;
  }
  .tension .value {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .tension .target {
    fill: none;
    stroke: var(--lavender);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    vector-effect: non-scaling-stroke;
  }
  .label-s {
    font-weight: 700;
    color: var(--text-muted);
    margin-top: 0.4rem;
  }
  .card.prop,
  .card.fate {
    padding: 0.6rem 0.7rem;
    display: grid;
    gap: 0.35rem;
  }
  .card.fate {
    border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
  }
  .arc {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.2rem;
    border-radius: var(--r-sm);
    color: inherit;
    text-decoration: none;
  }
  .arc:hover {
    background: var(--surface-2);
  }
  .stage {
    color: var(--accent);
    width: 1rem;
    text-align: center;
  }
  .block {
    display: block;
    max-width: 15rem;
  }
  .dots {
    display: inline-flex;
    gap: 2px;
  }
  .dots span {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    border: 1px solid var(--border);
  }
  .dots span.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .line {
    padding: 0.15rem 0;
  }
</style>
