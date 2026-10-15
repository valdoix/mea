<script lang="ts">
  import Module from "../desk/Module.svelte";
  import Seg from "../desk/Seg.svelte";
  import { get } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import type { Planbook, PlanStats, PlanTrendPoint } from "../../lib/types";

  /**
   * The planner's notebook: how this story's plans turned out, from the replies you've answered.
   * Three numbers carry it (kept on the first take, swipes, slips), each for the last 20 replies
   * against the ones before, with its line across the whole story, so you can see whether the
   * planning is getting better. Learned notes join it later.
   */
  let { chatId }: { chatId: string } = $props();

  let scope = $state<"chat" | "model">("chat");
  let book = $state<Planbook | null>(null);

  async function load() {
    try {
      book = await get<Planbook>(`/api/chats/${chatId}/planbook${scope === "model" ? "?scope=model" : ""}`);
    } catch {
      // optional
    }
  }
  $effect(() => {
    void chatId;
    void scope;
    void load();
  });
  let timer: ReturnType<typeof setTimeout>;
  $effect(() =>
    onEvent((e) => {
      if ((e.type === "gen.end" || e.type === "message.changed" || e.type === "chat.changed") && "chatId" in e && e.chatId === chatId) {
        clearTimeout(timer);
        timer = setTimeout(() => void load(), 800);
      }
    }),
  );

  type Key = "firstTry" | "swipes" | "slips";
  const METRICS: { key: Key; label: string; up: boolean; fmt: (v: number) => string; diff: (d: number) => string }[] = [
    { key: "firstTry", label: "Kept on the first take", up: true, fmt: (v) => `${Math.round(v * 100)}%`, diff: (d) => `${Math.round(Math.abs(d) * 100)} pts` },
    { key: "swipes", label: "Swipes per reply", up: false, fmt: (v) => v.toFixed(1), diff: (d) => Math.abs(d).toFixed(1) },
    { key: "slips", label: "Slips per 100 replies", up: false, fmt: (v) => String(Math.round(v)), diff: (d) => String(Math.round(Math.abs(d))) },
  ];
  const ENOUGH = 5;

  /** The change from the replies before the last 20, when there are enough of them to compare. */
  function delta(key: Key) {
    if (!book || book.earlier.n < ENOUGH) return null;
    const now = book.recent[key];
    const then = book.earlier[key];
    if (now == null || then == null) return null;
    const d = now - then;
    const m = METRICS.find((x) => x.key === key)!;
    if (Math.abs(d) < (key === "firstTry" ? 0.02 : key === "swipes" ? 0.05 : 1)) return { text: "steady", tone: "flat" as const };
    const better = d > 0 === m.up;
    return { text: `${d > 0 ? "▲" : "▼"} ${m.diff(d)} ${better ? "better" : "worse"}`, tone: better ? ("good" as const) : ("bad" as const) };
  }

  // The sparkline, drawn in pixels so its line and dots keep their size at any width.
  const H = 34;
  const PAD = 5;
  let width = $state(0);
  let hover = $state<{ key: Key; i: number } | null>(null);
  function points(trend: PlanTrendPoint[], key: Key) {
    const vals = trend.map((p) => p[key] ?? 0);
    const hi = key === "firstTry" ? 1 : Math.max(...vals, key === "swipes" ? 1 : 10);
    const w = Math.max(width, 40);
    const step = trend.length > 1 ? (w - PAD * 2) / (trend.length - 1) : 0;
    return vals.map((v, i) => ({ x: trend.length > 1 ? PAD + i * step : w / 2, y: H - PAD - (v / (hi || 1)) * (H - PAD * 2) }));
  }
  const tip = (p: PlanTrendPoint, key: Key) => {
    const m = METRICS.find((x) => x.key === key)!;
    return `Messages ${p.fromSeq}–${p.toSeq} · ${m.fmt(p[key] ?? 0)} · ${p.n} replies`;
  };

  const TIERS = ["Routine", "Charged", "Pivotal"] as const;
  const HOW: Record<string, string> = { own: "Its own reasoning", step: "A step of its own", first: "Planned first", planner: "The planner model", rescue: "The planner, as a last resort", none: "No plan" };
  const pct = (s: PlanStats | undefined) => (s?.firstTry == null ? "–" : `${Math.round(s.firstTry * 100)}%`);
  const peek = $derived(!book || book.all.n < ENOUGH ? "Filling in" : book.recent.firstTry == null ? "" : `${Math.round(book.recent.firstTry * 100)}% first take`);
</script>

