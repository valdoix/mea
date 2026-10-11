<script lang="ts" module>
  export interface PressureInfo {
    text: string;
    stage: "hidden" | "growing" | "cracking" | "head" | "resolved";
    by: "deck" | "grounded" | "you";
    locked?: boolean;
    seq: number;
    draws: number;
  }
  export interface PressurePerson {
    id: string;
    name: string;
    present: boolean;
    pressure: PressureInfo | null;
    youKnow: string[];
  }
</script>

<script lang="ts">
  import { post } from "../../lib/api";
  import { Dices, Eye, EyeOff, Lock } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * E1: a person's hidden pressure, folded away until you choose to look (it's for you, never the
   * story). Redraw, Write my own, Lock, Bring it to a head, Resolve.
   */
  let { chatId, person, onchange }: { chatId: string; person: PressurePerson; onchange: () => void } = $props();
  let shown = $state(false);
  let writing = $state(false);
  let draft = $state("");
  let busy = $state(false);
  const p = $derived(person.pressure);
  const STAGES = ["hidden", "growing", "cracking", "head"] as const;
  const STAGE_LABEL: Record<PressureInfo["stage"], string> = { hidden: "Hidden", growing: "Growing", cracking: "Cracking", head: "Coming to a head", resolved: "Resolved" };
  const BY: Record<PressureInfo["by"], string> = { deck: "drawn from the genre", grounded: "from what the story says", you: "yours" };

  async function act(action: "redraw" | "write" | "lock" | "unlock" | "head" | "resolve") {
    busy = true;
    try {
      await post(`/api/chats/${chatId}/pressures/${encodeURIComponent(person.id)}`, { action, ...(action === "write" ? { text: draft } : {}) });
      if (action === "head") toast(`The next scene tests ${person.name}`, { kind: "ok" });
      if (action === "resolve") toast(`Resolved; ${person.name} trusts you a little more`, { kind: "ok" });
      if (action === "redraw" || action === "write") shown = true;
      writing = false;
      onchange();
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="pressure">
  <div class="row wrap">
    <span class="tiny muted">Pressure</span>
    {#if p}
      <span class="steps" aria-label="Stage: {STAGE_LABEL[p.stage]}" title={STAGE_LABEL[p.stage]}>
        {#each STAGES as s, i (s)}<i class:on={p.stage !== "resolved" && STAGES.indexOf(p.stage) >= i} class:done={p.stage === "resolved"}></i>{/each}
      </span>
      <span class="tiny">{STAGE_LABEL[p.stage]}</span>
      {#if p.locked}<span class="tiny faint" title="Locked: it won't grow or be redrawn"><Lock size={11} /></span>{/if}
      <button class="btn ghost icon small" onclick={() => (shown = !shown)} aria-label={shown ? "Hide it" : "Show it"} aria-pressed={shown}>{#if shown}<EyeOff size={13} />{:else}<Eye size={13} />{/if}</button>
    {:else}
      <span class="tiny faint">none yet (drawn when they matter)</span>
    {/if}
  </div>
  {#if p && shown}
    <div class="small text">{person.name} {p.text}. <span class="tiny faint">{BY[p.by]}</span></div>
    <div class="row wrap">
      <button class="btn ghost small" disabled={busy || p.locked} onclick={() => act("redraw")}><Dices size={13} /> Redraw</button>
      <button class="btn ghost small" disabled={busy} onclick={() => ((writing = !writing), (draft = p.by === "you" ? p.text : ""))}>Write my own</button>
      <button class="btn ghost small" disabled={busy} onclick={() => act(p.locked ? "unlock" : "lock")}>{p.locked ? "Unlock" : "Lock"}</button>
      {#if p.stage !== "resolved"}
        <button class="btn ghost small" disabled={busy || p.stage === "head"} onclick={() => act("head")} title="The next scene puts them where hiding it costs something">Bring it to a head</button>
        <button class="btn ghost small" disabled={busy} onclick={() => act("resolve")}>Resolve</button>
      {/if}
    </div>
  {/if}
  {#if !p}
    <div class="row wrap">
      <button class="btn ghost small" disabled={busy} onclick={() => act("redraw")}><Dices size={13} /> Draw one</button>
      <button class="btn ghost small" disabled={busy} onclick={() => ((writing = !writing), (draft = ""))}>Write my own</button>
    </div>
  {/if}
  {#if writing}
    <div class="row">
      <input class="input grow" bind:value={draft} maxlength="200" placeholder="is hiding a letter from their brother" aria-label="Their pressure" onkeydown={(e) => e.key === "Enter" && draft.trim() && act("write")} />
      <button class="btn small" disabled={busy || !draft.trim()} onclick={() => act("write")}>Save</button>
    </div>
  {/if}
</div>

<style>
  .pressure {
    display: grid;
    gap: 0.3rem;
    padding-top: 0.35rem;
    border-top: 1px dashed var(--border);
  }
  .row {
    align-items: center;
    gap: 0.35rem;
  }
  .steps {
    display: inline-flex;
    gap: 3px;
  }
  .steps i {
    width: 12px;
    height: 6px;
    border-radius: 2px;
    background: var(--surface-3, var(--border));
  }
  .steps i.on {
    background: var(--warn, #b7791f);
  }
  .steps i:last-child.on {
    background: var(--danger);
  }
  .steps i.done {
    background: var(--mint);
  }
  .text {
    font-style: italic;
  }
</style>
