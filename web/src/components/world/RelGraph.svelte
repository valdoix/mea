<script lang="ts">
  import { get } from "../../lib/api";
  import { Pause, Play } from "../../lib/icons";
  import { errorToast } from "../../lib/state.svelte";

  /**
   * G2: the relationship graph with a time slider. Layers: bonds (warmth, trust, affection or
   * resentment as colours), knowledge (who knows the selected secret), factions, and object
   * trails. Drag the slider through the story (or Play it like a film); click a line for the
   * bond's history with Jump to the message; pick a person to see only their web.
   */
  interface Node {
    id: string;
    name: string;
    isUser: boolean;
    isMain: boolean;
    present: boolean;
    dead: boolean;
    color: string | null;
    faction: string | null;
  }
  interface Edge {
    from: string;
    to: string;
    label: string | null;
    axes: Record<string, number>;
    warmth: number;
    heat: number;
    ladder: number | null;
    history: { axis: string; delta: number; to: number; cause: string | null; seq: number }[];
  }
  interface Graph {
    nodes: Node[];
    edges: Edge[];
    secrets: { key: string; statement: string; knows: string[]; unaware: string[] }[];
    trails: { id: string; name: string; gift: string | null; steps: { from: string | null; to: string; seq: number; at: string | null }[] }[];
    seq: number;
    maxSeq: number;
  }
  type Layer = "bonds" | "knowledge" | "factions" | "objects";

  let { chatId, focus = $bindable(null) }: { chatId: string; focus?: string | null } = $props();

  let graph = $state<Graph | null>(null);
  let positions = $state(new Map<string, { x: number; y: number }>());
  let scrub = $state(0);
  let playing = $state(false);
  let layer = $state<Layer>("bonds");
  let axis = $state<"warmth" | "trust" | "affection" | "resentment">("warmth");
  let secretKey = $state("");
  let itemId = $state("");
  let selectedEdge = $state<string | null>(null);
  let selectedNode = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let player: ReturnType<typeof setInterval> | undefined;

  async function load(seq?: number) {
    try {
      const g = await get<Graph>(`/api/chats/${chatId}/trackers/graph${seq != null ? `?seq=${seq}` : ""}`);
      // Places come from the whole story once, so people don't jump around as the slider moves.
      if (!positions.size || g.nodes.some((n) => !positions.has(n.id))) positions = layoutOf(g);
      graph = g;
      if (seq == null) scrub = g.maxSeq;
      if (!secretKey && g.secrets[0]) secretKey = g.secrets[0].key;
      if (!itemId && g.trails[0]) itemId = g.trails[0].id;
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void chatId;
    positions = new Map();
    void load();
    return () => {
      clearInterval(player);
      clearTimeout(timer);
    };
  });
  function onScrub() {
    clearTimeout(timer);
    timer = setTimeout(() => void load(scrub), 120);
  }
  function play() {
    if (playing) {
      playing = false;
      clearInterval(player);
      return;
    }
    if (!graph) return;
    if (scrub >= graph.maxSeq) scrub = 1;
    playing = true;
    const step = Math.max(1, Math.round(graph.maxSeq / 60));
    player = setInterval(() => {
      if (!graph || scrub >= graph.maxSeq) {
        playing = false;
        clearInterval(player);
        return;
      }
      scrub = Math.min(graph.maxSeq, scrub + step);
      void load(scrub);
    }, 450);
  }

  /** A small force layout (springs along bonds, everyone pushing apart), deterministic and run once. */
  function layoutOf(g: Graph) {
    const ids = g.nodes.filter((n) => n.isUser || n.isMain || g.edges.some((e) => e.from === n.id || e.to === n.id) || g.trails.some((t) => t.steps.some((s) => s.to === n.id || s.from === n.id))).map((n) => n.id);
    const p = new Map(ids.map((id, i) => [id, { x: 50 + Math.cos((i / ids.length) * Math.PI * 2) * 30, y: 50 + Math.sin((i / ids.length) * Math.PI * 2) * 30 }]));
    const k = Math.min(30, 70 / Math.sqrt(Math.max(1, ids.length)));
    for (let it = 0; it < 220; it++) {
      const f = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const a = p.get(ids[i]!)!;
          const b = p.get(ids[j]!)!;
          const dx = a.x - b.x || 0.01;
          const dy = a.y - b.y || 0.01;
          const d = Math.hypot(dx, dy);
          const r = (k * k) / d / d;
          f.get(ids[i]!)!.x += dx * r;
          f.get(ids[i]!)!.y += dy * r;
          f.get(ids[j]!)!.x -= dx * r;
          f.get(ids[j]!)!.y -= dy * r;
        }
      for (const e of g.edges) {
        const a = p.get(e.from);
        const b = p.get(e.to);
        if (!a || !b) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const s = d / k / 2;
        f.get(e.from)!.x -= dx * s * 0.5;
        f.get(e.from)!.y -= dy * s * 0.5;
        f.get(e.to)!.x += dx * s * 0.5;
        f.get(e.to)!.y += dy * s * 0.5;
      }
      const t = 2.5 * (1 - it / 220) + 0.1;
      for (const id of ids) {
        const v = f.get(id)!;
        const q = p.get(id)!;
        v.x += (50 - q.x) * 0.02;
        v.y += (50 - q.y) * 0.02;
        const m = Math.hypot(v.x, v.y) || 1;
        q.x = Math.min(92, Math.max(8, q.x + (v.x / m) * Math.min(m, t)));
        q.y = Math.min(90, Math.max(8, q.y + (v.y / m) * Math.min(m, t)));
      }
    }
    return p;
  }

  const ekey = (e: Edge) => `${e.from}>${e.to}`;
  const name = (id: string) => graph?.nodes.find((n) => n.id === id)?.name ?? id;
  const near = $derived.by(() => {
    if (!focus || !graph) return null;
    const s = new Set([focus]);
    for (const e of graph.edges) if (e.from === focus || e.to === focus) s.add(e.from), s.add(e.to);
    return s;
  });
  const visibleNodes = $derived(graph ? graph.nodes.filter((n) => positions.has(n.id) && (!near || near.has(n.id))) : []);
  const visibleEdges = $derived(graph ? graph.edges.filter((e) => positions.has(e.from) && positions.has(e.to) && (!focus || e.from === focus || e.to === focus)) : []);
  const secret = $derived(graph?.secrets.find((s) => s.key === secretKey) ?? null);
  const trail = $derived(graph?.trails.find((t) => t.id === itemId) ?? null);
  const edge = $derived(graph?.edges.find((e) => ekey(e) === selectedEdge) ?? null);

  const FACTION = ["#82e3d3", "#ffb86b", "#c7b4ff", "#ff9ec0", "#9cc4ff", "#b6f08a", "#ffd08f"];
  const factions = $derived([...new Set((graph?.nodes ?? []).map((n) => n.faction).filter((f): f is string => Boolean(f)))]);
  const factionColor = (f: string | null) => (f ? FACTION[factions.indexOf(f) % FACTION.length] : "var(--border)");

  function value(e: Edge) {
    if (axis === "warmth") return e.warmth;
    return e.axes[axis] ?? 0;
  }
  function edgeColor(e: Edge) {
    if (layer !== "bonds") return "var(--border)";
    const v = value(e);
    if (axis === "resentment") return v > 0 ? "var(--danger)" : "var(--border)";
    return v > 0.5 ? "var(--mint)" : v < -0.5 ? "var(--danger)" : "var(--lavender)";
  }
  const edgeWidth = (e: Edge) => (layer === "bonds" ? 0.35 + Math.min(5, Math.abs(value(e))) * 0.28 : 0.3);
  function nodeFill(n: Node) {
    if (layer === "knowledge" && secret) return secret.knows.includes(n.id) ? "var(--mint)" : secret.unaware.includes(n.id) ? "var(--danger)" : "var(--surface-2)";
    return n.color ?? (n.isUser ? "var(--lavender)" : n.isMain ? "var(--accent)" : "var(--surface-2)");
  }
  function curve(a: { x: number; y: number }, b: { x: number; y: number }, back: boolean) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = back ? 2.2 : 0;
    const nx = (-dy / len) * off;
    const ny = (dx / len) * off;
    return { x1: a.x + nx + (dx / len) * 5, y1: a.y + ny + (dy / len) * 5, x2: b.x + nx - (dx / len) * 6, y2: b.y + ny - (dy / len) * 6, mx: (a.x + b.x) / 2 + nx * 2, my: (a.y + b.y) / 2 + ny * 2 };
  }
