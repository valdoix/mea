<script lang="ts">
  import { get } from "../../lib/api";
  import { confirm, promptText } from "../../lib/dialogs.svelte";
  import { autosize } from "../../lib/gestures";
  import { Copy, Plus, Trash } from "../../lib/icons";
  import { app, errorToast, saveSetting } from "../../lib/state.svelte";
  import type { PromptSet } from "../../lib/types";

  /**
   * Helper prompt sets (PROMPT-09): add to, or replace, any helper prompt (summaries, trackers, the
   * checker, the studios…), grouped into sets you switch between. Mea's defaults are never edited,
   * so your sets survive updates, and the reply format is always kept.
   */
  type Service = { id: string; group: string; label: string; help: string; sample: { text: string; at: number } | null };
  let services = $state<Service[]>([]);
  let globalId = $state("global");
  // svelte-ignore state_referenced_locally
  let sets = $state<PromptSet[]>(structuredClone($state.snapshot(app.settings?.["prompts.sets"] ?? [])));
  // svelte-ignore state_referenced_locally
  let active = $state<string | null>(app.settings?.["prompts.active"] ?? null);
  // svelte-ignore state_referenced_locally
  let editing = $state<string | null>(app.settings?.["prompts.active"] ?? sets[0]?.id ?? null);
  const set = $derived(sets.find((s) => s.id === editing) ?? null);
  const groups = $derived([...new Set(services.map((s) => s.group))]);

  $effect(() => {
    get<{ prompts: Service[]; globalId: string }>("/api/prompts/service").then((r) => ((services = r.prompts), (globalId = r.globalId)), errorToast);
  });

  let timer: ReturnType<typeof setTimeout>;
  function save(delay = 600) {
    clearTimeout(timer);
    timer = setTimeout(() => saveSetting("prompts.sets", $state.snapshot(sets)).catch(errorToast), delay);
  }
  async function activate(id: string | null) {
    active = id;
    try {
      await saveSetting("prompts.active", id);
    } catch (e) {
      errorToast(e);
    }
  }

  async function newSet(from?: PromptSet) {
    const name = await promptText({ title: from ? "Copy this set" : "New prompt set", label: "Name", value: from ? `${from.name} (copy)` : "My prompts", confirmLabel: "Create" });
    if (!name?.trim()) return;
    const s: PromptSet = { id: `ps-${Date.now().toString(36)}`, name: name.trim(), overrides: from ? structuredClone($state.snapshot(from.overrides)) : {} };
    sets = [...sets, s];
    editing = s.id;
    save(0);
  }

  async function removeSet(s: PromptSet) {
    if (!(await confirm({ title: `Delete “${s.name}”?`, message: "Your text in it is gone for good. Mea's defaults are untouched.", confirmLabel: "Delete", danger: true }))) return;
    sets = sets.filter((x) => x.id !== s.id);
    if (active === s.id) await activate(null);
    editing = sets[0]?.id ?? null;
    save(0);
  }

  function setOverride(id: string, mode: "off" | "append" | "replace", text?: string) {
    if (!set) return;
    const cur = set.overrides[id];
    if (mode === "off") {
      const next = { ...set.overrides };
      delete next[id];
      set.overrides = next;
    } else set.overrides = { ...set.overrides, [id]: { mode, text: text ?? cur?.text ?? (mode === "replace" ? "{{default}}" : "") } };
    save();
  }
</script>

