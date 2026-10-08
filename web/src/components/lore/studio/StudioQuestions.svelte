<script lang="ts">
  import { autosize } from "../../../lib/gestures";
  import { ListTree, MessageQuestion, Sparkles } from "../../../lib/icons";
  import type { StudioSession } from "../../../lib/studio.svelte";
  import ExtendButton from "../../studio/ExtendButton.svelte";

  let { session }: { session: StudioSession } = $props();
  const draft = $derived(session.draft!);
  const answered = $derived(draft.questions.filter((q) => q.answer.trim()).length);
</script>

<section class="stack">
  {#if draft.readback}
    <div class="panel stack tight readback">
      <span class="label"><Sparkles size={14} /> What Mea understood</span>
      <p class="story">{draft.readback.understood}</p>
      {#if draft.readback.missing.length}
        <div class="row wrap"><span class="tiny muted">Still unclear:</span>{#each draft.readback.missing as m, i (i)}<span class="chip tiny peach">{m}</span>{/each}</div>
      {/if}
      <span class="tiny muted">Not right? Go back to Start and say it another way.</span>
    </div>
  {:else}
    <p class="muted small">Mea hasn't read your material yet.</p>
  {/if}

  {#each draft.questions as q (q.id)}
    <div class="question card stack tight">
      <b>{q.q}</b>
      {#if q.why}<span class="tiny muted">Why I'm asking: {q.why}</span>{/if}
      <textarea
        class="textarea"
        use:autosize={{ max: 300, value: q.answer }}
        rows="2"
        bind:value={q.answer}
        oninput={() => session.save({ answers: { [q.id]: q.answer } }, `answer:${q.id}`)}
        placeholder="In your own words, or leave it blank to let Mea decide"
      ></textarea>
      <div class="row"><ExtendButton text={q.answer} question={q.q} idea={draft.source.text} onresult={(t) => { q.answer = t; session.save({ answers: { [q.id]: t } }, `answer:${q.id}`, 0); }} /></div>
    </div>
  {/each}

  <div class="row wrap actions">
    <span class="tiny muted grow">{answered} of {draft.questions.length} answered. Your answers are quoted to the model as the author's own words.</span>
    <button class="btn" onclick={() => session.act("readback", "/readback")} disabled={Boolean(session.busy)}><MessageQuestion size={16} /> {session.busy === "readback" ? "Thinking…" : "More questions"}</button>
    <button class="btn primary" onclick={() => session.act("outline", "/outline")} disabled={Boolean(session.busy)}><ListTree size={16} /> {session.busy === "outline" ? "Planning…" : "Plan the lorebook"}</button>
  </div>
</section>

<style>
  .readback p {
    margin: 0;
  }
  .question {
    padding: 0.9rem 1rem;
  }
  .actions {
    align-items: center;
  }
</style>
