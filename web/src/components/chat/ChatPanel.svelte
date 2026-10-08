<script lang="ts">
  import Segmented from "../Segmented.svelte";
  import { del, download, get, patch, post } from "../../lib/api";
  import { confirm, promptText } from "../../lib/dialogs.svelte";
  import { autosize } from "../../lib/gestures";
  import { Archive, BookOpen, Download, Pencil, Plus, ScrollText, Trash, Unlink } from "../../lib/icons";
  import { navigate } from "../../lib/router.svelte";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { ChatDetail, ChatMode, LorebookSummary, Persona, Profile } from "../../lib/types";

  let { detail, onchange, oninspect }: { detail: ChatDetail; onchange: () => void; oninspect: () => void } = $props();

  let personas = $state<Persona[]>([]);
  let profiles = $state<Profile[]>([]);
  let storyProfileId = $state<string | null>(null);
  let presets = $state<{ id: string; name: string }[]>([]);
  let books = $state<LorebookSummary[]>([]);
  // A local copy: typing must not be overwritten by refreshes from the server.
  // svelte-ignore state_referenced_locally
  let note = $state(detail.chat.settings.authorsNote?.content ?? "");
  // svelte-ignore state_referenced_locally
  let depth = $state(detail.chat.settings.authorsNote?.depth ?? 4);
  let noteTimer: ReturnType<typeof setTimeout>;
  // svelte-ignore state_referenced_locally
  let story = $state({ ...(detail.chat.settings.story ?? {}) });
  let storyTimer: ReturnType<typeof setTimeout>;
  let newTruth = $state("");
  let newOoc = $state("");
  const s = $derived(detail.chat.settings);

  $effect(() => {
    void Promise.all([
      get<{ personas: Persona[] }>("/api/personas"),
      get<{ profiles: Profile[]; storyProfileId: string | null }>("/api/profiles"),
      get<{ presets: { id: string; name: string }[] }>("/api/presets"),
      get<{ lorebooks: LorebookSummary[] }>("/api/lorebooks"),
    ])
      .then(([p, pr, ps, lb]) => {
        personas = p.personas;
        profiles = pr.profiles;
        storyProfileId = pr.storyProfileId;
        presets = ps.presets;
        books = lb.lorebooks;
      })
      .catch(errorToast);
  });

  async function update(body: Record<string, unknown>) {
    try {
      await patch(`/api/chats/${detail.chat.id}`, body);
      onchange();
    } catch (e) {
      errorToast(e);
    }
  }

  function saveNote() {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => update({ settings: { authorsNote: { content: note, depth: Number(depth) || 0, role: "system" } } }), 500);
  }

  function saveStory() {
    clearTimeout(storyTimer);
    const clean = Object.fromEntries(Object.entries(story).filter(([, v]) => typeof v === "string" && v.trim()));
    storyTimer = setTimeout(() => update({ settings: { story: clean } }), 500);
  }
  function addTruth() {
    if (!newTruth.trim()) return;
    void update({ settings: { truths: [...(s.truths ?? []), newTruth.trim()] } });
    newTruth = "";
  }
  function addOoc() {
    if (!newOoc.trim()) return;
    void update({ settings: { ooc: [...(s.ooc ?? []), { id: crypto.randomUUID().slice(0, 8), text: newOoc.trim() }] } });
    newOoc = "";
  }

  async function rename() {
    const title = await promptText({ title: "Rename chat", value: detail.chat.title, confirmLabel: "Rename" });
    if (title?.trim()) await update({ title: title.trim() });
  }

  async function archive() {
    await update({ archived: !detail.chat.archivedAt });
    toast(detail.chat.archivedAt ? "Chat unarchived" : "Chat archived");
  }

  async function remove() {
    if (!(await confirm({ title: "Move this chat to the trash?", message: "You can restore it for 30 days.", confirmLabel: "Move to trash", danger: true }))) return;
    await del(`/api/chats/${detail.chat.id}`);
    const id = detail.chat.id;
    toast("Chat moved to trash", { action: { label: "Undo", run: () => void post(`/api/chats/${id}/restore`).then(() => navigate(`/chat/${id}`)) } });
    navigate(detail.character ? `/character/${detail.character.id}` : "/");
  }

  async function newChatBook() {
    try {
      const b = await post<{ id: string }>("/api/lorebooks", { name: `${detail.chat.title} — notes`, links: [{ type: "chat", id: detail.chat.id }] });
      navigate(`/lorebooks/${b.id}`);
    } catch (e) {
      errorToast(e);
    }
  }
  async function linkBook(id: string) {
    await post(`/api/lorebooks/${id}/links`, { type: "chat", id: detail.chat.id });
    onchange();
  }
  async function unlinkBook(id: string) {
    await del(`/api/lorebooks/${id}/links`, { type: "chat", id: detail.chat.id });
    onchange();
  }

  const unlinked = $derived(books.filter((b) => !detail.lorebooks.some((l) => l.id === b.id)));
  const profileName = (id: string | null) => profiles.find((p) => p.id === id)?.name ?? "none";
