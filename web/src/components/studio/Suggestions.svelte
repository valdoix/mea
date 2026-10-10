<script lang="ts">
  import { Lightbulb } from "../../lib/icons";

  /** Answers to pick from under a studio question: one tap fills it in (or adds to what you wrote). */
  let { suggestions, answer, onpick }: { suggestions: string[]; answer: string; onpick: (text: string) => void } = $props();
</script>

{#if suggestions.length}
  <div class="sugg" role="group" aria-label="Suggested answers">
    <Lightbulb size={13} />
    {#each suggestions as s (s)}
      <button type="button" class="chip pick" class:used={answer.includes(s)} onclick={() => onpick(answer.trim() ? (answer.includes(s) ? answer : `${answer.trim()} ${s}`) : s)}>{s}</button>
    {/each}
  </div>
{/if}

<style>
  .sugg {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    color: var(--text-muted);
  }
  .pick {
    cursor: pointer;
    border: 1px dashed var(--border);
    font: inherit;
    font-size: var(--fs-xs);
    text-align: left;
    background: none;
    color: var(--text);
  }
  .pick:hover {
    border-style: solid;
    border-color: var(--accent);
  }
  .pick.used {
    opacity: 0.5;
  }
</style>
