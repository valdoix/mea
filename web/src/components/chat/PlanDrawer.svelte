<script lang="ts">
  import { opened } from "../../lib/gestures";
  import { parsePlan, PLAN_STEPS, planSource } from "../../lib/plan";

  /**
   * The plan this reply was written from, in a drawer above it. Planning is mandatory, so every
   * story reply has one; the drawer folds it away by default, like "What went unsaid", and splits
   * the pass into its steps. While the reply streams, the steps fill in as they're planned.
   */
  let { reasoning, how, streaming = false, writing = false, open = false }: { reasoning: string | null; how?: unknown; streaming?: boolean; writing?: boolean; open?: boolean } = $props();

  const plan = $derived(parsePlan(reasoning));
  const label = (key: string) => PLAN_STEPS.find((s) => s.key === key)!;
  const source = $derived(planSource(how));
  const unplanned = $derived(how === "none" && !plan.steps.length);
  const planning = $derived(streaming && !writing);
  const TIER_COLOR = { Routine: "var(--mint)", Charged: "var(--warn)", Pivotal: "var(--rose)" };
</script>

{#if plan.steps.length || plan.rest || unplanned || planning}
  <details class="plan" class:unplanned use:opened={open}>
    <summary>
      <span aria-hidden="true">◇</span>
      {#if unplanned}
        Unplanned: every planning try failed
      {:else if plan.steps.length}
        {planning ? "Planning…" : "The plan"}
        {#if plan.tier}<span class="tier" style:--tc={TIER_COLOR[plan.tier]}>{plan.tier}</span>{/if}
        <span class="count">{plan.steps.length} step{plan.steps.length === 1 ? "" : "s"}</span>
      {:else}
        {planning ? "Thinking…" : "Reasoning"}
      {/if}
    </summary>
    <div class="in">
      {#if plan.steps.length}
        <ol class="steps">
          {#each plan.steps as s (s.key)}
            <li class="step {s.key.toLowerCase()}">
              <span class="key" title={label(s.key).hint}>{label(s.key).label}</span>
              <span class="text">{s.text}</span>
            </li>
          {/each}
        </ol>
      {/if}
      {#if plan.rest}
        {#if plan.steps.length}
          <details class="rest">
            <summary>Other reasoning</summary>
            <p class="raw">{plan.rest}</p>
          </details>
        {:else}
          <p class="raw">{plan.rest}</p>
        {/if}
      {/if}
      {#if source && !planning}<p class="source">{source}</p>{/if}
    </div>
  </details>
{/if}

<style>
  .plan {
    margin: 0 0 0.6rem;
    border-radius: var(--r-md, 14px);
    border: 1px solid color-mix(in srgb, var(--sky) 28%, var(--border));
    background: color-mix(in srgb, var(--sky) 6%, transparent);
  }
  .unplanned {
    --sky: var(--warn);
  }
  summary {
    list-style: none;
    cursor: pointer;
    padding: 0.45rem 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font: 700 var(--fs-xs) var(--font-ui);
    color: color-mix(in srgb, var(--sky) 60%, var(--text));
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .tier {
    padding: 0 0.45rem;
    border-radius: 9px;
    font-size: 0.68rem;
    text-transform: uppercase;
    background: color-mix(in srgb, var(--tc) 18%, transparent);
    color: color-mix(in srgb, var(--tc) 75%, var(--text));
  }
  .count {
    margin-left: auto;
    color: var(--text-muted);
  }
  .in {
    padding: 0 0.8rem 0.75rem;
    display: grid;
    gap: 0.55rem;
  }
  .steps {
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
  }
  .step {
    display: grid;
    grid-template-columns: 5.6rem 1fr;
    gap: 0.6rem;
    padding-left: 0.55rem;
    border-left: 2px solid color-mix(in srgb, var(--sky) 35%, transparent);
    font-size: var(--fs-sm);
  }
  .move {
    border-color: var(--accent);
  }
  .risk {
    border-color: var(--warn);
  }
  .key {
    font: 700 0.64rem/1.9 var(--font-ui);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .text,
  .raw {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .rest summary,
  .raw,
  .source {
    padding: 0;
    color: var(--text-muted);
  }
  .raw {
    font-size: var(--fs-sm);
    max-height: 16rem;
    overflow-y: auto;
  }
  .source {
    margin: 0;
    font-size: var(--fs-xs);
  }
  @media (max-width: 520px) {
    .step {
      grid-template-columns: 1fr;
      gap: 0;
    }
  }
</style>
