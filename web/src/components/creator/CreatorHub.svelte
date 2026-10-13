<script lang="ts">
  import { del, get, post } from "../../lib/api";
  import { confirm } from "../../lib/dialogs.svelte";
  import { timeAgo } from "../../lib/format";
  import { BookOpen, Globe2, Trash, UserPen, Users } from "../../lib/icons";
  import { navigate, route } from "../../lib/router.svelte";
  import { app, errorToast } from "../../lib/state.svelte";
  import type { CreatorDraft, CreatorDraftSummary, CreatorKind, LorebookSummary, StudioDraftSummary } from "../../lib/types";

  /** The Creator Studio's front door: characters, personas and worlds, and every draft in progress. */
  let kind = $state<CreatorKind | null>(null);
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
    if (!kind || !idea.trim()) return;
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
  const STAGE: Record<string, string> = { idea: "Idea", questions: "Questions", bible: "Bible", write: "Writing", done: "Saved", start: "Starting", plan: "Planning", review: "Writing & review" };
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
    <a class="kind card" href="/lore-studio">
      <span class="icon sky"><Globe2 size={18} /></span><b>A world</b><span class="tiny muted">A lorebook in the Lore Studio: from an idea, a card, a document or a book you have.</span>
    </a>
  </div>

  {#if kind}
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