</script>

{#if graph}
  <div class="rg">
    <div class="bar row wrap">
      <div class="seg" role="radiogroup" aria-label="Layer">
        {#each [["bonds", "Bonds"], ["knowledge", "Knowledge"], ["factions", "Factions"], ["objects", "Objects"]] as [v, l] (v)}
          <button type="button" role="radio" aria-checked={layer === v} class:on={layer === v} onclick={() => (layer = v as Layer)}>{l}</button>
        {/each}
      </div>
      {#if layer === "bonds"}
        <select class="select tiny" bind:value={axis} aria-label="Bond colour">
          <option value="warmth">Warmth</option><option value="trust">Trust</option><option value="affection">Affection</option><option value="resentment">Resentment</option>
        </select>
      {:else if layer === "knowledge"}
        <select class="select tiny grow" bind:value={secretKey} aria-label="Which secret" disabled={!graph.secrets.length}>
          {#each graph.secrets as s (s.key)}<option value={s.key}>{s.statement.slice(0, 60)}</option>{:else}<option value="">No secrets yet</option>{/each}
        </select>
      {:else if layer === "objects"}
        <select class="select tiny grow" bind:value={itemId} aria-label="Which object" disabled={!graph.trails.length}>
          {#each graph.trails as t (t.id)}<option value={t.id}>{t.name}{t.gift ? " (a gift)" : ""}</option>{:else}<option value="">No objects have changed hands yet</option>{/each}
        </select>
      {/if}
      {#if focus}<button type="button" class="chip tiny" onclick={() => (focus = null)}>Only {name(focus)} ✕</button>{/if}
    </div>

    <div class="card canvas">
      <svg viewBox="0 0 100 100" role="img" aria-label="Relationship graph as of message {graph.seq}">
        <defs>
          <marker id="rg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--text-muted)" /></marker>
          <marker id="rg-trail" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--butter, #ffd08f)" /></marker>
        </defs>
        {#each visibleEdges as e (ekey(e))}
          {@const a = positions.get(e.from)!}
          {@const b = positions.get(e.to)!}
          {@const c = curve(a, b, graph.edges.some((x) => x.from === e.to && x.to === e.from))}
          <g class="edge" class:sel={selectedEdge === ekey(e)}>
            <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke={edgeColor(e)} stroke-width={edgeWidth(e)} marker-end="url(#rg-arrow)" opacity={layer === "bonds" ? 0.9 : 0.35} />
            <line class="hit" x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} role="button" tabindex="0" aria-label="{name(e.from)} to {name(e.to)}" onclick={() => (selectedEdge = ekey(e))} onkeydown={(ev) => ev.key === "Enter" && (selectedEdge = ekey(e))} />
            {#if layer === "bonds" && (e.label || e.ladder)}<text x={c.mx} y={c.my} class="elabel" text-anchor="middle">{e.ladder ? `💗${e.ladder} ` : ""}{e.label ?? ""}</text>{/if}
          </g>
        {/each}
        {#if layer === "objects" && trail}
          {#each trail.steps.filter((s) => s.from && s.seq <= graph!.seq && positions.has(s.from) && positions.has(s.to)) as s, i (i)}
            {@const c = curve(positions.get(s.from!)!, positions.get(s.to)!, true)}
            <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="var(--butter, #ffd08f)" stroke-width="0.7" stroke-dasharray="1.6 1" marker-end="url(#rg-trail)" />
            <text x={c.mx} y={c.my} class="elabel trail" text-anchor="middle">#{s.seq}</text>
          {/each}
        {/if}
        {#each visibleNodes as n (n.id)}
          {@const p = positions.get(n.id)!}
          <g class="node" class:sel={selectedNode === n.id} onclick={() => (selectedNode = selectedNode === n.id ? null : n.id)} role="button" tabindex="0" aria-label={n.name} onkeydown={(ev) => ev.key === "Enter" && (selectedNode = n.id)}>
            <circle cx={p.x} cy={p.y} r={n.isUser || n.isMain ? 4.4 : 3.6} fill={nodeFill(n)} stroke={layer === "factions" ? factionColor(n.faction) : n.present ? "var(--accent)" : "var(--border)"} stroke-width={layer === "factions" ? 1.2 : 0.5} />
            <text x={p.x} y={p.y + 7} text-anchor="middle" class="nlabel">{n.name}{n.dead ? " †" : ""}</text>
          </g>
        {/each}
      </svg>
    </div>

    <div class="row slider">
      <button type="button" class="btn ghost icon small" onclick={play} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play it through the story"}>{#if playing}<Pause size={15} />{:else}<Play size={15} />{/if}</button>
      <input type="range" min="1" max={graph.maxSeq || 1} bind:value={scrub} oninput={onScrub} aria-label="As of message" class="grow" />
      <span class="tiny muted">#{graph.seq}</span>
    </div>

    {#if layer === "factions" && factions.length}
      <div class="legend tiny">{#each factions as f (f)}<span><i style:background={factionColor(f)}></i>{f}</span>{/each}</div>
    {/if}
    {#if layer === "knowledge" && secret}
      <div class="tiny legend"><span><i style:background="var(--mint)"></i>knows</span><span><i style:background="var(--danger)"></i>doesn't know</span></div>
    {/if}

    {#if selectedNode && !focus}
      <div class="row"><b class="small">{name(selectedNode)}</b><button type="button" class="btn ghost small" onclick={() => ((focus = selectedNode), (selectedNode = null))}>Only their web</button></div>
    {/if}

    {#if edge}
      <div class="card details">
        <div class="row between"><b class="small">{name(edge.from)} → {name(edge.to)}{edge.label ? ` · “${edge.label}”` : ""}</b><button type="button" class="btn ghost small" onclick={() => (selectedEdge = null)}>Close</button></div>
        <div class="tiny muted">{Object.entries(edge.axes).filter(([, v]) => v).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(" · ") || "no feelings recorded yet"}</div>
        {#each [...edge.history].reverse() as h, i (i)}
          <div class="hrow small">
            <span class:up={h.delta > 0 === (h.axis !== "resentment")} class="mv">{h.axis} {h.delta > 0 ? "+" : ""}{h.delta}</span>
            <span class="grow muted">{h.cause ?? ""}</span>
            <a class="tiny" href="/chat/{chatId}?at={h.seq}">Jump to #{h.seq}</a>
          </div>
        {:else}
          <p class="tiny muted">No changes recorded yet.</p>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .rg {
    display: grid;
    gap: 0.5rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .wrap {
    flex-wrap: wrap;
  }
  .between {
    justify-content: space-between;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .bar .select {
    width: auto;
    max-width: 100%;
  }
  .bar .select.grow {
    flex: 1;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
  }
  .seg button {
    border: 0;
    background: none;
    color: var(--text-muted);
    padding: 0.25rem 0.65rem;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .seg button.on {
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
  .canvas {
    padding: 0.5rem;
  }
  svg {
    width: 100%;
    max-height: 66vh;
    display: block;
  }
  .edge line {
    transition:
      stroke 0.3s,
      stroke-width 0.3s;
  }
  .edge .hit {
    stroke: transparent;
    stroke-width: 3;
    cursor: pointer;
  }
  .edge.sel line:first-child {
    stroke: var(--accent);
  }
  .nlabel {
    font: 600 2.6px var(--font-ui);
    fill: var(--text);
  }
  .elabel {
    font: 2.1px var(--font-ui);
    fill: var(--text-muted);
  }
  .elabel.trail {
    fill: var(--butter, #ffd08f);
  }
  .node {
    cursor: pointer;
  }
  .node circle {
    transition: fill 0.3s;
  }
  .node.sel circle {
    stroke: var(--accent);
    stroke-width: 1;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
  }
  .legend i {
    display: inline-block;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    margin-right: 0.25rem;
    vertical-align: middle;
  }
  .details {
    padding: 0.7rem;
    display: grid;
    gap: 0.3rem;
  }
  .hrow {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
  .mv {
    color: var(--danger);
    white-space: nowrap;
  }
  .mv.up {
    color: var(--mint, var(--accent));
  }
</style>
