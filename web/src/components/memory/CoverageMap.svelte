<script lang="ts">
  import type { CoverageRow, MemoryOverview, SummaryLevel } from "../../lib/types";

  /** Which message ranges are covered at which level, with gaps highlighted (SUM-09). */
  let { overview, onpick }: { overview: MemoryOverview; onpick?: (row: CoverageRow) => void } = $props();

  const LEVELS: { level: SummaryLevel; label: string }[] = [
    { level: "story", label: "Story" },
    { level: "arc", label: "Arcs" },
    { level: "chapter", label: "Chapters" },
    { level: "scene", label: "Scenes" },
  ];

  const lo = $derived(overview.firstSeq || 1);
  const hi = $derived(Math.max(overview.lastSeq, lo + 1));
  const span = $derived(hi - lo + 1);
  const pct = (seq: number) => `${Math.max(0, Math.min(100, ((seq - lo) / span) * 100))}%`;
  const width = (a: number, b: number) => `${Math.max(0.4, ((Math.min(b, hi) - a + 1) / span) * 100)}%`;
  const end = (r: CoverageRow) => r.endSeq ?? overview.segmentedThrough;
  const label = (r: CoverageRow) => `${r.title || r.level} · #${r.startSeq}–#${r.endSeq ?? "…"} · ${r.closed || r.level === "story" ? r.state : "still open"}`;
</script>

<div class="map" role="group" aria-label="Memory coverage">
  {#each LEVELS as l (l.level)}
    {@const rows = overview.coverage.filter((r) => r.level === l.level)}
    <div class="lane">
      <span class="name tiny muted">{l.label}</span>
      <div class="track">
        {#each rows as r (r.id)}
          <button
            class="seg {r.closed || r.level === 'story' ? r.state : 'open'}"
            style:left={pct(r.startSeq)}
            style:width={width(r.startSeq, end(r))}
            title={label(r)}
            aria-label={label(r)}
            onclick={() => onpick?.(r)}
          ></button>
        {/each}
        {#if l.level === "scene"}
          {#each overview.gaps as g (g.startSeq)}
            <span class="gap" style:left={pct(g.startSeq)} style:width={width(g.startSeq, g.endSeq)} title="Gap #{g.startSeq}–#{g.endSeq}: {g.reason}"></span>
          {/each}
        {/if}
      </div>
    </div>
  {/each}
  <div class="lane">
    <span class="name tiny muted">Prompt</span>
    <div class="track">
      {#if overview.evictedThrough >= lo}
        <span class="seg summarized" style:left="0%" style:width={width(lo, overview.evictedThrough)} title="Up to #{overview.evictedThrough}: told through summaries and memories"></span>
      {/if}
      <span class="seg verbatim" style:left={pct(overview.evictedThrough + 1)} style:width={width(overview.evictedThrough + 1, hi)} title="From #{overview.evictedThrough + 1}: sent word for word"></span>
    </div>
  </div>
  <div class="row between tiny faint scale"><span>#{lo}</span><span>#{hi}</span></div>
  <div class="row wrap tiny muted legend">
    <span><i class="dot ready"></i>summarized</span>
    <span><i class="dot open"></i>being written</span>
    <span><i class="dot pending"></i>waiting</span>
    <span><i class="dot stale"></i>needs update</span>
    <span><i class="dot error"></i>failed / gap</span>
    <span><i class="dot verbatim"></i>word for word</span>
  </div>
</div>

<style>
  .map {
    display: grid;
    gap: 0.3rem;
  }
  .lane {
    display: grid;
    grid-template-columns: 4.2rem 1fr;
    align-items: center;
    gap: 0.4rem;
  }
  .track {
    position: relative;
    height: 0.75rem;
    border-radius: var(--r-pill);
    background: var(--surface-2);
    overflow: hidden;
  }
  .seg,
  .gap {
    position: absolute;
    top: 0;
    bottom: 0;
    border: 0;
    padding: 0;
    border-right: 1.5px solid var(--surface);
    cursor: pointer;
  }
  .gap {
    background: repeating-linear-gradient(45deg, var(--danger) 0 3px, transparent 3px 6px);
    opacity: 0.7;
    pointer-events: none;
  }
  .ready,
  .dot.ready {
    background: var(--mint);
  }
  .open,
  .dot.open {
    background: var(--sky);
  }
  .pending,
  .building,
  .dot.pending {
    background: var(--butter);
  }
  .stale,
  .review,
  .dot.stale {
    background: var(--peach);
  }
  .error,
  .dot.error {
    background: var(--danger);
  }
  .summarized {
    background: var(--lavender);
  }
  .verbatim,
  .dot.verbatim {
    background: var(--accent);
  }
  .seg:hover {
    filter: brightness(0.92);
  }
  .scale {
    padding-left: 4.6rem;
  }
  .legend {
    gap: 0.7rem;
    margin-top: 0.2rem;
  }
  .dot {
    display: inline-block;
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    margin-right: 0.25rem;
    vertical-align: -0.03rem;
  }
</style>
