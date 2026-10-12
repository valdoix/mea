<script lang="ts">
  import "../../styles/studio.css";
  import Module from "../desk/Module.svelte";
  import Rocker from "../desk/Rocker.svelte";
  import Jack from "../desk/Jack.svelte";
  import Knob from "../desk/Knob.svelte";
  import Seg from "../desk/Seg.svelte";
  import Fader from "../desk/Fader.svelte";
  import ControlDesk from "../presets/ControlDesk.svelte";
  import ChatGuards from "./ChatGuards.svelte";
  import ChatStatus from "./ChatStatus.svelte";
  import HealthPanel from "./HealthPanel.svelte";
  import CanonPanel from "./CanonPanel.svelte";
  import CraftPanel from "./CraftPanel.svelte";
  import CostPanel from "./CostPanel.svelte";
  import ChatSteer from "./ChatSteer.svelte";
  import BookExport from "./BookExport.svelte";
  import LoreExport from "./LoreExport.svelte";
  import AmbienceEditor from "./AmbienceEditor.svelte";
  import { openSetup } from "../../lib/setup.svelte";
  import { del, download, get, imageUrl, patch, post, put } from "../../lib/api";
  import { confirm, promptText } from "../../lib/dialogs.svelte";
  import { autosize } from "../../lib/gestures";
  import { compact } from "../../lib/format";
  import { Archive, BookOpen, Download, Eye, ImageIcon, Library, Link, Pencil, Plus, ScrollText, Sparkles, Trash, Unlink, X } from "../../lib/icons";
  import { uploadImage } from "../../lib/images";
  import type { Collection, StoryStats } from "../../lib/types";
  import { navigate } from "../../lib/router.svelte";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { ChatDetail, ChatMode, ChatSettings, LorebookSummary, Persona, Preset, Profile } from "../../lib/types";

  let { detail, onchange, oninspect }: { detail: ChatDetail; onchange: () => void; oninspect: () => void } = $props();

  let personas = $state<Persona[]>([]);
  let profiles = $state<Profile[]>([]);
  let storyProfileId = $state<string | null>(null);
  let presets = $state<{ id: string; name: string }[]>([]);
  let defaultPresetId = $state<string | null>(null);
  // PROMPT-07: the controls of the preset this chat actually uses (its own, the character's, or the global one).
  let preset = $state<Preset | null>(null);
  const effectivePresetId = $derived(detail.chat.settings.presetId ?? detail.defaults?.presetId ?? defaultPresetId);
  $effect(() => {
    const id = effectivePresetId;
    if (id) get<Preset>(`/api/presets/${id}`).then((p) => (preset = p), () => (preset = null));
  });
  function setControl(id: string, value: boolean | string | null) {
    const next = { ...(detail.chat.settings.controls ?? {}) };
    if (value === null) delete next[id];
    else next[id] = value;
    void update({ settings: { controls: next } });
  }
  const fromCharacter = (what: "preset" | "profile") => detail.defaults?.from[what] === "character";
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
  let exportOpen = $state(false);
  let loreOpen = $state(false);

  $effect(() => {
    void Promise.all([
      get<{ personas: Persona[] }>("/api/personas"),
      get<{ profiles: Profile[]; storyProfileId: string | null }>("/api/profiles"),
      get<{ presets: { id: string; name: string }[]; defaultId: string | null }>("/api/presets"),
      get<{ lorebooks: LorebookSummary[] }>("/api/lorebooks"),
    ])
      .then(([p, pr, ps, lb]) => {
        personas = p.personas;
        profiles = pr.profiles;
        storyProfileId = pr.storyProfileId;
        presets = ps.presets;
        defaultPresetId = ps.defaultId;
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
  function setStory<K extends keyof typeof story>(k: K, v: string) {
    story[k] = (v || undefined) as (typeof story)[K];
    saveStory();
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

  // LIB-04…07: title, cover, collections, stats.
  let collections = $state<Collection[]>([]);
  let mine = $state<string[]>([]);
  let extras = $state<{ titleLocked: boolean; coverImageId: string | null } | null>(null);
  let stats = $state<StoryStats | null>(null);
  let coverInput = $state<HTMLInputElement | null>(null);
  async function loadLibrary() {
    try {
      const [c, x, st] = await Promise.all([
        get<{ collections: Collection[] }>("/api/collections"),
        get<{ titleLocked: boolean; coverImageId: string | null; collections: string[] }>(`/api/chats/${detail.chat.id}/extras`),
        get<StoryStats>(`/api/chats/${detail.chat.id}/stats`),
      ]);
      collections = c.collections;
      mine = x.collections;
      extras = x;
      stats = st;
    } catch {
      // the library is optional here
    }
  }
  $effect(() => {
    void detail.chat.id;
    void loadLibrary();
  });
  async function toggleCollection(cid: string) {
    try {
      mine = (await put<{ collections: string[] }>(`/api/chats/${detail.chat.id}/collections/${cid}`, { member: !mine.includes(cid) })).collections;
    } catch (e) {
      errorToast(e);
    }
  }
  async function autoTitle() {
    try {
      await post(`/api/chats/${detail.chat.id}/title/auto`);
      onchange();
      await loadLibrary();
    } catch (e) {
      errorToast(e);
    }
  }
  async function setCover(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    try {
      const imageId = await uploadImage(f);
      extras = await put(`/api/chats/${detail.chat.id}/cover`, { imageId });
    } catch (e) {
      errorToast(e);
    }
  }
  async function clearCover() {
    try {
      extras = await put(`/api/chats/${detail.chat.id}/cover`, { imageId: null });
    } catch (e) {
      errorToast(e);
    }
  }
  const hours = (m: number) => (m >= 90 ? `${Math.round(m / 60)}H` : `${m}M`);

  async function rename() {
    const title = await promptText({ title: "Rename chat", value: detail.chat.title, confirmLabel: "Rename" });
    if (title?.trim()) await update({ title: title.trim() });
  }

  async function archive() {
    await update({ archived: !detail.chat.archivedAt });
    toast(detail.chat.archivedAt ? "Chat unarchived" : "Chat archived");
  }

  // Delete hides under a striped safety cover: lift it, then press.
  let coverLifted = $state(false);
  let coverTimer: ReturnType<typeof setTimeout>;
  function lift() {
    coverLifted = true;
    clearTimeout(coverTimer);
    coverTimer = setTimeout(() => (coverLifted = false), 5000);
  }
  async function remove() {
    if (!(await confirm({ title: "Move this chat to the trash?", message: "You can restore it for 30 days.", confirmLabel: "Move to trash", danger: true }))) return;
    try {
      await del(`/api/chats/${detail.chat.id}`);
    } catch (err) {
      errorToast(err);
      return;
    }
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
  const sleeve = $derived(extras?.coverImageId ? imageUrl(extras.coverImageId, true) : detail.character?.avatarId ? imageUrl(detail.character.avatarId, "m") : null);
  const initials = (name: string) =>
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase();
  const tapes = ["var(--st-sea)", "var(--st-rose)", "var(--st-cool)", "var(--st-warm)", "var(--accent)"];

  const POV = [
    { value: "", label: "Card", title: "The card's choice" },
    { value: "first", label: "1st", title: "First person" },
    { value: "second", label: "2nd", title: "Second person" },
    { value: "third", label: "3rd", title: "Third person" },
  ];
  const TENSE = [
    { value: "", label: "Card", title: "The card's choice" },
    { value: "past", label: "Past" },
    { value: "present", label: "Present" },
  ];
  const INTENSITY = [
    { value: "", label: "Card", title: "The card's choice" },
    { value: "gentle", label: "Gentle" },
    { value: "moderate", label: "Moderate" },
    { value: "intense", label: "Intense" },
  ];
  const storyPeek = $derived(
    [story.genre, POV.find((p) => p.value && p.value === story.pov)?.label, story.tense].filter(Boolean).join(" · ") || "The card's choices",
  );
  // Open at first when anything is set; after that it stays where you leave it.
  // svelte-ignore state_referenced_locally
  const storyOpen = !!(s.truths?.length || Object.keys(s.story ?? {}).length || s.ooc?.length);
</script>

<div class="studio st-stack chat-desk">
  <!-- now playing -->
  <Module title="Now playing" lit peek="{detail.chat.messageCount} messages">
    <div class="display">
      <div class="sleeve">
        {#if sleeve}<img src={sleeve} alt="" />{:else}<span class="np-initials" aria-hidden="true">{initials(detail.character?.name ?? detail.chat.title)}</span>{/if}
        <button type="button" class="sl-b" onclick={() => coverInput?.click()} aria-label={extras?.coverImageId ? "Change cover" : "Add a cover image"} title={extras?.coverImageId ? "Change cover" : "Add a cover image"}><ImageIcon size={13} /></button>
        {#if extras?.coverImageId}<button type="button" class="sl-b x" onclick={clearCover} aria-label="Remove cover" title="Remove cover"><X size={13} /></button>{/if}
      </div>
      <div class="np">
        <p class="np-title">{detail.chat.title}</p>
        {#if detail.character || detail.persona}<p class="np-cast">{[detail.character?.name, detail.persona?.name].filter(Boolean).join(" × ")}</p>{/if}
        {#if stats && stats.messages}
          <div class="counters" aria-label="Story statistics">
            <span class="st-lcd" title="{stats.messages} messages">{compact(stats.messages)}<small>MSG</small></span>
            <span class="st-lcd" title="{stats.words.toLocaleString()} words">{compact(stats.words)}<small>WORDS</small></span>
            <span class="st-lcd" title="{stats.yourWords.toLocaleString()} of them yours">{compact(stats.yourWords)}<small>YOURS</small></span>
            <span class="st-lcd" title="Time spent">{hours(stats.minutesSpent)}<small>{stats.daysActive} DAY{stats.daysActive === 1 ? "" : "S"}</small></span>
            {#if stats.memories}<span class="st-lcd" title="Memories">{stats.memories}<small>MEM</small></span>{/if}
            {#if stats.cost}<span class="st-lcd" title="Spent on this story">${stats.cost.toFixed(2)}</span>{/if}
          </div>
        {/if}
      </div>
    </div>
    <input type="file" accept="image/*" hidden bind:this={coverInput} onchange={(e) => setCover(e.currentTarget.files)} />
    <div class="st-keys">
      <button class="st-key" type="button" onclick={rename}><Pencil size={14} /> Rename</button>
      {#if extras?.titleLocked}<button class="st-key" type="button" onclick={autoTitle} title="Let the Story So Far name this chat"><Sparkles size={14} /> Name it</button>{/if}
      <a class="st-key" href="/chat/{detail.chat.id}/codex"><Library size={14} /> Codex</a>
    </div>
    {#if collections.length}
      <div class="st-keys" role="group" aria-label="Collections">
        {#each collections as c (c.id)}
          <button class="st-key" type="button" aria-pressed={mine.includes(c.id)} onclick={() => toggleCollection(c.id)}><span class="st-led" class:on={mine.includes(c.id)}></span>{c.name}</button>
        {/each}
      </div>
    {/if}
  </Module>

  <ChatStatus chatId={detail.chat.id} />
  <HealthPanel chatId={detail.chat.id} />

  <!-- mode and routing -->
  <div class="st-keys setup"><button class="st-key" type="button" onclick={() => openSetup(detail.chat.id)}><Sparkles size={14} /> Story setup</button></div>

  <Module title="Mode">
    <Rocker
      label="Mode"
      value={detail.chat.mode}
      options={[
        { value: "companion" as ChatMode, label: "Companion", sub: "one-on-one" },
        { value: "narrator" as ChatMode, label: "Narrator", sub: "a whole world" },
      ]}
      onchange={(v) => update({ mode: v })}
    />
    <p class="st-caption">{detail.chat.mode === "narrator" ? "The card narrates a world and voices its characters." : "One-on-one with this character."}</p>
    <div class="st-mod-h routing" role="heading" aria-level="4">Routing</div>
    <div class="st-patch">
      <Jack
        label="You're playing"
        value={detail.persona?.id ?? ""}
        options={personas.length ? personas.map((p) => ({ value: p.id, label: `${p.name}${p.isDefault ? " (default)" : ""}` })) : [{ value: "", label: "No personas yet" }]}
        onchange={(v) => update({ personaId: v || null })}
      />
      {#if detail.variants?.length}
        <Jack
          label="{detail.character?.name} plays"
          value={s.variantId ?? ""}
          options={[{ value: "", label: "The base card" }, ...detail.variants.map((v) => ({ value: v.id, label: v.name }))]}
          onchange={(v) => update({ settings: { variantId: v || null } })}
        />
      {/if}
      {#if detail.personaVariants?.length}
        <Jack
          label="You play"
          value={s.personaVariantId ?? ""}
          options={[{ value: "", label: `${detail.persona?.name} (base)` }, ...detail.personaVariants.map((v) => ({ value: v.id, label: v.name }))]}
          onchange={(v) => update({ settings: { personaVariantId: v || null } })}
        />
      {/if}
      <hr />
      <Jack
        label="Model"
        value={s.profileId ?? ""}
        options={[
          { value: "", label: fromCharacter("profile") ? `${detail.character?.name}'s default (${profileName(detail.defaults?.profileId ?? null)})` : `Default (${profileName(storyProfileId)})` },
          ...profiles.map((p) => ({ value: p.id, label: `${p.name} · ${p.modelId}` })),
        ]}
        onchange={(v) => update({ settings: { profileId: v || null } })}
      />
      <Jack
        label="Preset"
        value={s.presetId ?? ""}
        options={[
          {
            value: "",
            label: fromCharacter("preset")
              ? `${detail.character?.name}'s default (${presets.find((p) => p.id === detail.defaults?.presetId)?.name ?? "preset"})`
              : `Default (${presets.find((p) => p.id === defaultPresetId)?.name ?? "preset"})`,
          },
          ...presets.map((p) => ({ value: p.id, label: p.name })),
        ]}
        onchange={(v) => update({ settings: { presetId: v || null } })}
      />
    </div>
  </Module>

  <!-- the preset's rules -->
  {#if preset?.controls.length}
    {@const changed = preset.controls.filter((c) => s.controls?.[c.id] !== undefined && s.controls[c.id] !== (detail.defaults?.characterControls?.[c.id] ?? c.default)).length}
    <Module title="Rules · from “{preset.name}”" led={changed ? "warm" : null} peek={changed ? `${changed} changed` : "All from the preset"}>
      <ControlDesk
        controls={preset.controls}
        values={s.controls ?? {}}
        inherited={detail.defaults?.characterControls ?? {}}
        inheritedLabel={Object.keys(detail.defaults?.characterControls ?? {}).length ? "character's default" : "preset's default"}
        onchange={setControl}
      />
    </Module>
  {/if}

  <!-- author's note: masking tape and a depth knob -->
  <Module title="Author's note" peek="every turn">
    <div class="tapebox">
      <div class="tape">
        <textarea
          use:autosize={240}
          bind:value={note}
          oninput={saveNote}
          aria-label="Author's note"
          placeholder={detail.defaults?.from.authorsNote === "character" ? "Empty: the character's default note applies." : "A standing note for the story, e.g. “It's raining all week.”"}
        ></textarea>
      </div>
      <Knob label="Depth" value={Number(depth) || 0} min={0} max={100} onchange={(v) => ((depth = v), saveNote())} />
    </div>
    <p class="st-hint">Inserted {depth} message{depth === 1 ? "" : "s"} from the end, every turn. Drag the knob or use the arrow keys.</p>
  </Module>

  <!-- story settings -->
  <Module title="Story settings" fold open={storyOpen} peek={storyPeek}>
    <div class="dymo-grid">
      <label><span class="st-k">Genre</span><input class="dymo" bind:value={story.genre} oninput={saveStory} placeholder="Cozy mystery" maxlength="60" /></label>
      <label><span class="st-k">Tone</span><input class="dymo" bind:value={story.tone} oninput={saveStory} placeholder="Warm, wry" maxlength="60" /></label>
      <label class="wide"><span class="st-k">Style</span><input class="dymo alt" bind:value={story.style} oninput={saveStory} placeholder="Short paragraphs, sensory detail" maxlength="200" /></label>
      <label><span class="st-k">Language</span><input class="dymo" bind:value={story.language} oninput={saveStory} placeholder="English" maxlength="30" /></label>
    </div>
    <hr class="st-divider" />
    <div class="st-seg-row"><span class="st-k">Point of view</span><Seg label="Point of view" value={story.pov ?? ""} options={POV} onchange={(v) => setStory("pov", v)} /></div>
    <div class="st-seg-row"><span class="st-k">Tense</span><Seg label="Tense" value={story.tense ?? ""} options={TENSE} onchange={(v) => setStory("tense", v)} /></div>
    <div class="st-seg-row"><span class="st-k">Intensity</span><Seg label="Intensity" value={story.intensity ?? ""} options={INTENSITY} onchange={(v) => setStory("intensity", v)} /></div>
    <hr class="st-divider" />
    <Fader
      label="Reply length"
      value={s.length ?? "normal"}
      base="normal"
      resetLabel="Back to normal"
      options={[
        { value: "short", label: "Short" },
        { value: "normal", label: "Normal" },
        { value: "long", label: "Long" },
      ]}
      onchange={(v) => update({ settings: { length: v === "normal" ? null : v } as Partial<ChatSettings> })}
      onreset={() => update({ settings: { length: null } })}
    />
    <Fader
      label="Pace"
      value={s.pacing ?? "normal"}
      base="normal"
      resetLabel="Back to normal"
      options={[
        { value: "slow", label: "Slow" },
        { value: "normal", label: "Normal" },
        { value: "fast", label: "Fast" },
      ]}
      onchange={(v) => update({ settings: { pacing: v === "normal" ? null : v } as Partial<ChatSettings> })}
      onreset={() => update({ settings: { pacing: null } })}
    />
    <hr class="st-divider" />
    <span class="st-k">Truths · rules of this story, sent every turn</span>
    {#if s.truths?.length}
      <ul class="st-pins">
        {#each s.truths as t, i (i)}
          <li><span>{t}</span><button type="button" onclick={() => update({ settings: { truths: (s.truths ?? []).filter((_, j) => j !== i) } })} aria-label="Remove truth"><X size={13} /></button></li>
        {/each}
      </ul>
    {/if}
    <label class="st-addline"><Plus size={14} /><input bind:value={newTruth} placeholder="Magic always costs something. Enter to add" maxlength="300" onkeydown={(e) => e.key === "Enter" && addTruth()} aria-label="Add a truth" /></label>
    <hr class="st-divider" />
    <span class="st-k">Standing notes · to the model, out of character</span>
    {#if s.ooc?.length}
      <ul class="st-pins ooc">
        {#each s.ooc as o (o.id)}
          <li><span>{o.text}</span><button type="button" onclick={() => update({ settings: { ooc: (s.ooc ?? []).filter((x) => x.id !== o.id) } })} aria-label="Remove note"><X size={13} /></button></li>
        {/each}
      </ul>
    {/if}
    <label class="st-addline"><Plus size={14} /><input bind:value={newOoc} placeholder="Don't speak for my character. Enter to add" maxlength="600" onkeydown={(e) => e.key === "Enter" && addOoc()} aria-label="Add a standing note" /></label>
  </Module>

  <CraftPanel chatId={detail.chat.id} />
  <CostPanel chatId={detail.chat.id} budgetMode={Boolean((detail.chat.settings as ChatSettings).budgetMode)} {onchange} />
  <CanonPanel chatId={detail.chat.id} />

  <ChatSteer chatId={detail.chat.id} settings={detail.chat.settings} characterStyle={detail.defaults?.characterStyle ?? null} onupdate={(b) => update(b)} />
  <ChatGuards chatId={detail.chat.id} settings={detail.chat.settings} onupdate={(b) => update(b)} />

  <!-- lorebooks as cassettes -->
  <Module title="Lorebooks" fold open={detail.lorebooks.length > 0} peek={detail.lorebooks.length ? `${detail.lorebooks.length} loaded` : "None for this chat"}>
    {#if detail.lorebooks.length}
      <div class="cassettes">
        {#each detail.lorebooks as b, i (b.id)}
          <div class="cassette" style:--c={tapes[i % tapes.length]}>
            <a class="cas-label" href="/lorebooks/{b.id}"><span class="reels" aria-hidden="true"><i></i><i></i></span><b>{b.name}</b></a>
            <button class="eject" type="button" onclick={() => unlinkBook(b.id)} aria-label="Unlink {b.name}" title="Unlink"><Unlink size={14} /></button>
          </div>
        {/each}
      </div>
    {/if}
    <div class="slots">
      <button class="slot" type="button" onclick={newChatBook}><Plus size={14} /> New book</button>
      {#if unlinked.length}
        <label class="slot"
          ><Link size={14} /> Link existing
          <select value="" onchange={(e) => e.currentTarget.value && linkBook(e.currentTarget.value)} aria-label="Link an existing lorebook">
            <option value="">Link existing…</option>
            {#each unlinked as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
          </select>
        </label>
      {/if}
    </div>
    <p class="st-hint">Character, persona and global lorebooks apply automatically.</p>
  </Module>

  <AmbienceEditor {detail} {onchange} />

  <!-- tools -->
  <Module title="Tools">
    <div class="keypad">
      <button class="st-key" type="button" onclick={oninspect}><ScrollText size={18} />Next prompt</button>
      <a class="st-key" href="/chat/{detail.chat.id}/read"><Eye size={18} />Reading mode</a>
      <button class="st-key" type="button" onclick={() => (exportOpen = true)}><BookOpen size={18} />Book &amp; memory</button>
      <button class="st-key fmt" type="button" onclick={() => download(`/api/chats/${detail.chat.id}/export?format=html`)}><Download size={15} />HTML</button>
      <button class="st-key fmt" type="button" onclick={() => download(`/api/chats/${detail.chat.id}/export?format=md`)}><Download size={15} />Markdown</button>
      <button class="st-key fmt" type="button" onclick={() => download(`/api/chats/${detail.chat.id}/export?format=jsonl`)}><Download size={15} />JSONL</button>
      <button class="st-key fmt" type="button" onclick={() => (loreOpen = true)} title="Save this story as a lorebook"><Library size={15} />As a lorebook</button>
    </div>
  </Module>

  <BookExport bind:open={exportOpen} chatId={detail.chat.id} />
  <LoreExport bind:open={loreOpen} chatId={detail.chat.id} lastSeq={detail.chat.messageCount} />

  <Module>
    <div class="endrow">
      <button class="st-key" type="button" onclick={archive}><Archive size={14} /> {detail.chat.archivedAt ? "Unarchive" : "Archive"}</button>
      <div class="guarded" class:open={coverLifted}>
        <button class="st-key danger" type="button" onclick={remove} tabindex={coverLifted ? 0 : -1}><Trash size={14} /> Delete chat</button>
        <button class="cover" type="button" onclick={lift} aria-label="Lift the cover to reveal Delete" tabindex={coverLifted ? -1 : 0}>Lift to delete</button>
      </div>
    </div>
    <p class="fine">Deleted chats wait in the trash for 30 days.</p>
  </Module>
</div>

<style>
  /* now playing */
  .display {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    gap: 12px;
    padding: 10px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: var(--st-inset);
  }
  .sleeve {
    position: relative;
    aspect-ratio: 1;
    align-self: start;
    border-radius: calc(var(--r-sm) - 2px);
    overflow: hidden;
    background: var(--st-grad);
    box-shadow:
      0 6px 14px -6px rgb(0 0 0 / 45%),
      0 0 0 1px rgb(0 0 0 / 10%);
  }
  .sleeve img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .np-initials {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    font: 400 calc(30px * var(--st-hs)) / 1 var(--st-head);
    color: var(--on-accent);
    background:
      radial-gradient(60% 60% at 30% 25%, rgb(255 255 255 / 35%), transparent 70%),
      repeating-radial-gradient(circle at 50% 120%, transparent 0 7px, rgb(255 255 255 / 10%) 7px 8px);
  }
  .sl-b {
    position: absolute;
    right: 4px;
    bottom: 4px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgb(0 0 0 / 55%);
    color: #fff;
    cursor: pointer;
    opacity: 0.85;
  }
  .sl-b.x {
    right: auto;
    left: 4px;
  }
  .sl-b:hover,
  .sl-b:focus-visible {
    opacity: 1;
  }
  .np {
    min-width: 0;
  }
  .np-title {
    margin: 1px 0 0;
    font: 600 calc(17px * var(--st-hs)) / 1.12 var(--st-head);
    overflow-wrap: anywhere;
  }
  .np-cast {
    margin: 3px 0 0;
    font-size: 12px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .counters {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    margin-top: 8px;
  }
  .counters small {
    margin-left: 3px;
    font-size: 0.78em;
    color: var(--text-faint);
    text-shadow: none;
  }
  .routing {
    margin-top: 16px;
  }

  /* author's note: masking tape */
  .tapebox {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 74px;
    gap: 12px;
    align-items: center;
  }
  .tape {
    position: relative;
    padding: 12px 14px 10px;
    background: color-mix(in srgb, var(--butter) 70%, var(--surface));
    color: #3a2f1e;
    transform: rotate(-1deg);
    clip-path: polygon(0 4%, 3% 0, 7% 5%, 12% 1%, 18% 4%, 25% 0, 33% 3%, 41% 0, 50% 4%, 58% 1%, 66% 4%, 74% 0, 82% 3%, 90% 0, 96% 4%, 100% 1%, 100% 96%, 97% 100%, 91% 96%, 84% 100%, 76% 97%, 68% 100%, 60% 96%, 52% 100%, 44% 97%, 36% 100%, 28% 96%, 20% 100%, 12% 97%, 5% 100%, 0 96%);
    filter: drop-shadow(0 3px 6px rgb(0 0 0 / 12%));
  }
  :global(:root:is([data-mode="night"], [data-theme="lantern"])) .tape {
    background: color-mix(in srgb, var(--butter) 62%, #d9c49a);
  }
  .tape textarea {
    display: block;
    width: 100%;
    min-height: 84px;
    padding: 0;
    border: 0;
    background: transparent;
    resize: none;
    color: inherit;
    font: italic 15px/1.45 var(--st-story);
  }
  .tape textarea::placeholder {
    color: rgb(58 47 30 / 55%);
  }
  .tape textarea:focus {
    outline: none;
  }
  .tape:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  /* story settings: label-maker tapes */
  .dymo-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 10px 8px;
  }
  .dymo-grid label {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .dymo-grid .wide {
    grid-column: span 2;
  }
  .dymo {
    width: 100%;
    min-width: 0;
    padding: 7px 10px;
    border: 0;
    border-radius: 3px;
    background: var(--text);
    color: var(--surface);
    font: 800 12px/1.2 var(--font-ui);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    text-shadow:
      0 1px 0 rgb(0 0 0 / 35%),
      0 -1px 0 rgb(255 255 255 / 20%);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 12%),
      0 2px 4px rgb(0 0 0 / 20%);
  }
  .dymo-grid label:nth-child(odd) .dymo {
    transform: rotate(-0.4deg);
  }
  .dymo::placeholder {
    color: color-mix(in srgb, var(--surface) 50%, transparent);
  }
  .dymo:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .dymo.alt {
    background: var(--accent);
    color: var(--on-accent);
    text-shadow: none;
  }
  .dymo.alt::placeholder {
    color: color-mix(in srgb, var(--on-accent) 55%, transparent);
  }

  /* lorebooks: cassettes */
  .cassettes {
    display: grid;
    gap: 8px;
  }
  .cassette {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 8px 8px 8px 10px;
    border-radius: 8px;
    background: linear-gradient(var(--c), color-mix(in srgb, var(--c) 75%, black));
    box-shadow:
      0 2px 0 rgb(0 0 0 / 20%),
      inset 0 1px 0 rgb(255 255 255 / 25%);
  }
  :global(:root[data-theme="citadel"]) .cassette {
    border-radius: 2px;
  }
  .cassette a.cas-label {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 7px 10px;
    border-radius: 4px;
    background: #fdfaf2;
    color: #2a2230;
    text-decoration: none;
  }
  .cas-label b {
    font: 600 calc(14.5px * var(--st-hs)) / 1.15 var(--st-head);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .reels {
    display: flex;
    gap: 4px;
  }
  .reels i {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: repeating-conic-gradient(#2a2230 0 20deg, #5a5060 20deg 60deg);
    box-shadow:
      0 0 0 2px #fdfaf2,
      0 0 0 3px rgb(0 0 0 / 20%);
  }
  .cas-label:hover .reels i {
    animation: reel 3s linear infinite;
  }
  @keyframes reel {
    to {
      transform: rotate(1turn);
    }
  }
  .eject {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: rgb(0 0 0 / 22%);
    color: #fff;
    cursor: pointer;
  }
  .eject:hover {
    background: rgb(0 0 0 / 38%);
  }
  .slots {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
    gap: 8px;
    margin-top: 8px;
  }
  .slot {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 9px;
    border: 1.5px dashed var(--border-strong);
    border-radius: 8px;
    background: none;
    color: var(--text-muted);
    font: 700 12px/1.2 var(--font-ui);
    cursor: pointer;
  }
  .slot:hover,
  .slot:focus-within {
    border-color: var(--accent);
    color: var(--text);
  }
  .slot select {
    position: absolute;
    inset: 0;
    width: 100%;
    opacity: 0;
    cursor: pointer;
    font-size: 16px;
  }

  /* tools: a keypad */
  .keypad {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .keypad .st-key {
    flex-direction: column;
    min-height: 64px;
    padding: 8px 4px;
    font-size: 11.5px;
    text-align: center;
    line-height: 1.15;
  }
  .keypad .st-key.fmt {
    min-height: 52px;
  }

  /* archive, and delete under a safety cover */
  .endrow {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    align-items: stretch;
  }
  .guarded {
    position: relative;
    perspective: 400px;
  }
  .guarded .st-key {
    width: 100%;
    height: 100%;
  }
  .cover {
    position: absolute;
    inset: -3px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: calc(var(--r-sm) + 2px);
    background: repeating-linear-gradient(135deg, var(--danger) 0 8px, color-mix(in srgb, var(--danger) 45%, var(--surface)) 8px 16px);
    color: #fff;
    font: 800 10px/1 var(--font-ui);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-shadow: 0 1px 2px rgb(0 0 0 / 50%);
    transform-origin: top;
    transition:
      transform 0.35s var(--spring),
      opacity 0.35s;
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--danger) 80%, black);
    cursor: pointer;
  }
  .cover:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .guarded.open .cover {
    transform: rotateX(-110deg);
    opacity: 0.25;
    pointer-events: none;
  }
  .fine {
    margin: 8px 2px 0;
    text-align: center;
    font-size: 11px;
    color: var(--text-faint);
  }
</style>
