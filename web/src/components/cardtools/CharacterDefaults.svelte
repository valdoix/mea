<script lang="ts">
  import ControlSwitches from "../presets/ControlSwitches.svelte";
  import StyleEditor from "../chat/StyleEditor.svelte";
  import { get, put } from "../../lib/api";
  import { autosize } from "../../lib/gestures";
  import { ExternalLink, Layers, NotebookPen, Plus, X } from "../../lib/icons";
  import { errorToast } from "../../lib/state.svelte";
  import type { CharacterSettings, Preset, Profile } from "../../lib/types";

  /**
   * CHAR-07 (your notes, the source link) and PROMPT-06 (defaults every chat with this character
   * starts from: preset, model profile, author's note, controls, story truths). A chat's own choice
   * still wins; leave a value empty to use the global one.
   */
  let { characterId, settings: initial }: { characterId: string; settings: CharacterSettings } = $props();
  // svelte-ignore state_referenced_locally
  let s = $state<CharacterSettings>(structuredClone(initial ?? {}));
  let presets = $state<{ id: string; name: string }[]>([]);
  let defaultPresetId = $state<string | null>(null);
  let profiles = $state<Profile[]>([]);
  let storyProfileId = $state<string | null>(null);
  let preset = $state<Preset | null>(null);
  let truth = $state("");

  $effect(() => {
    get<{ presets: { id: string; name: string }[]; defaultId: string | null }>("/api/presets").then((r) => ((presets = r.presets), (defaultPresetId = r.defaultId)), () => {});
    get<{ profiles: Profile[]; storyProfileId: string | null }>("/api/profiles").then((r) => ((profiles = r.profiles), (storyProfileId = r.storyProfileId)), () => {});
  });
  $effect(() => {
    const id = s.presetId || defaultPresetId;
    if (id) get<Preset>(`/api/presets/${id}`).then((p) => (preset = p), () => (preset = null));
  });

  // Only the keys changed here go to the server, so the voice lab's kept lines are never overwritten.
  let timer: ReturnType<typeof setTimeout>;
  let pending: Partial<CharacterSettings> = {};
  function save(patch: Partial<CharacterSettings>, delay = 500) {
    Object.assign(s, patch);
    pending = { ...pending, ...$state.snapshot(patch) };
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const body = pending;
      pending = {};
      try {
        await put(`/api/characters/${characterId}`, { settings: body });
      } catch (e) {
        errorToast(e);
      }
    }, delay);
  }

  const nameOf = (list: { id: string; name: string }[], id: string | null) => list.find((x) => x.id === id)?.name ?? "none";
  function setControl(id: string, value: boolean | string | null) {
    const next = { ...(s.controls ?? {}) };
    if (value === null) delete next[id];
    else next[id] = value;
    save({ controls: next }, 0);
  }
</script>