</script>

<div class="panel-body stack">
  <section class="stack tight">
    <div class="row between">
      <h3 class="truncate">{detail.chat.title}</h3>
      <button class="btn ghost icon small" onclick={rename} aria-label="Rename chat"><Pencil size={15} /></button>
    </div>
    <span class="tiny muted">{detail.chat.messageCount} messages</span>
  </section>

  <label class="field">
    <span class="label">Mode</span>
    <Segmented
      value={detail.chat.mode}
      options={[
        { value: "companion" as ChatMode, label: "Companion" },
        { value: "narrator" as ChatMode, label: "Narrator" },
      ]}
      onchange={(v) => update({ mode: v })}
      small
    />
    <span class="hint">{detail.chat.mode === "narrator" ? "The card narrates a world and voices its characters." : "One-on-one with this character."}</span>
  </label>

  <label class="field">
    <span class="label">You're playing</span>
    <select class="select" value={detail.persona?.id ?? ""} onchange={(e) => update({ personaId: e.currentTarget.value || null })}>
      {#each personas as p (p.id)}<option value={p.id}>{p.name}{p.isDefault ? " (default)" : ""}</option>{/each}
      {#if !personas.length}<option value="">No personas yet</option>{/if}
    </select>
  </label>

  <label class="field">
    <span class="label">Model</span>
    <select class="select" value={detail.chat.settings.profileId ?? ""} onchange={(e) => update({ settings: { profileId: e.currentTarget.value || null } })}>
      <option value="">Default ({profileName(storyProfileId)})</option>
      {#each profiles as p (p.id)}<option value={p.id}>{p.name} · {p.modelId}</option>{/each}
    </select>
  </label>

  <label class="field">
    <span class="label">Preset</span>
    <select class="select" value={detail.chat.settings.presetId ?? ""} onchange={(e) => update({ settings: { presetId: e.currentTarget.value || null } })}>
      <option value="">Default preset</option>
      {#each presets as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
    </select>
  </label>

  <div class="field">
    <span class="label">Author's note <span class="faint">depth <input class="depth" type="number" min="0" max="100" bind:value={depth} oninput={saveNote} aria-label="Depth" /></span></span>
    <textarea class="textarea" use:autosize={240} bind:value={note} oninput={saveNote} placeholder="A standing note for the story, e.g. “It's raining all week.”"></textarea>
    <span class="hint">Inserted {depth} messages from the end, every turn.</span>
  </div>

  <details class="story-set" open={!!(s.truths?.length || Object.keys(s.story ?? {}).length || s.ooc?.length)}>
    <summary class="label">Story settings</summary>
    <div class="stack tight">
      <div class="sgrid">
        <label class="field"><span class="tiny muted">Genre</span><input class="input mini" bind:value={story.genre} oninput={saveStory} placeholder="cozy mystery" maxlength="60" /></label>
        <label class="field"><span class="tiny muted">Tone</span><input class="input mini" bind:value={story.tone} oninput={saveStory} placeholder="warm, wry" maxlength="60" /></label>
        <label class="field"><span class="tiny muted">Point of view</span>
          <select class="select mini" bind:value={story.pov} onchange={saveStory}><option value={undefined}>Card's choice</option><option value="first">First person</option><option value="second">Second person</option><option value="third">Third person</option></select>
        </label>
        <label class="field"><span class="tiny muted">Tense</span>
          <select class="select mini" bind:value={story.tense} onchange={saveStory}><option value={undefined}>Card's choice</option><option value="past">Past</option><option value="present">Present</option></select>
        </label>
        <label class="field"><span class="tiny muted">Intensity</span>
          <select class="select mini" bind:value={story.intensity} onchange={saveStory}><option value={undefined}>Card's choice</option><option value="gentle">Gentle</option><option value="moderate">Moderate</option><option value="intense">Intense</option></select>
        </label>
        <label class="field"><span class="tiny muted">Language</span><input class="input mini" bind:value={story.language} oninput={saveStory} placeholder="English" maxlength="30" /></label>
      </div>
      <label class="field"><span class="tiny muted">Style</span><input class="input mini" bind:value={story.style} oninput={saveStory} placeholder="Short paragraphs, sensory detail, no purple prose" maxlength="200" /></label>
      <div class="field">
        <span class="tiny muted">Reply length and pace</span>
        <div class="row wrap">
          <Segmented value={s.length ?? "normal"} small options={[{ value: "short", label: "Short" }, { value: "normal", label: "Normal" }, { value: "long", label: "Long" }]} onchange={(v) => update({ settings: { length: v === "normal" ? null : v } })} />
          <Segmented value={s.pacing ?? "normal"} small options={[{ value: "slow", label: "Slow" }, { value: "normal", label: "Normal" }, { value: "fast", label: "Fast" }]} onchange={(v) => update({ settings: { pacing: v === "normal" ? null : v } })} />
        </div>
      </div>
      <div class="field">
        <span class="tiny muted">Truths: rules of this story, sent every turn</span>
        {#each s.truths ?? [] as t, i (i)}
          <div class="row item"><span class="grow">{t}</span><button class="btn ghost icon small" onclick={() => update({ settings: { truths: (s.truths ?? []).filter((_, j) => j !== i) } })} aria-label="Remove truth"><Trash size={13} /></button></div>
        {/each}
        <input class="input mini" bind:value={newTruth} placeholder="Magic always costs something. Enter to add" maxlength="300" onkeydown={(e) => e.key === "Enter" && addTruth()} />
      </div>
      <div class="field">
        <span class="tiny muted">Standing notes to the model (out of character)</span>
        {#each s.ooc ?? [] as o (o.id)}
          <div class="row item"><span class="grow">{o.text}</span><button class="btn ghost icon small" onclick={() => update({ settings: { ooc: (s.ooc ?? []).filter((x) => x.id !== o.id) } })} aria-label="Remove note"><Trash size={13} /></button></div>
        {/each}
        <input class="input mini" bind:value={newOoc} placeholder="Don't speak for my character. Enter to add" maxlength="600" onkeydown={(e) => e.key === "Enter" && addOoc()} />
      </div>
    </div>
  </details>

  <div class="field">
    <span class="label">Lorebooks for this chat</span>
    {#each detail.lorebooks as b (b.id)}
      <div class="row book">
        <a href="/lorebooks/{b.id}" class="grow row truncate"><BookOpen size={15} /> {b.name}</a>
        <button class="btn ghost icon small" onclick={() => unlinkBook(b.id)} aria-label="Unlink {b.name}"><Unlink size={14} /></button>
      </div>
    {/each}
    <div class="row wrap">
      <button class="btn small" onclick={newChatBook}><Plus size={14} /> New</button>
      {#if unlinked.length}
        <select class="select small-select" onchange={(e) => e.currentTarget.value && linkBook(e.currentTarget.value)}>
          <option value="">Link existing…</option>
          {#each unlinked as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
        </select>
      {/if}
    </div>
    <span class="hint">Character, persona and global lorebooks apply automatically.</span>
  </div>

  <div class="field">
    <span class="label">Tools</span>
    <div class="row wrap">
      <button class="btn small" onclick={oninspect}><ScrollText size={14} /> Next prompt</button>
      <button class="btn small" onclick={() => download(`/api/chats/${detail.chat.id}/export?format=html`)}><Download size={14} /> HTML</button>
      <button class="btn small" onclick={() => download(`/api/chats/${detail.chat.id}/export?format=md`)}><Download size={14} /> Markdown</button>
      <button class="btn small" onclick={() => download(`/api/chats/${detail.chat.id}/export?format=jsonl`)}><Download size={14} /> JSONL</button>
    </div>
  </div>

  <div class="row wrap">
    <button class="btn small" onclick={archive}><Archive size={14} /> {detail.chat.archivedAt ? "Unarchive" : "Archive"}</button>
    <button class="btn small danger" onclick={remove}><Trash size={14} /> Delete chat</button>
  </div>

</div>

<style>
  .panel-body {
    gap: 1.15rem;
  }
  .depth {
    width: 3.2rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    padding: 0 0.3rem;
    text-transform: none;
  }
  .book a {
    color: var(--text);
    gap: 0.4rem;
    font-size: var(--fs-sm);
  }
  .story-set summary {
    cursor: pointer;
    margin-bottom: 0.5rem;
  }
  .sgrid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .mini {
    padding: 0.3rem 0.5rem;
    font-size: var(--fs-sm);
  }
  .item {
    font-size: var(--fs-sm);
    padding: 0.15rem 0.2rem;
    border-bottom: 1px solid var(--border);
  }
  .small-select {
    width: auto;
    padding-top: 0.35rem;
    padding-bottom: 0.35rem;
  }
</style>
