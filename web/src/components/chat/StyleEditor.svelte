<script lang="ts">
  import { autosize } from "../../lib/gestures";
  import type { StyleProfile } from "../../lib/types";

  /** STEER-04: a style profile (prose guide, words to avoid, actions, dialogue punctuation). */
  let { value, inherited = null, onchange }: { value: StyleProfile; inherited?: StyleProfile | null; onchange: (next: StyleProfile) => void } = $props();

  // A local copy so typing isn't interrupted by refreshes.
  // svelte-ignore state_referenced_locally
  let guide = $state(value.guide ?? "");
  // svelte-ignore state_referenced_locally
  let dialogue = $state(value.dialogue ?? "");
  let word = $state("");
  let timer: ReturnType<typeof setTimeout>;

  function emit(patch: Partial<StyleProfile>, delay = 0) {
    clearTimeout(timer);
    timer = setTimeout(() => onchange({ ...value, guide: guide.trim() || undefined, dialogue: dialogue.trim() || undefined, ...patch }), delay);
  }
  function addWord() {
    const w = word.trim();
    if (!w) return;
    emit({ banned: [...new Set([...(value.banned ?? []), w])] });
    word = "";
  }
</script>

<div class="stack tight">
  <label class="field">
    <span class="tiny muted">Prose style guide</span>
    <textarea class="textarea" use:autosize={200} bind:value={guide} oninput={() => emit({}, 600)} placeholder={inherited?.guide ? `From the character: ${inherited.guide}` : "Short paragraphs. Concrete sensory detail. Let silences sit."} maxlength="1500"></textarea>
  </label>
  <div class="sgrid">
    <label class="field">
      <span class="tiny muted">Actions</span>
      <select class="select mini" value={value.actions ?? ""} onchange={(e) => emit({ actions: (e.currentTarget.value || undefined) as StyleProfile["actions"] })}>
        <option value="">{inherited?.actions ? `Character's (${inherited.actions})` : "Any"}</option>
        <option value="asterisks">In *asterisks*</option>
        <option value="plain">Plain prose</option>
        <option value="any">Any</option>
      </select>
    </label>
    <label class="field">
      <span class="tiny muted">Dialogue quotes</span>
      <select class="select mini" value={value.quotes ?? ""} onchange={(e) => emit({ quotes: (e.currentTarget.value || undefined) as StyleProfile["quotes"] })}>
        <option value="">{inherited?.quotes ? `Character's (${inherited.quotes})` : "Any"}</option>
        <option value="straight">"Straight"</option>
        <option value="curly">“Curly” (fixed in replies)</option>
        <option value="any">Any</option>
      </select>
    </label>
  </div>
  <label class="field">
    <span class="tiny muted">Dialogue punctuation, other notes</span>
    <input class="input mini" bind:value={dialogue} oninput={() => emit({}, 600)} placeholder="Em dashes for interruptions; no ellipses" maxlength="200" />
  </label>
  <div class="field">
    <span class="tiny muted">Words this story never uses <span class="faint">(flagged like your banned phrases)</span></span>
    <div class="row wrap words">
      {#each inherited?.banned ?? [] as w (w)}<span class="chip tiny" title="From the character">{w}</span>{/each}
      {#each value.banned ?? [] as w (w)}<span class="chip tiny">{w} <button class="x" onclick={() => emit({ banned: (value.banned ?? []).filter((x) => x !== w) })} aria-label="Remove {w}">×</button></span>{/each}
    </div>
    <input class="input mini" bind:value={word} placeholder="Add a word, Enter" maxlength="80" onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), addWord())} />
  </div>
</div>

<style>
  .sgrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.5rem;
  }
  .words {
    gap: 0.3rem;
  }
  .x {
    border: 0;
    background: none;
    cursor: pointer;
    padding: 0 0.1rem;
    color: inherit;
  }
</style>
