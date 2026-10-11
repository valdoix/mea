<script lang="ts" module>
  export interface ExposureView {
    key: string;
    statement: string;
    cur: number;
    max: number;
    near: { id: string; name: string; score: number; why: string[] }[];
  }
</script>

<script lang="ts">
  import { post } from "../../lib/api";
  import { Minus, Plus } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * B2: a secret's exposure clock (0–6) as six segments, with + / −, Raise the stakes and Cool it
   * down, and who is closest to finding out, and why.
   */
  let { chatId, x, onchange }: { chatId: string; x: ExposureView; onchange: () => void } = $props();
  let busy = $state(false);

  async function nudge(delta: number, how: "set" | "raise" | "cool" = "set") {
    busy = true;
    try {
      await post(`/api/chats/${chatId}/exposure/${encodeURIComponent(x.key)}`, { delta, how });
      if (how === "raise") toast("Raised: the next scene puts it at risk", { kind: "ok" });
      if (how === "cool") toast("Cooled down a step");
      onchange();
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="dial">
  <div class="row wrap">
    <span class="tiny muted">Exposure</span>
    <span class="segs" role="meter" aria-valuemin="0" aria-valuemax={x.max} aria-valuenow={x.cur} aria-label="Exposure {x.cur} of {x.max}">
      {#each Array.from({ length: x.max }, (_, i) => i) as i (i)}<i class:on={i < x.cur} class:hot={i < x.cur && x.cur >= x.max - 1}></i>{/each}
    </span>
    <b class="small">{x.cur}/{x.max}</b>
    <button class="btn ghost icon small" onclick={() => nudge(-1)} disabled={busy || x.cur <= 0} aria-label="One step less"><Minus size={13} /></button>
    <button class="btn ghost icon small" onclick={() => nudge(1)} disabled={busy || x.cur >= x.max} aria-label="One step more"><Plus size={13} /></button>
    <button class="btn ghost small" onclick={() => nudge(1, "raise")} disabled={busy || x.cur >= x.max} title="+1, and the next scene puts the secret at risk">Raise the stakes</button>
    <button class="btn ghost small" onclick={() => nudge(-1, "cool")} disabled={busy || x.cur <= 0}>Cool it down</button>
  </div>
  {#if x.near.length}
    <div class="tiny faint near">Closest: {#each x.near.slice(0, 3) as n, i (n.id)}{i ? " · " : ""}<b>{n.name}</b> ({n.why.at(-1) ?? "—"}){/each}</div>
  {/if}
</div>

<style>
  .dial {
    display: grid;
    gap: 0.25rem;
    margin-top: 0.4rem;
  }
  .row {
    align-items: center;
    gap: 0.4rem;
  }
  .segs {
    display: inline-flex;
    gap: 3px;
  }
  .segs i {
    width: 14px;
    height: 8px;
    border-radius: 2px;
    background: var(--surface-3, var(--border));
  }
  .segs i.on {
    background: var(--warn, #b7791f);
  }
  .segs i.hot {
    background: var(--danger);
  }
</style>
