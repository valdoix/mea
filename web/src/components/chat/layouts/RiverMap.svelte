<script lang="ts">
  import Avatar from "../../Avatar.svelte";
  import { get } from "../../../lib/api";
  import { Brain, Flag, Heart, ScrollText, Star, X } from "../../../lib/icons";
  import { trk } from "../../../lib/trackers.svelte";
  import type { Atom, Boundary, ChatDetail, Summary } from "../../../lib/types";

  /** Stage: the river, opened: the whole story on one timeline. A mark says what it is; a click goes there. */
  let {
    detail,
    boundaries,
    max,
    current,
    moments,
    continuity,
    onjump,
    onclose,
  }: {
    detail: ChatDetail;
    boundaries: Boundary[];
    max: number;
    current: number;
    moments: { seq: number; kind: string; title: string }[];
    /** Messages with an open continuity question. */
    continuity: { seq: number; title: string }[];
    onjump: (seq: number) => void;
    onclose: () => void;
  } = $props();

  let zoom = $state<"story" | "chapter">("story");
  let memories = $state<{ seq: number; title: string }[]>([]);
  let briefs = $state<Summary[]>([]);
  const chatId = $derived(detail.chat.id);
  $effect(() => {
    get<{ atoms: Atom[] }>(`/api/chats/${chatId}/memories?limit=200`).then(
      (r) => (memories = r.atoms.filter((a) => a.minSeq != null).map((a) => ({ seq: a.minSeq!, title: a.content }))),
      () => (memories = []),
    );
    get<{ summaries: Summary[] }>(`/api/chats/${chatId}/summaries?level=chapter`).then(
      (r) => (briefs = r.summaries),
      () => (briefs = []),
    );
  });

  const chapters = $derived(boundaries.filter((b) => b.level === "chapter").sort((a, b) => a.startSeq - b.startSeq));
  const scenes = $derived(boundaries.filter((b) => b.level === "scene").sort((a, b) => a.startSeq - b.startSeq));
  const nowChapter = $derived([...chapters].reverse().find((c) => c.startSeq <= current) ?? null);
  const from = $derived(zoom === "chapter" && nowChapter ? nowChapter.startSeq : 1);
  const to = $derived.by(() => {
    if (zoom !== "chapter" || !nowChapter) return Math.max(2, max);
    const next = chapters.find((c) => c.startSeq > nowChapter.startSeq);
    return next ? next.startSeq : Math.max(from + 1, max);
  });
  const pct = (seq: number) => ((Math.min(to, Math.max(from, seq)) - from) / Math.max(1, to - from)) * 100;
  const inView = (seq: number) => seq >= from && seq <= to;
  /** Blocks from a list of starts: each runs to the next start. */
  const blocks = (list: Boundary[]) =>
    list
      .map((b, i) => ({ b, n: i + 1, start: b.startSeq, end: list[i + 1]?.startSeq ?? max }))
      .filter((x) => x.end >= from && x.start <= to)
      .map((x) => ({ ...x, left: pct(x.start), width: Math.max(0.4, pct(x.end) - pct(x.start)) }));

  const st = $derived(trk.data?.state ?? null);
  const cast = $derived(st ? Object.values(st.chars).sort((a, b) => Number(b.isUser) - Number(a.isUser) || Number(b.isMain) - Number(a.isMain) || b.lastSeq - a.lastSeq).slice(0, 6) : []);
  const avatarOf = (c: (typeof cast)[number]) => (c.isUser ? (detail.persona?.avatarId ?? null) : c.isMain ? (detail.character?.avatarId ?? null) : (trk.data?.profiles[c.name.toLowerCase()]?.avatarId ?? null));
  const bondMarks = $derived(
    st
      ? Object.values(st.bonds)
          .filter((b) => b.to === "user")
          .flatMap((b) => b.history.map((h) => ({ seq: h.seq, delta: h.delta, title: `${h.axis} ${h.delta > 0 ? "+" : "−"}${Math.abs(h.delta)}${h.cause ? `: ${h.cause}` : ""}` })))
          .filter((h) => h.delta)
      : [],
  );
  const best = $derived(moments.filter((m) => m.kind !== "chapter").slice(-4));
  const brief = $derived(nowChapter ? briefs.find((b) => b.startSeq === nowChapter.startSeq) : briefs.at(-1));
  const ticks = $derived.by(() => {
    const span = to - from;
    const step = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000].find((s) => span / s <= 6) ?? 10000;
    const out: number[] = [];
    for (let s = Math.ceil(from / step) * step; s <= to; s += step) if (s) out.push(s);
    return out;
  });
</script>

