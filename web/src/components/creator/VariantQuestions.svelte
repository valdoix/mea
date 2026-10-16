<script lang="ts">
  import type { CreatorSession } from "../../lib/creator.svelte";
  import { autosize } from "../../lib/gestures";
  import { Check, Loader, MessageQuestion, Plus, StepForward, X } from "../../lib/icons";

  /** A version's questions (docs/14): what stays true about them, then the questions about the change. */
  let { session }: { session: CreatorSession } = $props();
  const draft = $derived(session.draft!);
  const v = $derived(draft.variant!);
  let anchorDraft = $state("");
  let steer = $state("");

  async function saveAnchors(patch: { id?: string; text?: string; kept?: boolean; remove?: boolean }[]) {
    await session.flush();
    session.save({ variant: { anchors: patch } }, `anchors:${Date.now()}`, 0);
  }

  function toggle(id: string, kept: boolean) {
    const a = session.draft!.variant!.anchors.find((x) => x.id === id);
    if (a) a.kept = kept;
    void saveAnchors([{ id, kept }]);
  }

  function remove(id: string) {
    session.draft!.variant!.anchors = session.draft!.variant!.anchors.filter((x) => x.id !== id);
    void saveAnchors([{ id, remove: true }]);
  }

  async function add() {
    const text = anchorDraft.trim();
    if (!text) return;
    anchorDraft = "";
    await saveAnchors([{ text }]);
    await session.flush();
    await session.load();
  }

  function answer(qid: string, text: string) {
    const q = session.draft!.questions.find((x) => x.id === qid);
    if (q) q.answer = text;
    session.save({ answers: { [qid]: text }, answerSources: { [qid]: "typed" } }, `answer:${qid}`);
  }

  function pick(qid: string, text: string) {
    const q = session.draft!.questions.find((x) => x.id === qid);
    if (q) q.answer = text;
    session.save({ answers: { [qid]: text }, answerSources: { [qid]: "picked" } }, `answer:${qid}`, 0);
  }

  async function next() {
    session.draft!.stage = "map";
    session.save({ stage: "map" }, "stage", 0);
    if (!v.mapBuilt) await session.act("map", "/variant/map");
  }

  const answered = $derived(draft.questions.filter((q) => q.answer.trim()).length);
</script>

<section class="stack">
  <div class="panel stack tight">
    <span class="label">What stays true</span>
    <span class="tiny muted">What makes {v.originName} them in any version. Untick what this version lets go; add your own. The version is checked against these.</span>
    {#each v.anchors as a (a.id)}
      <div class="anchor" class:off={!a.kept}>
        <label class="row grow"><input type="checkbox" checked={a.kept} onchange={(e) => toggle(a.id, e.currentTarget.checked)} /> <span class="small">{a.text}</span></label>
        {#if a.from === "mea"}<span class="tiny faint">Mea's suggestion</span>{/if}
        <button class="btn ghost icon small" onclick={() => remove(a.id)} aria-label="Remove"><X size={13} /></button>
      </div>
    {:else}
      <div class="row">
        <span class="tiny muted grow">Nothing yet.</span>
        <button class="btn small" onclick={() => session.act("anchors", "/variant/start", { anchorsOnly: true })} disabled={Boolean(session.busy)}>{#if session.busy === "anchors"}<span class="spin"><Loader size={14} /></span> Reading {v.originName}…{:else}Suggest them{/if}</button>
      </div>
    {/each}
    <div class="row">
      <input class="input grow" bind:value={anchorDraft} placeholder="Calls everyone by their surname" maxlength="300" onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), void add())} aria-label="Add something that stays true" />
      <button class="btn small" onclick={add} disabled={!anchorDraft.trim()}><Plus size={13} /> Add</button>
    </div>
  </div>

  <div class="stack">
    <span class="label"><MessageQuestion size={14} /> About this version <span class="faint">{answered} of {draft.questions.length} answered</span></span>
    {#each draft.questions as q (q.id)}
      <div class="card stack tight q">
        <b>{q.q}</b>
        {#if q.why}<span class="tiny muted">{q.why}</span>{/if}
        {#if q.suggestions.length}
          <div class="row wrap">
            {#each q.suggestions as s (s)}<button class="chip" class:lavender={q.answer.trim() === s} onclick={() => pick(q.id, s)}>{#if q.answer.trim() === s}<Check size={11} />{/if} {s}</button>{/each}
          </div>
        {/if}
        <textarea class="textarea" use:autosize={{ max: 240, value: q.answer }} value={q.answer} oninput={(e) => answer(q.id, e.currentTarget.value)} placeholder="Your answer, or tap one above"></textarea>
      </div>
    {/each}
    <div class="row wrap">
      <input class="input grow" bind:value={steer} placeholder="Ask me about… (optional)" aria-label="What to be asked about" />
      <button class="btn" onclick={async () => { if (await session.act("question", "/variant/question", { steer })) steer = ""; }} disabled={Boolean(session.busy)}>
        {#if session.busy === "question"}<span class="spin"><Loader size={14} /></span> Thinking…{:else}<Plus size={14} /> Ask me another{/if}
      </button>
    </div>
  </div>

  <div class="row actions">
    <span class="tiny muted grow">Anything you leave open, Mea decides from the premise.</span>
    <button class="btn primary" onclick={next} disabled={Boolean(session.busy)}>
      {#if session.busy === "map"}<span class="spin"><Loader size={14} /></span> Reading {v.originName}'s world…{:else}<StepForward size={16} /> Next: the map{/if}
    </button>
  </div>
</section>

<style>
  .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .anchor {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .anchor label {
    gap: 0.45rem;
    align-items: center;
    cursor: pointer;
  }
  .anchor.off span.small {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  .q {
    padding: 0.8rem 1rem;
  }
  .spin {
    display: inline-grid;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