<div class="stack">
  <div>
    <h2>Helper prompts</h2>
    <p class="small muted">Every prompt Mea's helpers use (summaries, trackers, the continuity checker, the Archivist, the studios) can be added to or replaced. Changes live in sets you switch between; Mea's own defaults are never edited, so your sets survive updates. The reply format each helper needs is always kept.</p>
  </div>

  <section class="panel stack tight">
    <label class="field">
      <span class="label">In use</span>
      <select class="select" value={active ?? ""} onchange={(e) => activate(e.currentTarget.value || null)}>
        <option value="">Mea's defaults</option>
        {#each sets as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
      </select>
    </label>
  </section>

  <div class="row wrap">
    {#each sets as s (s.id)}<button class="chip" class:sel={editing === s.id} onclick={() => (editing = s.id)}>{s.name}</button>{/each}
    <button class="btn small" onclick={() => newSet()}><Plus size={14} /> New set</button>
  </div>

  {#if set}
    <section class="panel stack">
      <div class="row between wrap">
        <input class="input setname" bind:value={set.name} oninput={() => save()} aria-label="Set name" />
        <div class="row">
          <button class="btn ghost small" onclick={() => newSet(set!)}><Copy size={13} /> Copy</button>
          <button class="btn ghost small danger" onclick={() => removeSet(set!)}><Trash size={13} /> Delete</button>
        </div>
      </div>
      <label class="field">
        <span class="label">For every helper <span class="faint">added to all of them</span></span>
        <textarea class="textarea" use:autosize={{ max: 200, value: set.overrides[globalId]?.text ?? "" }} value={set.overrides[globalId]?.text ?? ""} oninput={(e) => setOverride(globalId, e.currentTarget.value.trim() ? "append" : "off", e.currentTarget.value)} placeholder="British spelling. Never invent names that aren't in the story."></textarea>
      </label>
      {#each groups as g (g)}
        <h3>{g}</h3>
        {#each services.filter((s) => s.group === g) as sp (sp.id)}
          {@const o = set.overrides[sp.id]}
          <div class="prompt">
            <div class="row between wrap">
              <div class="grow"><b class="small">{sp.label}</b>{" "}<span class="tiny muted">· {sp.help}</span></div>
              <select class="select mini" value={o?.mode ?? "off"} onchange={(e) => setOverride(sp.id, e.currentTarget.value as "off" | "append" | "replace")} aria-label="How to change {sp.label}">
                <option value="off">Mea's default</option>
                <option value="append">Add to it</option>
                <option value="replace">Replace it</option>
              </select>
            </div>
            {#if o}
              <textarea class="textarea mono" use:autosize={{ max: 400, value: o.text }} value={o.text} oninput={(e) => setOverride(sp.id, o.mode, e.currentTarget.value)} placeholder={o.mode === "append" ? "Extra instructions, added after Mea's" : "Your prompt. {{default}} puts Mea's in."}></textarea>
              {#if o.mode === "replace"}<span class="tiny muted"><code>{"{{default}}"}</code> inserts Mea's prompt; the reply format is added for you.</span>{/if}
            {/if}
            {#if sp.sample}
              <details>
                <summary class="tiny muted">As last sent</summary>
                <pre class="sample tiny">{sp.sample.text}</pre>
              </details>
            {/if}
          </div>
        {/each}
      {/each}
    </section>
  {:else}
    <p class="small muted">No sets yet. Make one to start changing prompts.</p>
  {/if}
</div>

<style>
  h3 {
    margin: 0.6rem 0 0;
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .sel {
    background: color-mix(in srgb, var(--accent) 35%, var(--surface));
    font-weight: 700;
  }
  .chip {
    cursor: pointer;
    border: 1px solid var(--border);
    font: inherit;
    font-size: var(--fs-sm);
  }
  .setname {
    font-weight: 700;
    max-width: 20rem;
  }
  .prompt {
    display: grid;
    gap: 0.35rem;
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
  }
  .grow {
    flex: 1 1 14rem;
    min-width: 0;
  }
  .mini {
    width: auto;
    padding-top: 0.25rem;
    padding-bottom: 0.25rem;
    font-size: var(--fs-xs);
  }
  .sample {
    white-space: pre-wrap;
    max-height: 16rem;
    overflow: auto;
    background: var(--bg);
    padding: 0.5rem;
    border-radius: var(--r-sm, 8px);
    margin: 0.3rem 0 0;
  }
  code {
    font-family: var(--font-mono);
  }
</style>
