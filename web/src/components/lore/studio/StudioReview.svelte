<script lang="ts">
  import Segmented from "../../Segmented.svelte";
  import { get, post } from "../../../lib/api";
  import { BookOpen, ClipboardCheck, ClockAlert, Globe, PenLine, RefreshCw, Square, X } from "../../../lib/icons";
  import { navigate } from "../../../lib/router.svelte";
  import { app, errorToast, toast } from "../../../lib/state.svelte";
  import type { StudioSession } from "../../../lib/studio.svelte";
  import type { CharacterSummary, LorebookSummary, Persona, StudioDraft } from "../../../lib/types";
  import { tick } from "svelte";
  import StudioItemCard from "./StudioItemCard.svelte";

  let { session }: { session: StudioSession } = $props();
  const draft = $derived(session.draft!);
  const review = $derived(session.review);
  let filter = $state<"all" | "look" | "unwritten">("all");
  let open = $state<Record<string, boolean>>({});

  const kept = $derived(draft.items.filter((i) => i.keep));
  const written = $derived(kept.filter((i) => i.entry));
  const working = $derived(draft.items.filter((i) => i.status === "queued" || i.status === "writing"));
  const current = $derived(draft.items.find((i) => i.status === "writing"));
  const unwritten = $derived(kept.filter((i) => !i.entry && i.status !== "queued" && i.status !== "writing"));
  const issuesOf = (id: string) => review?.issues[id] ?? [];
  const stale = $derived(review?.stale ?? {});
  const staleIds = $derived(kept.filter((i) => stale[i.id]?.length).map((i) => i.id));
  const staleWhy = $derived([...new Set(staleIds.flatMap((id) => stale[id] ?? []))]);
  let hidden = $state<Record<string, boolean>>({});
  const notes = $derived((draft.critique ?? []).filter((c) => !hidden[c.id]));
  const needsLook = (id: string) =>
    issuesOf(id).some((i) => i.severity === "warn") || draft.items.find((x) => x.id === id)?.status === "error" || (draft.consistency ?? []).some((c) => c.items.includes(id)) || notes.some((c) => c.items.includes(id)) || Boolean(stale[id]?.length);
  const KIND: Record<string, string> = { contradiction: "contradiction", flat: "flat", canon: "canon", keys: "keys", split: "two in one", gap: "missing" };
  const lookCount = $derived(kept.filter((i) => needsLook(i.id)).length);
  const shown = $derived(kept.filter((i) => (filter === "all" ? true : filter === "look" ? needsLook(i.id) : !i.entry)));
  const left = $derived(draft.items.filter((i) => !i.keep));
  const unsaved = $derived(written.filter((i) => !i.savedEntryId));
  const titleOf = (id: string) => draft.items.find((i) => i.id === id)?.title ?? "?";

  async function jump(id: string) {
    filter = "all";
    open[id] = true;
    await tick();
    document.getElementById(`studio-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // ---------- saving ----------
  let books = $state<LorebookSummary[]>([]);
  let characters = $state<CharacterSummary[]>([]);
  let personas = $state<Persona[]>([]);
  // svelte-ignore state_referenced_locally
  let dest = $state<"new" | "existing">(draft.targetBookId ? "existing" : "new");
  // svelte-ignore state_referenced_locally
  let bookId = $state(draft.targetBookId ?? "");
  let saving = $state(false);
  $effect(() => {
    void app.libraryVersion;
    Promise.all([get<{ lorebooks: LorebookSummary[] }>("/api/lorebooks"), get<{ characters: CharacterSummary[] }>("/api/characters?sort=name"), get<{ personas: Persona[] }>("/api/personas")]).then(
      ([b, c, p]) => {
        books = b.lorebooks.filter((x) => !x.settings.chronicleFor);
        characters = c.characters;
        personas = p.personas;
      },
      () => {},
    );
  });
  const isGlobal = $derived(draft.links.some((l) => l.type === "global"));
  const linkedChars = $derived(characters.filter((c) => draft.links.some((l) => l.type === "character" && l.id === c.id)));
  const linkedPersonas = $derived(personas.filter((p) => draft.links.some((l) => l.type === "persona" && l.id === p.id)));
  function setLink(type: "global" | "character" | "persona", id: string, on: boolean) {
    const rest = draft.links.filter((l) => !(l.type === type && l.id === id));
    draft.links = on ? [...rest, { type, id }] : rest;
    session.save({ links: $state.snapshot(draft.links) }, "links", 0);
  }

  // Once saved, more entries go into the same book (never a second copy).
  const savedId = $derived(draft.committedBookId ?? (draft.source.kind === "book" ? draft.targetBookId : null));
  const savedBook = $derived(savedId ? (books.find((b) => b.id === savedId) ?? { id: savedId, name: draft.title }) : null);
  const overviewNew = $derived(draft.options.overview && Boolean(draft.overview.trim()) && !draft.committedBookId);
  async function save() {
    saving = true;
    try {
      await session.flush();
      const r = await post<{ bookId: string; added: number; unlinked?: string[]; draft: StudioDraft }>(`/api/lore-studio/${session.id}/commit`, { bookId: savedId ?? (dest === "existing" ? bookId || null : null), name: draft.title, links: $state.snapshot(draft.links) });
      session.apply(r.draft);
      const unlinked = r.unlinked?.length ? ` · ${draft.version?.name} no longer uses ${r.unlinked.join(", ")}` : "";
      toast(`Saved ${r.added} entr${r.added === 1 ? "y" : "ies"}${unlinked}`, { kind: "ok", action: { label: "Open", run: () => navigate(`/lorebooks/${r.bookId}`) } });
    } catch (e) {
      errorToast(e);
    } finally {
      saving = false;
    }
  }
</script>

<section class="stack">
  <div class="panel stack tight progress">
    <div class="row between wrap">
      <b>{written.length} of {kept.length} written</b>
      <div class="row wrap">
        {#if working.length}
          <span class="tiny muted">{current ? `Writing “${current.title}”…` : "Starting…"} {working.length} to go</span>
          <button class="btn small" onclick={() => session.act("stop", "/stop")}><Square size={13} /> Stop</button>
        {:else if unwritten.length}
          <button class="btn small primary" onclick={() => session.act("write", "/write")} disabled={Boolean(session.busy)}><PenLine size={14} /> Write the other {unwritten.length}</button>
        {/if}
      </div>
    </div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={kept.length} aria-valuenow={written.length}><span style:width="{kept.length ? (written.length / kept.length) * 100 : 0}%"></span></div>
    {#if staleIds.length && !working.length}
      <div class="row wrap stale">
        <ClockAlert size={14} />
        <span class="small grow">{staleIds.length} entr{staleIds.length === 1 ? "y was" : "ies were"} written before you changed {staleWhy.join(", ")}.</span>
        <button class="btn small" onclick={() => session.act("write", "/write", { itemIds: staleIds, steer: "" })} disabled={Boolean(session.busy)}><RefreshCw size={13} /> Bring {staleIds.length === 1 ? "it" : "them"} up to date</button>
      </div>
    {/if}
    {#if review}
      <span class="tiny muted">{review.cost.entries} entries · {review.cost.totalTokens} tokens in all · always on {review.cost.alwaysOnTokens} · a fired entry averages {review.cost.averageTokens}</span>
    {/if}
  </div>

  <div class="row between wrap">
    <Segmented value={filter} options={[{ value: "all", label: `All ${kept.length}` }, { value: "look", label: `Needs a look ${lookCount}` }, { value: "unwritten", label: `Not written ${kept.length - written.length}` }]} onchange={(v) => (filter = v)} small />
    <button class="btn small" onclick={() => session.act("critique", "/critique")} disabled={Boolean(session.busy) || !written.length} title="Contradictions, flat writing, canon mistakes, weak keys, and who's missing"><ClipboardCheck size={14} /> {session.busy === "critique" ? "Reading every entry…" : "Editor's pass"}</button>
  </div>

  {#if draft.critique}
    <div class="panel stack tight">
      {#each notes as c (c.id)}
        <div class="small conflict">
          <div class="row wrap">
            <span class="chip tiny" class:rose={c.kind === "contradiction" || c.kind === "canon"} class:butter={c.kind === "gap"}>{KIND[c.kind] ?? c.kind}</span>
            <b class="grow">{c.problem}</b>
          </div>
          {#if c.fix}<div class="muted">{c.fix}</div>{/if}
          {#if c.add}<div class="tiny">Add: <b>{c.add.title}</b>{c.add.pitch ? ` · ${c.add.pitch}` : ""}</div>{/if}
          <div class="row wrap">
            {#each c.items as id (id)}<button class="link tiny" onclick={() => jump(id)}>{titleOf(id)}</button>{/each}
            <span class="grow"></span>
            <button class="btn ghost small" onclick={() => (hidden[c.id] = true)}>Dismiss</button>
            <button class="btn small" onclick={() => session.act(`critique:${c.id}`, `/critique/${c.id}`)} disabled={Boolean(session.busy)}>{c.add && !c.items.length ? "Add to the plan" : c.items.length > 1 ? `Rewrite ${c.items.length} with this fix` : "Apply the fix"}</button>
          </div>
        </div>
      {:else}
        <span class="tiny muted">The editor has no notes{draft.critique.length ? " left" : ""}.</span>
      {/each}
    </div>
  {/if}

  {#if draft.consistency}
    <div class="panel stack tight">
      {#each draft.consistency as c, k (k)}
        <div class="small conflict">
          <b>{c.problem}</b>{#if c.fix}{" "}<span class="muted">{c.fix}</span>{/if}
          <div class="row wrap">{#each c.items as id (id)}<button class="link tiny" onclick={() => jump(id)}>{titleOf(id)}</button>{/each}</div>
        </div>
      {:else}
        <span class="tiny muted">No contradictions found between the entries.</span>
      {/each}
    </div>
  {/if}

  <div class="items">
    {#each shown as it (it.id)}
      <StudioItemCard {session} item={it} issues={issuesOf(it.id)} stale={stale[it.id] ?? []} tokens={review?.tokens[it.id] ?? 0} bind:open={() => open[it.id] ?? false, (v) => (open[it.id] = v)} />
    {:else}
      <p class="muted small">{filter === "look" ? "Nothing needs a look." : filter === "unwritten" ? "Everything is written." : "Nothing planned yet. Go back to Plan."}</p>
    {/each}
  </div>

  {#if left.length}
    <details>
      <summary class="small muted">Left out ({left.length})</summary>
      <div class="items">{#each left as it (it.id)}<StudioItemCard {session} item={it} issues={[]} tokens={review?.tokens[it.id] ?? 0} bind:open={() => open[it.id] ?? false, (v) => (open[it.id] = v)} />{/each}</div>
    </details>
  {/if}

  <div class="panel stack savebox">
    <h3><BookOpen size={16} /> Save</h3>
    {#if draft.version}
      <span class="small">Saves into two lorebooks linked to {draft.version.name}'s version: its own (people, things, events) and its world's (places, groups, ideas, rules). {draft.version.originName}'s lorebooks stay as they are, and the version stops using them.</span>
      {#if draft.version.companionBookId || draft.version.worldBookId}
        <span class="tiny muted">Saved so far:{#if draft.version.companionBookId}{" "}<a href="/lorebooks/{draft.version.companionBookId}">its own</a>{/if}{#if draft.version.worldBookId}{" "}<a href="/lorebooks/{draft.version.worldBookId}">its world</a>{/if}. Only new entries are added.</span>
      {/if}
    {:else if savedBook}
      <span class="small">Saving into <a href="/lorebooks/{savedBook.id}">{savedBook.name}</a>. Entries saved before stay as they are; only new ones are added.</span>
    {:else if draft.source.kind !== "book"}
      <div class="row wrap">
        <Segmented value={dest} options={[{ value: "new", label: "A new lorebook" }, { value: "existing", label: "Add to one I have" }]} onchange={(v) => (dest = v)} small />
        {#if dest === "new"}<span class="tiny muted">Named “{draft.title}”; rename it at the top.</span>{/if}
      </div>
    {/if}
    {#if dest === "existing" && !savedBook && !draft.version}
      <select class="select" bind:value={bookId} aria-label="Lorebook">
        <option value="">Choose…</option>
        {#each books as b (b.id)}<option value={b.id}>{b.name} ({b.entryCount})</option>{/each}
      </select>
    {/if}
    {#if !draft.version}
    <div class="stack tight">
      <span class="label">Where it applies</span>
      <label class="switch"><input type="checkbox" checked={isGlobal} onchange={(e) => setLink("global", "", e.currentTarget.checked)} /> <Globe size={14} /> Every chat</label>
      <div class="row wrap">
        <span class="tiny muted lbl">Characters</span>
        {#each linkedChars as c (c.id)}<span class="chip rose">{c.name}<button class="x" onclick={() => setLink("character", c.id, false)} aria-label="Unlink {c.name}"><X size={11} /></button></span>{/each}
        <select class="select mini" onchange={(e) => { if (e.currentTarget.value) { setLink("character", e.currentTarget.value, true); e.currentTarget.value = ""; } }} aria-label="Add a character">
          <option value="">Add…</option>
          {#each characters.filter((c) => !linkedChars.includes(c)) as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </div>
      <div class="row wrap">
        <span class="tiny muted lbl">Personas</span>
        {#each linkedPersonas as p (p.id)}<span class="chip lavender">{p.name}<button class="x" onclick={() => setLink("persona", p.id, false)} aria-label="Unlink {p.name}"><X size={11} /></button></span>{/each}
        <select class="select mini" onchange={(e) => { if (e.currentTarget.value) { setLink("persona", e.currentTarget.value, true); e.currentTarget.value = ""; } }} aria-label="Add a persona">
          <option value="">Add…</option>
          {#each personas.filter((p) => !linkedPersonas.includes(p)) as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
      </div>
      {#if !draft.links.length}<span class="tiny muted">Not linked anywhere yet: it won't fire until you link it here or in the lorebook.</span>{/if}
    </div>
    {/if}
    <div class="row between wrap">
      <span class="tiny muted">{unsaved.length} new entr{unsaved.length === 1 ? "y" : "ies"}{overviewNew ? " + the overview" : ""}{working.length ? ". Entries still being written can be saved later." : ""}{lookCount ? ` · ${lookCount} need a look` : ""}</span>
      <button class="btn primary" onclick={save} disabled={saving || (!unsaved.length && !overviewNew) || (!draft.version && !savedId && dest === "existing" && !bookId)}>{saving ? "Saving…" : draft.committedBookId ? "Save the new entries" : "Save the lorebook"}</button>
    </div>
  </div>
</section>

<style>
  .progress .bar {
    height: 0.4rem;
    border-radius: var(--r-pill);
    background: var(--border);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.4s var(--ease);
  }
  .items {
    display: grid;
    gap: 0.5rem;
  }
  details .items {
    margin-top: 0.5rem;
  }
  .stale {
    gap: 0.5rem;
    align-items: center;
    padding: 0.45rem 0.6rem;
    border-radius: 8px;
    background: color-mix(in srgb, var(--butter, #f5d77a) 18%, transparent);
  }
  .conflict {
    border-top: 1px solid var(--border);
    padding-top: 0.35rem;
  }
  .conflict:first-child {
    border-top: 0;
    padding-top: 0;
  }
  .link {
    border: 0;
    background: none;
    color: var(--accent-ink);
    cursor: pointer;
    padding: 0 0.25rem 0 0;
    text-decoration: underline;
  }
  .lbl {
    min-width: 5rem;
    font-weight: 700;
  }
  .mini {
    width: auto;
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
    font-size: var(--fs-xs);
  }
  .x {
    border: 0;
    background: none;
    display: grid;
    place-items: center;
    cursor: pointer;
    color: inherit;
    padding: 0;
  }
  .savebox h3 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
  }
</style>
