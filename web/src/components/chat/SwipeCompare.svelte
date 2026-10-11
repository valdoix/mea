<script lang="ts">
  import Modal from "../Modal.svelte";
  import { wordDiff } from "../../lib/diff";
  import type { Message } from "../../lib/types";

  /**
   * A2: two takes side by side, with what differs highlighted (words only on the left are marked
   * on the left, words only on the right on the right), then Keep left or Keep right.
   */
  let { open = $bindable(false), message, onkeep }: { open?: boolean; message: Message | null; onkeep: (idx: number) => void } = $props();

  const takes = $derived((message?.swipes ?? []).filter((s) => s.status !== "streaming"));
  let left = $state(0);
  let right = $state(0);
  $effect(() => {
    if (!open || !message) return;
    const active = message.activeSwipe;
    right = active;
    left = takes.find((t) => t.idx === active - 1)?.idx ?? takes.find((t) => t.idx !== active)?.idx ?? active;
  });
  /** The prose to compare: emphasis marks don't count as a difference. */
  const textOf = (idx: number) => (takes.find((t) => t.idx === idx)?.content ?? "").replace(/\*+/g, "").trim();
  const parts = $derived(open && message ? wordDiff(textOf(left), textOf(right)) : []);
  const same = $derived(parts.length ? parts.filter((p) => p.type === "same").reduce((n, p) => n + p.text.length, 0) / Math.max(1, Math.max(textOf(left).length, textOf(right).length)) : 0);

  function keep(idx: number) {
    onkeep(idx);
    open = false;
  }
</script>

<Modal bind:open title="Compare two takes" size="xl">
  {#if message && takes.length > 1}
    <div class="stack">
      <p class="tiny muted">Highlighted: what only that take has. {Math.round(same * 100)}% of the wording is shared.</p>
      <div class="cols">
        {#each [{ side: "left", get: () => left, set: (v: number) => (left = v), type: "del" }, { side: "right", get: () => right, set: (v: number) => (right = v), type: "add" }] as col (col.side)}
          <section class="col card">
            <div class="row between">
              <select class="select small" value={col.get()} onchange={(e) => col.set(Number(e.currentTarget.value))} aria-label="Take on the {col.side}">
                {#each takes as t (t.idx)}<option value={t.idx}>Take {t.idx + 1}{t.idx === message.activeSwipe ? " (current)" : ""}</option>{/each}
              </select>
              <button class="btn primary small" onclick={() => keep(col.get())} disabled={col.get() === message.activeSwipe}>{col.get() === message.activeSwipe ? "Current" : `Keep ${col.side}`}</button>
            </div>
            <p class="text small">{#each parts as part, i (i)}{#if part.type === "same"}{part.text}{:else if part.type === col.type}<mark>{part.text}</mark>{/if}{/each}</p>
          </section>
        {/each}
      </div>
    </div>
  {:else}
    <p class="muted">There's only one take of this reply.</p>
  {/if}
</Modal>

<style>
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.8rem;
  }
  .col {
    display: grid;
    align-content: start;
    gap: 0.6rem;
    padding: 0.8rem;
    min-width: 0;
  }
  .text {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.6;
  }
  mark {
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: inherit;
  }
  @media (max-width: 700px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
</style>
