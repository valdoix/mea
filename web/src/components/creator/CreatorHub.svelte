<script lang="ts">
  import { del, get, post } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { timeAgo } from "../../lib/format";
  import { BookOpen, GitBranch, Globe2, Trash, UserPen, Users } from "../../lib/icons";
  import { navigate, route } from "../../lib/router.svelte";
  import { app, errorToast } from "../../lib/state.svelte";
  import { type CharacterSummary, type CreatorDraft, type CreatorDraftSummary, type CreatorKind, type LorebookSummary, type Persona, type StudioDraftSummary, VERSION_KINDS, type VersionKind } from "../../lib/types";
  import CreatorImport from "./CreatorImport.svelte";

  /** The Creator Studio's front door: characters, personas and worlds, and every draft in progress. */
  let kind = $state<CreatorKind | "version" | null>(null);
  // A version (docs/14): of which character or persona, what kind, and what it's called.
  let originKind = $state<CreatorKind>("character");
  let originId = $state("");
  let vkind = $state<VersionKind>("au");
  let vlabel = $state("");
  let characters = $state<CharacterSummary[]>([]);
  let personas = $state<Persona[]>([]);
  let universes = $state<{ id: string; name: string }[]>([]);
  let universeId = $state("");
  $effect(() => {
    if (kind !== "version" || characters.length || personas.length) return;
    Promise.all([get<{ characters: CharacterSummary[] }>("/api/characters?sort=name"), get<{ personas: Persona[] }>("/api/personas"), get<{ universes: { id: string; name: string }[] }>("/api/universes")]).then(([c, p, u]) => {
      characters = c.characters;
      personas = p.personas;
      universes = u.universes;
    }, errorToast);
  });

  async function startVersion() {
    if (!originId) return;
    creating = true;
    try {
      const r = await post<{ draft: CreatorDraft }>("/api/creator", { kind: originKind, baseId: originId, asVersion: { kind: vkind, label: vlabel.trim(), universeId: universeId || null }, idea: vlabel.trim() });
      navigate(`/creator/${r.draft.id}`);
    } catch (e) {
      errorToast(e);
    } finally {
      creating = false;
    }
  }
  let idea = $state("");
  let worldId = $state("");
  let creating = $state(false);
  let drafts = $state<CreatorDraftSummary[]>([]);
  let loreDrafts = $state<StudioDraftSummary[]>([]);
  let books = $state<LorebookSummary[]>([]);

  $effect(() => {
    void app.libraryVersion;
    Promise.all([get<{ drafts: CreatorDraftSummary[] }>("/api/creator"), get<{ drafts: StudioDraftSummary[] }>("/api/lore-studio"), get<{ lorebooks: LorebookSummary[] }>("/api/lorebooks")]).then(
      ([c, l, b]) => {
        drafts = c.drafts;
        loreDrafts = l.drafts;
        books = b.lorebooks.filter((x) => !x.settings.chronicleFor);
      },
      errorToast,
    );
  });
  $effect(() => {
    const q = route.query;
    if (q.kind === "character" || q.kind === "persona") kind = q.kind;
    if (q.world) worldId = q.world;
  });

  async function start() {
    if (!kind || kind === "version" || !idea.trim()) return;
    creating = true;
    try {
      const r = await post<{ draft: CreatorDraft }>("/api/creator", { kind, idea, worldBookIds: worldId ? [worldId] : [] });
      navigate(`/creator/${r.draft.id}`);
    } catch (e) {
      errorToast(e);
    } finally {
      creating = false;
    }
  }

  type Row = { id: string; href: string; title: string; kind: string; detail: string; updatedAt: number; lore: boolean };
  const STAGE: Record<string, string> = { idea: "Idea", questions: "Questions", map: "Map", bible: "Bible", write: "Writing", done: "Saved", start: "Starting", plan: "Planning", review: "Writing & review" };
  const rows = $derived<Row[]>(
    [
      ...drafts.map((d) => ({ id: d.id, href: `/creator/${d.id}`, title: d.name, kind: d.kind === "persona" ? "Persona" : "Character", detail: `${STAGE[d.stage]} · ${d.written}/${d.fields} fields${d.writing ? ` · writing ${d.writing}…` : ""}`, updatedAt: d.updatedAt, lore: false })),
      ...loreDrafts.map((d) => ({ id: d.id, href: `/lore-studio/${d.id}`, title: d.title, kind: "World", detail: `${STAGE[d.stage]} · ${d.drafted}/${d.items} entries${d.writing ? ` · writing ${d.writing}…` : ""}`, updatedAt: d.updatedAt, lore: true })),
    ].sort((a, b) => b.updatedAt - a.updatedAt),
  );

  async function drop(r: Row) {
    if (!(await confirm({ title: `Delete the draft “${r.title}”?`, message: "Anything you saved from it stays.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await del(r.lore ? `/api/lore-studio/${r.id}` : `/api/creator/${r.id}`);
      if (r.lore) loreDrafts = loreDrafts.filter((d) => d.id !== r.id);
      else drafts = drafts.filter((d) => d.id !== r.id);
    } catch (e) {
      errorToast(e);
    }
  }
</script>

<div class="page">
  <header>
    <h1>Creator Studio</h1>
    <p class="muted">Characters, personas and worlds, built with you rather than for you. Start from a few lines: Mea expands them, asks what it needs, writes a bible you can edit, then writes every field from it. They link to each other: a character lives in a world, a person in your lore becomes a card, a card gets its own lorebook.</p>
  </header>

  <div class="kinds">
    <button class="kind card" class:on={kind === "character"} onclick={() => (kind = "character")} aria-pressed={kind === "character"}>
      <span class="icon rose"><Users size={18} /></span><b>A character</b><span class="tiny muted">A card for someone to roleplay with, or a narrator for a whole world.</span>
    </button>
    <button class="kind card" class:on={kind === "persona"} onclick={() => (kind = "persona")} aria-pressed={kind === "persona"}>
      <span class="icon lavender"><UserPen size={18} /></span><b>A persona</b><span class="tiny muted">You, in the story: who you play, where you come from.</span>
    </button>
    <button class="kind card" class:on={kind === "version"} onclick={() => (kind = "version")} aria-pressed={kind === "version"}>
      <span class="icon butter"><GitBranch size={18} /></span><b>A version</b><span class="tiny muted">Someone you already have, in an alternate universe, another era, years later, or a what-if.</span>
    </button>
    <a class="kind card" href="/lore-studio">
      <span class="icon sky"><Globe2 size={18} /></span><b>A world</b><span class="tiny muted">A lorebook in the Lore Studio: from an idea, a card, a document or a book you have.</span>
    </a>
  </div>

  {#if kind === "version"}
    <section class="panel stack">
      <div class="row wrap">
        <label class="field"><span class="label">Of</span>
          <select class="select" bind:value={originKind} onchange={() => (originId = "")}>
            <option value="character">A character</option>
            <option value="persona">A persona</option>
          </select>
        </label>
        <label class="field grow"><span class="label">Who</span>
          <select class="select" bind:value={originId}>
            <option value="">Pick one…</option>
            {#each originKind === "character" ? characters : personas as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
          </select>
        </label>
      </div>
      <div class="row wrap">
        <label class="field grow"><span class="label">Called</span><input class="input" bind:value={vlabel} placeholder="College AU · Ten years later · The war never ended" maxlength="80" /></label>
        <label class="field"><span class="label">Kind</span>
          <select class="select" bind:value={vkind}>{#each VERSION_KINDS as k (k.id)}<option value={k.id}>{k.label}</option>{/each}</select>
        </label>
      </div>
      {#if universes.length}
        <label class="field"><span class="label">Universe</span>
          <select class="select" bind:value={universeId}>
            <option value="">A new one, just for this version</option>
            {#each universes as u (u.id)}<option value={u.id}>Join {u.name}</option>{/each}
          </select>
        </label>
      {/if}
      <div class="row"><span class="grow"></span><button class="btn primary" onclick={startVersion} disabled={creating || !originId}><GitBranch size={15} /> {creating ? "Starting…" : "Start the version"}</button></div>
    </section>
  {:else if kind}
    <section class="panel stack">
      <label class="field">
        <span class="label">{kind === "character" ? "Your character" : "Who you want to be"}, in your own words</span>
        <textarea class="textarea story" rows="5" bind:value={idea} placeholder={kind === "character" ? "The lighthouse keeper above Port Ellis. Dry, tired, kind in ways she hides. Owes the Salt Guild money and won't say why." : "A cartographer's apprentice who can't read her own maps anymore."}></textarea>
      </label>
      <label class="field">
        <span class="label">The world {kind === "persona" ? "you" : "they"} live in <span class="faint">optional; add more later</span></span>
        <select class="select" bind:value={worldId}><option value="">None yet</option>{#each books as b (b.id)}<option value={b.id}>{b.name} ({b.entryCount})</option>{/each}</select>
      </label>
      <div class="row between wrap">
        <span class="tiny muted">Next: expand the idea, answer a few questions, and review the bible. Nothing is saved as a {kind === "persona" ? "persona" : "card"} until you say so.</span>
        <button class="btn primary" onclick={start} disabled={creating || !idea.trim()}>{creating ? "Starting…" : "Start"}</button>
      </div>
    </section>
  {/if}

  <CreatorImport />

  {#if rows.length}
    <section class="stack tight">
      <h3>In progress</h3>
      {#each rows as r (r.id)}
        <div class="draft card">
          <a class="grow" href={r.href}>
            <b class="wraps">{r.title}</b>
            <span class="tiny muted"><span class="chip tiny">{r.kind}</span> {r.detail} · {timeAgo(r.updatedAt)}</span>
          </a>
          {#if r.lore}<BookOpen size={14} />{/if}
          <button class="btn ghost icon small" onclick={() => drop(r)} aria-label="Delete draft"><Trash size={14} /></button>
        </div>
      {/each}
    </section>
  {/if}
</div>

<style>
  .page {
    max-width: 56rem;
    margin: 0 auto;
    padding: 1.5rem clamp(1rem, 3vw, 2rem) 5rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.2rem;
  }
  header p {
    max-width: 44rem;
    margin: 0.3rem 0 0;
  }
  .kinds {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.7rem;
  }
  .kind {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.9rem;
    text-align: left;
    font: inherit;
    color: var(--text);
    cursor: pointer;
    text-decoration: none;
    border: 2px solid transparent;
    transition: transform var(--t) var(--ease);
  }
  .kind:hover {
    transform: translateY(-2px);
  }
  .kind.on {
    border-color: var(--accent);
  }
  .icon {
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 30%;
    display: grid;
    place-items: center;
  }
  .icon.rose {
    background: color-mix(in srgb, var(--accent) 35%, var(--surface));
  }
  .icon.lavender {
    background: color-mix(in srgb, var(--lavender) 45%, var(--surface));
  }
  .icon.sky {
    background: color-mix(in srgb, var(--sky) 45%, var(--surface));
  }
  .icon.butter {
    background: color-mix(in srgb, var(--butter) 45%, var(--surface));
  }
  .draft {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.6rem 0.55rem 0.9rem;
    color: var(--text-muted);
  }
  .draft a {
    display: grid;
    min-width: 0;
    color: var(--text);
    text-decoration: none;
  }
</style>
