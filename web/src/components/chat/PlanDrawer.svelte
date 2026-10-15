<script lang="ts">
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
</script>

{#if plan.steps.length || plan.rest || unplanned || planning}
  <details class="plan" class:unplanned {open}>
    <summary>
      <span class="mark" class:pulse={planning} aria-hidden="true">◇</span>
      {#if unplanned}
        Unplanned: every planning try failed
      {:else if plan.steps.length}
        {planning ? "Planning…" : "The plan"}
        {#if plan.tier}<span class="tier {plan.tier.toLowerCase()}">{plan.tier}</span>{/if}
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
    border: 1px solid color-mix(in srgb, var(--sky, #8fc7ff) 28%, var(--border));
    background: linear-gradient(160deg, color-mix(in srgb, var(--sky, #8fc7ff) 7%, transparent), color-mix(in srgb, var(--accent) 3%, transparent));
    overflow: hidden;
  }
  .plan.unplanned {
    border-color: color-mix(in srgb, var(--warn) 45%, var(--border));
    background: color-mix(in srgb, var(--warn) 8%, transparent);
  }
  summary {
    list-style: none;
    cursor: pointer;
    padding: 0.45rem 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font: 700 var(--fs-xs) var(--font-ui);
    color: color-mix(in srgb, var(--sky, #8fc7ff) 60%, var(--text));
  }
  .unplanned summary {
    color: var(--warn);
    cursor: default;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .mark {
    font-size: 1.05em;
    line-height: 1;
    transition: transform 0.2s var(--ease, ease);
  }
  details[open] > summary .mark {
    transform: rotate(45deg);
  }
  .pulse {
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  .tier {
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-weight: 700;
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    background: color-mix(in srgb, var(--mint) 18%, transparent);
    color: color-mix(in srgb, var(--mint) 70%, var(--text));
  }
  .tier.charged {
    background: color-mix(in srgb, var(--warn) 18%, transparent);
    color: color-mix(in srgb, var(--warn) 75%, var(--text));
  }
  .tier.pivotal {
    background: color-mix(in srgb, var(--rose) 20%, transparent);
    color: color-mix(in srgb, var(--rose) 75%, var(--text));
  }
  .count {
    margin-left: auto;
    color: var(--text-muted);
    font-weight: 600;
  }
  .in {
    padding: 0 0.8rem 0.75rem;
    display: grid;
    gap: 0.55rem;
  }
  .steps {
    list-style: none;
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
    border-left: 2px solid color-mix(in srgb, var(--sky, #8fc7ff) 35%, transparent);
    font-size: var(--fs-sm, 0.9rem);
    line-height: 1.5;
  }
  .step.move {
    border-left-color: var(--accent);
  }
  .step.risk {
    border-left-color: var(--warn);
  }
  .key {
    font: 700 0.64rem/1.9 var(--font-ui);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text);
  }
  .rest summary {
    padding: 0.2rem 0;
    font-weight: 600;
    color: var(--text-muted);
  }
  .raw {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text-muted);
    font-size: var(--fs-sm, 0.9rem);
    max-height: 16rem;
    overflow-y: auto;
  }
  .source {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-faint, var(--text-muted));
  }
  @media (max-width: 520px) {
    .step {
      grid-template-columns: 1fr;
      gap: 0.1rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: none;
    }
  }
</style>
