<script lang="ts">
  import { get } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { ChevronDown, ChevronRight, Import, Plus, Trash } from "../../lib/icons";
  import { applyScript, compileFind, importStRegex } from "../../lib/regex.svelte";
  import { app, errorToast, saveSetting, toast } from "../../lib/state.svelte";
  import type { CharacterSummary, RegexScript } from "../../lib/types";

  /**
   * Regex scripts (PROMPT-08): find and replace on messages, for display only, for what the model
   * is sent, or on the stored text. Each script has a live tester; SillyTavern exports import.
   */
  // svelte-ignore state_referenced_locally
  let scripts = $state<RegexScript[]>(structuredClone($state.snapshot(app.settings?.["regex.scripts"] ?? [])));
  let open = $state<Record<string, boolean>>({});
  let sample = $state<Record<string, string>>({});
  let characters = $state<CharacterSummary[]>([]);
  let fileInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    get<{ characters: CharacterSummary[] }>("/api/characters?sort=name").then((r) => (characters = r.characters), () => {});
  });

  let timer: ReturnType<typeof setTimeout>;
  function save(delay = 600) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await saveSetting("regex.scripts", $state.snapshot(scripts));
      } catch (e) {
        errorToast(e);
      }
    }, delay);
  }

  function add() {
    const id = `rx-${Date.now().toString(36)}`;
    scripts = [...scripts, { id, name: "New script", find: "", replace: "", targets: ["ai"], mode: "display", enabled: true, characterIds: [] }];
    open[id] = true;
    save(0);
  }

  async function remove(s: RegexScript) {
    if (!(await confirm({ title: `Delete “${s.name}”?`, confirmLabel: "Delete", danger: true }))) return;
    scripts = scripts.filter((x) => x.id !== s.id);
    save(0);
  }

  async function importFile(f: File) {
    try {
      const list = importStRegex(JSON.parse(await f.text()));
      if (!list.length) throw new Error("No regex scripts in that file");
      scripts = [...scripts, ...list];
      save(0);
      toast(`Imported ${list.length} script${list.length === 1 ? "" : "s"}`, { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }

  const MODE: Record<RegexScript["mode"], string> = { display: "Display only", prompt: "Prompt only", persistent: "Stored text" };
  const HELP: Record<RegexScript["mode"], string> = {
    display: "Changes how messages look. The stored text and the prompt are untouched.",
    prompt: "Changes what the model is sent. What you see and what's stored are untouched.",
    persistent: "Changes the message itself when a reply finishes or you send one.",
  };
  const toggleTarget = (s: RegexScript, t: "ai" | "user") => {
    s.targets = s.targets.includes(t) ? s.targets.filter((x) => x !== t) : [...s.targets, t];
    save();
  };
</script>

<div class="stack">
  <div class="row between wrap">
    <div>
      <h2>Regex scripts</h2>
      <p class="small muted">Find and replace on messages: tidy formatting, hide out-of-character notes from the model, or fix a model's habits. <code>/pattern/flags</code> or a plain pattern; <code>{"{{match}}"}</code> or <code>$1</code> in the replacement.</p>
    </div>
    <div class="row">
      <button class="btn" onclick={() => fileInput?.click()}><Import size={15} /> Import</button>
      <button class="btn primary" onclick={add}><Plus size={15} /> Script</button>
      <input bind:this={fileInput} type="file" accept=".json,application/json" hidden onchange={(e) => e.currentTarget.files?.[0] && importFile(e.currentTarget.files[0])} />
    </div>
  </div>

  {#each scripts as s (s.id)}
    {@const valid = !s.find || compileFind(s.find) !== null}
    <div class="script card" class:off={!s.enabled}>
      <div class="head">
        <input type="checkbox" bind:checked={s.enabled} onchange={() => save(0)} aria-label="Enabled" />
        <button class="expand" onclick={() => (open[s.id] = !open[s.id])} aria-expanded={Boolean(open[s.id])}>
          {#if open[s.id]}<ChevronDown size={15} />{:else}<ChevronRight size={15} />{/if}
          <b class="truncate">{s.name}</b>
          <span class="chip tiny">{MODE[s.mode]}</span>
          {#if !valid}<span class="chip tiny rose">invalid pattern</span>{/if}
        </button>
        <button class="btn ghost icon small" onclick={() => remove(s)} aria-label="Delete script"><Trash size={14} /></button>
      </div>
      {#if open[s.id]}
        <div class="body stack tight">
          <label class="field"><span class="label">Name</span><input class="input" bind:value={s.name} oninput={() => save()} /></label>
          <div class="row wrap">
            <label class="field grow"><span class="label">Find</span><input class="input mono" bind:value={s.find} oninput={() => save()} placeholder={"/\\(OOC:[^)]*\\)/g"} /></label>
            <label class="field grow"><span class="label">Replace with</span><input class="input mono" bind:value={s.replace} oninput={() => save()} placeholder="(empty removes the match)" /></label>
          </div>
          <div class="row wrap">
            <label class="field">
              <span class="label">Applies to</span>
              <select class="select" bind:value={s.mode} onchange={() => save(0)}>
                <option value="display">Display only</option>
                <option value="prompt">Prompt only</option>
                <option value="persistent">Stored text</option>
              </select>
            </label>
            <div class="field">
              <span class="label">Messages</span>
              <div class="row">
                <label class="switch"><input type="checkbox" checked={s.targets.includes("ai")} onchange={() => toggleTarget(s, "ai")} /> Replies</label>
                <label class="switch"><input type="checkbox" checked={s.targets.includes("user")} onchange={() => toggleTarget(s, "user")} /> Mine</label>
              </div>
            </div>
            <label class="field grow">
              <span class="label">Only with</span>
              <select class="select" onchange={(e) => { const v = e.currentTarget.value; if (v) { s.characterIds = [...s.characterIds, v]; save(0); } e.currentTarget.value = ""; }}>
                <option value="">{s.characterIds.length ? "Add a character…" : "Every character"}</option>
                {#each characters.filter((c) => !s.characterIds.includes(c.id)) as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
              </select>
            </label>
          </div>
          {#if s.characterIds.length}
            <div class="row wrap">{#each s.characterIds as cid (cid)}<button class="chip tiny" onclick={() => ((s.characterIds = s.characterIds.filter((x) => x !== cid)), save(0))}>{characters.find((c) => c.id === cid)?.name ?? "?"} ×</button>{/each}</div>
          {/if}
          <span class="tiny muted">{HELP[s.mode]}</span>
          <div class="tester">
            <label class="field"><span class="label">Try it</span><textarea class="textarea" rows="2" bind:value={sample[s.id]} placeholder="Paste a message to test against"></textarea></label>
            {#if sample[s.id]}
              <div class="result small"><span class="label">Result</span><p>{valid ? applyScript(sample[s.id] ?? "", s) : "The pattern isn't valid."}</p></div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <p class="small muted">No scripts yet.</p>
  {/each}
</div>

<style>
  code {
    font-family: var(--font-mono);
    font-size: 0.9em;
  }
  .script.off {
    opacity: 0.6;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem;
  }
  .expand {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border: 0;
    background: none;
    font: inherit;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    padding: 0.4rem 0;
  }
  .body {
    padding: 0.4rem 1rem 1rem;
    border-top: 1px solid var(--border);
  }
  .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .result p {
    margin: 0.2rem 0 0;
    white-space: pre-wrap;
    padding: 0.4rem 0.6rem;
    border-radius: var(--r-sm, 8px);
    background: color-mix(in srgb, var(--mint) 22%, transparent);
    overflow-wrap: anywhere;
  }
</style>
