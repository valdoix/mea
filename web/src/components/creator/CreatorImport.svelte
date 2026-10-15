<script lang="ts">
  import { api, get, post } from "../../lib/api";
  import { BookOpen, Import, Loader, UserPen, Users } from "../../lib/icons";
  import { navigate } from "../../lib/router.svelte";
  import { errorToast } from "../../lib/state.svelte";
  import type { CharacterSummary, CreatorDraft } from "../../lib/types";

  /**
   * Bring something in to build from: a card (yours or a file) rebuilt as a character or a narrator,
   * a lorebook turned into a narrator card or mined for a character, or a persona made to play
   * opposite one of your characters. The original is never changed unless you choose to rework it.
   */
  type Treatment = { name: string; fields: { key: string; label: string; words: number; count?: number }[]; books: { id: string; name: string; entries: number }[]; mode: "companion" | "narrator"; treatment: "companion" | "narrator"; why: string };
  let characters = $state<CharacterSummary[]>([]);
  let busy = $state("");
  let pickId = $state("");
  let card = $state<{ id: string; t: Treatment } | null>(null);
  let book = $state<{ id: string; name: string } | null>(null);
  let asCopy = $state(true);
  let who = $state("");
  let oppositeId = $state("");

  $effect(() => {
    get<{ characters: CharacterSummary[] }>("/api/characters?sort=name")
      .then((r) => (characters = r.characters))
      .catch(() => {});
  });

  async function run<T>(label: string, fn: () => Promise<T>) {
    busy = label;
    try {
      return await fn();
    } catch (e) {
      errorToast(e);
      return undefined;
    } finally {
      busy = "";
    }
  }

  async function readCard(id: string) {
    book = null;
    const t = await run("read", () => get<Treatment>(`/api/creator/treatment/${id}`));
    if (t) card = { id, t };
  }

  async function upload(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const r = await run("upload", () => api<{ results: { ok: boolean; kind?: string; id?: string; name?: string; error?: string }[] }>("POST", "/api/import", form));
    const res = r?.results[0];
    if (!res) return;
    if (!res.ok) return errorToast(new Error(res.error ?? "Couldn't import that file"));
    // The original lands in your library first, untouched; the rebuild is a separate card.
    if (res.kind === "character" && res.id) await readCard(res.id);
    else if (res.kind === "lorebook" && res.id) {
      card = null;
      book = { id: res.id, name: res.name ?? "the lorebook" };
    } else errorToast(new Error(`That's a ${res.kind}; the creator builds from cards and lorebooks.`));
  }

  async function create(body: Record<string, unknown>) {
    const r = await run("create", () => post<{ draft: CreatorDraft }>("/api/creator", body));
    if (r) navigate(`/creator/${r.draft.id}`);
  }

  async function enrich() {
    if (!book) return;
    if (await run("enrich", () => post(`/api/lorebooks/${book!.id}/enrich`))) navigate(`/lorebooks/${book.id}`);
  }
</script>

<section class="panel stack">
  <h3><Import size={16} /> Build from something you have</h3>
  <div class="row wrap">
    <label class="btn small">{#if busy === "upload"}<span class="spin"><Loader size={13} /></span>{/if} Upload a card or lorebook<input type="file" accept=".png,.json,.charx" hidden onchange={upload} /></label>
    <span class="tiny muted">or</span>
    <select class="select mini" bind:value={pickId} onchange={() => pickId && readCard(pickId)} aria-label="One of your characters">
      <option value="">Rebuild one of your characters…</option>
      {#each characters as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
    </select>
  </div>

  {#if busy === "read"}<span class="tiny muted">Reading the card…</span>{/if}
  {#if card}
    <div class="stack tight result">
      <b>{card.t.name}</b>
      <div class="row wrap">
        {#each card.t.fields as f (f.key)}<span class="chip tiny" class:empty={!f.words}>{f.label}: {f.words ? `${f.words} words${f.count ? ` in ${f.count}` : ""}` : "empty"}</span>{/each}
        {#each card.t.books as b (b.id)}<span class="chip tiny"><BookOpen size={11} /> {b.name} · {b.entries}</span>{/each}
      </div>
      <span class="small">Suggested: <b>{card.t.treatment === "narrator" ? "Build as a narrator" : "Rebuild as a character"}</b>{#if card.t.why}{" "}<span class="muted">{card.t.why}</span>{/if}</span>
      <label class="switch tiny"><input type="checkbox" bind:checked={asCopy} /> Keep the original untouched (save the rebuild as a new card)</label>
      <div class="row wrap">
        {#each [{ mode: "companion", label: "Rebuild as a character" }, { mode: "narrator", label: "Build as a narrator" }] as o (o.mode)}
          <button class="btn small" class:primary={card.t.treatment === o.mode} onclick={() => create({ kind: "character", baseId: card!.id, asCopy, options: { mode: o.mode } })} disabled={Boolean(busy)}>{o.label}</button>
        {/each}
      </div>
      <span class="tiny muted">The read-back shows what the card actually establishes; the questions ask only about the gaps.</span>
    </div>
  {/if}

  {#if book}
    <div class="stack tight result">
      <b><BookOpen size={14} /> {book.name}</b>
      <div class="row wrap">
        <button class="btn small primary" onclick={() => create({ kind: "character", worldBookIds: [book!.id], options: { mode: "narrator" }, name: book!.name, idea: `A narrator for ${book!.name}: the world this lorebook describes, run as a story. Ask only what the lore can't answer: the premise, the tension, how the world treats {{user}}, and the narration's voice.` })} disabled={Boolean(busy)}>Build a narrator card from it</button>
        <button class="btn small" onclick={enrich} disabled={Boolean(busy)}>Enrich the entries</button>
        <a class="btn small ghost" href="/lorebooks/{book.id}">Keep it as it is</a>
      </div>
      <div class="row wrap">
        <input class="input slim grow" bind:value={who} placeholder="Mine a character from it: who? (a name in the book, or leave empty)" aria-label="Who to build" />
        <button class="btn small" onclick={() => create({ kind: "character", worldBookIds: [book!.id], idea: who.trim() ? `${who.trim()}, from ${book!.name}. Build them at full depth from what the lore says about them.` : `Someone from ${book!.name}: find the person the lore most wants on a card, and build them at full depth.` })} disabled={Boolean(busy)}><Users size={13} /> Generate a character</button>
      </div>
    </div>
  {/if}

  <div class="row wrap">
    <select class="select mini" bind:value={oppositeId} aria-label="Play opposite">
      <option value="">A persona to play opposite…</option>
      {#each characters as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
    </select>
    <button class="btn small" onclick={() => create({ kind: "persona", oppositeOf: { characterId: oppositeId } })} disabled={!oppositeId || Boolean(busy)}><UserPen size={13} /> Make that persona</button>
  </div>
</section>

<style>
  h3 {
    margin: 0;
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .result {
    border-top: 1px solid var(--border);
    padding-top: 0.6rem;
  }
  .chip.empty {
    opacity: 0.55;
  }
  .slim {
    padding: 0.3rem 0.5rem;
    font-size: var(--fs-sm);
  }
  .grow {
    flex: 1 1 14rem;
    min-width: 0;
  }
  .spin {
    display: inline-grid;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
