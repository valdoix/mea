<script lang="ts">
  import { del, get, post } from "../../../lib/api";
  import { confirm } from "../../../lib/dialogs.svelte";
  import { timeAgo } from "../../../lib/format";
  import { ArrowLeft, BookOpen, FileText, Lightbulb, Trash, Upload, UserPen, Users } from "../../../lib/icons";
  import { navigate, route } from "../../../lib/router.svelte";
  import { app, errorToast } from "../../../lib/state.svelte";
  import type { CharacterSummary, LorebookSummary, Persona, StudioDraft, StudioDraftSummary, StudioSourceKind } from "../../../lib/types";

  const SOURCES: { kind: StudioSourceKind; title: string; text: string; icon: typeof Lightbulb }[] = [
    { kind: "idea", title: "From an idea", text: "Describe a world in your own words. Mea asks what it needs, plans the entries with you, then writes them.", icon: Lightbulb },
    { kind: "character", title: "From a character", text: "A companion lorebook for a card: their past, the people in their life, the places they know.", icon: Users },
    { kind: "persona", title: "From a persona", text: "Lore for your own character: family, home, history, the things they carry.", icon: UserPen },
    { kind: "document", title: "From a document", text: "A setting bible, wiki page or notes (Markdown or text). Headings become entries and folders, with no model call.", icon: FileText },
    { kind: "book", title: "Grow a lorebook", text: "Find what an existing book is missing (names it mentions with no entry) and fill the gaps.", icon: BookOpen },
  ];

  let kind = $state<StudioSourceKind | null>(null);
  let text = $state("");
  let refId = $state("");
  let fileName = $state("");
  let creating = $state(false);
  let drafts = $state<StudioDraftSummary[]>([]);
  let characters = $state<CharacterSummary[]>([]);
  let personas = $state<Persona[]>([]);
  let books = $state<LorebookSummary[]>([]);
  let preview = $state<{ title: string; shape: string; overview: string; sections: { title: string; type: string | null; folder: string; words: number }[] } | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function load() {
    try {
      const [d, c, p, b] = await Promise.all([
        get<{ drafts: StudioDraftSummary[] }>("/api/lore-studio"),
        get<{ characters: CharacterSummary[] }>("/api/characters?sort=name"),
        get<{ personas: Persona[] }>("/api/personas"),
        get<{ lorebooks: LorebookSummary[] }>("/api/lorebooks"),
      ]);
      drafts = d.drafts;
      characters = c.characters;
      personas = p.personas;
      books = b.lorebooks;
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void app.libraryVersion;
    void load();
  });

  // Entry points elsewhere link here with the source picked: ?character=…, ?persona=…, ?book=…
  $effect(() => {
    const q = route.query;
    for (const k of ["character", "persona", "book"] as const)
      if (q[k]) {
        kind = k;
        refId = q[k]!;
      }
    if (q.kind === "idea" || q.kind === "document") kind = q.kind;
  });

  function pick(k: StudioSourceKind) {
    kind = k;
    refId = "";
    preview = null;
    if (k !== "idea") text = k === "document" ? text : "";
  }

  let previewTimer: ReturnType<typeof setTimeout>;
  function updatePreview() {
    clearTimeout(previewTimer);
    if (kind !== "document" || !text.trim()) {
      preview = null;
      return;
    }
    previewTimer = setTimeout(async () => {
      try {
        preview = await post("/api/lore-studio/parse", { text, fileName });
      } catch (e) {
        errorToast(e);
      }
    }, 400);
  }

  async function readFile(f: File) {
    if (f.size > 2_000_000) return errorToast(new Error("That file is over 2 MB. Split it into parts."));
    text = await f.text();
    fileName = f.name;
    updatePreview();
  }

  const ready = $derived(kind === "idea" || kind === "document" ? Boolean(text.trim()) : Boolean(refId));

  async function create() {
    if (!kind || !ready) return;
    creating = true;
    try {
      const r = await post<{ draft: StudioDraft }>("/api/lore-studio", { kind, text: text || undefined, refId: refId || undefined, fileName: fileName || undefined });
      navigate(`/lore-studio/${r.draft.id}`);
    } catch (e) {
      errorToast(e);
    } finally {
      creating = false;
    }
  }

  async function drop(d: StudioDraftSummary) {
    if (!(await confirm({ title: `Delete the draft “${d.title}”?`, message: d.committedBookId ? "The lorebook you saved from it stays." : "Nothing from it has been saved to a lorebook.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await del(`/api/lore-studio/${d.id}`);
      drafts = drafts.filter((x) => x.id !== d.id);
    } catch (e) {
      errorToast(e);
    }
  }

  const STAGE: Record<string, string> = { start: "Starting", questions: "Questions", plan: "Planning", review: "Writing & review", done: "Saved" };
  const KIND: Record<string, string> = { idea: "Idea", character: "Character", persona: "Persona", document: "Document", book: "Growing a book" };
</script>

<div class="page">
  <button class="btn ghost small" onclick={() => navigate("/lorebooks")}><ArrowLeft size={15} /> Lorebooks</button>
  <header>
    <h1>Lore Studio</h1>
    <p class="muted">Build a lorebook with Mea: start from an idea, a character, your persona, a document or a book you have. You plan it together, Mea drafts every entry, and nothing is saved until you've reviewed it.</p>
  </header>

  {#if drafts.length}
    <section class="stack tight">
      <h3>Continue</h3>
      <div class="drafts">
        {#each drafts as d (d.id)}
          <div class="draft card">
            <a class="grow" href="/lore-studio/{d.id}">
              <b class="truncate">{d.title}</b>
              <span class="tiny muted">{KIND[d.kind]}{d.refName ? `: ${d.refName}` : ""} · {STAGE[d.stage]} · {d.drafted}/{d.items} written{d.writing ? ` · writing ${d.writing}…` : ""} · {timeAgo(d.updatedAt)}</span>
            </a>
            <button class="btn ghost icon small" onclick={() => drop(d)} aria-label="Delete draft"><Trash size={14} /></button>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <section class="stack">
    <h3>Start something new</h3>
    <div class="sources">
      {#each SOURCES as s (s.kind)}
        <button class="source card" class:on={kind === s.kind} onclick={() => pick(s.kind)} aria-pressed={kind === s.kind}>
          <span class="icon"><s.icon size={18} /></span>
          <b>{s.title}</b>
          <span class="tiny muted">{s.text}</span>
        </button>
      {/each}
    </div>
  </section>

  {#if kind}
    <section class="panel stack form">
      {#if kind === "idea"}
        <label class="field">
          <span class="label">Your idea, in your own words <span class="faint">the more specific, the less generic the lore</span></span>
          <textarea class="textarea story" rows="6" bind:value={text} placeholder="A cold harbour town where the fog keeps secrets. The Salt Guild owns the docks, the lighthouse keeper owes them money, and every few winters a ship comes back with one sailor too many."></textarea>
        </label>
      {:else if kind === "character"}
        <label class="field">
          <span class="label">Character</span>
          <select class="select" bind:value={refId}><option value="">Choose…</option>{#each characters as c (c.id)}<option value={c.id}>{c.name}</option>{/each}</select>
        </label>
        <label class="field"><span class="label">Notes for the studio <span class="faint">optional</span></span><textarea class="textarea" rows="3" bind:value={text} placeholder="Focus on her family and the town; she has a brother who left."></textarea></label>
      {:else if kind === "persona"}
        <label class="field">
          <span class="label">Persona</span>
          <select class="select" bind:value={refId}><option value="">Choose…</option>{#each personas as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select>
        </label>
        <label class="field"><span class="label">Notes for the studio <span class="faint">optional</span></span><textarea class="textarea" rows="3" bind:value={text} placeholder="Where I grew up, who I left behind, what I carry."></textarea></label>
      {:else if kind === "book"}
        <label class="field">
          <span class="label">Lorebook</span>
          <select class="select" bind:value={refId}><option value="">Choose…</option>{#each books.filter((b) => !b.settings.chronicleFor) as b (b.id)}<option value={b.id}>{b.name} ({b.entryCount})</option>{/each}</select>
        </label>
        <label class="field"><span class="label">What's missing? <span class="faint">optional</span></span><textarea class="textarea" rows="3" bind:value={text} placeholder="More places outside the city, and the people who run the guilds."></textarea></label>
      {:else}
        <div class="row wrap">
          <button class="btn" onclick={() => fileInput?.click()}><Upload size={15} /> Choose a file</button>
          <span class="tiny muted">{fileName || "…or paste below. Markdown headings become entries; sub-headings become folders and parents."}</span>
          <input bind:this={fileInput} type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" hidden onchange={(e) => e.currentTarget.files?.[0] && readFile(e.currentTarget.files[0])} />
        </div>
        <textarea class="textarea mono doc" rows="8" bind:value={text} oninput={updatePreview} placeholder={"# The Salt Coast\nA cold coast of fishing towns.\n\n## Places\n### Port Ellis\nA harbour town under the lighthouse…"}></textarea>
        {#if preview}
          <div class="preview stack tight">
            <span class="small"><b>{preview.title}</b> · {preview.sections.length} entries {preview.shape === "headings" ? "from headings" : preview.shape === "glossary" ? "from a glossary" : "from paragraphs"}{preview.overview ? " · plus an overview" : ""}</span>
            <div class="sections">
              {#each preview.sections.slice(0, 60) as s, i (i)}
                <span class="tiny row"><span class="faint">{s.folder ? `${s.folder} › ` : ""}</span><b>{s.title}</b>{#if s.type}<span class="chip tiny">{s.type}</span>{/if}<span class="faint">{s.words} words</span></span>
              {/each}
              {#if preview.sections.length > 60}<span class="tiny faint">…and {preview.sections.length - 60} more</span>{/if}
            </div>
          </div>
        {/if}
      {/if}
      <div class="row between wrap">
        <span class="tiny muted">{kind === "document" ? "Your text is kept word for word; you can polish entries with the model later." : "Next: Mea reads it back and plans the entries with you. Nothing is saved to a lorebook yet."}</span>
        <button class="btn primary" onclick={create} disabled={!ready || creating}>{creating ? "Starting…" : "Start"}</button>
      </div>
    </section>
  {/if}
</div>

<style>
  .page {
    max-width: 56rem;
    margin: 0 auto;
    padding: 1.2rem clamp(1rem, 3vw, 2rem) 5rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.2rem;
  }
  header p {
    max-width: 42rem;
    margin: 0.3rem 0 0;
  }
  .drafts {
    display: grid;
    gap: 0.4rem;
  }
  .draft {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.6rem 0.55rem 0.9rem;
  }
  .draft a {
    display: grid;
    min-width: 0;
    color: var(--text);
    text-decoration: none;
  }
  .sources {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.7rem;
  }
  .source {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.9rem;
    text-align: left;
    font: inherit;
    color: var(--text);
    cursor: pointer;
    border: 2px solid transparent;
    transition: transform var(--t) var(--ease);
  }
  .source:hover {
    transform: translateY(-2px);
  }
  .source.on {
    border-color: var(--accent);
  }
  .icon {
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 30%;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--lavender) 45%, var(--surface));
  }
  .doc {
    font-size: var(--fs-xs);
  }
  .preview {
    border-top: 1px solid var(--border);
    padding-top: 0.6rem;
  }
  .sections {
    display: grid;
    gap: 0.15rem;
    max-height: 16rem;
    overflow: auto;
  }
  .sections .row {
    gap: 0.4rem;
    flex-wrap: wrap;
  }
</style>
