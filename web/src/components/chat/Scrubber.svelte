<script lang="ts">
  /**
   * UI-10: the timeline scrubber. A thin strip on the chat's edge: chapter marks, bookmarks and
   * highlights, and where you are. Drag (or tap) anywhere to jump, even in a 10,000-message story.
   */
  let {
    max,
    current,
    marks,
    onjump,
  }: {
    max: number;
    current: number;
    marks: { seq: number; kind: "chapter" | "bookmark" | "highlight"; title: string }[];
    onjump: (seq: number) => void;
  } = $props();

  let strip = $state<HTMLDivElement | null>(null);
  let drag = $state<{ seq: number; y: number } | null>(null);

  const pct = (seq: number) => `${Math.min(100, Math.max(0, ((seq - 1) / Math.max(1, max - 1)) * 100))}%`;

  function seqAt(clientY: number) {
    const r = strip!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    return { seq: Math.max(1, Math.round(1 + f * (max - 1))), y: clientY - r.top };
  }
  /** Close to a mark, the jump lands on it. */
  function snap(seq: number) {
    const near = marks.reduce<(typeof marks)[number] | null>((best, m) => (Math.abs(m.seq - seq) <= Math.max(2, max * 0.012) && (!best || Math.abs(m.seq - seq) < Math.abs(best.seq - seq)) ? m : best), null);
    return near ? near.seq : seq;
  }
  function down(e: PointerEvent) {
    strip?.setPointerCapture(e.pointerId);
    drag = seqAt(e.clientY);
  }
  function move(e: PointerEvent) {
    if (drag) drag = seqAt(e.clientY);
  }
  function up() {
    if (!drag) return;
    onjump(snap(drag.seq));
    drag = null;
  }
  const label = $derived.by(() => {
    if (!drag) return "";
    const s = snap(drag.seq);
    const chapter = [...marks].filter((m) => m.kind === "chapter" && m.seq <= s).at(-1);
    const here = marks.find((m) => m.seq === s && m.kind !== "chapter");
    return [`#${s}`, here?.title ? `“${here.title.slice(0, 40)}”` : chapter?.title].filter(Boolean).join(" · ");
  });
  function key(e: KeyboardEvent) {
    const chapterSeqs = marks.filter((m) => m.kind === "chapter").map((m) => m.seq);
    if (e.key === "PageDown" || e.key === "ArrowDown") {
      e.preventDefault();
      onjump(chapterSeqs.find((s) => s > current) ?? max);
    } else if (e.key === "PageUp" || e.key === "ArrowUp") {
      e.preventDefault();
      onjump([...chapterSeqs].reverse().find((s) => s < current - 1) ?? 1);
    } else if (e.key === "Home") onjump(1);
    else if (e.key === "End") onjump(max);
  }
</script>

<div
  class="scrub"
  class:dragging={drag}
  bind:this={strip}
  role="slider"
  tabindex="0"
  aria-label="Story timeline: drag to jump"
  aria-valuemin={1}
  aria-valuemax={max}
  aria-valuenow={current}
  aria-valuetext="Message {current} of {max}"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={() => (drag = null)}
  onkeydown={key}
>
  <span class="rail"></span>
  {#each marks as m (`${m.kind}:${m.seq}:${m.title}`)}
    <span class="mark {m.kind}" style:top={pct(m.seq)} title="{m.kind === 'chapter' ? '' : m.kind === 'bookmark' ? 'Bookmark: ' : 'Highlight: '}{m.title}"></span>
  {/each}
  <span class="here" style:top={pct(current)}></span>
  {#if drag}<span class="tip card tiny" style:top="{drag.y}px">{label}</span>{/if}
</div>

<style>
  .scrub {
    position: absolute;
    right: 2px;
    top: 4.2rem;
    bottom: 7.5rem;
    width: 18px;
    z-index: 3;
    cursor: pointer;
    touch-action: none;
    opacity: 0.45;
    transition: opacity var(--t) var(--ease);
  }
  .scrub:hover,
  .scrub:focus-visible,
  .scrub.dragging {
    opacity: 1;
  }
  .scrub:focus-visible {
    outline: 2px solid var(--accent);
    border-radius: 8px;
  }
  .rail {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 2px;
    translate: -50% 0;
    background: var(--border);
    border-radius: 2px;
  }
  .mark {
    position: absolute;
    left: 50%;
    translate: -50% -50%;
    pointer-events: none;
  }
  .mark.chapter {
    width: 12px;
    height: 2px;
    background: var(--text-muted);
  }
  .mark.bookmark,
  .mark.highlight {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent-strong);
  }
  .mark.highlight {
    background: var(--peach);
  }
  .here {
    position: absolute;
    left: 50%;
    width: 8px;
    height: 18px;
    translate: -50% -50%;
    border-radius: 6px;
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--bg);
    transition: top 120ms linear;
  }
  .dragging .here {
    transition: none;
  }
  .tip {
    position: absolute;
    right: 22px;
    translate: 0 -50%;
    white-space: nowrap;
    padding: 0.25rem 0.55rem;
    pointer-events: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .here {
      transition: none;
    }
  }
</style>