<section class="panel stack">
  <h3><NotebookPen size={16} /> Your notes</h3>
  <label class="field"><span class="label">Notes <span class="faint">private; never sent to the model</span></span><textarea class="textarea" use:autosize={{ max: 360, value: s.notes ?? "" }} value={s.notes ?? ""} oninput={(e) => save({ notes: e.currentTarget.value })} placeholder="Ideas, what worked in which chat, what to try next"></textarea></label>
  <label class="field">
    <span class="label">Source <span class="faint">where the card came from</span></span>
    <div class="row">
      <input class="input grow" type="url" value={s.sourceUrl ?? ""} oninput={(e) => save({ sourceUrl: e.currentTarget.value.trim() })} placeholder="https://…" />
      {#if s.sourceUrl && /^https?:\/\//.test(s.sourceUrl)}<a class="btn ghost icon" href={s.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="Open the source"><ExternalLink size={15} /></a>{/if}
    </div>
  </label>
</section>

<section class="panel stack">
  <h3><Layers size={16} /> Defaults for this character's chats</h3>
  <p class="tiny muted">Every chat with this character starts from these. A chat's own choice wins; leave one empty to use the global setting.</p>
  <div class="row wrap">
    <label class="field grow">
      <span class="label">Preset</span>
      <select class="select" value={s.presetId ?? ""} onchange={(e) => save({ presetId: e.currentTarget.value || null }, 0)}>
        <option value="">Global default ({nameOf(presets, defaultPresetId)})</option>
        {#each presets as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
    </label>
    <label class="field grow">
      <span class="label">Model profile</span>
      <select class="select" value={s.profileId ?? ""} onchange={(e) => save({ profileId: e.currentTarget.value || null }, 0)}>
        <option value="">Story default ({nameOf(profiles, storyProfileId)})</option>
        {#each profiles as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
    </label>
  </div>
  <label class="field">
    <span class="label">Author's note <span class="faint">used when a chat has none of its own</span></span>
    <textarea class="textarea" use:autosize={{ max: 240, value: s.authorsNote?.content ?? "" }} value={s.authorsNote?.content ?? ""} oninput={(e) => save({ authorsNote: e.currentTarget.value.trim() ? { content: e.currentTarget.value, depth: s.authorsNote?.depth ?? 4, role: s.authorsNote?.role ?? "system" } : null })} placeholder="Keep her guarded until trust is earned; she never cries in front of anyone."></textarea>
  </label>
  {#if s.authorsNote?.content}
    <label class="row tiny muted depth">Depth <input class="input mini" type="number" min="0" max="100" value={s.authorsNote.depth} onchange={(e) => save({ authorsNote: { ...s.authorsNote!, depth: Number(e.currentTarget.value) || 0 } }, 0)} /></label>
  {/if}
  <div class="field">
    <span class="label">Story truths <span class="faint">rules that hold in every chat, over the card and the lore</span></span>
    {#each s.truths ?? [] as t, i (i)}
      <div class="row truth small"><span class="grow">{t}</span><button class="btn ghost icon small" onclick={() => save({ truths: (s.truths ?? []).filter((_, j) => j !== i) }, 0)} aria-label="Remove"><X size={13} /></button></div>
    {/each}
    <div class="row">
      <input class="input grow" bind:value={truth} placeholder="Magic always costs a memory." onkeydown={(e) => e.key === "Enter" && truth.trim() && (save({ truths: [...(s.truths ?? []), truth.trim()] }, 0), (truth = ""))} />
      <button class="btn" onclick={() => truth.trim() && (save({ truths: [...(s.truths ?? []), truth.trim()] }, 0), (truth = ""))} disabled={!truth.trim()}><Plus size={14} /></button>
    </div>
  </div>
  {#if preset?.controls.length}
    <div class="field">
      <span class="label">Controls <span class="faint">from “{preset.name}”</span></span>
      <ControlSwitches controls={preset.controls} values={s.controls ?? {}} inheritedLabel="preset's default" onchange={setControl} />
    </div>
  {/if}
  <label class="field">
    <span class="label">Re-anchor <span class="faint">who this character is, in a few lines; sent near the end of the prompt in long chats</span></span>
    <textarea class="textarea" use:autosize={{ max: 240, value: s.anchor ?? "" }} value={s.anchor ?? ""} oninput={(e) => save({ anchor: e.currentTarget.value })} placeholder="Empty: Mea writes one from the personality and the voice samples."></textarea>
    <span class="hint">Settings → Guards decides when it's used.</span>
  </label>
  <div class="field">
    <span class="label">Style profile <span class="faint">for this character's chats; a chat can change any part of it</span></span>
    <StyleEditor value={s.style ?? {}} onchange={(style) => save({ style }, 0)} />
  </div>
</section>

<style>
  h3 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
  }
  .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .mini {
    width: 5rem;
    padding-top: 0.25rem;
    padding-bottom: 0.25rem;
  }
  .depth {
    align-items: center;
    gap: 0.4rem;
  }
  .truth {
    border-bottom: 1px solid var(--border);
    padding: 0.2rem 0;
  }
</style>
