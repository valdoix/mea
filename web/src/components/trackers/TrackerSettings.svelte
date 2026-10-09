<script lang="ts">
  import Modal from "../Modal.svelte";
  import Segmented from "../Segmented.svelte";
  import { get, patch, post, put } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { errorToast, toast } from "../../lib/state.svelte";
  import { refreshTrackers, trk } from "../../lib/trackers.svelte";
  import type { ChatDetail, TrackerConfig, TrackerSection, TrackerTemplate } from "../../lib/types";

  let { open = $bindable(false), chatId }: { open?: boolean; chatId: string } = $props();

  let cfg = $state<TrackerConfig | null>(null);
  let templates = $state<TrackerTemplate[]>([]);
  let characterId = $state<string | null>(null);
  let note = $state<{ text: string; tokens: number } | null>(null);

  $effect(() => {
    if (!open) return;
    cfg = trk.data ? structuredClone($state.snapshot(trk.data.config)) : null;
    void Promise.all([get<{ templates: TrackerTemplate[] }>("/api/tracker-templates"), get<ChatDetail>(`/api/chats/${chatId}`), get<{ note: { text: string; tokens: number } | null }>(`/api/chats/${chatId}/trackers/note`)])
      .then(([t, d, n]) => {
        templates = t.templates;
        characterId = d.chat.characterId;
        note = n.note;
      })
      .catch(errorToast);
  });

  const SECTIONS: [TrackerSection, string, string][] = [
    ["scene", "Scene", "time, place, weather"],
    ["cast", "People", "who's here and how they are"],
    ["body", "Bodies", "needs, wounds, illnesses"],
    ["bonds", "Bonds", "trust, affection and the rest"],
    ["romance", "Romance ladder", "rungs from strangers to established"],
    ["knowledge", "Knowledge", "who knows what; secrets"],
    ["items", "Things", "who has what"],
    ["threads", "Threads", "plot threads, Chekhov's guns"],
    ["stakes", "Stakes", "promises, debts, deadlines, gauges"],
    ["calendar", "Calendar", "plans, birthdays, anniversaries"],
    ["motifs", "Running bits", "jokes, pet names, milestones"],
    ["persona", "Your character", "outfit, injuries, what you carry"],
    ["custom", "Custom trackers", "your own templates"],
  ];

  let timer: ReturnType<typeof setTimeout>;
  function save() {
    if (!cfg) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const snap = $state.snapshot(cfg);
        if (!snap) return;
        // What the preset decides isn't saved as the chat's own setting.
        const { dialed: _dialed, ...own } = snap;
        await patch(`/api/chats/${chatId}`, { settings: { trackers: own } });
        refreshTrackers(chatId);
      } catch (e) {
        errorToast(e);
      }
    }, 300);
  }
  function toggleTemplate(id: string, on: boolean) {
    if (!cfg) return;
    cfg.templates = on ? [...cfg.templates, id] : cfg.templates.filter((x) => x !== id);
    save();
  }
  async function asCharacterDefault() {
    if (!cfg || !characterId) return;
    try {
      await put(`/api/characters/${characterId}/trackers`, { templates: cfg.templates, sections: cfg.sections, romance: cfg.romance, mode: cfg.mode, sealed: cfg.sealed, calendar: cfg.calendar, season: cfg.season });
      toast("New chats with this character start with these trackers", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }
  async function startOver() {
    if (!(await confirm({ title: "Start the trackers over?", message: "Everything the trackers recorded in this chat is cleared, then rebuilt from the card and the latest reply. Your edits go too.", confirmLabel: "Start over", danger: true }))) return;
    try {
      await post(`/api/chats/${chatId}/trackers/init`, { fresh: true });
      refreshTrackers(chatId);
      toast("Rebuilding the story state…");
    } catch (e) {
      errorToast(e);
    }
  }
</script>

<Modal bind:open title="Trackers for this chat" size="md">
  {#if cfg}
    <div class="stack">
      <div class="field">
        <span class="label">Who writes the trackers</span>
        <Segmented
          bind:value={cfg.mode}
          small
          options={[
            { value: "helper", label: "A helper model" },
            { value: "inline", label: "The story model" },
            { value: "off", label: "Off" },
          ]}
          onchange={save}
        />
        <span class="hint">
          {cfg.mode === "helper" ? "After each reply, a helper model reads it and writes what changed. Most accurate; one extra request per reply." : cfg.mode === "inline" ? "The story model adds a hidden ledger to each reply: no extra request, slightly longer replies. A reply without one gets a helper pass." : "No trackers in this chat."}
        </span>
      </div>
      {#if cfg.mode !== "off"}
        <div class="grid">
          <label class="field">
            <span class="label">How often</span>
            <select class="select" bind:value={cfg.cadence} onchange={save}>
              <option value="every">Every reply</option>
              <option value="everyN">Every few replies</option>
              <option value="scene">When the scene changes</option>
              <option value="manual">Only when I ask</option>
            </select>
          </label>
          {#if cfg.cadence === "everyN"}<label class="field"><span class="label">Every</span><input class="input" type="number" min="2" max="20" bind:value={cfg.everyN} onchange={save} /></label>{/if}
          <label class="field">
            <span class="label">Romance pace</span>
            <select class="select" bind:value={cfg.romance} onchange={save} disabled={cfg.dialed?.includes("romance")} title={cfg.dialed?.includes("romance") ? "Set by the preset's Romance pace control" : undefined}>
              <option value="off">Off</option>
              <option value="slow">Slow burn</option>
              <option value="measured">Measured</option>
              <option value="fast">Fast</option>
              <option value="established">Already together</option>
            </select>
          </label>
          <label class="field">
            <span class="label">Calendar</span>
            <select class="select" bind:value={cfg.calendar} onchange={save}>
              <option value="gregorian">Gregorian</option>
              <option value="westeros">Westeros (AC, moons)</option>
            </select>
          </label>
          {#if cfg.calendar === "westeros"}
            <label class="field"><span class="label">Season</span><input class="input" bind:value={cfg.season} maxlength="80" placeholder="a long summer, its ninth year" onchange={save} /><span class="hint">Westeros seasons last for years, so say which one it is</span></label>
          {/if}
          <label class="field"><span class="label">Prompt budget</span><input class="input" type="number" min="100" max="4000" step="50" bind:value={cfg.budget} onchange={save} /><span class="hint">tokens{note ? ` · now ${note.tokens}` : ""}</span></label>
        </div>
        <label class="switch"><input type="checkbox" bind:checked={cfg.sealed} onchange={save} disabled={cfg.dialed?.includes("sealed")} /> Keep my character's inner life mine (the model never writes your mood or thoughts)</label>
        {#if cfg.dialed?.length}<p class="tiny muted">{cfg.dialed.includes("sealed") && cfg.dialed.includes("romance") ? "Your character's inner life and the romance pace are" : cfg.dialed.includes("sealed") ? "Your character's inner life is" : "The romance pace is"} set by this chat's preset (its Persona and Romance pace controls in the chat panel).</p>{/if}
        <label class="switch"><input type="checkbox" bind:checked={cfg.limits} onchange={save} /> Slow changes: cap how far a bond or meter moves in one reply</label>
        <label class="switch"><input type="checkbox" bind:checked={cfg.nudges} onchange={save} /> Offer quiet threads and planted details back to the model as optional hooks</label>
        <label class="switch"><input type="checkbox" bind:checked={cfg.gate} onchange={save} /> Skip the update when nothing changed (a tiny check first; saves quota, can miss small things)</label>
        <label class="switch"><input type="checkbox" checked={cfg.strictness === "strict"} onchange={(e) => ((cfg!.strictness = e.currentTarget.checked ? "strict" : "lenient"), save())} /> Strict: refuse relationship, knowledge and item changes without a reason</label>

        <div class="field">
          <span class="label">What to track</span>
          <div class="checks">
            {#each SECTIONS as [k, label, hint] (k)}
              <label class="switch small" title={hint}><input type="checkbox" bind:checked={cfg.sections[k]} onchange={save} /> {label}</label>
            {/each}
          </div>
        </div>
        {#if cfg.sections.custom}
          <div class="field">
            <span class="label">Custom trackers <a class="tiny" href="/settings/trackers">Manage templates</a></span>
            {#each templates as t (t.id)}
              <label class="switch small"><input type="checkbox" checked={cfg.templates.includes(t.id)} onchange={(e) => toggleTemplate(t.id, e.currentTarget.checked)} /> <b>{t.name}</b> <span class="tiny muted">{t.description}</span></label>
            {/each}
          </div>
        {/if}
        {#if note}
          <details>
            <summary class="tiny">What the trackers add to the prompt ({note.tokens} tokens)</summary>
            <pre>{note.text}</pre>
          </details>
        {/if}
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    <button class="btn ghost small" onclick={startOver}>Start over from the card</button>
    {#if characterId}<button class="btn small" onclick={asCharacterDefault}>Use for this character's new chats</button>{/if}
    <button class="btn primary small" onclick={() => (open = false)}>Done</button>
  {/snippet}
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.7rem;
  }
  .checks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.3rem 0.8rem;
  }
  pre {
    white-space: pre-wrap;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    background: var(--surface-2);
    padding: 0.6rem;
    border-radius: var(--r-sm);
    max-height: 20rem;
    overflow: auto;
  }
</style>
