<script lang="ts">
  import { Maximize2 } from "../../../lib/icons";
  import type { Boundary } from "../../../lib/types";

  /** Stage: the story as a river under the composer: its chapters, its marks and where you are. Click to jump. */
  let {
    chapters,
    max,
    current,
    marks,
    onjump,
    onopen,
  }: {
    chapters: Boundary[];
    max: number;
    current: number;
    marks: { seq: number; kind: string; title: string }[];
    onjump: (seq: number) => void;
    onopen: () => void;
  } = $props();

  const spans = $derived.by(() => {
    const list = chapters.length ? chapters : [{ id: "all", startSeq: 1, title: "The story so far" } as Boundary];
    return list.map((c, i) => ({
      id: c.id,
      n: i + 1,
      title: c.title || "A new chapter",
      start: i === 0 ? 1 : c.startSeq,
      end: Math.max(list[i + 1]?.startSeq ?? max + 1, (i === 0 ? 1 : c.startSeq) + 1),
    }));
  });
  const flexOf = (s: { start: number; end: number }) => Math.max(1, s.end - s.start);
  const at = (seq: number, s: { start: number; end: number }) => `${((seq - s.start) / (s.end - s.start)) * 100}%`;
</script>

<div class="river">
  <span class="r-end">#1</span>
  <div class="lane" aria-label="Chapters">
    {#each spans as s (s.id)}
      {@const here = current >= s.start && current < s.end}
      <button class="ch" class:now={here} style:flex={flexOf(s)} onclick={() => onjump(s.start)} title="{s.n} · {s.title}" aria-current={here ? "true" : undefined}>
        <span class="ch-l">{s.n} · {s.title}</span>
        <span class="ticks" aria-hidden="true"></span>
        {#each marks.filter((m) => m.kind !== "chapter" && m.seq >= s.start && m.seq < s.end) as m, i (i)}<span class="mk {m.kind}" style:left={at(m.seq, s)} aria-hidden="true"></span>{/each}
        {#if here}<span class="here" style:left={at(current, s)} aria-hidden="true"></span>{/if}
      </button>
    {/each}
  </div>
  <span class="r-end">#{max}</span>
  <button class="btn ghost icon small" onclick={onopen} aria-label="Open the river: the whole story on a map" title="Open the river"><Maximize2 size={15} /></button>
</div>
