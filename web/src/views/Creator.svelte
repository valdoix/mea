<script lang="ts">
  import EmptyState from "../components/EmptyState.svelte";
  import CreatorBible from "../components/creator/CreatorBible.svelte";
  import CreatorHub from "../components/creator/CreatorHub.svelte";
  import CreatorIdea from "../components/creator/CreatorIdea.svelte";
  import CreatorQuestions from "../components/creator/CreatorQuestions.svelte";
  import CreatorWrite from "../components/creator/CreatorWrite.svelte";
  import { CreatorSession } from "../lib/creator.svelte";
  import { ArrowLeft, Check } from "../lib/icons";
  import { navigate } from "../lib/router.svelte";
  import type { CreatorStage } from "../lib/types";

  let { id }: { id?: string } = $props();

  // svelte-ignore state_referenced_locally
  const session = id ? new CreatorSession(id) : null;
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

  const STEPS: { stage: CreatorStage; label: string }[] = [
    { stage: "idea", label: "Idea" },
    { stage: "questions", label: "Questions" },
    { stage: "bible", label: "Bible" },
    { stage: "write", label: "Write & save" },
  ];
  const at = $derived(draft ? (draft.stage === "done" ? 3 : STEPS.findIndex((s) => s.stage === draft.stage)) : 0);

  function go(stage: CreatorStage) {
    if (!session?.draft) return;
    session.draft.stage = stage;
    session.save({ stage }, "stage", 0);
    window.scrollTo?.({ top: 0 });
  }
</script>

{#if !session}
  <CreatorHub />
{:else if session.missing}
  <div class="page"><EmptyState icon="🪞" title="This draft is gone" text="It was deleted, maybe on another device."><button class="btn primary" onclick={() => navigate("/creator")}>Creator Studio</button></EmptyState></div>
{:else if draft}
  <div class="page">
    <button class="btn ghost small" onclick={() => navigate("/creator")}><ArrowLeft size={15} /> Creator Studio</button>
    <div class="head">
      <input class="title" bind:value={draft.name} oninput={() => session.save({ name: draft.name }, "name")} aria-label="Name" />
      <span class="chip {draft.kind === 'persona' ? 'lavender' : 'rose'}">{draft.kind === "persona" ? "Persona" : draft.options.mode === "narrator" ? "Narrator card" : "Character"}</span>
    </div>
    {#if draft.baseId}
      <span class="tiny muted">Reworking <a href={draft.kind === "persona" ? `/personas/${draft.baseId}` : `/character/${draft.baseId}`}>the saved {draft.kind === "persona" ? "persona" : "card"}</a>. Saving updates it{draft.kind === "character" ? " and keeps the old version in its history" : ""}.</span>
    {:else if draft.origin?.loreDraftId}
      <span class="tiny muted">From an entry in <a href="/lore-studio/{draft.origin.loreDraftId}">a Lore Studio draft</a>; that world is its context.</span>
    {:else if draft.origin?.fromDraftId}
      <span class="tiny muted">Built from <a href="/creator/{draft.origin.fromDraftId}">another draft</a>'s bible.</span>
    {/if}

    <nav class="steps" aria-label="Steps">
      {#each STEPS as s, i (s.stage)}
        <button class="step" class:on={i === at} class:past={i < at} onclick={() => go(s.stage)} aria-current={i === at ? "step" : undefined} aria-label="Step {i + 1}: {s.label}">
          <span class="dot">{#if i < at}<Check size={12} />{:else}{i + 1}{/if}</span>
          <span class="label">{s.label}</span>
        </button>
      {/each}
    </nav>

    {#if draft.stage === "idea"}
      <CreatorIdea {session} />
    {:else if draft.stage === "questions"}
      <CreatorQuestions {session} />
    {:else if draft.stage === "bible"}
      <CreatorBible {session} />
    {:else}
      <CreatorWrite {session} />
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
    border-bottom: 2px solid var(--border);
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
