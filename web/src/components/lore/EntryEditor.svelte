<script lang="ts">
  import TagInput from "../TagInput.svelte";
  import { autosize } from "../../lib/gestures";
  import type { LoreEntry } from "../../lib/types";

  let { entry = $bindable(), full }: { entry: LoreEntry | undefined; full: boolean } = $props();

  const nullableBool = (v: string) => (v === "" ? null : v === "true");
</script>

{#if entry}
<div class="stack">
  <div class="row wrap">
    <label class="field grow"><span class="label">Title</span><input class="input" bind:value={entry.comment} placeholder="e.g. The lighthouse" /></label>
    <label class="switch" title="Always in the prompt"><input type="checkbox" bind:checked={entry.constant} /> Always on</label>
    <label class="switch"><input type="checkbox" bind:checked={entry.enabled} /> Enabled</label>
  </div>
  <label class="field">
    <span class="label">Keywords <span class="faint">matched in recent messages · /regex/ allowed</span></span>
    <TagInput bind:value={entry.keys} placeholder={entry.constant ? "Not needed for always-on entries" : "Add a keyword and press Enter"} />
  </label>
  <label class="field">
    <span class="label">Content</span>
    <textarea class="textarea story" use:autosize={500} bind:value={entry.content} placeholder="What the model should know when this fires"></textarea>
  </label>

  {#if full}
    <div class="grid2">
      <label class="field">
        <span class="label">Secondary keywords</span>
        <TagInput bind:value={entry.secondaryKeys} placeholder="Optional filter" />
      </label>
      <label class="field">
        <span class="label">Secondary logic</span>
        <select class="select" bind:value={entry.logic}>
          <option value="and_any">AND any secondary</option>
          <option value="and_all">AND all secondary</option>
          <option value="not_any">NOT any secondary</option>
          <option value="not_all">NOT all secondary</option>
        </select>
      </label>
      <label class="field">
        <span class="label">Position</span>
        <select class="select" bind:value={entry.position}>
          <option value="before_char">Before character</option>
          <option value="after_char">After character</option>
          <option value="an_top">Top of author's note</option>
          <option value="an_bottom">Bottom of author's note</option>
          <option value="ex_top">Before examples</option>
          <option value="ex_bottom">After examples</option>
          <option value="depth">In chat at depth…</option>
        </select>
      </label>
      {#if entry.position === "depth"}
        <div class="row">
          <label class="field grow"><span class="label">Depth</span><input class="input" type="number" min="0" bind:value={entry.depth} /></label>
          <label class="field grow">
            <span class="label">Role</span>
            <select class="select" bind:value={entry.role}><option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option></select>
          </label>
        </div>
      {/if}
      <label class="field"><span class="label">Order <span class="faint">higher = more priority</span></span><input class="input" type="number" bind:value={entry.order} /></label>
      <label class="field">
        <span class="label">Probability <span class="faint">{entry.useProbability ? `${entry.probability}%` : "off"}</span></span>
        <div class="row"><input type="checkbox" bind:checked={entry.useProbability} aria-label="Use probability" /><input type="range" min="0" max="100" bind:value={entry.probability} disabled={!entry.useProbability} /></div>
      </label>
      <label class="field"><span class="label">Scan depth <span class="faint">blank = book default</span></span><input class="input" type="number" min="0" value={entry.scanDepth ?? ""} oninput={(e) => (entry.scanDepth = e.currentTarget.value === "" ? null : Number(e.currentTarget.value))} /></label>
      <label class="field">
        <span class="label">Case sensitive</span>
        <select class="select" value={String(entry.caseSensitive ?? "")} onchange={(e) => (entry.caseSensitive = nullableBool(e.currentTarget.value))}><option value="">Book default</option><option value="true">Yes</option><option value="false">No</option></select>
      </label>
      <label class="field">
        <span class="label">Whole words</span>
        <select class="select" value={String(entry.matchWholeWords ?? "")} onchange={(e) => (entry.matchWholeWords = nullableBool(e.currentTarget.value))}><option value="">Book default</option><option value="true">Yes</option><option value="false">No</option></select>
      </label>
      <label class="field"><span class="label">Inclusion group</span><input class="input" bind:value={entry.group} placeholder="Only one entry per group fires" /></label>
      <label class="field"><span class="label">Group weight</span><input class="input" type="number" min="0" bind:value={entry.groupWeight} /></label>
      <label class="field"><span class="label">Sticky <span class="faint">messages</span></span><input class="input" type="number" min="0" bind:value={entry.sticky} /></label>
      <label class="field"><span class="label">Cooldown <span class="faint">messages</span></span><input class="input" type="number" min="0" bind:value={entry.cooldown} /></label>
      <label class="field"><span class="label">Delay <span class="faint">until message #</span></span><input class="input" type="number" min="0" bind:value={entry.delay} /></label>
    </div>
    <div class="row wrap toggles">
      <label class="switch"><input type="checkbox" bind:checked={entry.groupOverride} /> Prioritize in group</label>
      <label class="switch"><input type="checkbox" checked={Boolean(entry.useGroupScoring)} onchange={(e) => (entry.useGroupScoring = e.currentTarget.checked || null)} /> Group scoring</label>
      <label class="switch"><input type="checkbox" bind:checked={entry.excludeRecursion} /> Not triggered by other entries</label>
      <label class="switch"><input type="checkbox" bind:checked={entry.preventRecursion} /> Doesn't trigger other entries</label>
      <label class="switch"><input type="checkbox" bind:checked={entry.delayUntilRecursion} /> Only via other entries</label>
    </div>
  {/if}
</div>
{/if}

<style>
  .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.8rem;
  }
  .toggles {
    gap: 1rem;
  }
</style>
