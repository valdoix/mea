<script lang="ts">
  import ExtendButton from "../studio/ExtendButton.svelte";
  import ResearchPanel from "../studio/ResearchPanel.svelte";
  import Suggestions from "../studio/Suggestions.svelte";
  import type { CreatorSession } from "../../lib/creator.svelte";
  import { autosize } from "../../lib/gestures";
  import { MessageQuestion, NotebookPen, Sparkles } from "../../lib/icons";

  let { session }: { session: CreatorSession } = $props();
  const draft = $derived(session.draft!);
  const answered = $derived(draft.questions.filter((q) => q.answer.trim()).length);
</script>

<section class="stack">
  {#if draft.readback}
    <div class="panel stack tight">
      <span class="label"><Sparkles size={14} /> What Mea understood</span>
      <p class="story">{draft.readback.understood}</p>
      {#if draft.readback.missing.length}
        <div class="row wrap"><span class="tiny muted">Still unclear:</span>{#each draft.readback.missing as m, i (i)}<span class="chip tiny peach">{m}</span>{/each}</div>
      {/if}
      <span class="tiny muted">Not right? Go back to Idea and say it another way.</span>
    </div>
  {/if}
  <label class="field">
    <span class="label">Based on <span class="faint">a character from an existing show, book or game: their canon fills in what you don't change</span></span>
    <input class="input" bind:value={draft.basedOn} oninput={() => session.save({ basedOn: draft.basedOn }, "basedOn")} placeholder="Yellowjackets (TV series) · leave empty for an original character" />
  </label>
  {#if draft.basedOn || draft.research}
    <ResearchPanel research={draft.research} basedOn={draft.basedOn} busy={session.busy === "research"} onresearch={(urls) => session.act("research", "/research", { urls })} />
  {/if}

  {#each draft.questions as q (q.id)}
    <div class="card stack tight question">
      <b>{q.q}</b>
      {#if q.why}<span class="tiny muted">Why I'm asking: {q.why}</span>{/if}
      <textarea class="textarea" use:autosize={{ max: 300, value: q.answer }} rows="2" bind:value={q.answer} oninput={() => session.save({ answers: { [q.id]: q.answer } }, `answer:${q.id}`)} placeholder="In your own words, pick a suggestion, or leave it blank to let Mea decide"></textarea>
      <Suggestions suggestions={q.suggestions ?? []} answer={q.answer} onpick={(t) => { q.answer = t; session.save({ answers: { [q.id]: t } }, `answer:${q.id}`, 0); }} />
      <div class="row">
        <ExtendButton text={q.answer} question={q.q} idea={draft.idea} onresult={(t) => { q.answer = t; session.save({ answers: { [q.id]: t } }, `answer:${q.id}`, 0); }} />
      </div>
    </div>
  {/each}

  <div class="row wrap actions">
    <span class="tiny muted grow">{answered} of {draft.questions.length} answered. Your answers outrank anything the model would invent.</span>
    <button class="btn" onclick={() => session.act("readback", "/readback")} disabled={Boolean(session.busy)}><MessageQuestion size={16} /> {session.busy === "readback" ? "Thinking…" : "More questions"}</button>
    <button class="btn primary" onclick={() => session.act("bible", "/bible")} disabled={Boolean(session.busy)}><NotebookPen size={16} /> {session.busy === "bible" ? "Writing the bible…" : "Write the bible"}</button>
  </div>
</section>

<style>
  .question {
    padding: 0.9rem 1rem;
  }
  p.story {
    margin: 0;
  }
  .actions {
    align-items: center;
  }
  .grow {
    flex: 1 1 14rem;
  }
</style>