<div class="map" role="region" aria-label="The river: the whole story">
  <div class="map-h">
    <h3>The river</h3>
    <span class="muted small">{chapters.length} chapter{chapters.length === 1 ? "" : "s"} · {scenes.length} scene{scenes.length === 1 ? "" : "s"} · {max} messages</span>
    <div class="legend" aria-hidden="true">
      <span><i class="k mem"></i>Memory</span>
      <span><i class="k bond"></i>Bond</span>
      <span><i class="k flag"></i>Continuity</span>
    </div>
    <div class="seg map-seg">
      <button class:on={zoom === "story"} aria-pressed={zoom === "story"} onclick={() => (zoom = "story")}>The whole story</button>
      <button class:on={zoom === "chapter"} aria-pressed={zoom === "chapter"} disabled={!nowChapter} onclick={() => (zoom = "chapter")}>This chapter</button>
    </div>
    <button class="btn ghost icon" onclick={onclose} aria-label="Back to the scene" title="Back to the scene"><X size={18} /></button>
  </div>

  <div class="lanes-wrap">
    <div class="lanes">
      <div class="ln">Chapters</div>
      <div class="tr">{#each blocks(chapters) as x (x.b.id)}<button class="blk chap" class:now={x.b.id === nowChapter?.id} style:left="{x.left}%" style:width="calc({x.width}% - 3px)" title={x.b.title} onclick={() => onjump(x.start)}>{x.n} · {x.b.title || "A new chapter"}</button>{/each}</div>
      <div class="ln">Scenes</div>
      <div class="tr">{#each blocks(scenes) as x (x.b.id)}<button class="blk scene" style:left="{x.left}%" style:width="calc({x.width}% - 3px)" title={x.b.title} onclick={() => onjump(x.start)}>{x.b.title}</button>{/each}</div>
      <div class="lane-sep"></div>
      {#each cast as c (c.id)}
        <div class="ln"><Avatar id={avatarOf(c)} name={c.name} size={24} shape="squircle" /><span class="wraps">{c.name.split(/\s+/)[0]}</span></div>
        <div class="tr"><button class="bar" style:left="{pct(c.firstSeq)}%" style:width="{Math.max(0.6, pct(c.lastSeq) - pct(c.firstSeq))}%" title="{c.name}: first at #{c.firstSeq}, last at #{c.lastSeq}" aria-label="{c.name}: go to #{c.lastSeq}" onclick={() => onjump(c.lastSeq)}></button></div>
      {/each}
      <div class="lane-sep"></div>
      <div class="ln"><Brain size={14} />Memories</div>
      <div class="tr">{#each memories.filter((x) => inView(x.seq)) as x, i (i)}<button class="dot mem" style:left="{pct(x.seq)}%" title="#{x.seq} · {x.title}" aria-label="Memory at #{x.seq}" onclick={() => onjump(x.seq)}></button>{/each}</div>
      <div class="ln"><Heart size={14} />Bond</div>
      <div class="tr">{#each bondMarks.filter((x) => inView(x.seq)) as x, i (i)}<button class="tk" class:up={x.delta > 0} class:dn={x.delta < 0} style:left="{pct(x.seq)}%" title="#{x.seq} · {x.title}" onclick={() => onjump(x.seq)}>{x.delta > 0 ? "+" : "−"}{Math.abs(x.delta)}</button>{/each}</div>
      <div class="ln"><Flag size={14} />Continuity</div>
      <div class="tr">{#each continuity.filter((x) => inView(x.seq)) as x, i (i)}<button class="dia" style:left="{pct(x.seq)}%" title="#{x.seq} · {x.title}" aria-label="Continuity question at #{x.seq}" onclick={() => onjump(x.seq)}></button>{/each}</div>
      <div></div>
      <div class="axis" aria-hidden="true">{#each ticks as t (t)}<span style:left="{pct(t)}%">#{t}</span>{/each}</div>
      <div class="nowwrap" aria-hidden="true"><span class="nowline" style:left="{pct(current)}%"><em>Now · #{current}</em></span></div>
    </div>
  </div>

  <div class="below">
    <div class="card">
      <h4><ScrollText size={12} /> {nowChapter ? `${nowChapter.title || "This chapter"}, in brief` : "In brief"}</h4>
      <p>{brief?.content || "Mea writes a chapter's summary once the story has moved past it."}</p>
    </div>
    <div class="card">
      <h4><Star size={12} /> Best moments</h4>
      {#each best as m, i (i)}
        <button class="moment" onclick={() => onjump(m.seq)}><span class="s">#{m.seq}</span><span>{m.title}</span></button>
      {:else}
        <p class="tiny muted">Bookmark or highlight a line and it lands here.</p>
      {/each}
    </div>
  </div>
</div>
