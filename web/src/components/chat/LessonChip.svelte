<script lang="ts">
  import Modal from "../Modal.svelte";
  import Segmented from "../Segmented.svelte";
  import { autosize } from "../../lib/gestures";
  import { Check, Pencil, X } from "../../lib/icons";
  import { type Lesson, type LessonScope, SCOPES, setLesson, suggestedFor } from "../../lib/lessons.svelte";
  import { toast } from "../../lib/state.svelte";

  /**
   * A1: "2 lessons from your swipes" under a reply you kept after swiping (or edited). Each card
   * shows the rule, why, and the take it came from, with Keep, Edit, Not this and a scope.
   */
  let { messageId }: { messageId: string } = $props();
  const list = $derived(suggestedFor(messageId));
  let open = $state(false);
  let editing = $state<string | null>(null);
  let draft = $state("");
  let scopes = $state<Record<string, LessonScope>>({});

  const fromEdit = $derived(list.length > 0 && list.every((l) => l.data.from === "edit"));
  async function keep(l: Lesson) {
    await setLesson(l, { status: "kept", scope: scopes[l.id] ?? "story", ...(editing === l.id && draft.trim() ? { text: draft.trim() } : {}) });
    editing = null;
    toast("Kept: it goes to the model every turn", { kind: "ok" });
    if (list.length <= 1) open = false;
  }
  async function notThis(l: Lesson) {
    await setLesson(l, { status: "rejected" });
    if (list.length <= 1) open = false;
  }
  function edit(l: Lesson) {
    editing = l.id;
    draft = l.text;
  }
</script>

{#if list.length}
  <button type="button" class="lchip" onclick={() => (open = true)} title="What the takes you passed over got wrong">
    <span aria-hidden="true">📏</span>
    {list.length}
    {list.length === 1 ? "lesson" : "lessons"} from your {fromEdit ? "edit" : "swipes"}
  </button>
{/if}

<Modal bind:open title={fromEdit ? "Lessons from your edit" : "Lessons from your swipes"} size="md">
  <div class="stack">
    <p class="tiny muted">Kept lessons go to the model every turn, and Mea checks each reply against them. Ones that keep slipping grow stronger; ones not needed for 200 messages rest.</p>
    {#each list as l (l.id)}
      <article class="card lcard">
        {#if editing === l.id}
          <textarea class="textarea" use:autosize={200} bind:value={draft} maxlength="300" aria-label="The lesson"></textarea>
        {:else}
          <p class="ltext">{l.text}</p>
        {/if}
        {#if l.why}<p class="tiny muted">{l.why}</p>{/if}
        {#if l.quote || l.data.rejected?.length}
          <div class="evidence small">
            <div><span class="tiny faint">You passed over</span><p>“{l.quote || l.data.rejected?.[0]?.quote}”</p></div>
            {#if l.data.kept}<div><span class="tiny faint">You kept</span><p>“{l.data.kept}”</p></div>{/if}
          </div>
        {/if}
        <div class="row wrap between">
          <Segmented small value={scopes[l.id] ?? "story"} options={SCOPES} onchange={(v) => (scopes = { ...scopes, [l.id]: v })} />
          <span class="tiny faint">{SCOPES.find((s) => s.value === (scopes[l.id] ?? "story"))?.title}</span>
        </div>
        <div class="row wrap">
          <button class="btn primary small" onclick={() => keep(l)}><Check size={14} /> {editing === l.id ? "Save and keep" : "Keep"}</button>
          {#if editing !== l.id}<button class="btn ghost small" onclick={() => edit(l)}><Pencil size={14} /> Edit</button>{:else}<button class="btn ghost small" onclick={() => (editing = null)}>Cancel edit</button>{/if}
          <button class="btn ghost small" onclick={() => notThis(l)}><X size={14} /> Not this</button>
          <span class="tiny faint by">{l.by === "model" ? "the helper compared your takes" : l.by === "edit" ? "from your edit" : "found by the rules"}</span>
        </div>
      </article>
    {/each}
  </div>
</Modal>

<style>
  .lchip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.4rem;
    padding: 0.22rem 0.6rem;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--accent-ink, var(--text));
    font: 700 var(--fs-xs) / 1.2 var(--font-ui);
    cursor: pointer;
  }
  .lcard {
    display: grid;
    gap: 0.5rem;
    padding: 0.8rem 0.9rem;
  }
  .ltext {
    margin: 0;
    font-weight: 600;
  }
  .evidence {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }
  .evidence p {
    margin: 0.15rem 0 0;
    font-style: italic;
    color: var(--text-muted);
  }
  .by {
    margin-left: auto;
  }
  @media (max-width: 520px) {
    .evidence {
      grid-template-columns: 1fr;
    }
  }
</style>
