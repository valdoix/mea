<script lang="ts">
  import { FIELD_STEERS, type CreatorSession } from "../../lib/creator.svelte";
  import { promptText } from "../../lib/dialogs.svelte";
  import { autosize } from "../../lib/gestures";
  import { CircleAlert, Loader, PenLine, RotateCcw, TriangleAlert } from "../../lib/icons";
  import type { CardField, StudioIssue } from "../../lib/types";

  let { session, field, issues = [], tokens = 0 }: { session: CreatorSession; field: CardField; issues?: StudioIssue[]; tokens?: number } = $props();
  const busy = $derived(field.status === "queued" || field.status === "writing");
  const short = $derived(field.key === "tags" || field.key === "pronouns");
  const HINT: Record<string, string> = {
    description: "Always in the prompt: who they are, for the storyteller.",
    personality: "Always in the prompt: a short summary.",
    scenario: "Always in the prompt: where the story starts.",
    first_mes: "The opening message. The model copies its voice and length.",
    mes_example: "Teaches the voice; dropped first when the prompt is tight.",
    tags: "For your library, not the model.",
    creator_notes: "For you, not the model.",
    pronouns: "",
  };

  const hint = $derived(HINT[field.key] ?? (field.key.startsWith("alt_") ? "Offered as a swipe on the first message." : ""));

  async function rewrite(steer: string) {
    let s = steer;
    if (s === "…") {
      const v = await promptText({ title: `Rewrite the ${field.label.toLowerCase()}`, label: "What should change?", placeholder: "Open at the docks at dawn instead; she's hiding an injury", confirmLabel: "Rewrite" });
      if (!v?.trim()) return;
      s = v.trim();
    }
    await session.act(`field:${field.key}`, "/write", { keys: [field.key], steer: s });
  }
</script>

<div class="card field-card" id="field-{field.key}">
  <div class="row between head">
    <div class="grow">
      <b>{field.label}</b>
      {#if hint}{" "}<span class="tiny muted">· {hint}</span>{/if}
    </div>
    {#if busy}<span class="spin"><Loader size={15} /></span><span class="tiny muted">{field.status === "writing" ? "Writing…" : "In line"}</span>{/if}
    {#if field.value.trim() && !short}<span class="tiny faint">{tokens} tok</span>{/if}
  </div>

  {#if field.status === "error"}<p class="tiny error">Failed: {field.error}</p>{/if}

  {#if short}
    <input class="input" value={field.value} disabled={busy} oninput={(e) => { field.value = e.currentTarget.value; session.save({ fields: { [field.key]: field.value } }, `field:${field.key}`); }} />
  {:else}
    <textarea class="textarea story" use:autosize={{ max: field.key === "description" ? 640 : 480, value: field.value }} value={field.value} disabled={busy} placeholder={busy ? "" : "Not written yet"} oninput={(e) => { field.value = e.currentTarget.value; session.save({ fields: { [field.key]: field.value } }, `field:${field.key}`); }}></textarea>
  {/if}

  {#if issues.length}
    <ul class="issues">
      {#each issues as iss, k (k)}<li class="tiny" class:warn={iss.severity === "warn"}>{#if iss.severity === "warn"}<TriangleAlert size={11} />{:else}<CircleAlert size={11} />{/if} {iss.message}</li>{/each}
    </ul>
  {/if}

  <div class="row wrap tools">
    {#if field.value.trim()}
      <span class="tiny muted"><PenLine size={12} /> Rewrite:</span>
      {#if !short}{#each FIELD_STEERS as s (s)}<button class="chip tiny steer" onclick={() => rewrite(s)} disabled={busy || Boolean(session.busy)}>{s}</button>{/each}{/if}
      <button class="chip tiny steer" onclick={() => rewrite("…")} disabled={busy || Boolean(session.busy)}>Something else…</button>
      <button class="chip tiny steer" onclick={() => rewrite("")} disabled={busy || Boolean(session.busy)}>Fresh draft</button>
      {#if field.previous !== null}<button class="btn ghost small" onclick={() => session.act("restore", `/fields/${field.key}/restore`)} disabled={busy}><RotateCcw size={13} /> Previous version</button>{/if}
    {:else if !busy}
      <button class="btn small" onclick={() => rewrite(field.steer)} disabled={Boolean(session.busy)}><PenLine size={14} /> {field.status === "error" ? "Try again" : "Write it"}</button>
    {/if}
  </div>
</div>

<style>
  .field-card {
    display: grid;
    gap: 0.45rem;
    padding: 0.8rem 1rem;
  }
  .head {
    gap: 0.4rem;
    align-items: center;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .error {
    color: var(--danger);
    margin: 0;
  }
  .issues {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.2rem;
    color: var(--text-muted);
  }
  .issues .warn {
    color: var(--danger);
  }
  .tools {
    gap: 0.3rem;
    align-items: center;
  }
  .steer {
    cursor: pointer;
    border: 1px solid var(--border);
    font: inherit;
    font-size: var(--fs-xs);
  }
  .steer:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .spin {
    display: inline-grid;
    animation: spin 1s linear infinite;
    color: var(--text-muted);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
