<script lang="ts">
  import "../../styles/studio.css";
  import Module from "../desk/Module.svelte";
  import { get, post } from "../../lib/api";
  import { onEvent } from "../../lib/events";
  import { compact, debounce } from "../../lib/format";
  import { Brain, Library, RefreshCw } from "../../lib/icons";
  import { navigate } from "../../lib/router.svelte";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { CoverageRow, MemoryOverview, Summary, SummaryLevel } from "../../lib/types";

  // onjump: scroll the chat to a message (the continuity tile); without it the tile links to the chat.
  let { chatId, onjump }: { chatId: string; onjump?: (messageId: string) => void } = $props();

  let overview = $state<MemoryOverview | null>(null);
  let story = $state<Summary | null>(null);

  async function load() {
    try {
      const [o, s] = await Promise.all([get<MemoryOverview>(`/api/chats/${chatId}/memory`), get<{ summaries: Summary[] }>(`/api/chats/${chatId}/summaries?level=story`)]);
      overview = o;
      story = s.summaries[0] ?? null;
    } catch (e) {
      errorToast(e);
    }
  }
  const soon = debounce(load, 800);
  $effect(() => {
    void load();
  });
  $effect(() => onEvent((e) => (e.type === "memory.changed" && e.chatId === chatId) || e.type === "reconnected" ? soon() : undefined));

  // Phase 3: open continuity notes and Chronicle proposals waiting for you.
  let openNotes = $state(0);
  let noteMessages = $state<string[]>([]);
  let proposals = $state(0);
  async function loadPhase3() {
    try {
      const [f, c] = await Promise.all([get<{ flags: { open: number; messageId: string }[] }>(`/api/chats/${chatId}/continuity?open=1`), get<{ proposals: unknown[] }>(`/api/chats/${chatId}/chronicle`)]);
      openNotes = f.flags.reduce((n, x) => n + x.open, 0);
      noteMessages = f.flags.filter((x) => x.open).map((x) => x.messageId);
      proposals = c.proposals.length;
    } catch {
      // optional
    }
  }
  $effect(() => {
    void loadPhase3();
  });
  $effect(() => onEvent((e) => ((e.type === "continuity.changed" || e.type === "memory.changed") && e.chatId === chatId ? void loadPhase3() : undefined)));

  let catching = $state(false);
  async function run() {
    catching = true;
    await post(`/api/chats/${chatId}/memory/run`).catch(errorToast);
    toast("Catching up in the background…");
    setTimeout(() => (catching = false), 1200);
  }

  // The continuity tile walks the replies that carry an open note, newest first, one per click.
  let noteAt = 0;
  function nextNote() {
    if (!noteMessages.length) return;
    const m = noteMessages[noteAt++ % noteMessages.length]!;
    if (onjump) onjump(m);
    else navigate(`/chat/${chatId}?m=${m}`);
  }

  const busy = $derived(overview?.jobs.filter((j) => j.status !== "failed").reduce((n, j) => n + j.n, 0) ?? 0);

  // ---- the multitrack: one lane per level, a playhead where the prompt goes word for word (SUM-09) ----
  const LANES: { level: SummaryLevel; label: string }[] = [
    { level: "story", label: "Story" },
    { level: "arc", label: "Arcs" },
    { level: "chapter", label: "Chapters" },
    { level: "scene", label: "Scenes" },
  ];
  const lo = $derived(overview?.firstSeq || 1);
  const hi = $derived(Math.max(overview?.lastSeq ?? 1, lo + 1));
  const span = $derived(hi - lo + 1);
  const pct = (seq: number) => Math.max(0, Math.min(100, ((seq - lo) / span) * 100));
  const width = (a: number, b: number) => Math.max(0.6, ((Math.min(b, hi) - a + 1) / span) * 100);
  const end = (r: CoverageRow) => r.endSeq ?? overview?.segmentedThrough ?? hi;
  const stateOf = (r: CoverageRow) => (r.closed || r.level === "story" ? r.state : "open");
  const STATE: Record<string, string> = { ready: "summarized", open: "being written", building: "being written", pending: "waiting", stale: "needs updating", review: "to review", error: "failed" };
  const label = (r: CoverageRow) => `${r.title || r.level} · #${r.startSeq}–${r.endSeq ?? "…"} · ${STATE[stateOf(r)] ?? stateOf(r)}`;
  let readout = $state("");

  const evicted = $derived(overview ? overview.evictedThrough : 0);
  const kept = $derived(overview?.stats.storyTokens ?? overview?.stats.summarizedSourceTokens ?? 0);
  const memTokens = $derived(overview?.stats.memoryTokens ?? overview?.stats.telescopeTokens ?? overview?.stats.sceneSummaryTokens ?? 0);
  const ratio = $derived(kept && memTokens ? kept / memTokens : 0);

  type Lamp = { n: number; label: string; tone: "amber" | "red" | "blue"; href?: string; onclick?: () => void; title?: string };
  const lamps = $derived<Lamp[]>(
    overview
      ? [
          { n: overview.stats.review, label: `update${overview.stats.review === 1 ? "" : "s"} to review`, tone: "amber", href: `/chat/${chatId}/memory?show=review`, title: "Open the summaries waiting for your OK" },
          { n: overview.stats.stale, label: "stale after edits", tone: "amber", href: `/chat/${chatId}/memory?show=stale`, title: "Open what changed under its summary or memory" },
          { n: overview.stats.errors, label: `failed summar${overview.stats.errors === 1 ? "y" : "ies"}`, tone: "red", href: `/chat/${chatId}/memory?show=error`, title: "Open the summaries that failed" },
          { n: overview.gaps.length, label: overview.gaps.length ? `gap${overview.gaps.length === 1 ? "" : "s"} · ${overview.gaps.map((g) => `#${g.startSeq}–${g.endSeq}`).join(", ")}` : "gaps", tone: "red", href: `/chat/${chatId}/memory?show=gaps`, title: overview.gaps.map((g) => `#${g.startSeq}–#${g.endSeq}: ${g.reason}`).join("\n") },
          { n: openNotes, label: `continuity note${openNotes === 1 ? "" : "s"}`, tone: "amber", onclick: nextNote, title: noteMessages.length > 1 ? "Jump to the next reply with a note" : "Jump to the reply with the note" },
          { n: proposals, label: "lore for the Chronicle", tone: "blue", href: `/chat/${chatId}/codex?tab=chronicle`, title: "Open the Chronicle proposals" },
        ]
      : [],
  );
  const lit = $derived(lamps.filter((l) => l.n).reduce((n, l) => n + l.n, 0));
</script>

{#if !overview}
  <p class="st-loading">LOADING THE MEMORY…</p>
{:else}
  <div class="studio st-stack">
    <Module title="Memory" lit={!overview.paused && overview.enabled}>
      {#snippet aside()}
        {#if busy}<span class="weaving"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>weaving {busy}</span>{:else}{overview?.stats.atoms ?? 0} memories{/if}
      {/snippet}
      {#if !overview.enabled}<p class="warn"><span class="st-led warm"></span>Memory is off (Settings → Memory).</p>{/if}
      {#if overview.paused}<p class="warn"><span class="st-led warm"></span>Memory is paused for this chat.</p>{/if}
      <div class="tracks" role="group" aria-label="Memory coverage" onpointerleave={() => (readout = "")}>
        {#each LANES as l (l.level)}
          <div class="lane">
            <span class="nm">{l.label}</span>
            <div class="tr">
              {#each overview.coverage.filter((r) => r.level === l.level) as r (r.id)}
                <button
                  type="button"
                  class="blk {stateOf(r)}"
                  style:left="{pct(r.startSeq)}%"
                  style:width="{width(r.startSeq, end(r))}%"
                  aria-label={label(r)}
                  onpointerenter={() => (readout = label(r))}
                  onfocus={() => (readout = label(r))}
                  onclick={() => navigate(`/chat/${chatId}/memory`)}
                ></button>
              {/each}
              {#if l.level === "scene"}
                {#each overview.gaps as g (g.startSeq)}
                  <span class="blk gap" style:left="{pct(g.startSeq)}%" style:width="{width(g.startSeq, g.endSeq)}%" title="Gap #{g.startSeq}–#{g.endSeq}: {g.reason}"></span>
                {/each}
              {/if}
            </div>
          </div>
        {/each}
        <div class="lane">
          <span class="nm">Prompt</span>
          <div class="tr">
            {#if evicted >= lo}
              <span class="blk summ" style:left="0%" style:width="{width(lo, evicted)}%" role="img" aria-label="Up to #{evicted}: told through summaries and memories" onpointerenter={() => (readout = `#${lo}–${evicted} · told through summaries and memories`)}></span>
            {/if}
            <span class="blk verb" style:left="{pct(evicted + 1)}%" style:width="{width(evicted + 1, hi)}%" role="img" aria-label="From #{evicted + 1}: sent word for word" onpointerenter={() => (readout = `#${evicted + 1}–${hi} · sent word for word`)}></span>
          </div>
        </div>
        <div class="ph-layer" aria-hidden="true"><span class="playhead" style:left="{pct(evicted + 1)}%"><span class:flip={pct(evicted + 1) > 50}>word for word</span></span></div>
        <div class="scale"><span>#{lo}</span><span>#{hi}</span></div>
      </div>
      <p class="readout st-lcd" aria-live="polite">{readout || "Point at a block to read it. Click to open it in memory."}</p>
      <div class="legend">
        <span><i class="k-ready"></i>summarized</span>
        <span><i class="k-open"></i>being written</span>
        <span><i class="k-pending"></i>waiting</span>
        <span><i class="k-stale"></i>needs a look</span>
        <span><i class="k-gap"></i>failed / gap</span>
      </div>
      <div class="stats">
        <div><b class="st-lcd">{overview.stats.scenes}</b><span>Scenes</span></div>
        <div><b class="st-lcd">{overview.stats.chapters}</b><span>Chapters</span></div>
        <div><b class="st-lcd">{overview.stats.atoms}</b><span>Memories</span></div>
        <div><b class="st-lcd">{overview.stats.pinned}</b><span>Pinned</span></div>
      </div>
    </Module>

    <Module title="Compression" peek={ratio ? `${ratio.toFixed(1)}×` : "Word for word"}>
      {#if overview.stats.summarizedSourceTokens}
        {#if kept && memTokens}
          <div class="bars">
            <div class="bar"><span>The story</span><span class="t"><i style:width="100%"></i></span><output class="st-lcd">{compact(kept)}</output></div>
            <div class="bar"><span>Its memory</span><span class="t"><i class="mem" style:width="{Math.max(2, Math.min(100, (memTokens / kept) * 100))}%"></i></span><output class="st-lcd">{compact(memTokens)}</output></div>
          </div>
          <div class="ratio">
            <span>{overview.stats.messages ? `${overview.stats.messages.toLocaleString()} messages` : "The story"} squeezed into memory</span>
            <b>{ratio.toFixed(1)}×</b>
          </div>
        {/if}
        <p class="st-hint">{compact(overview.stats.summarizedSourceTokens)} tokens of story kept in {compact(overview.stats.sceneSummaryTokens)} tokens of scene summaries. Messages from #{overview.evictedThrough + 1} are sent word for word; the ones before stay here to read.</p>
      {:else}
        <p class="st-hint first">Scenes are recorded in the background once the story moves past them. Until the chat outgrows the prompt, everything is sent word for word.</p>
      {/if}
    </Module>

    <Module title="Status" led={lit ? "warm" : "ok"} peek={lit ? `${lit} need${lit === 1 ? "s" : ""} a look` : "All clear"}>
      <div class="annun">
        {#each lamps as l (l.label)}
          {#if l.href && l.n}
            <a class="lamp {l.tone}" href={l.href} title={l.title}><span class="st-led" class:warm={l.tone === "amber"} class:bad={l.tone === "red"} class:on={l.tone === "blue"}></span><b>{l.n}</b>{l.label}</a>
          {:else if l.onclick && l.n}
            <button type="button" class="lamp {l.tone}" onclick={l.onclick} title={l.title}><span class="st-led" class:warm={l.tone === "amber"} class:bad={l.tone === "red"} class:on={l.tone === "blue"}></span><b>{l.n}</b>{l.label}</button>
          {:else}
            <div class="lamp" class:amber={l.n && l.tone === "amber"} class:red={l.n && l.tone === "red"} class:blue={l.n && l.tone === "blue"} title={l.n ? l.title : undefined}><span class="st-led" class:warm={l.n && l.tone === "amber"}></span><b>{l.n}</b>{l.label}</div>
          {/if}
        {/each}
      </div>
    </Module>

    {#if story?.content}
      <Module title="Story so far" fold open={false} peek={story.title ?? ""}>
        <div class="liner">
          {#if story.title}<p class="liner-t">{story.title}</p>{/if}
          <p class="liner-b">{story.content}</p>
        </div>
      </Module>
    {/if}

    <Module>
      <div class="st-keys first">
        <a class="st-key primary" href="/chat/{chatId}/memory"><Brain size={14} /> Open memory</a>
        <a class="st-key" href="/chat/{chatId}/codex"><Library size={14} /> Codex</a>
        <button class="st-key" type="button" onclick={run} aria-pressed={catching}><RefreshCw size={14} class={catching ? "spin" : ""} /> Catch up</button>
      </div>
    </Module>
  </div>
{/if}

<style>
  .warn {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 10px;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--st-warm) 18%, var(--st-well));
    font-size: 12px;
  }
  .weaving {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--accent-ink);
  }
  .eq {
    display: inline-flex;
    align-items: flex-end;
    gap: 1.5px;
    height: 10px;
  }
  .eq i {
    width: 2px;
    background: currentColor;
    animation: eq 0.9s ease-in-out infinite;
  }
  .eq i:nth-child(2) {
    animation-delay: -0.3s;
  }
  .eq i:nth-child(3) {
    animation-delay: -0.6s;
  }
  @keyframes eq {
    0%,
    100% {
      height: 3px;
    }
    50% {
      height: 10px;
    }
  }

  /* the multitrack */
  .tracks {
    position: relative;
    padding: 10px 10px 8px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: var(--st-inset);
  }
  .lane {
    display: grid;
    grid-template-columns: 62px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    height: 22px;
  }
  .lane + .lane {
    margin-top: 5px;
  }
  .nm {
    font: 700 9px/1 var(--st-meta);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-faint);
  }
  .tr {
    position: relative;
    height: 16px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }
  .blk {
    position: absolute;
    top: 2px;
    bottom: 2px;
    padding: 0;
    border: 0;
    border-radius: 2px;
    background: var(--ok);
    box-shadow: inset -1px 0 0 color-mix(in srgb, var(--st-well) 70%, transparent);
  }
  button.blk {
    cursor: pointer;
  }
  button.blk:hover,
  button.blk:focus-visible {
    z-index: 1;
    filter: brightness(1.12);
    outline: 1.5px solid var(--text);
    outline-offset: 1px;
  }
  .blk.open,
  .blk.building {
    background: repeating-linear-gradient(135deg, var(--accent) 0 4px, color-mix(in srgb, var(--accent) 45%, transparent) 4px 8px);
    background-size: 11px 11px;
    animation: march 0.9s linear infinite;
  }
  @keyframes march {
    to {
      background-position: 11px 0;
    }
  }
  .blk.pending {
    background: var(--surface-3);
    box-shadow: inset 0 0 0 1px var(--border-strong);
  }
  .blk.stale,
  .blk.review {
    background: var(--st-warm);
  }
  .blk.error {
    background: var(--danger);
  }
  .blk.gap {
    background: repeating-linear-gradient(45deg, var(--danger) 0 2px, transparent 2px 5px);
    box-shadow: inset 0 0 0 1px var(--danger);
    pointer-events: none;
  }
  .blk.summ {
    background: color-mix(in srgb, var(--st-cool) 60%, transparent);
  }
  .blk.verb {
    background: var(--st-grad);
    box-shadow: var(--st-glow);
  }
  .ph-layer {
    position: absolute;
    top: 6px;
    bottom: 24px;
    left: 80px;
    right: 10px;
    pointer-events: none;
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--text);
  }
  .playhead::before {
    content: "";
    position: absolute;
    top: -4px;
    left: -4px;
    border: 5px solid transparent;
    border-top: 6px solid var(--text);
  }
  .playhead span {
    position: absolute;
    top: -4px;
    left: 6px;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--st-well);
    font: 700 9px/1 var(--font-ui);
    white-space: nowrap;
  }
  .playhead span.flip {
    left: auto;
    right: 6px;
  }
  .scale {
    display: flex;
    justify-content: space-between;
    margin: 6px 0 0 70px;
    font: 400 calc(9px * var(--st-lcd-k)) / 1 var(--st-lcd);
    color: var(--text-faint);
  }
  .readout {
    min-height: 2.4em;
    margin: 8px 2px 0;
    font-size: calc(9.5px * var(--st-lcd-k));
    line-height: 1.2;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-faint);
  }
  .legend i {
    display: inline-block;
    width: 10px;
    height: 8px;
    margin-right: 5px;
    border-radius: 2px;
  }
  .k-ready {
    background: var(--ok);
  }
  .k-open {
    background: var(--accent);
  }
  .k-pending {
    background: var(--surface-3);
    box-shadow: inset 0 0 0 1px var(--border-strong);
  }
  .k-stale {
    background: var(--st-warm);
  }
  .k-gap {
    background: repeating-linear-gradient(45deg, var(--danger) 0 2px, transparent 2px 4px);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
    margin-top: 10px;
  }
  .stats div {
    padding: 8px 4px 7px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: var(--st-inset-sm);
    text-align: center;
  }
  .stats b {
    display: block;
    font-size: calc(16px * var(--st-lcd-k));
    line-height: 1;
  }
  .stats span {
    display: block;
    margin-top: 4px;
    font: 700 8.5px/1 var(--st-meta);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  /* compression */
  .bars {
    display: grid;
    gap: 6px;
  }
  .bar {
    display: grid;
    grid-template-columns: 74px minmax(0, 1fr) 46px;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    color: var(--text-muted);
  }
  .bar .t {
    height: 10px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--st-well);
    box-shadow: inset 0 0 0 var(--st-bw) var(--st-edge);
  }
  .bar .t i {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--st-cool);
  }
  .bar .t i.mem {
    background: var(--st-grad);
  }
  .bar output {
    text-align: right;
    font-size: calc(10px * var(--st-lcd-k));
    color: var(--text);
    text-shadow: none;
  }
  .ratio {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .ratio b {
    font: 400 calc(30px * var(--st-hs)) / 1 var(--st-head);
    color: var(--accent-ink);
  }
  .first {
    margin-top: 0;
  }

  /* the annunciator */
  .annun {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }
  .lamp {
    position: relative;
    display: grid;
    align-content: start;
    justify-items: start;
    gap: 3px;
    min-width: 0;
    padding: 8px 9px 7px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: var(--st-inset-sm);
    color: var(--text-faint);
    font-size: 10.5px;
    font-weight: 700;
    line-height: 1.2;
    text-decoration: none;
    overflow-wrap: anywhere;
    border: 0;
    font-family: inherit;
    text-align: start;
  }
  .lamp b {
    font: 400 calc(15px * var(--st-lcd-k)) / 1 var(--st-lcd);
    color: var(--text-faint);
  }
  .lamp .st-led {
    position: absolute;
    top: 8px;
    right: 8px;
  }
  .lamp.amber {
    background: color-mix(in srgb, var(--st-warm) 22%, var(--st-well));
    color: var(--text);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--st-warm) 70%, transparent),
      0 0 14px -4px var(--st-warm);
  }
  .lamp.amber b {
    color: var(--warn);
  }
  .lamp.red {
    background: color-mix(in srgb, var(--danger) 16%, var(--st-well));
    color: var(--text);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--danger) 70%, transparent),
      0 0 14px -4px var(--danger);
  }
  .lamp.red b {
    color: var(--danger);
  }
  .lamp.blue {
    background: color-mix(in srgb, var(--accent) 14%, var(--st-well));
    color: var(--text);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent);
  }
  .lamp.blue b {
    color: var(--accent-ink);
  }
  a.lamp,
  button.lamp {
    cursor: pointer;
  }
  a.lamp:hover,
  button.lamp:hover {
    filter: brightness(1.06);
  }
  a.lamp:focus-visible,
  button.lamp:focus-visible {
    outline: 1.5px solid var(--text);
    outline-offset: 1px;
  }

  /* story so far: liner notes */
  .liner {
    padding: 12px 14px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--butter) 22%, var(--surface));
    box-shadow: inset 0 0 0 var(--st-bw) var(--st-edge);
  }
  .liner-t {
    margin: 0;
    font: 600 calc(16px * var(--st-hs)) / 1.2 var(--st-head);
  }
  .liner-b {
    margin: 6px 0 0;
    font: 13.5px/1.55 var(--st-story);
    color: var(--text-muted);
    white-space: pre-wrap;
  }
  .liner-b::first-letter {
    float: left;
    margin: 3px 6px 0 0;
    font: 400 2.6em/0.85 var(--st-head);
    color: var(--accent-ink);
  }
</style>
