<script lang="ts">
  import EmptyState from "../components/EmptyState.svelte";
  import StudioPlan from "../components/lore/studio/StudioPlan.svelte";
  import StudioQuestions from "../components/lore/studio/StudioQuestions.svelte";
  import StudioReview from "../components/lore/studio/StudioReview.svelte";
  import StudioSeed from "../components/lore/studio/StudioSeed.svelte";
  import StudioStart from "../components/lore/studio/StudioStart.svelte";
  import { ArrowLeft, BookOpen, Check } from "../lib/icons";
  import { navigate } from "../lib/router.svelte";
  import { StudioSession } from "../lib/studio.svelte";
  import type { StudioStage } from "../lib/types";

  let { id }: { id?: string } = $props();

  // svelte-ignore state_referenced_locally
  const session = id ? new StudioSession(id) : null;
  $effect(() => {
    if (!session) return;
    void session.load();
    const off = session.listen();
    return () => {
      off();
      session.dispose();
    };
  });
  const draft = $derived(session?.draft ?? null);

  const STEPS: { stage: StudioStage; label: string }[] = [
    { stage: "start", label: "Start" },
    { stage: "questions", label: "Questions" },
    { stage: "plan", label: "Plan" },
    { stage: "review", label: "Write & review" },
  ];
  const at = $derived(draft ? (draft.stage === "done" ? 3 : STEPS.findIndex((s) => s.stage === draft.stage)) : 0);
  const SOURCE: Record<string, string> = { idea: "From your idea", character: "Companion lore for", persona: "Lore for your persona", document: "From", book: "Growing" };
  const sourceLabel = $derived(draft ? `${SOURCE[draft.source.kind]}${draft.source.refName ? ` ${draft.source.refName}` : draft.source.kind === "document" ? ` ${draft.source.fileName || "your notes"}` : ""}` : "");

  function go(stage: StudioStage) {
    if (!session?.draft) return;
    session.draft.stage = stage;
    session.save({ stage }, "stage", 0);
    window.scrollTo?.({ top: 0 });
  }
</script>

{#if !session}
  <StudioStart />
{:else if session.missing}
  <div class="page"><EmptyState icon="📜" title="This draft is gone" text="It was deleted, maybe on another device."><button class="btn primary" onclick={() => navigate("/lore-studio")}>Lore Studio</button></EmptyState></div>
{:else if draft}
  <div class="page">
    <button class="btn ghost small" onclick={() => navigate("/lore-studio")}><ArrowLeft size={15} /> Lore Studio</button>
    <div class="head">
      <input class="title" bind:value={draft.title} oninput={() => session.save({ title: draft.title }, "title")} aria-label="Lorebook name" />
      <span class="chip lavender src">{sourceLabel}</span>
    </div>
    {#if draft.committedBookId}
      <a class="notice ok saved small" href="/lorebooks/{draft.committedBookId}"><BookOpen size={15} /> Saved to a lorebook. Open it →<span class="tiny muted"> You can keep planning here; saving again adds only new entries.</span></a>
    {/if}

    <nav class="steps" aria-label="Steps">
      {#each STEPS as s, i (s.stage)}
        <button class="step" class:on={i === at} class:past={i < at} onclick={() => go(s.stage)} aria-current={i === at ? "step" : undefined} aria-label="Step {i + 1}: {s.label}">
          <span class="dot">{#if i < at}<Check size={12} />{:else}{i + 1}{/if}</span>
          <span class="label">{s.label}</span>
        </button>
      {/each}
    </nav>

    {#if draft.stage === "start"}
      <StudioSeed {session} />
    {:else if draft.stage === "questions"}
      <StudioQuestions {session} />
    {:else if draft.stage === "plan"}
      <StudioPlan {session} />
    {:else}
      <StudioReview {session} />
    {/if}
  </div>
{/if}

<style>
  .page {
    max-width: 58rem;
    margin: 0 auto;
    padding: 1.2rem clamp(1rem, 3vw, 2rem) 5rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    flex-wrap: wrap;
  }
  .title {
    flex: 1 1 16rem;
    min-width: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: 600 1.8rem/1.2 var(--font-display);
    font-variation-settings: "SOFT" 100;
    padding: 0.2rem 0;
    outline: none;
    border-bottom: 2px solid transparent;
  }
  .title:focus {
    border-bottom-color: var(--accent);
  }
  .src {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .saved {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    text-decoration: none;
  }
  .steps {
    display: flex;
    gap: 0.3rem;
    overflow-x: auto;
    scrollbar-width: none;
    padding-bottom: 0.2rem;
  }
  .step {
    flex: 1 0 auto;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    border: 0;
    background: none;
    font: inherit;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.45rem 0.6rem;
    border-radius: var(--r-pill);
    border-bottom: 2px solid var(--border);
    border-radius: 0;
  }
  .step.on {
    color: var(--text);
    border-bottom-color: var(--accent);
    font-weight: 700;
  }
  .step.past {
    color: var(--text);
  }
  .dot {
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: var(--fs-xs);
    background: var(--border);
  }
  .step.on .dot {
    background: var(--accent);
    color: var(--on-accent);
  }
  .step.past .dot {
    background: color-mix(in srgb, var(--mint) 70%, var(--surface));
  }
  .step .label {
    white-space: nowrap;
  }
  @media (max-width: 640px) {
    .step:not(.on) .label {
      display: none;
    }
  }
</style>
