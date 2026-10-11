<script lang="ts">
  import { calendars, loadCalendars } from "../../lib/customcal.svelte";
  import Modal from "../Modal.svelte";
  import Segmented from "../Segmented.svelte";
  import { api, del, download, get, post, put } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { ArrowDown, ArrowUp, Copy, Download, Import, Plus, Trash } from "../../lib/icons";
  import { app, errorToast, saveSetting, toast } from "../../lib/state.svelte";
  import type { TemplateField, TrackerConfig, TrackerTemplate } from "../../lib/types";

  let templates = $state<TrackerTemplate[]>([]);
  let editOpen = $state(false);
  let editId = $state<string | null>(null);
  let form = $state<{ key: string; name: string; description: string; fields: TemplateField[] }>({ key: "", name: "", description: "", fields: [] });
  let fileInput = $state<HTMLInputElement | null>(null);

  async function load() {
    try {
      templates = (await get<{ templates: TrackerTemplate[] }>("/api/tracker-templates")).templates;
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void load();
  });

  const defaults = $derived((app.settings?.["trackers.defaults"] ?? {}) as Partial<TrackerConfig>);
  function setDefault<K extends keyof TrackerConfig>(k: K, v: TrackerConfig[K]) {
    void saveSetting("trackers.defaults", { ...defaults, [k]: v }).catch(errorToast);
  }

  const TYPES: TemplateField["type"][] = ["text", "longtext", "number", "meter", "enum", "tags", "boolean", "datetime", "duration", "entity", "table"];
  const TYPE_LABEL: Record<string, string> = { text: "Text", longtext: "Long text", number: "Number", meter: "Meter 0–100", enum: "Choice", tags: "List", boolean: "Yes/no", datetime: "Date & time", duration: "Duration", entity: "Person", table: "Table (rows)", object: "Group" };

  function newTemplate() {
    editId = null;
    form = { key: "", name: "", description: "", fields: [{ key: "status", label: "Status", type: "text" }] };
    editOpen = true;
  }
  function edit(t: TrackerTemplate) {
    editId = t.id;
    form = { key: t.key, name: t.name, description: t.description, fields: structuredClone($state.snapshot(t.schema.fields)) };
    editOpen = true;
  }
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f$1").slice(0, 30) || "field";
  function addField(list: TemplateField[]) {
    let i = list.length + 1;
    while (list.some((f) => f.key === `field_${i}`)) i++;
    list.push({ key: `field_${i}`, label: `Field ${i}`, type: "text" });
  }
  function move(list: TemplateField[], i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  function setType(f: TemplateField, type: TemplateField["type"]) {
    f.type = type;
    if (type === "enum" && !f.options?.length) f.options = ["one", "two"];
    if (type === "table" && !f.fields?.length) {
      f.fields = [{ key: "name", label: "Name", type: "text" }, { key: "notes", label: "Notes", type: "text" }];
      f.keyField = "name";
    }
    if (type === "meter") f.maxDelta ??= 15;
  }
  async function saveTemplate() {
    const body = { key: form.key || slug(form.name), name: form.name, description: form.description, schema: { fields: $state.snapshot(form.fields) } };
    try {
      if (editId) await put(`/api/tracker-templates/${editId}`, body);
      else await post("/api/tracker-templates", body);
      editOpen = false;
      toast("Saved", { kind: "ok" });
      await load();
    } catch (e) {
      errorToast(e);
    }
  }
  async function duplicate(t: TrackerTemplate) {
    try {
      const copy = await post<TrackerTemplate>(`/api/tracker-templates/${t.id}/duplicate`);
      await load();
      edit(copy);
    } catch (e) {
      errorToast(e);
    }
  }
  async function remove(t: TrackerTemplate) {
    if (!(await confirm({ title: `Delete “${t.name}”?`, message: "Chats that use it stop tracking these fields. What they recorded stays in their history.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await del(`/api/tracker-templates/${t.id}`);
      await load();
    } catch (e) {
      errorToast(e);
    }
  }
  async function importFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      const t = await api<TrackerTemplate>("POST", "/api/tracker-templates/import", json);
      toast(`Imported “${t.name}”`, { kind: "ok" });
      await load();
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void loadCalendars();
  });
</script>

<div class="stack">
  <section class="panel stack">
    <h2>Defaults for every chat</h2>
    <p class="tiny muted">Each chat and each character can change these. Maximum accuracy is the default: a helper model reads every reply.</p>
    <div class="field">
      <span class="label">Who writes the trackers</span>
      <Segmented
        value={defaults.mode ?? "helper"}
        small
        options={[
          { value: "helper", label: "A helper model" },
          { value: "inline", label: "The story model" },
          { value: "off", label: "Off" },
        ]}
        onchange={(v) => setDefault("mode", v)}
      />
    </div>
    <div class="grid">
      <label class="field">
        <span class="label">How often</span>
        <select class="select" value={defaults.cadence ?? "every"} onchange={(e) => setDefault("cadence", e.currentTarget.value as TrackerConfig["cadence"])}>
          <option value="every">Every reply</option><option value="everyN">Every few replies</option><option value="scene">When the scene changes</option><option value="manual">Only when I ask</option>
        </select>
      </label>
      <label class="field">
        <span class="label">Romance pace</span>
        <select class="select" value={defaults.romance ?? "slow"} onchange={(e) => setDefault("romance", e.currentTarget.value as TrackerConfig["romance"])}>
          <option value="off">Off</option><option value="slow">Slow burn</option><option value="measured">Measured</option><option value="fast">Fast</option><option value="established">Already together</option>
        </select>
      </label>
      <label class="field">
        <span class="label">Calendar</span>
        <select class="select" value={defaults.calendar ?? "gregorian"} onchange={(e) => setDefault("calendar", e.currentTarget.value as TrackerConfig["calendar"])}>
          <option value="gregorian">Gregorian</option><option value="westeros">Westeros (AC, moons)</option>
          {#each calendars.list as c (c.id)}<option value={`custom:${c.id}`}>{c.name}</option>{/each}
        </select>
        <span class="hint">how story dates read; a chat or character can change it</span>
      </label>
      <label class="field"><span class="label">Prompt budget</span><input class="input" type="number" min="100" max="4000" step="50" value={defaults.budget ?? 700} onchange={(e) => setDefault("budget", Number(e.currentTarget.value))} /><span class="hint">tokens for the story-state note</span></label>
      <label class="field"><span class="label">Quiet after</span><input class="input" type="number" min="5" max="500" value={defaults.quietAfter ?? 40} onchange={(e) => setDefault("quietAfter", Number(e.currentTarget.value))} /><span class="hint">messages before a thread is offered back as a hook</span></label>
    </div>
    <label class="switch"><input type="checkbox" checked={defaults.sealed ?? true} onchange={(e) => setDefault("sealed", e.currentTarget.checked)} /> Keep my character's inner life mine</label>
    <label class="switch"><input type="checkbox" checked={defaults.limits ?? true} onchange={(e) => setDefault("limits", e.currentTarget.checked)} /> Slow changes: cap how far a bond or meter moves in one reply</label>
    <label class="switch"><input type="checkbox" checked={defaults.gate ?? false} onchange={(e) => setDefault("gate", e.currentTarget.checked)} /> Skip updates when nothing changed (saves quota)</label>
    <p class="tiny muted">A preset with Persona or Romance pace controls (like Mea's own) sets those two for its chats.</p>
  </section>

  <section class="stack tight">
    <div class="row between wrap">
      <h2>Custom trackers</h2>
      <div class="row">
        <button class="btn small" onclick={() => fileInput?.click()}><Import size={14} /> Import</button>
        <button class="btn small" onclick={newTemplate}><Plus size={14} /> New template</button>
        <input type="file" accept=".json,application/json" hidden bind:this={fileInput} onchange={(e) => importFile(e.currentTarget.files)} />
      </div>
    </div>
    <p class="tiny muted">The built-in world model already tracks scenes, people, bonds, knowledge, things, threads and stakes. Templates add whatever else a story needs; switch them on per chat in its Story tab.</p>
    {#each templates as t (t.id)}
      <div class="card tpl">
        <div class="grow">
          <div class="row"><b>{t.name}</b><span class="tiny faint mono">{t.key}</span>{#if t.builtin}<span class="chip tiny">starter</span>{/if}</div>
          <div class="tiny muted">{t.description}</div>
          <div class="tiny faint">{t.schema.fields.map((f) => f.label).join(" · ")}</div>
        </div>
        <div class="row">
          {#if !t.builtin}<button class="btn ghost small" onclick={() => edit(t)}>Edit</button>{/if}
          <button class="btn ghost icon small" onclick={() => duplicate(t)} aria-label="Duplicate" title="Duplicate"><Copy size={14} /></button>
          <button class="btn ghost icon small" onclick={() => download(`/api/tracker-templates/${t.id}/export`)} aria-label="Export" title="Share as JSON"><Download size={14} /></button>
          {#if !t.builtin}<button class="btn ghost icon small" onclick={() => remove(t)} aria-label="Delete"><Trash size={14} /></button>{/if}
        </div>
      </div>
    {/each}
  </section>
</div>

{#snippet fieldRows(list: TemplateField[], depth: number)}
  {#each list as f, i (i)}
    <div class="frow" style:margin-left="{depth * 1.2}rem">
      <input class="input mini" bind:value={f.label} oninput={() => !editId && (f.key = slug(f.label))} placeholder="Label" aria-label="Field label" />
      <select class="select mini" value={f.type} onchange={(e) => setType(f, e.currentTarget.value as TemplateField["type"])} aria-label="Field type">
        {#each depth ? TYPES.filter((x) => x !== "table") : TYPES as t (t)}<option value={t}>{TYPE_LABEL[t]}</option>{/each}
      </select>
      <select class="select mini" bind:value={f.visibility} aria-label="Who sees it">
        <option value={undefined}>Model and me</option><option value="ui">Only me</option><option value="hidden">Hidden</option>
      </select>
      <span class="row">
        <button class="btn ghost icon small" onclick={() => move(list, i, -1)} aria-label="Up"><ArrowUp size={13} /></button>
        <button class="btn ghost icon small" onclick={() => move(list, i, 1)} aria-label="Down"><ArrowDown size={13} /></button>
        <button class="btn ghost icon small" onclick={() => list.splice(i, 1)} aria-label="Remove"><Trash size={13} /></button>
      </span>
    </div>
    <div class="fopts" style:margin-left="{depth * 1.2 + 0.4}rem">
      <span class="tiny faint mono">{f.key}</span>
      {#if f.type === "enum"}<input class="input mini wide" value={(f.options ?? []).join(", ")} onchange={(e) => (f.options = e.currentTarget.value.split(/\s*,\s*/).filter(Boolean))} placeholder="Options, comma-separated" />{/if}
      {#if f.type === "number" || f.type === "meter"}
        <label class="tiny">min <input class="input mini num" type="number" bind:value={f.min} /></label>
        <label class="tiny">max <input class="input mini num" type="number" bind:value={f.max} /></label>
        <label class="tiny" title="Largest move per reply (slow changes)">step cap <input class="input mini num" type="number" bind:value={f.maxDelta} /></label>
      {/if}
      <label class="tiny"><input type="checkbox" bind:checked={f.hud} /> HUD</label>
      <label class="tiny"><input type="checkbox" bind:checked={f.spoiler} /> spoiler</label>
      <label class="tiny"><input type="checkbox" bind:checked={f.memory} /> changes are memories</label>
      <input class="input mini wide" bind:value={f.hint} placeholder="Hint for the model (optional)" />
    </div>
    {#if f.type === "table" && f.fields}
      <div class="tiny muted" style:margin-left="{depth * 1.2 + 1.2}rem">Columns (the first names each row)</div>
      {@render fieldRows(f.fields, depth + 1)}
      <button class="btn ghost small" style:margin-left="{depth * 1.2 + 1.2}rem" onclick={() => addField(f.fields!)}><Plus size={13} /> Column</button>
    {/if}
  {/each}
{/snippet}

<Modal bind:open={editOpen} title={editId ? "Edit template" : "New template"} size="lg">
  <div class="stack">
    <div class="grid">
      <label class="field"><span class="label">Name</span><input class="input" bind:value={form.name} oninput={() => !editId && (form.key = slug(form.name))} /></label>
      <label class="field"><span class="label">Key</span><input class="input mono" bind:value={form.key} /><span class="hint">how the model names it: {form.key || "key"}.field</span></label>
    </div>
    <label class="field"><span class="label">Description</span><input class="input" bind:value={form.description} /></label>
    <div class="label">Fields</div>
    {@render fieldRows(form.fields, 0)}
    <button class="btn small" onclick={() => addField(form.fields)}><Plus size={14} /> Field</button>
  </div>
  {#snippet footer()}
    <button class="btn ghost" onclick={() => (editOpen = false)}>Cancel</button>
    <button class="btn primary" onclick={saveTemplate} disabled={!form.name.trim() || !form.fields.length}>Save</button>
  {/snippet}
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 0.8rem;
  }
  .tpl {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.7rem 0.9rem;
  }
  .frow {
    display: grid;
    grid-template-columns: 1.4fr 1fr 1fr auto;
    gap: 0.4rem;
    align-items: center;
    margin-top: 0.5rem;
  }
  .fopts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    padding: 0.2rem 0 0.3rem;
  }
  .mini {
    padding: 0.25rem 0.45rem;
    font-size: var(--fs-sm);
  }
  .num {
    width: 4.2rem;
  }
  .wide {
    flex: 1;
    min-width: 10rem;
  }
  @media (max-width: 640px) {
    .frow {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
