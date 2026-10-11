<script lang="ts">
  import Module from "../desk/Module.svelte";
  import Seg from "../desk/Seg.svelte";
  import { dockRequest } from "../../lib/dock.svelte";
  import { Plus, Trash } from "../../lib/icons";
  import { addLesson, type Lesson, type LessonScope, lessonsState, removeLesson, SCOPES, setLesson } from "../../lib/lessons.svelte";

  /**
   * A1: the Story tab's Lessons. Every lesson that applies here (this story, this character,
   * every story), with on/off, strength, resting, and Add a lesson. Suggestions wait under their
   * replies and in the Inbox.
   */
  let { chatId }: { chatId: string } = $props();

  const shown = $derived(lessonsState.list.filter((l) => l.status === "kept" || l.status === "off"));
  const waiting = $derived(lessonsState.list.filter((l) => l.status === "suggested").length);
  const active = $derived(shown.filter((l) => l.status === "kept" && !l.resting).length);
  let text = $state("");
  let scope = $state<LessonScope>("story");
  let open = $state(false);
  let el = $state<HTMLElement | null>(null);

  // A Status tile or a citation asked for this section.
  $effect(() => {
    if (dockRequest.seq && dockRequest.section === "lessons") {
      open = true;
      requestAnimationFrame(() => el?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  });

  function add() {
    if (!text.trim()) return;
    void addLesson(chatId, text.trim(), scope);
    text = "";
  }
  const scopeLabel = (l: Lesson) => (l.scope === "story" ? "" : l.scope === "character" ? "character" : "everywhere");
  const toggle = (l: Lesson) => setLesson(l, { status: l.status === "kept" ? "off" : "kept" });
</script>

<div bind:this={el} data-section="lessons">
  <Module title="Lessons" fold bind:open led={waiting ? "warm" : active ? "on" : null} peek={waiting ? `${waiting} to look at` : shown.length ? `${active} in use` : "From your swipes"}>
    {#if lessonsState.mode === "off"}<p class="st-hint first">Suggesting lessons is off (Settings › Guards). Lessons you add still go to the model.</p>{/if}
    {#if shown.length}
      <ul class="lessons">
        {#each shown as l (l.id)}
          <li class:off={l.status === "off"} class:resting={l.resting}>
            <button type="button" class="st-key sq led" aria-pressed={l.status === "kept"} onclick={() => toggle(l)} title={l.status === "kept" ? "Switch off" : "Switch on"} aria-label="{l.status === 'kept' ? 'Switch off' : 'Switch on'}: {l.text}"><span class="st-led" class:on={l.status === "kept" && !l.resting} class:warm={l.resting}></span></button>
            <span class="ltext">
              {l.text}
              <small>
                <span class="bar" title="Strength {l.strength} of 5: grows each time a reply breaks it" aria-label="Strength {l.strength} of 5">{#each [1, 2, 3, 4, 5] as n (n)}<i class:on={n <= l.strength}></i>{/each}</span>
                {#if l.resting}resting · not needed lately{/if}
                {#if scopeLabel(l)}{l.resting ? " · " : ""}{scopeLabel(l)}{/if}
                {#if l.lastBrokenSeq}{l.resting || scopeLabel(l) ? " · " : ""}last broken #{l.lastBrokenSeq}{/if}
              </small>
            </span>
            <button type="button" class="st-key sq" onclick={() => removeLesson(l)} title="Delete" aria-label="Delete: {l.text}"><Trash size={13} /></button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="st-hint first">When you swipe past takes and keep one, Mea suggests what the others got wrong, under the reply you kept. Lessons you keep land here.</p>
    {/if}
    <label class="st-addline"><Plus size={14} /><input bind:value={text} placeholder="Wren doesn't apologise easily. Enter to add" maxlength="300" onkeydown={(e) => e.key === "Enter" && add()} aria-label="Add a lesson" /></label>
    <div class="st-seg-row"><span class="st-k">Applies to</span><Seg label="Applies to" value={scope} options={SCOPES} onchange={(v) => (scope = v)} /></div>
  </Module>
</div>

<style>
  .lessons {
    display: grid;
    gap: 6px;
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
  }
  .lessons li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: var(--st-inset-sm);
  }
  .lessons li.off .ltext,
  .lessons li.resting .ltext {
    color: var(--text-faint);
  }
  .ltext {
    display: grid;
    gap: 3px;
    font-size: 13px;
    line-height: 1.35;
  }
  .ltext small {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-faint);
  }
  .bar {
    display: inline-flex;
    gap: 2px;
  }
  .bar i {
    width: 8px;
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
  }
  .bar i.on {
    background: var(--accent);
  }
  .led {
    width: 26px;
    height: 26px;
  }
</style>