<Module title="Planner's notebook" fold open={false} {peek}>
  <div class="st-seg-row">
    <span class="st-k">Plans in</span>
    <Seg
      label="Whose plans the notebook counts"
      value={scope}
      options={[
        { value: "chat", label: "This story" },
        { value: "model", label: "This model", title: "Every story this model wrote" },
      ]}
      onchange={(v) => (scope = v as "chat" | "model")}
    />
  </div>

  {#if !book || book.all.n < ENOUGH}
    <p class="st-hint">Every reply is planned before it's written. Once you've answered {ENOUGH} of them, this shows how the plans turned out: the takes you kept on the first try, the swipes, and the slips the checker found.</p>
  {:else}
    <p class="st-hint">
      The last {book.recent.n} replies{book.earlier.n >= ENOUGH ? `, against the ${book.earlier.n} before` : ""}{book.scope === "model" && book.model ? `, in every story ${book.model} wrote` : ""}.
    </p>
    <div class="tiles">
      {#each METRICS as m (m.key)}
        {@const d = delta(m.key)}
        {@const pts = points(book.trend, m.key)}
        <div class="tile">
          <span class="label">{m.label}</span>
          <span class="value">{book.recent[m.key] == null ? "–" : m.fmt(book.recent[m.key]!)}</span>
          {#if d}<span class="delta {d.tone}">{d.text}</span>{/if}
          {#if book.trend.length > 1}
            <div class="sparkbox" bind:clientWidth={width}>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <svg class="spark" height={H} role="img" aria-label="{m.label} across the story: {book.trend.map((p) => m.fmt(p[m.key] ?? 0)).join(', ')}" onmouseleave={() => (hover = null)}>
              <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />
              {#each pts as p, i (i)}
                <rect class="hit" x={p.x - 8} y="0" width="16" height={H} onmouseenter={() => (hover = { key: m.key, i })} />
                {#if i === pts.length - 1 || (hover?.key === m.key && hover.i === i)}<circle cx={p.x} cy={p.y} r="4" class:last={i === pts.length - 1} />{/if}
              {/each}
            </svg>
            </div>
            {#if hover?.key === m.key}<span class="tip">{tip(book.trend[hover.i]!, m.key)}</span>{/if}
          {/if}
        </div>
      {/each}
    </div>
    {#if book.all.planned != null && book.all.planned < 1}
      <p class="st-hint">{Math.round(book.all.planned * 100)}% of these replies have a readable plan: the rest came before planning was mandatory, or every planning try failed.</p>
    {/if}

    <table class="by">
      {#if TIERS.some((t) => book!.byTier[t])}
        <thead><tr><th>By beat</th><th>Replies</th><th>First take</th></tr></thead>
        <tbody>
          {#each TIERS as t (t)}{#if book.byTier[t]}<tr><td>{t}</td><td>{book.byTier[t]!.n}</td><td>{pct(book.byTier[t])}</td></tr>{/if}{/each}
        </tbody>
      {/if}
      <thead><tr><th>Planned by</th><th>Replies</th><th>First take</th></tr></thead>
      <tbody>
        {#each Object.entries(book.byHow) as [how, s] (how)}<tr><td>{HOW[how] ?? how}</td><td>{s!.n}</td><td>{pct(s)}</td></tr>{/each}
      </tbody>
    </table>

    {#if book.slipKinds.length}
      <div class="slips">
        <span class="st-k">Slips lately</span>
        {#each book.slipKinds as s (s.kind)}<span class="chip">{s.kind} ×{s.count}</span>{/each}
      </div>
    {/if}

    <details class="numbers">
      <summary class="st-link">Numbers</summary>
      <table class="by">
        <thead><tr><th>Messages</th><th>Replies</th><th>First take</th><th>Swipes</th><th>Slips /100</th></tr></thead>
        <tbody>
          {#each book.trend as p (p.fromSeq)}<tr><td>{p.fromSeq}–{p.toSeq}</td><td>{p.n}</td><td>{pct(p)}</td><td>{(p.swipes ?? 0).toFixed(1)}</td><td>{Math.round(p.slips ?? 0)}</td></tr>{/each}
        </tbody>
      </table>
    </details>
  {/if}
</Module>

<style>
  .tiles {
    display: grid;
    gap: 0.5rem;
    margin: 0.4rem 0;
  }
  .tile {
    position: relative;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    gap: 0.1rem 0.6rem;
    padding: 0.5rem 0.6rem 0.3rem;
    border-radius: var(--r-md, 12px);
    background: var(--surface-2);
  }
  .label {
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .value {
    grid-row: span 2;
    font: 600 1.35rem/1 var(--font-ui);
    color: var(--text);
  }
  .delta {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-muted);
  }
  .delta.good {
    color: var(--ok);
  }
  .delta.bad {
    color: var(--danger);
  }
  .sparkbox {
    grid-column: 1 / -1;
  }
  .spark {
    display: block;
    width: 100%;
    overflow: visible;
  }
  polyline {
    fill: none;
    stroke: var(--text-faint);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  circle {
    fill: var(--text-muted);
    stroke: var(--surface-2);
    stroke-width: 2;
  }
  circle.last {
    fill: var(--accent);
  }
  .hit {
    fill: transparent;
  }
  .tip {
    grid-column: 1 / -1;
    font-size: var(--fs-xs);
    color: var(--text);
  }
  .by {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
  }
  .by th {
    text-align: left;
    padding: 0.5rem 0 0.15rem;
    font-weight: 700;
    color: var(--text-muted);
  }
  .by td {
    padding: 0.15rem 0;
    border-top: 1px solid var(--border);
  }
  .by td:not(:first-child),
  .by th:not(:first-child) {
    text-align: right;
  }
  .slips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.6rem;
  }
  .numbers {
    margin-top: 0.5rem;
  }
</style>
