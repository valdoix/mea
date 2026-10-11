<script lang="ts">
  import Module from "../desk/Module.svelte";
  import { get, patch, post } from "../../lib/api";
  import { dockRequest } from "../../lib/dock.svelte";
  import { onEvent } from "../../lib/events";
  import { compact } from "../../lib/format";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * H2: this chat's cost today: the replies, and the background work (summaries, checks, lessons,
   * trackers, the world off the page) as a share of the day's quota. A warning past the share you
   * set, Use a cheaper model for these, and Budget mode (no optional model reads in this chat).
   */
  interface Cost {
    story: { tokens: number; requests: number; cost: number };
    background: { tokens: number; requests: number; cost: number; quotaTokens: number; byKind: { kind: string; tokens: number; requests: number; cost: number }[] };
    share: number | null;
    threshold: number;
    over: boolean;
    cheaper: { current: { id: string; name: string; price: number | null } | null; pick: { id: string; name: string; price: number } | null };
  }
  let { chatId, budgetMode = false, onchange }: { chatId: string; budgetMode?: boolean; onchange?: () => void } = $props();
  let c = $state<Cost | null>(null);
  let open = $state(false);
  let el = $state<HTMLElement | null>(null);

  async function load() {
    try {
      c = await get<Cost>(`/api/chats/${chatId}/cost`);
    } catch {
      c = null;
    }
  }
  $effect(() => {
    void chatId;
    void load();
  });
  let t: ReturnType<typeof setTimeout>;
  $effect(() =>
    onEvent((e) => {
      if (e.type === "gen.end" && e.chatId === chatId) {
        clearTimeout(t);
        t = setTimeout(load, 4000);
      }
    }),
  );
  $effect(() => {
    if (dockRequest.seq && dockRequest.section === "cost") {
      open = true;
      requestAnimationFrame(() => el?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  });

  async function cheaper() {
    try {
      const r = await post<{ profile: { name: string } }>("/api/cost/cheaper", {});
      toast(`Background work now uses ${r.profile.name}`, { kind: "ok" });
      await load();
    } catch (e) {
      errorToast(e);
    }
  }
  async function toggleBudget() {
    try {
      await patch(`/api/chats/${chatId}`, { settings: { budgetMode: !budgetMode } });
      toast(budgetMode ? "Budget mode off" : "Budget mode on: no optional model reads in this chat", { kind: "ok" });
      onchange?.();
    } catch (e) {
      errorToast(e);
    }
  }
  const money = (n: number) => (n > 0 ? ` · $${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}` : "");
  const pct = (n: number) => `${Math.round(n * 100)}%`;
</script>

<div bind:this={el} data-section="cost">
  <Module title="Cost today" fold bind:open led={c?.over ? "warm" : budgetMode ? "on" : null} peek={c ? (c.share != null ? `background ${pct(c.share)} of today's quota` : `${compact(c.story.tokens + c.background.tokens)} tokens`) : "…"}>
    {#if c}
      {#if c.over}<p class="warn small">This chat's background work has used {pct(c.share ?? 0)} of today's quota (you're warned past {pct(c.threshold)}).</p>{/if}
      <div class="rows">
        <div class="r"><span>Replies</span><small>{c.story.requests} · {compact(c.story.tokens)} tokens{money(c.story.cost)}</small></div>
        <div class="r"><span>Background</span><small>{c.background.requests} · {compact(c.background.tokens)} tokens{money(c.background.cost)}</small></div>
        {#each c.background.byKind.slice(0, 6) as k (k.kind)}<div class="r sub"><span>{k.kind}</span><small>{k.requests} · {compact(k.tokens)}</small></div>{/each}
      </div>
      <div class="st-keys">
        {#if c.cheaper.pick}<button class="st-key" type="button" onclick={cheaper} title="Summaries, helpers, trackers and the world off the page move to {c.cheaper.pick.name}">Use a cheaper model for these</button>{/if}
        <button class="st-key" type="button" class:on={budgetMode} aria-pressed={budgetMode} onclick={toggleBudget} title="No optional model reads in this chat: checks, lessons, the advisor, the editor, the librarian">Budget mode {budgetMode ? "on" : "off"}</button>
      </div>
      {#if c.cheaper.pick}<p class="st-hint">Cheaper: {c.cheaper.pick.name}{c.cheaper.current ? ` instead of ${c.cheaper.current.name}` : ""}.</p>{/if}
    {/if}
  </Module>
</div>

<style>
  .rows {
    display: grid;
    gap: 3px;
    margin-bottom: 6px;
  }
  .r {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
  }
  .r small {
    color: var(--text-faint);
  }
  .r.sub {
    padding-left: 10px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .warn {
    margin: 0 0 6px;
    color: var(--st-warm, var(--warn, #b7791f));
  }
</style>
