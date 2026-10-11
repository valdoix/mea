<script lang="ts">
  import Module from "../desk/Module.svelte";
  import { get } from "../../lib/api";
  import { dockRequest, openDock } from "../../lib/dock.svelte";
  import { onEvent } from "../../lib/events";
  import { WandSparkles as Wand } from "../../lib/icons";
  import { openMeusIn } from "../../lib/meus.svelte";
  import { navigate } from "../../lib/router.svelte";

  /**
   * D3: story health for the last 20 replies. Each part opens what drags it down; "Fix the top 3"
   * hands the worst three to Meus as one request (it answers with one change card).
   */
  interface Part {
    part: string;
    label: string;
    score: number;
    detail: string;
    open?: { messageId: string; seq: number } | { dock: "chat" | "story"; section?: string } | { href: string };
    ask?: string;
  }
  interface Health {
    score: number;
    level: "good" | "fair" | "poor";
    replies: number;
    parts: Part[];
    trend: { week: number; score: number }[];
  }
  let { chatId }: { chatId: string } = $props();
  let h = $state<Health | null>(null);
  let open = $state(false);
  let el = $state<HTMLElement | null>(null);

  async function load() {
    try {
      h = await get<Health>(`/api/chats/${chatId}/story-health`);
    } catch {
      h = null;
    }
  }
  $effect(() => {
    void chatId;
    void load();
  });
  let t: ReturnType<typeof setTimeout>;
  $effect(() =>
    onEvent((e) => {
      if ((e.type === "continuity.changed" || e.type === "gen.end" || e.type === "lessons.changed") && e.chatId === chatId) {
        clearTimeout(t);
        t = setTimeout(load, 2000);
      }
    }),
  );
  $effect(() => {
    if (dockRequest.seq && dockRequest.section === "health") {
      open = true;
      void load();
      requestAnimationFrame(() => el?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  });

  function go(p: Part) {
    const o = p.open;
    if (!o) return;
    if ("messageId" in o) navigate(`/chat/${chatId}?m=${o.messageId}`);
    else if ("dock" in o) openDock(o.dock, o.section);
    else navigate(o.href);
  }
  const top3 = $derived((h?.parts ?? []).filter((p) => p.ask && p.score < 90).sort((a, b) => a.score - b.score).slice(0, 3));
  function fixTop3() {
    if (!top3.length) return;
    openMeusIn(chatId, `Story health says these need fixing. Look at each, and propose the fixes as one change card:\n${top3.map((p, i) => `${i + 1}. ${p.label}: ${p.ask}`).join("\n")}`, true);
    openDock("meus");
  }
  // The sparkline: one point a week.
  const spark = $derived.by(() => {
    const pts = h?.trend ?? [];
    if (pts.length < 2) return "";
    const w = 120;
    const ht = 26;
    return pts.map((p, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * w).toFixed(1)} ${(ht - (p.score / 100) * ht).toFixed(1)}`).join(" ");
  });
</script>

{#if h && h.replies >= 3}
  <div bind:this={el} data-section="health">
    <Module title="Story health" fold bind:open led={h.level === "good" ? "ok" : h.level === "fair" ? "warm" : "bad"} peek="{h.score} / 100">
      <div class="head">
        <span class="big st-lcd">{h.score}</span>
        <span class="tiny muted">the last {h.replies} replies</span>
        {#if spark}<svg class="spark" viewBox="-2 -2 124 30" role="img" aria-label="Week by week: {h.trend.map((p) => p.score).join(', ')}"><path d={spark} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>{/if}
      </div>
      <ul class="parts">
        {#each h.parts as p (p.part)}
          <li>
            <button type="button" class="part" onclick={() => go(p)} disabled={!p.open} title={p.open ? "Show where" : undefined}>
              <span class="lbl">{p.label}</span>
              <span class="bar" aria-hidden="true"><i class:fair={p.score < 80} class:poor={p.score < 60} style:width="{p.score}%"></i></span>
              <span class="n">{p.score}</span>
              <small>{p.detail}</small>
            </button>
          </li>
        {/each}
      </ul>
      {#if top3.length}<div class="st-keys"><button class="st-key" type="button" onclick={fixTop3}><Wand size={14} /> Fix the top {top3.length === 3 ? "3" : top3.length}</button></div>{/if}
    </Module>
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .big {
    font-size: 26px;
  }
  .spark {
    width: 120px;
    height: 28px;
    margin-left: auto;
    color: var(--accent);
  }
  .parts {
    display: grid;
    gap: 4px;
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
  }
  .part {
    display: grid;
    grid-template-columns: 7.5rem minmax(0, 1fr) 2rem;
    align-items: center;
    gap: 2px 8px;
    width: 100%;
    padding: 4px 6px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
    text-align: start;
    cursor: pointer;
  }
  .part:disabled {
    cursor: default;
  }
  .part:not(:disabled):hover {
    background: var(--st-well);
  }
  .part small {
    grid-column: 1 / -1;
    font-size: 11px;
    color: var(--text-faint);
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--surface-3, var(--border));
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--ok);
  }
  .bar i.fair {
    background: var(--warn, #b7791f);
  }
  .bar i.poor {
    background: var(--danger);
  }
  .n {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
</style>
