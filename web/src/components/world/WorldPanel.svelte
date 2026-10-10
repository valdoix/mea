<script lang="ts">
  import "../../styles/studio.css";
  import Module from "../desk/Module.svelte";
  import { get, post } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { Dices, DoorOpen, ExternalLink, Footprints, Mail, Megaphone, MessageCircle, Moon, Radio } from "../../lib/icons";
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
  /** How far along an arc is, as a quarter-filled dial. */
  const STAGES = ["hook", "rising", "reversal", "crisis", "climax", "aftermath"];
  const stageAt = (s: string) => Math.max(0, STAGES.indexOf(s)) / (STAGES.length - 1);
  const routeIcon = { omen: Moon, entrance: DoorOpen, signal: Mail, trace: Footprints, ambient: Megaphone } as const;
  const routeOf = (r: string) => routeIcon[r as keyof typeof routeIcon] ?? MessageCircle;
  const surprise = $derived(w?.config.view === "surprise");
  const clockDots = (a: Arc) => Array.from({ length: a.clock.max }, (_, i) => i < a.clock.cur);
</script>

{#if !w}
  <p class="st-loading">LOADING THE WORLD…</p>
{:else if w.config.mode === "off"}
  <div class="studio st-stack">
    <Module title="World">
      <p class="st-hint first">The world off the page is off for this chat. People only act when they're in a scene.</p>
      <div class="st-keys"><a class="st-key" href="/chat/{chatId}/world">Turn it on</a></div>
    </Module>
  </div>
{:else}
  <div class="studio st-stack">
    <div class="st-lcdbar">
      <span class="st-read">
        <span class="st-lcd now">{(w.time ?? "NO STORY TIME YET").toUpperCase()}</span>
        <small>{w.lastTickAt ? `Last moved ${w.lastTickAt}` : "The world moves as story time passes"}</small>
      </span>
      <span class="st-iconkeys">
        <button class="st-key sq dice" class:rolling={busy} type="button" onclick={step} disabled={busy || !w.time} title="Move the world a step now" aria-label="Move the world a step"><Dices size={17} /></button>
        <a class="st-key sq" href="/chat/{chatId}/world" title="Open the world" aria-label="Open the world"><ExternalLink size={15} /></a>
      </span>
    </div>

    {#if spark || w.sky}
      <Module title="Tension" led={last && last.value > last.target ? "warm" : "on"} peek={last ? `${last.value} → ${last.target}` : ""}>
        {#if spark}
          <div class="scope" title="Story tension (line) against where the director wants it (dashes)">
            <svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><polyline points={spark.target} class="target" /><polyline points={spark.value} class="value" /></svg>
          </div>
          <p class="st-caption cap"><span><i class="key-v"></i>tension</span><span><i class="key-t"></i>where {w.personalities[w.config.director]?.label ?? "the director"} wants it</span></p>
        {/if}
        {#if w.sky}<p class="sky"><Moon size={13} /> {w.sky.line.replace(/^SKY: /, "")}{w.sky.moon ? ` · ${w.sky.moon}` : ""}</p>{/if}
      </Module>
    {/if}

    {#each w.proposals as p (p.id)}
      <div class="call">
        <div class="call-h"><span class="st-led warm pulse"></span><span class="st-k">New subplot? · {w.kinds[p.kind]?.label}</span></div>
        <p><b>{p.leadName}</b>: {p.premise}</p>
        <p class="why">{p.why}</p>
        <div class="st-keys">
          <button class="st-key small primary" type="button" onclick={() => decide(`/api/chats/${chatId}/world/proposals/${encodeURIComponent(p.id)}`, { accept: true })}>Let it happen</button>
          <button class="st-key small ghost" type="button" onclick={() => decide(`/api/chats/${chatId}/world/proposals/${encodeURIComponent(p.id)}`, { accept: false })}>Not this</button>
        </div>
      </div>
    {/each}
    {#each fates as a (a.id)}
      <div class="call fate">
        <div class="call-h"><span class="st-led bad pulse"></span><span class="st-k">An ending that can't be undone · {a.leadName}</span></div>
        <p>{a.fate?.text}</p>
        <div class="st-keys">
          <button class="st-key small" type="button" onclick={() => decide(`/api/chats/${chatId}/world/fates/${encodeURIComponent(a.id)}`, { choice: "accept" })}>Accept</button>
          <button class="st-key small" type="button" onclick={() => decide(`/api/chats/${chatId}/world/fates/${encodeURIComponent(a.id)}`, { choice: "soften" })}>Soften</button>
          <button class="st-key small ghost" type="button" onclick={() => decide(`/api/chats/${chatId}/world/fates/${encodeURIComponent(a.id)}`, { choice: "page" })}>Keep it for the page</button>
        </div>
      </div>
    {/each}

    <Module title="Subplots" led={live.length ? "on" : null} peek={String(live.length)}>
      {#each live as a (a.id)}
        <a class="arc" href="/chat/{chatId}/world#{encodeURIComponent(a.id)}">
          <span class="pie" style:--p={stageAt(a.stage)} title={a.stage} aria-label="Stage: {a.stage}"></span>
          <span class="arc-t">
            <span class="arc-n"><b>{a.leadName}</b> · {w.kinds[a.kind]?.label}{a.status === "held" ? " (held)" : ""}</span>
            {#if !surprise}<span class="arc-b">{a.beats.at(-1)?.text ?? a.premise}</span>{/if}
          </span>
          <span class="clock" title="{a.clock.cur} of {a.clock.max}">{#each clockDots(a) as on, i (i)}<i class:on></i>{/each}</span>
        </a>
      {:else}
        <p class="st-hint first">Nothing is moving off the page yet. Subplots grow out of the story's loose ends as story time passes.</p>
      {/each}
    </Module>

    {#if pending.length}
      <Module title="On its way to the scene" peek={String(pending.length)}>
        {#each pending as a (a.id)}
          {@const Icon = routeOf(a.route)}
          <div class="route"><span class="st-chip faint rt" title={a.route}><Icon size={12} /> {a.route}</span><span>{a.text}</span></div>
        {/each}
      </Module>
    {/if}
    {#if w.news.length && !surprise}
      <Module title="News off the page" peek={String(w.news.length)}>
        <div class="ticker st-lcd" aria-hidden="true"><span><Radio size={12} /> {(w.news[0]?.to ?? "").toUpperCase()} HEARD FROM {(w.news[0]?.from ?? "").toUpperCase()}</span></div>
        {#each w.news.slice(0, 3) as n, i (i)}<p class="news">{n.to} heard from {n.from} ({n.medium}){n.distorted ? ", garbled" : ""}: {n.statement}</p>{/each}
      </Module>
    {/if}
  </div>
{/if}

<style>
  .first {
    margin-top: 0;
  }
  .now {
    font-size: calc(12px * var(--st-lcd-k));
  }
  .dice {
    border-radius: 50%;
  }
  .dice.rolling :global(svg) {
    animation: roll 0.6s linear infinite;
  }
  @keyframes roll {
    to {
      transform: rotate(360deg);
    }
  }
  .scope {
    padding: 8px;
    border-radius: var(--r-sm);
    background:
      repeating-linear-gradient(0deg, transparent 0 11px, color-mix(in srgb, var(--text) 7%, transparent) 11px 12px),
      repeating-linear-gradient(90deg, transparent 0 23px, color-mix(in srgb, var(--text) 7%, transparent) 23px 24px),
      var(--st-well);
    box-shadow: var(--st-inset);
  }
  .scope svg {
    display: block;
    width: 100%;
    height: 54px;
  }
  .value {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    filter: drop-shadow(0 0 3px color-mix(in srgb, var(--accent) 60%, transparent));
  }
  .target {
    fill: none;
    stroke: var(--st-cool);
    stroke-width: 1.2;
    stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke;
  }
  .cap {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin-top: 6px;
  }
  .cap span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .key-v,
  .key-t {
    display: inline-block;
    width: 14px;
    height: 0;
    border-top: 2px solid var(--accent);
  }
  .key-t {
    border-top: 1.5px dashed var(--st-cool);
  }
  .sky {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 10px 0 0;
    font: italic 12.5px/1.4 var(--st-story);
    color: var(--text-muted);
  }
  .sky :global(svg) {
    flex: 0 0 auto;
    color: var(--st-warm);
  }

  /* calls waiting on you: new subplots and fates */
  .call {
    display: grid;
    gap: 6px;
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: var(--surface);
    border: var(--st-bw) solid color-mix(in srgb, var(--st-warm) 55%, var(--st-edge));
    box-shadow: var(--st-card);
  }
  .call.fate {
    border-color: color-mix(in srgb, var(--danger) 55%, var(--st-edge));
    background: linear-gradient(color-mix(in srgb, var(--danger) 7%, var(--surface)), var(--surface));
  }
  .call-h {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .call p {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
  }
  .call .why {
    font: italic 12px/1.4 var(--st-story);
    color: var(--text-muted);
  }
  .call .st-keys {
    margin-top: 4px;
  }

  /* subplots */
  :root .studio a.arc {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 8px 6px;
    border-radius: var(--r-sm);
    color: var(--text);
    text-decoration: none;
  }
  .arc + .arc {
    border-top: 1px dashed var(--st-edge);
  }
  .arc:hover {
    background: var(--st-fill);
  }
  .pie {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: conic-gradient(var(--accent) calc(var(--p) * 360deg), color-mix(in srgb, var(--text) 10%, transparent) 0);
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 3px var(--st-edge);
  }
  .arc-t {
    min-width: 0;
  }
  .arc-n {
    display: block;
    font-size: 13px;
  }
  .arc-b {
    display: block;
    margin-top: 2px;
    font: italic 12px/1.35 var(--st-story);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .clock {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 3px;
    max-width: 64px;
  }
  .clock i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }
  .clock i.on {
    background: var(--st-warm);
    box-shadow: 0 0 5px var(--st-warm);
  }

  /* routes and news */
  .route {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 8px;
    padding: 6px 0;
    font-size: 12.5px;
    line-height: 1.4;
  }
  .route + .route {
    border-top: 1px dashed var(--st-edge);
  }
  .rt {
    text-transform: capitalize;
  }
  .ticker {
    overflow: hidden;
    padding: 6px 10px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: var(--st-inset-sm);
    font-size: calc(10px * var(--st-lcd-k));
    white-space: nowrap;
  }
  .ticker span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    animation: tick 14s linear infinite;
  }
  @keyframes tick {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(-100%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ticker span,
    .dice.rolling :global(svg) {
      animation: none;
    }
  }
  .news {
    margin: 8px 0 0;
    font-size: 12.5px;
    line-height: 1.45;
  }
</style>
