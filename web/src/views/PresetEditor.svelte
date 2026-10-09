<script lang="ts">
  import Segmented from "../components/Segmented.svelte";
  import ControlsEditor from "../components/presets/ControlsEditor.svelte";
  import { del, get, put } from "../lib/api";
  import { confirm } from "../lib/dialogs.svelte";
  import { autosize } from "../lib/gestures";
  import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ChevronRight, Plus, RotateCcw, Star, Trash } from "../lib/icons";
  import { navigate } from "../lib/router.svelte";
  import { app, errorToast, saveSetting, toast } from "../lib/state.svelte";
  import type { BlockKind, Preset, PromptBlock } from "../lib/types";

  let { id }: { id: string } = $props();

  let preset = $state<Preset | null>(null);
  let saved = $state("");
  let open = $state<Record<string, boolean>>({});
  const dirty = $derived(preset ? JSON.stringify(preset) !== saved : false);

  async function load() {
    try {
      preset = await get<Preset>(`/api/presets/${id}`);
      saved = JSON.stringify(preset);
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void load();
  });

  async function save() {
    if (!preset) return;
    try {
      const { id: _id, ...body } = $state.snapshot(preset);
      preset = await put<Preset>(`/api/presets/${id}`, body);
      saved = JSON.stringify(preset);
      toast("Preset saved ✿", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }

  async function resetDefaults() {
    if (!preset || !(await confirm({ title: "Reset to Mea's defaults?", message: "Blocks, prompts and samplers go back to the defaults. The name stays.", confirmLabel: "Reset" }))) return;
    const d = await get<Preset>("/api/presets-default");
    preset = { ...d, id: preset.id, name: preset.name };
  }

  async function remove() {
    if (!preset || !(await confirm({ title: `Delete “${preset.name}”?`, confirmLabel: "Delete", danger: true }))) return;
    await del(`/api/presets/${id}`);
    navigate("/presets");
  }

  const mainBlock = $derived(preset?.blocks.find((b) => b.id === "main" || b.kind === "text"));

  const KIND_LABEL: Record<BlockKind, string> = {
    text: "Custom text",
    character: "Character card",
    description: "Character description",
    personality: "Character personality",
    scenario: "Scenario",
    persona: "Your persona",
    examples: "Example dialogue",
    lore_before: "Lorebook (before)",
    lore_after: "Lorebook (after)",
    history: "Chat history",
    authors_note: "Author's note",
    post_history: "Post-history instructions",
    memory_story: "Story so far (memory)",
    memory_recall: "Recalled memories & triggered lore",
    controls: "Preset controls",
  };

  function move(i: number, dir: -1 | 1) {
    if (!preset) return;
    const j = i + dir;
    if (j < 0 || j >= preset.blocks.length) return;
    const list = [...preset.blocks];
    [list[i], list[j]] = [list[j]!, list[i]!];
    preset.blocks = list;
  }

  function addText() {
    if (!preset) return;
    const block: PromptBlock = { id: `custom-${Date.now().toString(36)}`, name: "New instruction", kind: "text", enabled: true, role: "system", position: "inline", content: "" };
    const hist = preset.blocks.findIndex((b) => b.kind === "history");
    preset.blocks.splice(hist < 0 ? preset.blocks.length : hist, 0, block);
    open[block.id] = true;
  }

  const num = (v: string) => (v === "" ? undefined : Number(v));
</script>

<svelte:window
  onkeydown={(e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  }}
/>

{#if preset}
  <div class="page">
    <button class="btn ghost small" onclick={() => navigate("/presets")}><ArrowLeft size={15} /> Presets</button>
    <div class="head row wrap">
      <input class="title" bind:value={preset.name} aria-label="Preset name" />
      <Segmented bind:value={preset.mode} options={[{ value: "simple", label: "Simple" }, { value: "advanced", label: "Advanced" }]} small />
    </div>
    <div class="row wrap">
      {#if app.settings?.["chat.defaultPresetId"] === id}<span class="chip rose"><Star size={12} /> Default preset</span>{:else}<button class="btn small" onclick={() => saveSetting("chat.defaultPresetId", id)}><Star size={14} /> Make default</button>{/if}
      <button class="btn small ghost" onclick={resetDefaults}><RotateCcw size={14} /> Reset to defaults</button>
      <button class="btn small ghost danger" onclick={remove}><Trash size={14} /> Delete</button>
    </div>

    {#if preset.importNotes?.length}
      <div class="notice warn small">
        <b>Imported from SillyTavern.</b> Not carried over:
        <ul>{#each preset.importNotes as n (n)}<li>{n}</li>{/each}</ul>
      </div>
    {/if}

    {#if preset.mode === "simple"}
      <section class="panel stack">
        <label class="field">
          <span class="label">Reply length</span>
          <Segmented bind:value={preset.simple.length} options={[{ value: "short", label: "Short" }, { value: "normal", label: "Normal" }, { value: "long", label: "Long" }]} />
        </label>
        {#if mainBlock}
          <label class="field">
            <span class="label">Main instructions</span>
            <textarea class="textarea" use:autosize={500} bind:value={mainBlock.content}></textarea>
            <span class="hint">Use {"{{char}}"}, {"{{user}}"} and {"{{if mode == narrator}}…{{else}}…{{/if}}"}. A character's own system prompt replaces this.</span>
          </label>
        {/if}
        <label class="field">
          <span class="label">Creativity (temperature) <span class="faint">{preset.samplers.temperature ?? 1}</span></span>
          <input type="range" min="0" max="2" step="0.05" bind:value={preset.samplers.temperature} />
        </label>
        <label class="field">
          <span class="label">Maximum reply length (tokens)</span>
          <input class="input" type="number" min="64" max="16000" step="50" bind:value={preset.samplers.max_tokens} />
        </label>
      </section>
    {:else}
      <section class="stack tight">
        <div class="row between"><h2>Prompt blocks</h2><button class="btn small" onclick={addText}><Plus size={14} /> Custom block</button></div>
        <p class="tiny muted">Top to bottom is the order the model reads. “Depth” blocks are slotted into the chat history, counted from the newest message.</p>
        {#each preset.blocks as block, i (block.id)}
          <div class="block card" class:off={!block.enabled}>
            <div class="brow">
              <input type="checkbox" bind:checked={block.enabled} aria-label="Enabled" />
              <button class="expand" onclick={() => (open[block.id] = !open[block.id])}>
                {#if open[block.id]}<ChevronDown size={15} />{:else}<ChevronRight size={15} />{/if}
                <b class="truncate">{block.name}</b>
                <span class="tiny muted hide-sm">{KIND_LABEL[block.kind]}</span>
              </button>
              <span class="chip">{block.position === "depth" ? `depth ${block.depth ?? 4}` : block.role}</span>
              {#if block.when}<span class="chip hide-sm" title="Sent only while this holds">{block.when}</span>{/if}
              <button class="btn ghost icon small" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={14} /></button>
              <button class="btn ghost icon small" onclick={() => move(i, 1)} disabled={i === preset.blocks.length - 1} aria-label="Move down"><ArrowDown size={14} /></button>
              {#if block.kind === "text"}<button class="btn ghost icon small" onclick={() => preset?.blocks.splice(i, 1)} aria-label="Remove block"><Trash size={14} /></button>{/if}
            </div>
            {#if open[block.id]}
              <div class="bbody stack tight">
                <div class="row wrap">
                  {#if block.kind === "text"}<label class="field grow"><span class="label">Name</span><input class="input" bind:value={block.name} /></label>{/if}
                  <label class="field">
                    <span class="label">Role</span>
                    <select class="select" bind:value={block.role}><option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option></select>
                  </label>
                  {#if block.kind !== "history"}
                    <label class="field">
                      <span class="label">Placement</span>
                      <select class="select" bind:value={block.position}><option value="inline">In order</option><option value="depth">In chat at depth</option></select>
                    </label>
                    {#if block.position === "depth"}<label class="field"><span class="label">Depth</span><input class="input" type="number" min="0" style="width:5rem" bind:value={block.depth} /></label>{/if}
                  {/if}
                  {#if block.kind === "text"}
                    <label class="field grow"><span class="label">Only when <span class="faint">a story-state condition, e.g. mode = conflict</span></span><input class="input" value={block.when ?? ""} oninput={(e) => (block.when = e.currentTarget.value.trim() || undefined)} placeholder="always" /></label>
                  {/if}
                </div>
                {#if block.kind === "text" || block.kind === "post_history" || block.kind === "authors_note"}
                  <label class="field">
                    <span class="label">{block.kind === "text" ? "Content" : block.kind === "post_history" ? "Default text (a card's own instructions replace it)" : "Default note (the chat's note replaces it)"}</span>
                    <textarea class="textarea" use:autosize={500} bind:value={block.content}></textarea>
                  </label>
                {:else}
                  <p class="tiny muted">Filled in automatically from the {KIND_LABEL[block.kind].toLowerCase()}.</p>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </section>

      <section class="panel stack">
        <h2>Sampling</h2>
        <div class="grid">
          <label class="field"><span class="label">Temperature</span><input class="input" type="number" step="0.05" min="0" max="5" value={preset.samplers.temperature ?? ""} oninput={(e) => (preset!.samplers.temperature = num(e.currentTarget.value))} /></label>
          <label class="field"><span class="label">Top P</span><input class="input" type="number" step="0.01" min="0" max="1" value={preset.samplers.top_p ?? ""} oninput={(e) => (preset!.samplers.top_p = num(e.currentTarget.value))} /></label>
          <label class="field"><span class="label">Top K</span><input class="input" type="number" min="0" value={preset.samplers.top_k ?? ""} oninput={(e) => (preset!.samplers.top_k = num(e.currentTarget.value))} /></label>
          <label class="field"><span class="label">Min P</span><input class="input" type="number" step="0.01" min="0" max="1" value={preset.samplers.min_p ?? ""} oninput={(e) => (preset!.samplers.min_p = num(e.currentTarget.value))} /></label>
          <label class="field"><span class="label">Frequency penalty</span><input class="input" type="number" step="0.05" min="-2" max="2" value={preset.samplers.frequency_penalty ?? ""} oninput={(e) => (preset!.samplers.frequency_penalty = num(e.currentTarget.value))} /></label>
          <label class="field"><span class="label">Presence penalty</span><input class="input" type="number" step="0.05" min="-2" max="2" value={preset.samplers.presence_penalty ?? ""} oninput={(e) => (preset!.samplers.presence_penalty = num(e.currentTarget.value))} /></label>
          <label class="field"><span class="label">Repetition penalty</span><input class="input" type="number" step="0.01" min="0" max="3" value={preset.samplers.repetition_penalty ?? ""} oninput={(e) => (preset!.samplers.repetition_penalty = num(e.currentTarget.value))} /></label>
          <label class="field"><span class="label">Max reply tokens</span><input class="input" type="number" min="16" value={preset.samplers.max_tokens ?? ""} oninput={(e) => (preset!.samplers.max_tokens = num(e.currentTarget.value))} /></label>
        </div>
        <p class="tiny muted">Blank fields aren't sent. A model profile's settings override these.</p>
      </section>

      <section class="panel stack">
        <h2>Helper prompts</h2>
        <label class="field"><span class="label">Impersonate</span><textarea class="textarea" use:autosize={300} bind:value={preset.impersonationPrompt}></textarea></label>
        <label class="field"><span class="label">Expand my draft <span class="faint">{"{{draft}}"} is the draft</span></span><textarea class="textarea" use:autosize={300} bind:value={preset.expandPrompt}></textarea></label>
        <label class="field"><span class="label">Continue</span><textarea class="textarea" use:autosize={300} bind:value={preset.continuePrompt}></textarea></label>
        <label class="field"><span class="label">Let the world move <span class="faint">sent when you send nothing after a reply</span></span><textarea class="textarea" use:autosize={200} value={preset.waitPrompt ?? ""} oninput={(e) => (preset!.waitPrompt = e.currentTarget.value)}></textarea></label>
        <label class="field"><span class="label">Assistant prefill <span class="faint">optional</span></span><textarea class="textarea" use:autosize={200} bind:value={preset.prefill}></textarea></label>
      </section>
    {/if}

    <ControlsEditor bind:controls={preset.controls} />

    {#if dirty}
      <div class="savebar card"><span class="small">Unsaved changes</span><button class="btn ghost small" onclick={load}>Discard</button><button class="btn primary small" onclick={save}>Save</button></div>
    {/if}
  </div>
{/if}

<style>
  .page {
    max-width: 50rem;
    margin: 0 auto;
    padding: 1.2rem clamp(1rem, 3vw, 2rem) 6rem;
    display: grid;
    gap: 1rem;
  }
  .head {
    gap: 1rem;
  }
  .title {
    flex: 1;
    min-width: 12rem;
    border: 0;
    background: none;
    color: var(--text);
    font: 600 1.8rem/1.2 var(--font-display);
    font-variation-settings: "SOFT" 100;
    outline: none;
    border-bottom: 2px solid transparent;
  }
  .title:focus {
    border-bottom-color: var(--accent);
  }
  .notice ul {
    margin: 0.3rem 0 0;
    padding-left: 1.2rem;
  }
  .block.off {
    opacity: 0.6;
  }
  .brow {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem 0.5rem 0.4rem 0.8rem;
  }
  .brow input[type="checkbox"] {
    accent-color: var(--accent-strong);
    width: 1rem;
    height: 1rem;
  }
  .expand {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    border: 0;
    background: none;
    color: var(--text);
    cursor: pointer;
    padding: 0.35rem;
    font: inherit;
    text-align: left;
  }
  .bbody {
    padding: 0.4rem 1rem 0.9rem;
    border-top: 1px solid var(--border);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.8rem;
  }
  .savebar {
    position: fixed;
    bottom: calc(1rem + var(--safe-bottom));
    left: 50%;
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.6rem 0.5rem 1rem;
    border-radius: var(--r-pill);
    box-shadow: var(--shadow-2);
    z-index: 30;
  }
  @media (min-width: 761px) {
    .savebar {
      left: calc(50% + var(--sidebar-w) / 2);
    }
  }
  @media (max-width: 760px) {
    .hide-sm {
      display: none;
    }
  }
</style>
