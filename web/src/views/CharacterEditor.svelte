<script lang="ts">
  import Avatar from "../components/Avatar.svelte";
  import ImageCropper from "../components/ImageCropper.svelte";
  import Menu, { type MenuItem } from "../components/Menu.svelte";
  import Modal from "../components/Modal.svelte";
  import Segmented from "../components/Segmented.svelte";
  import TagInput from "../components/TagInput.svelte";
  import CardCheck from "../components/cardtools/CardCheck.svelte";
  import CharacterDefaults from "../components/cardtools/CharacterDefaults.svelte";
  import DiffModal from "../components/cardtools/DiffModal.svelte";
  import FieldTools from "../components/cardtools/FieldTools.svelte";
  import GreetingWorkshop from "../components/cardtools/GreetingWorkshop.svelte";
  import NotesSorter from "../components/cardtools/NotesSorter.svelte";
  import TestBench from "../components/cardtools/TestBench.svelte";
  import VariantsPanel from "../components/cardtools/VariantsPanel.svelte";
  import VoiceLab from "../components/cardtools/VoiceLab.svelte";
  import WorldAgency from "../components/cardtools/WorldAgency.svelte";
  import { download, get, post, put, del } from "../lib/api";
  import { confirm } from "../lib/dialogs.svelte";
  import { clock, timeAgo } from "../lib/format";
  import { autosize } from "../lib/gestures";
  import { ArrowLeft, BookOpen, Download, Ellipsis, History, ImageIcon, Link, MessageHeart, Plus, Trash, Unlink, WandSparkles } from "../lib/icons";
  import { uploadImage } from "../lib/images";
  import { navigate, route } from "../lib/router.svelte";
  import { app, errorToast, toast } from "../lib/state.svelte";
  import type { CardData, Character, ChatListItem, ChatMode, LorebookSummary, Persona, TokenCounts } from "../lib/types";

  let { id }: { id: string } = $props();

  type Tab = "chats" | "card" | "greetings" | "voice" | "test" | "variants" | "advanced" | "images" | "lore" | "history";
  let tab = $state<Tab>((route.query.tab as Tab) || "chats");
  let character = $state<Character | null>(null);
  let draft = $state<CardData | null>(null);
  let tags = $state<string[]>([]);
  let folder = $state("");
  let mode = $state<ChatMode | "auto">("auto");
  let defaultPersonaId = $state<string>("");
  let saved = $state("");
  let saving = $state(false);
  let tokens = $state<TokenCounts | null>(null);
  let editorMode = $state<"form" | "document">((localStorage.getItem("mea.editorMode") as "form") || "form");
  let doc = $state("");
  let docError = $state("");
  let personas = $state<Persona[]>([]);
  let chats = $state<ChatListItem[]>([]);
  let allTags = $state<string[]>([]);
  let books = $state<LorebookSummary[]>([]);
  let versions = $state<{ id: string; name: string; note: string | null; createdAt: number }[]>([]);
  let guess = $state<{ mode: ChatMode; reasons: string[] } | null>(null);
  let cropFile = $state<Blob | null>(null);
  let cropOpen = $state(false);
  let exportOpen = $state(false);
  let exportBtn = $state<HTMLButtonElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  // Card tools (CHAR-11…17) read the card as it is on screen, saved or not.
  const cardNow = () => $state.snapshot(draft) as unknown as Record<string, unknown>;
  let pov = $state<"first" | "second" | "third">("third");
  let tense = $state<"present" | "past">("present");
  let notesOpen = $state(false);
  let rules = $state<{ before: string; after: string } | null>(null);
  let rulesOpen = $state(false);
  let drafting = $state(false);
  const LABELS: Record<string, string> = { name: "Name", description: "Description", personality: "Personality", scenario: "Scenario", first_mes: "First message", mes_example: "Example dialogue", creator_notes: "Creator notes" };

  function setField(field: string, text: string) {
    if (!draft) return;
    const alt = field.match(/^alt_(\d+)$/);
    if (alt) draft.alternate_greetings[Number(alt[1]) - 1] = text;
    else (draft as unknown as Record<string, unknown>)[field] = text;
  }

  async function draftRules() {
    if (!draft) return;
    drafting = true;
    try {
      const r = await post<{ text: string }>("/api/card-tools/rules", { card: cardNow() });
      rules = { before: draft.post_history_instructions, after: r.text };
      rulesOpen = true;
    } catch (e) {
      errorToast(e);
    } finally {
      drafting = false;
    }
  }

  const snapshot = () => JSON.stringify({ draft, tags, folder, mode, defaultPersonaId });
  const dirty = $derived(Boolean(draft) && snapshot() !== saved);

  async function load() {
    try {
      const c = await get<Character>(`/api/characters/${id}`);
      character = c;
      draft = structuredClone(c.card);
      tags = [...c.tags];
      folder = c.folder ?? "";
      mode = c.mode ?? "auto";
      defaultPersonaId = c.defaultPersonaId ?? "";
      tokens = c.tokens;
      saved = snapshot();
      doc = toDoc(c.card);
      const [p, ch, lib, g] = await Promise.all([
        get<{ personas: Persona[] }>("/api/personas"),
        get<{ chats: ChatListItem[] }>(`/api/chats?characterId=${id}`),
        get<{ tags: string[] }>("/api/characters"),
        get<{ mode: ChatMode; reasons: string[] }>(`/api/characters/${id}/mode-guess`),
      ]);
      personas = p.personas;
      chats = ch.chats;
      allTags = lib.tags;
      guess = g;
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void load();
  });

  $effect(() => {
    if (tab === "lore") get<{ lorebooks: LorebookSummary[] }>("/api/lorebooks").then((r) => (books = r.lorebooks));
    if (tab === "history") get<{ versions: typeof versions }>(`/api/characters/${id}/versions`).then((r) => (versions = r.versions));
    const url = new URL(location.href);
    url.searchParams.set("tab", tab);
    history.replaceState(history.state, "", url);
  });

  // Live token counts (CHAR-03).
  let tokenTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const card = draft ? $state.snapshot(draft) : null;
    if (!card) return;
    clearTimeout(tokenTimer);
    tokenTimer = setTimeout(async () => {
      try {
        tokens = await post<TokenCounts>("/api/characters/tokens", { card });
      } catch {
        // non-critical
      }
    }, 450);
  });

  const HEADINGS = ["Description", "Personality", "Scenario", "First message", "Example dialogue"] as const;
  const FIELD: Record<(typeof HEADINGS)[number], keyof CardData> = {
    Description: "description",
    Personality: "personality",
    Scenario: "scenario",
    "First message": "first_mes",
    "Example dialogue": "mes_example",
  };

  function toDoc(c: CardData) {
    return HEADINGS.map((h) => `# ${h}\n${(c[FIELD[h]] as string) ?? ""}`.trimEnd()).join("\n\n");
  }

  /** Markdown document mode with pinned headings (CHAR-02). */
  function applyDoc() {
    if (!draft) return;
    const re = new RegExp(`^# (${HEADINGS.join("|")})[ \\t]*$`, "gm");
    const found = [...doc.matchAll(re)];
    const names = found.map((m) => m[1]);
    const missing = HEADINGS.filter((h) => !names.includes(h));
    if (missing.length) {
      docError = `Keep every heading: missing “${missing.join("”, “")}”.`;
      return;
    }
    docError = "";
    found.forEach((m, i) => {
      const start = m.index! + m[0].length;
      const end = i + 1 < found.length ? found[i + 1]!.index! : doc.length;
      (draft as Record<string, unknown>)[FIELD[m[1] as (typeof HEADINGS)[number]]] = doc.slice(start, end).trim();
    });
  }

  function switchEditor(m: "form" | "document") {
    if (m === "document" && draft) doc = toDoc(draft);
    if (m === "form") applyDoc();
    editorMode = m;
    localStorage.setItem("mea.editorMode", m);
  }

  async function save() {
    if (!draft || saving) return;
    if (editorMode === "document") {
      applyDoc();
      if (docError) return;
    }
    if (!draft.name.trim()) {
      toast("Give your character a name first", { kind: "error" });
      return;
    }
    saving = true;
    try {
      const c = await put<Character>(`/api/characters/${id}`, {
        card: $state.snapshot(draft),
        tags: $state.snapshot(tags),
        folder: folder || null,
        mode: mode === "auto" ? null : mode,
        defaultPersonaId: defaultPersonaId || null,
      });
      character = c;
      tokens = c.tokens;
      saved = snapshot();
      toast("Saved ✿", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    } finally {
      saving = false;
    }
  }

  /** CHAR-18: the studio reads the saved card, so unsaved edits go first. */
  async function buildLore() {
    if (dirty) await save();
    navigate(`/lore-studio?character=${id}`);
  }

  /** Rework the card in the Creator Studio: its text is the starting idea, saving updates it. */
  async function rework() {
    try {
      if (dirty) await save();
      const r = await post<{ draft: { id: string } }>("/api/creator", { kind: "character", baseId: id });
      navigate(`/creator/${r.draft.id}`);
    } catch (e) {
      errorToast(e);
    }
  }

  async function newChat() {
    if (dirty) await save();
    try {
      const chat = await post<{ id: string }>("/api/chats", { characterId: id, personaId: defaultPersonaId || null });
      navigate(`/chat/${chat.id}`);
    } catch (e) {
      errorToast(e);
    }
  }

  async function deleteChat(c: ChatListItem) {
    if (!(await confirm({ title: "Move this chat to the trash?", message: "You can restore it from the trash for 30 days.", confirmLabel: "Move to trash", danger: true }))) return;
    try {
      await del(`/api/chats/${c.id}`);
    } catch (err) {
      errorToast(err);
      return;
    }
    chats = chats.filter((x) => x.id !== c.id);
    toast("Chat moved to trash", { action: { label: "Undo", run: async () => (await post(`/api/chats/${c.id}/restore`), void load()) } });
  }

  async function deleteCharacter() {
    if (!(await confirm({ title: `Move ${character?.name} to the trash?`, message: "Their chats stay; you can restore the character for 30 days.", confirmLabel: "Move to trash", danger: true }))) return;
    try {
      await del(`/api/characters/${id}`);
    } catch (err) {
      errorToast(err);
      return;
    }
    toast(`${character?.name} moved to trash`, { action: { label: "Undo", run: async () => (await post(`/api/characters/${id}/restore`), navigate(`/character/${id}`)) } });
    navigate("/");
  }

  async function onCropped(blob: Blob, img: HTMLImageElement) {
    cropOpen = false;
    try {
      const imageId = await uploadImage(blob, img);
      character = await put<Character>(`/api/characters/${id}`, { avatarId: imageId });
      toast("Portrait updated", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }

  async function setAvatar(imageId: string) {
    character = await put<Character>(`/api/characters/${id}`, { avatarId: imageId });
  }
  async function removeFromGallery(imageId: string) {
    if (!character) return;
    const gallery = character.gallery.filter((g) => g !== imageId);
    character = await put<Character>(`/api/characters/${id}`, { gallery, ...(character.avatarId === imageId ? { avatarId: gallery[0] ?? null } : {}) });
  }

  async function createLorebook() {
    const b = await post<{ id: string }>("/api/lorebooks", { name: `${draft?.name ?? "Character"} — lore`, links: [{ type: "character", id }] });
    navigate(`/lorebooks/${b.id}`);
  }
  async function link(bookId: string) {
    await post(`/api/lorebooks/${bookId}/links`, { type: "character", id });
    await load();
  }
  async function unlink(bookId: string) {
    await del(`/api/lorebooks/${bookId}/links`, { type: "character", id });
    await load();
  }
  async function restoreVersion(vid: string) {
    if (!(await confirm({ title: "Restore this version?", message: "Your current card is saved as a version first, so nothing is lost.", confirmLabel: "Restore" }))) return;
    character = await post<Character>(`/api/characters/${id}/versions/${vid}/restore`);
    await load();
    toast("Version restored", { kind: "ok" });
  }

  function addGreeting() {
    draft?.alternate_greetings.push("");
  }

  const exportItems: MenuItem[] = [
    { label: "PNG card (V2 + V3)", icon: ImageIcon, onclick: () => download(`/api/characters/${id}/export?format=png`) },
    { label: "JSON (V3)", icon: Download, onclick: () => download(`/api/characters/${id}/export?format=json&spec=v3`) },
    { label: "JSON (V2)", icon: Download, onclick: () => download(`/api/characters/${id}/export?format=json&spec=v2`) },
    { label: "CHARX", icon: Download, onclick: () => download(`/api/characters/${id}/export?format=charx`) },
  ];

  const tabs: { id: Tab; label: string }[] = [
    { id: "chats", label: "Chats" },
    { id: "card", label: "Card" },
    { id: "greetings", label: "Greetings" },
    { id: "voice", label: "Voice" },
    { id: "test", label: "Test" },
    { id: "variants", label: "Variants" },
    { id: "advanced", label: "Advanced" },
    { id: "images", label: "Images" },
    { id: "lore", label: "Lore" },
    { id: "history", label: "History" },
  ];

  const tk = (f: string) => (tokens?.fields[f] != null ? `${tokens.fields[f]} tokens` : "");
</script>

<svelte:window
  onkeydown={(e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  }}
  onbeforeunload={(e) => {
    if (dirty) e.preventDefault();
  }}
/>

{#if character && draft}
  <div class="page">
    <header class="hero" style:--c1={character.palette[0] ?? "var(--peach)"} style:--c2={character.palette[1] ?? "var(--lavender)"}>
      <button class="btn ghost icon back" onclick={() => navigate("/")} aria-label="Back"><ArrowLeft size={20} /></button>
      <button class="portrait" onclick={() => (tab = "images")} aria-label="Change portrait">
        <Avatar id={character.avatarId} name={draft.name} size={112} portrait shape="squircle" palette={character.palette} />
      </button>
      <div class="grow who">
        <h1 class="wraps">{draft.name || "Unnamed"}</h1>
        {#if draft.creator_notes}<p class="muted small notes">{draft.creator_notes.slice(0, 160)}</p>{/if}
        <div class="row wrap" style="margin-top:.5rem">
          {#if tokens}
            <span class="chip mint" title="Always in the prompt">{tokens.permanent} permanent tokens</span>
            <span class="chip butter" title="First message and examples">{tokens.temporary} temporary</span>
          {/if}
          {#each tags.slice(0, 4) as t (t)}<span class="chip lavender">{t}</span>{/each}
        </div>
      </div>
      <div class="actions row wrap">
        <button class="btn primary" onclick={newChat}><MessageHeart size={16} /> New chat</button>
        <button class="btn" onclick={rework} title="Expand, deepen and rewrite this card with the Creator Studio"><WandSparkles size={16} /> Rework</button>
        <button class="btn icon" bind:this={exportBtn} onclick={() => (exportOpen = true)} aria-label="Export"><Download size={18} /></button>
        <button class="btn icon" onclick={deleteCharacter} aria-label="Move to trash"><Trash size={18} /></button>
      </div>
    </header>

    <nav class="tabs" aria-label="Character sections">
      {#each tabs as t (t.id)}
        <button class:on={tab === t.id} onclick={() => (tab = t.id)}>{t.label}</button>
      {/each}
    </nav>

    <section class="content">
      {#if tab === "chats"}
        <div class="stack">
          {#each chats as c (c.id)}
            <div class="chatrow card">
              <a href="/chat/{c.id}" class="grow chatlink">
                <div class="row between"><b class="wraps">{c.title}</b><span class="tiny faint">{timeAgo(c.lastMessageAt)}</span></div>
                <p class="small muted wraps">{c.lastText}</p>
                <span class="tiny faint">{c.messageCount} messages · {c.mode}</span>
              </a>
              <button class="btn ghost icon small" onclick={() => deleteChat(c)} aria-label="Delete chat"><Trash size={16} /></button>
            </div>
          {:else}
            <div class="panel center">
              <p class="muted">No chats with {draft.name} yet.</p>
              <button class="btn primary" style="margin-top:.8rem" onclick={newChat}><MessageHeart size={16} /> Start the first one</button>
            </div>
          {/each}
        </div>
      {:else if tab === "card"}
        <div class="stack">
          <div class="row between wrap">
            <Segmented
              value={editorMode}
              options={[
                { value: "form", label: "Form" },
                { value: "document", label: "Document" },
              ]}
              onchange={(v) => switchEditor(v)}
              small
            />
            <div class="row">
              <button class="btn small" onclick={() => (notesOpen = true)} title="Paste messy notes; Mea sorts them into the fields">Sort my notes</button>
              <span class="tiny muted hide-sm">Ctrl+S saves</span>
            </div>
          </div>
          <label class="field"><span class="label">Name</span><input class="input" bind:value={draft.name} /></label>
          {#if editorMode === "form"}
            <label class="field"><span class="label">Description <span class="faint">{tk("description")}</span> <FieldTools kind="character" field="description" label="Description" text={draft.description} card={cardNow} {pov} {tense} onapply={(t) => setField("description", t)} /></span><textarea class="textarea story" use:autosize={600} bind:value={draft.description} placeholder="Who they are: appearance, history, how they speak…"></textarea></label>
            <label class="field"><span class="label">Personality <span class="faint">{tk("personality")}</span> <FieldTools kind="character" field="personality" label="Personality" text={draft.personality} card={cardNow} {pov} {tense} onapply={(t) => setField("personality", t)} /></span><textarea class="textarea story" use:autosize={400} bind:value={draft.personality} placeholder="A short summary of their personality"></textarea></label>
            <label class="field"><span class="label">Scenario <span class="faint">{tk("scenario")}</span> <FieldTools kind="character" field="scenario" label="Scenario" text={draft.scenario} card={cardNow} {pov} {tense} onapply={(t) => setField("scenario", t)} /></span><textarea class="textarea story" use:autosize={400} bind:value={draft.scenario} placeholder="Where and how the story begins"></textarea></label>
            <label class="field"><span class="label">Example dialogue <span class="faint">{tk("mes_example")}</span> <FieldTools kind="character" field="mes_example" label="Example dialogue" text={draft.mes_example} card={cardNow} {pov} {tense} onapply={(t) => setField("mes_example", t)} /></span><textarea class="textarea story" use:autosize={500} bind:value={draft.mes_example} placeholder={"<START>\n{{user}}: …\n{{char}}: …"}></textarea><span class="hint">Separate examples with &lt;START&gt;. They teach the voice; they aren't treated as events.</span></label>
          {:else}
            <label class="field">
              <span class="label">Card document <span class="faint">Keep the five headings</span></span>
              <textarea class="textarea story doc" use:autosize={2000} bind:value={doc} onblur={applyDoc}></textarea>
              {#if docError}<span class="notice error">{docError}</span>{/if}
            </label>
          {/if}
          <div class="row wrap">
            <label class="field grow"><span class="label">Tags</span><TagInput bind:value={tags} suggestions={allTags} /></label>
            <label class="field" style="min-width:12rem"><span class="label">Folder</span><input class="input" bind:value={folder} placeholder="None" /></label>
          </div>
          <div class="row wrap">
            <label class="field grow">
              <span class="label">Chat mode</span>
              <select class="select" bind:value={mode}>
                <option value="auto">Auto{guess ? ` (looks like ${guess.mode})` : ""}</option>
                <option value="companion">Companion · 1-on-1</option>
                <option value="narrator">Narrator · a world with many characters</option>
              </select>
            </label>
            <label class="field grow">
              <span class="label">Default persona</span>
              <select class="select" bind:value={defaultPersonaId}>
                <option value="">Use my default persona</option>
                {#each personas as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
              </select>
            </label>
          </div>
          <CardCheck kind="character" card={cardNow} labels={LABELS} {pov} onapply={setField} />
        </div>
      {:else if tab === "greetings"}
        <div class="stack">
          <GreetingWorkshop card={cardNow} bind:pov bind:tense onadd={(t) => draft?.alternate_greetings.push(t)} />
          <label class="field"><span class="label">First message <span class="faint">{tk("first_mes")}</span> <FieldTools kind="character" field="first_mes" label="First message" text={draft.first_mes} card={cardNow} {pov} {tense} onapply={(t) => setField("first_mes", t)} /></span><textarea class="textarea story" use:autosize={600} bind:value={draft.first_mes} placeholder="How the story opens"></textarea></label>
          {#each draft.alternate_greetings as _g, i (i)}
            <label class="field">
              <span class="label">Alternate greeting {i + 1} <FieldTools kind="character" field="alternate_greetings" label="Alternate greeting {i + 1}" text={draft.alternate_greetings[i] ?? ""} card={cardNow} {pov} {tense} onapply={(t) => setField(`alt_${i + 1}`, t)} /> <button class="btn ghost small danger" onclick={() => draft?.alternate_greetings.splice(i, 1)}>Remove</button></span>
              <textarea class="textarea story" use:autosize={600} bind:value={draft.alternate_greetings[i]}></textarea>
            </label>
          {/each}
          <button class="btn" onclick={addGreeting}><Plus size={16} /> Add an alternate greeting</button>
          <p class="tiny muted">In a new chat, alternate greetings appear as swipes on the first message.</p>
        </div>
      {:else if tab === "advanced"}
        <div class="stack">
          <label class="field"><span class="label">System prompt <span class="faint">{tk("system_prompt")}</span></span><textarea class="textarea" use:autosize={400} bind:value={draft.system_prompt} placeholder="Replaces the preset's main prompt. Use {'{{original}}'} to include it."></textarea></label>
          <label class="field">
            <span class="label">Rules (post-history instructions) <span class="faint">{tk("post_history_instructions")}</span> <button class="btn ghost small" onclick={(e) => (e.preventDefault(), draftRules())} disabled={drafting} title="A short re-anchor block this card carries, so it plays well with any preset">{drafting ? "Drafting…" : "Draft rules"}</button></span>
            <textarea class="textarea" use:autosize={{ max: 400, value: draft.post_history_instructions }} bind:value={draft.post_history_instructions} placeholder="Read after the chat history every turn. Start with {'{{original}}'} to keep the preset's own instructions."></textarea>
          </label>
          <label class="field"><span class="label">Creator notes</span><textarea class="textarea" use:autosize={400} bind:value={draft.creator_notes} placeholder="Not sent to the model"></textarea></label>
          <div class="row wrap">
            <label class="field grow"><span class="label">Creator</span><input class="input" bind:value={draft.creator} /></label>
            <label class="field grow"><span class="label">Version</span><input class="input" bind:value={draft.character_version} /></label>
          </div>
          <CharacterDefaults characterId={id} settings={character.settings} />
          {#if (mode === "auto" ? guess?.mode : mode) === "narrator"}<WorldAgency characterId={id} />{/if}
        </div>
      {:else if tab === "voice"}
        <VoiceLab characterId={id} card={cardNow} kept={character.settings?.voice?.kept ?? []} onexamples={(t) => draft && (draft.mes_example = [draft.mes_example.trim(), t].filter(Boolean).join("\n"))} />
      {:else if tab === "test"}
        <TestBench characterId={id} card={cardNow} mode={mode === "auto" ? undefined : mode} />
      {:else if tab === "variants"}
        <VariantsPanel ownerType="character" ownerId={id} base={() => character?.card as unknown as Record<string, unknown>} gallery={character.gallery} />
      {:else if tab === "images"}
        <div class="stack">
          <div class="row wrap">
            <button class="btn primary" onclick={() => fileInput?.click()}><ImageIcon size={16} /> Upload a portrait</button>
            <span class="tiny muted">You'll crop it to a 2:3 portrait. Mea doesn't generate images.</span>
            <input
              bind:this={fileInput}
              type="file"
              accept="image/*"
              hidden
              onchange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) {
                  cropFile = f;
                  cropOpen = true;
                }
                e.currentTarget.value = "";
              }}
            />
          </div>
          <div class="gallery">
            {#each character.gallery as g (g)}
              <div class="gimg" class:current={g === character.avatarId}>
                <Avatar id={g} name={draft.name} size={150} portrait shape="squircle" />
                <div class="row gact">
                  {#if g !== character.avatarId}<button class="btn small" onclick={() => setAvatar(g)}>Use</button>{:else}<span class="chip rose">Portrait</span>{/if}
                  <button class="btn ghost icon small" onclick={() => removeFromGallery(g)} aria-label="Remove image"><Trash size={14} /></button>
                </div>
              </div>
            {:else}
              <p class="muted small">No images yet.</p>
            {/each}
          </div>
        </div>
      {:else if tab === "lore"}
        <div class="stack">
          {#each character.lorebooks as b (b.id)}
            <div class="chatrow card">
              <a href="/lorebooks/{b.id}" class="grow chatlink row"><BookOpen size={18} /> <b>{b.name}</b></a>
              <button class="btn ghost small" onclick={() => unlink(b.id)}><Unlink size={14} /> Unlink</button>
            </div>
          {:else}
            <p class="muted small">No lorebooks are linked to {draft.name}. Linked books are active in all of their chats.</p>
          {/each}
          <div class="row wrap">
            <button class="btn primary" onclick={buildLore} title="Plan and draft their backstory, people and places with the Lore Studio"><WandSparkles size={16} /> Build a companion lorebook</button>
            <button class="btn" onclick={createLorebook}><Plus size={16} /> Empty lorebook</button>
            {#if books.filter((b) => !character?.lorebooks.some((l) => l.id === b.id)).length}
              <select class="select" style="width:auto" onchange={(e) => e.currentTarget.value && link(e.currentTarget.value)}>
                <option value="">Link an existing lorebook…</option>
                {#each books.filter((b) => !character?.lorebooks.some((l) => l.id === b.id)) as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
              </select>
            {/if}
          </div>
        </div>
      {:else if tab === "history"}
        <div class="stack tight">
          <p class="small muted"><History size={14} /> Every save keeps the previous card. Restoring keeps your current card as a version too.</p>
          {#each versions as v (v.id)}
            <div class="chatrow card">
              <div class="grow"><b>{v.name}</b> <span class="tiny muted">· {clock(v.createdAt)}{v.note ? ` · ${v.note}` : ""}</span></div>
              <button class="btn small" onclick={() => restoreVersion(v.id)}>Restore</button>
            </div>
          {:else}
            <p class="muted small">No earlier versions yet.</p>
          {/each}
        </div>
      {/if}
    </section>

    {#if dirty && tab !== "chats" && tab !== "images" && tab !== "lore" && tab !== "history"}
      <div class="savebar card">
        <span class="small">Unsaved changes</span>
        <button class="btn ghost small" onclick={() => load()}>Discard</button>
        <button class="btn primary small" onclick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
    {/if}
  </div>
{:else}
  <div class="page"><p class="muted" style="padding:3rem">Loading…</p></div>
{/if}

<NotesSorter bind:open={notesOpen} kind="character" card={cardNow} labels={LABELS} onapply={(f) => Object.entries(f).forEach(([k, v]) => setField(k, v))} />
{#if rules}<DiffModal bind:open={rulesOpen} title="Rules for this card" note="Read after the chat history every turn. {'{{original}}'} keeps the preset's own instructions first." before={rules.before} after={rules.after} onaccept={(t) => draft && (draft.post_history_instructions = t)} />{/if}
<Menu bind:open={exportOpen} items={exportItems} anchor={exportBtn} title="Export" />

<Modal bind:open={cropOpen} title="Crop portrait" size="md">
  {#if cropFile}
    <ImageCropper file={cropFile} aspect={2 / 3} outWidth={768} onconfirm={onCropped} oncancel={() => (cropOpen = false)} />
  {/if}
</Modal>

<style>
  .page {
    max-width: 58rem;
    margin: 0 auto;
    padding: 1.5rem clamp(1rem, 3vw, 2rem) 6rem;
  }
  .hero {
    display: flex;
    align-items: center;
    gap: 1.1rem;
    padding: 1.2rem;
    border-radius: var(--r-lg);
    background: linear-gradient(120deg, color-mix(in srgb, var(--c1) 30%, var(--surface)), color-mix(in srgb, var(--c2) 30%, var(--surface)));
    border: 1px solid var(--border);
    position: relative;
    flex-wrap: wrap;
  }
  .back {
    position: absolute;
    top: 0.6rem;
    left: 0.6rem;
  }
  .portrait {
    border: 0;
    padding: 0;
    background: none;
    cursor: pointer;
    border-radius: 28%;
    margin-left: 2rem;
  }
  .who h1 {
    font-size: 1.9rem;
  }
  .notes {
    margin-top: 0.3rem;
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    overflow-x: auto;
    margin: 1.1rem 0 1.2rem;
    padding-bottom: 0.2rem;
    scrollbar-width: none;
  }
  .tabs button {
    border: 0;
    background: none;
    padding: 0.55rem 0.95rem;
    border-radius: var(--r-pill);
    font: 700 var(--fs-sm) / 1 var(--font-ui);
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
  }
  .tabs button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-1);
  }
  .chatrow {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.75rem 0.9rem;
  }
  .chatlink {
    color: var(--text);
    text-decoration: none !important;
    display: grid;
    gap: 0.15rem;
    min-width: 0;
  }
  .center {
    text-align: center;
    padding: 2rem;
  }
  .doc {
    font-size: var(--fs-sm);
    line-height: 1.6;
  }
  .gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: 1rem;
  }
  .gimg {
    display: grid;
    gap: 0.4rem;
    justify-items: center;
  }
  .gimg.current :global(.avatar) {
    box-shadow: 0 0 0 3px var(--accent-strong);
  }
  .gact {
    gap: 0.3rem;
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
    animation: fade-up 0.25s var(--ease);
  }
  @media (min-width: 761px) {
    .savebar {
      left: calc(50% + var(--sidebar-w) / 2);
    }
  }
  @media (max-width: 760px) {
    .hero {
      flex-direction: column;
      text-align: center;
    }
    .portrait {
      margin-left: 0;
    }
    .who {
      width: 100%;
    }
    .who .row {
      justify-content: center;
    }
    .actions {
      justify-content: center;
    }
  }
</style>
