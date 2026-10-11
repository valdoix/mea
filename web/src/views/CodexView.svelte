<script lang="ts">
  import OffpageEditor from "../components/chat/OffpageEditor.svelte";
  import { editOffpage, offpageAction, offpageFor, watchOffpage } from "../lib/offpage.svelte";
  import EntityPage from "../components/codex/EntityPage.svelte";
  import Modal from "../components/Modal.svelte";
  import Segmented from "../components/Segmented.svelte";
  import { get, post } from "../lib/api";
  import { ArrowLeft, BookOpen, Check, GraduationCap, Merge, MapPin, MessagesSquare, Package, RefreshCw, ShieldCheck, Sparkles, Users, X } from "../lib/icons";
  import { openMeusIn } from "../lib/meus.svelte";
  import { navigate } from "../lib/router.svelte";
  import { errorToast, toast } from "../lib/state.svelte";
  import type { ChronicleProposal, Codex, CodexEntity, Entity, Journal, PromiseEntry, QuizRun, SecretEntry } from "../lib/types";

  let { id }: { id: string } = $props();

  type Tab = "people" | "places" | "things" | "timeline" | "threads" | "ledgers" | "journals" | "chronicle" | "checks";
  let tab = $state<Tab>((new URLSearchParams(location.search).get("tab") as Tab) ?? "people");
  let codex = $state<Codex | null>(null);
  let open = $state<string | null>(null);
  let q = $state("");

  async function load() {
    try {
      codex = await get<Codex>(`/api/chats/${id}/codex`);
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void load();
  });

  const match = (e: CodexEntity) => !q.trim() || `${e.name} ${e.aliases.join(" ")} ${e.card}`.toLowerCase().includes(q.trim().toLowerCase());
  const everyone = $derived(codex ? [...codex.cast, ...codex.places, ...codex.objects, ...codex.groups, ...codex.concepts].map((e) => ({ id: e.id, name: e.name, kind: e.kind })) : []);

  // ---------- ledgers (MEM-30, MEM-31) ----------
  let promises = $state<PromiseEntry[]>([]);
  let secrets = $state<SecretEntry[]>([]);
  async function loadLedgers() {
    try {
      const r = await get<{ promises: PromiseEntry[]; secrets: SecretEntry[] }>(`/api/chats/${id}/ledgers`);
      promises = r.promises;
      secrets = r.secrets;
    } catch (e) {
      errorToast(e);
    }
  }
  async function mark(p: PromiseEntry, status: PromiseEntry["status"]) {
    try {
      await post(`/api/chats/${id}/promises/mark`, { key: p.key, status });
      await loadLedgers();
    } catch (e) {
      errorToast(e);
    }
  }
  let revealing = $state<SecretEntry | null>(null);
  let revealTo = $state("");
  let revealHow = $state("");
  async function reveal() {
    if (!revealing || !revealTo.trim()) return;
    try {
      await post(`/api/chats/${id}/secrets/reveal`, { key: revealing.key, to: revealTo.trim(), how: revealHow.trim() || undefined });
      revealing = null;
      revealTo = revealHow = "";
      await loadLedgers();
    } catch (e) {
      errorToast(e);
    }
  }

  // ---------- journals (MEM-29) ----------
  let journals = $state<Journal[]>([]);
  let subjects = $state<string[]>([]);
  async function loadJournals() {
    try {
      const r = await get<{ journals: Journal[]; subjects: string[] }>(`/api/chats/${id}/journals`);
      journals = r.journals;
      subjects = r.subjects;
    } catch (e) {
      errorToast(e);
    }
  }
  async function writeJournal(name: string) {
    try {
      toast(`Writing ${name}'s journal…`);
      await post(`/api/chats/${id}/journals/rebuild`, { name, fromScratch: true });
      await loadJournals();
    } catch (e) {
      errorToast(e);
    }
  }

  // ---------- chronicle (LORE-12) ----------
  let proposals = $state<ChronicleProposal[]>([]);
  let editingProp = $state<ChronicleProposal | null>(null);
  async function loadChronicle() {
    try {
      proposals = (await get<{ proposals: ChronicleProposal[] }>(`/api/chats/${id}/chronicle`)).proposals;
    } catch (e) {
      errorToast(e);
    }
  }
  async function findNew() {
    try {
      const r = await post<{ proposals: ChronicleProposal[] }>(`/api/chats/${id}/chronicle/run`);
      toast(r.proposals.length ? `${r.proposals.length} new ${r.proposals.length === 1 ? "entry" : "entries"} proposed` : "Nothing new to propose");
      await loadChronicle();
    } catch (e) {
      errorToast(e);
    }
  }
  async function accept(p: ChronicleProposal) {
    try {
      await post(`/api/chronicle/${p.id}/accept`, { comment: p.entry.comment, keys: p.entry.keys, content: p.entry.content });
      editingProp = null;
      toast(`“${p.entry.comment}” added to the Chronicle`, { kind: "ok" });
      await loadChronicle();
    } catch (e) {
      errorToast(e);
    }
  }
  async function reject(p: ChronicleProposal) {
    try {
      await post(`/api/chronicle/${p.id}/reject`);
      await loadChronicle();
    } catch (e) {
      errorToast(e);
    }
  }

  /** Meus checks each pair against the story and proposes the merges that are real. */
  function askAboutDupes() {
    openMeusIn(id, `The Codex thinks these might be the same: ${dupes.map((d) => `${d.merge.name} ≈ ${d.keep.name}`).join("; ")}. Check each against the story and sort them out (merge the cast entries and pages that really are one).`, true);
    navigate(`/chat/${id}`);
  }

  // ---------- checks: quiz (MEM-46), sleep (MEM-42), reconcile (SUM-22), duplicates (MEM-28) ----------
  let runs = $state<QuizRun[]>([]);
  let quizBusy = $state(false);
  let sleepReport = $state<Record<string, number> | null>(null);
  let reconcile = $state<{ id: string; title: string; startSeq: number; issues: { kind: string; message: string; severity: string }[] }[]>([]);
  let dupes = $state<{ keep: Entity; merge: Entity; reason: string }[]>([]);
  async function loadChecks() {
    try {
      const [r, c, d, s] = await Promise.all([
        get<{ runs: QuizRun[] }>(`/api/chats/${id}/quiz`),
        get<{ scenes: typeof reconcile }>(`/api/chats/${id}/reconcile`),
        get<{ suggestions: typeof dupes }>(`/api/chats/${id}/entities/duplicates`),
        get<{ report: Record<string, number> | null }>(`/api/chats/${id}/consolidate`),
      ]);
      runs = r.runs;
      reconcile = c.scenes;
      dupes = d.suggestions;
      sleepReport = s.report;
    } catch (e) {
      errorToast(e);
    }
  }
  async function runQuiz() {
    quizBusy = true;
    try {
      const r = await post<QuizRun>(`/api/chats/${id}/quiz`, { n: 8, answers: true });
      runs = [r, ...runs];
    } catch (e) {
      errorToast(e);
    } finally {
      quizBusy = false;
    }
  }
  async function sleepNow() {
    try {
      const r = await post<{ report: Record<string, number> }>(`/api/chats/${id}/consolidate`);
      sleepReport = r.report;
      toast("Memory tidied", { kind: "ok" });
      await load();
    } catch (e) {
      errorToast(e);
    }
  }
  async function mergePair(keep: string, other: string) {
    try {
      await post(`/api/entities/${keep}/merge`, { ids: [other] });
      await Promise.all([loadChecks(), load()]);
    } catch (e) {
      errorToast(e);
    }
  }

  $effect(() => {
    if (tab === "ledgers") void loadLedgers();
    else if (tab === "journals") void loadJournals();
    else if (tab === "chronicle") void loadChronicle();
    else if (tab === "checks") void loadChecks();
  });
  const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
  // B1: secrets kept off the page, from here too.
  $effect(() => watchOffpage(id));
</script>

<div class="page">
  <div class="row head">
    <a class="btn ghost icon" href="/chat/{id}" aria-label="Back to the chat"><ArrowLeft size={18} /></a>
    <h1 class="grow">Codex</h1>
    {#if ["people", "places", "things"].includes(tab)}<input class="input search" bind:value={q} placeholder="Find…" aria-label="Find in the codex" />{/if}
  </div>
  <div class="tabs">
    <Segmented
      bind:value={tab}
      small
      options={[
        { value: "people" as const, label: "People" },
        { value: "places" as const, label: "Places" },
        { value: "things" as const, label: "Things" },
        { value: "timeline" as const, label: "Timeline" },
        { value: "threads" as const, label: "Threads" },
        { value: "ledgers" as const, label: "Promises & secrets" },
        { value: "journals" as const, label: "Journals" },
        { value: "chronicle" as const, label: "Chronicle" },
        { value: "checks" as const, label: "Checks" },
      ]}
    />
  </div>

  {#if codex?.story && (tab === "people" || tab === "timeline")}
    <section class="card story">
      <div class="label">{codex.story.title || "The story so far"}</div>
      <p class="small">{codex.story.summary.split("\n")[0]}</p>
    </section>
  {/if}

  {#if !codex}
    <p class="muted">Loading…</p>
  {:else if tab === "people" || tab === "places" || tab === "things"}
    {@const list = (tab === "people" ? codex.cast : tab === "places" ? codex.places : [...codex.objects, ...codex.groups, ...codex.concepts]).filter(match)}
    <div class="cards">
      {#each list as e (e.id)}
        <button class="ent card" class:dead={e.status === "dead" || e.status === "gone"} onclick={() => (open = e.id)}>
          <div class="row ent-head">
            {#if e.kind === "person"}<Users size={15} />{:else if e.kind === "place"}<MapPin size={15} />{:else}<Package size={15} />{/if}
            <b class="ent-name" title={e.name}>{e.name}</b>
            {#if e.status !== "active"}<span class="chip tiny">{e.status}</span>{/if}
            {#if e.isUser}<span class="chip tiny">you</span>{/if}
            {#if e.userEdited}<span class="chip tiny mint">yours</span>{/if}
          </div>
          <div class="tiny muted clamp">{e.card}</div>
          <div class="tiny faint">{e.facts} facts · {e.mentions} mentions{e.journal ? " · journal" : ""}{e.path ? ` · ${e.path.slice(0, -1).join(" › ")}` : ""}</div>
        </button>
      {:else}
        <p class="muted small">Nothing here yet. The codex fills in as the trackers and memory meet {tab === "people" ? "people" : tab === "places" ? "places" : "things"}.</p>
      {/each}
    </div>
  {:else if tab === "timeline"}
    <div class="stack">
      {#each codex.timeline as ch (ch.id)}
        <section class="card chapter">
          <div class="row between"><b>{ch.title}</b><span class="tiny faint">#{ch.startSeq}–#{ch.endSeq ?? "…"}{ch.storyTime ? ` · ${ch.storyTime}` : ""}</span></div>
          {#if ch.summary}<p class="small muted">{ch.summary}</p>{/if}
          {#each ch.scenes as s (s.id)}
            <a class="scene" href="/chat/{id}?at={s.startSeq}"><span class="tiny faint">#{s.startSeq}</span> <span class="small">{s.title || "Scene"}</span>{#if s.storyTime}{" "}<span class="tiny muted">· {s.storyTime}</span>{/if}</a>
          {/each}
        </section>
      {/each}
      {#if codex.unfiled.length}
        <section class="card chapter">
          <b>Not in a chapter yet</b>
          {#each codex.unfiled as s (s.id)}
            <a class="scene" href="/chat/{id}?at={s.startSeq}"><span class="tiny faint">#{s.startSeq}</span> <span class="small">{s.title || "Scene"}</span></a>
          {/each}
        </section>
      {/if}
      {#if codex.milestones.length}
        <section class="card chapter">
          <b>Milestones</b>
          {#each codex.milestones as m, i (i)}<a class="scene" href="/chat/{id}?at={m.seq}"><span class="tiny faint">#{m.seq}</span> <span class="small">{m.text}</span></a>{/each}
        </section>
      {/if}
      {#if !codex.timeline.length && !codex.unfiled.length}<p class="muted small">Scenes and chapters appear here as memory records them.</p>{/if}
    </div>
  {:else if tab === "threads"}
    <div class="stack">
      {#each codex.threads.tracked as t (t.id)}
        <div class="card thread">
          <div class="row"><span class="chip tiny" class:mint={t.status === "resolved"}>{t.status}</span><b class="grow">{t.title}</b><a class="tiny" href="/chat/{id}?at={t.lastSeq}">#{t.lastSeq}</a></div>
          {#if t.latest}<div class="tiny muted">{t.latest}</div>{/if}
        </div>
      {/each}
      {#if codex.threads.fromRecords.length}
        <section class="card thread">
          <b class="small">Still open, according to the latest records</b>
          {#each codex.threads.fromRecords as t, i (i)}<div class="small">· {t}</div>{/each}
        </section>
      {/if}
      {#if codex.relationships.length}
        <section class="card thread">
          <b class="small">Relationships</b>
          {#each codex.relationships as r, i (i)}<div class="small">{r.fromName} → {r.toName} <span class="muted">· {r.label}</span></div>{/each}
        </section>
      {/if}
      {#if !codex.threads.tracked.length && !codex.threads.fromRecords.length}<p class="muted small">Open threads, mysteries and plans show up here.</p>{/if}
    </div>
  {:else if tab === "ledgers"}
    <section class="stack tight">
      <h2>Promises</h2>
      {#each promises as p (p.key)}
        <div class="card ledger" class:done={p.status !== "pending"}>
          <div class="grow">
            <div class="small"><b>{p.who ?? "?"}</b> → <b>{p.whom ?? "?"}</b>: {p.what}</div>
            <div class="tiny faint">{p.kind}{p.due ? ` · due ${p.due}` : ""}{p.messageId ? "" : ""}{p.markedBy === "you" ? " · marked by you" : ""}</div>
          </div>
          {#if p.messageId}<a class="tiny" href="/chat/{id}?m={p.messageId}">#{p.seq}</a>{/if}
          <select class="select mini" value={p.status} onchange={(ev) => mark(p, ev.currentTarget.value as PromiseEntry["status"])} aria-label="Status">
            <option value="pending">pending</option><option value="kept">kept</option><option value="broken">broken</option>
          </select>
        </div>
      {:else}
        <p class="tiny muted">No promises yet.</p>
      {/each}
      <h2>Secrets</h2>
      {#each secrets as s (s.key)}
        {@const op = offpageFor(s.key)}
        <div class="card ledger">
          <div class="grow">
            <div class="small">{s.statement}</div>
            <div class="tiny muted">
              {#if s.keepers.length}Kept by {s.keepers.join(", ")}{/if}{#if s.hiddenFrom.length} · from {s.hiddenFrom.join(", ")}{/if}
              {#each s.revealed as r, i (i)} · revealed to {r.to.join(", ")}{#if r.messageId} (<a href="/chat/{id}?m={r.messageId}">#{r.seq}</a>){/if}{/each}
            </div>
            {#if s.knows.length}<div class="tiny faint">{s.knows.map((k) => `${k.name}: ${k.status}`).join(" · ")}</div>{/if}
          </div>
          <label class="switch tiny offp" title="Hold it back from the narration itself">
            <input type="checkbox" checked={Boolean(op)} onchange={(e) => (e.currentTarget.checked ? editOffpage(null, { label: s.statement, ref: s.key }) : op && void offpageAction(op, "delete"))} />
            {op ? "🔒 Off the page" : "Keep off the page"}
          </label>
          {#if op}<button class="btn ghost small" onclick={() => editOffpage(op)}>Words &amp; reveal</button>{/if}
          <button class="btn ghost small" onclick={() => ((revealing = s), (revealTo = ""))}>Revealed…</button>
        </div>
      {:else}
        <p class="tiny muted">No secrets yet.</p>
      {/each}
    </section>
  {:else if tab === "journals"}
    <p class="tiny muted">First-person memories, condensed after each scene: what each of them saw, feels and keeps to themselves. The main character's journal rides with the Story So Far in the prompt.</p>
    <div class="cards wide">
      {#each subjects as name (name)}
        {@const j = journals.find((x) => x.name.toLowerCase() === name.toLowerCase())}
        {@const ent = everyone.find((x) => x.name.toLowerCase() === name.toLowerCase())}
        <div class="card journal">
          <div class="row between"><b>{name}</b>{#if j?.proposal}<span class="chip tiny warn">new version waiting</span>{/if}</div>
          {#if j}
            <p class="small pre">{j.content}</p>
            <div class="row"><span class="tiny faint grow">through #{j.throughSeq} · {j.tokens} tokens{j.userEdited ? " · yours" : ""}</span>
              {#if ent}<button class="btn ghost small" onclick={() => (open = ent.id)}>Open</button>{/if}
            </div>
          {:else}
            <p class="tiny muted">Not written yet.</p>
            <button class="btn small" onclick={() => writeJournal(name)}>Write it now</button>
          {/if}
        </div>
      {/each}
    </div>
  {:else if tab === "chronicle"}
    <div class="row between">
      <p class="tiny muted">People, places and things this story introduced that no lorebook covers yet. Mea proposes; you decide. Accepted entries go to this chat's Chronicle book and fire when they're in the scene.</p>
      <button class="btn small" onclick={findNew}><Sparkles size={14} /> Look for new ones</button>
    </div>
    <div class="stack">
      {#each proposals as p (p.id)}
        <div class="card prop">
          <div class="row"><BookOpen size={15} /><b class="grow">{p.entry.comment}</b><span class="chip tiny">{String(p.entry.extra.type ?? "")}</span></div>
          <div class="tiny muted">Keys: {p.entry.keys.join(", ")}</div>
          <p class="small pre">{p.entry.content}</p>
          <div class="row">
            <button class="btn small primary" onclick={() => accept(p)}><Check size={14} /> Add</button>
            <button class="btn small" onclick={() => (editingProp = structuredClone($state.snapshot(p)))}>Edit first</button>
            <button class="btn small ghost" onclick={() => reject(p)}><X size={14} /> Not needed</button>
          </div>
        </div>
      {:else}
        <p class="muted small">No proposals waiting.</p>
      {/each}
    </div>
  {:else if tab === "checks"}
    <section class="card check">
      <div class="row between"><h2><GraduationCap size={17} /> Memory quiz</h2><button class="btn small primary" onclick={runQuiz} disabled={quizBusy}>{quizBusy ? "Testing…" : "Test my memory"}</button></div>
      <p class="tiny muted">Questions come from facts your story established. Recall answers them with your current settings, as if the whole story had left the window. Run it again after changing settings to compare.</p>
      {#if runs[0]}
        {@const r = runs[0]}
        <div class="scores">
          <div><div class="big">{pct(r.score)}</div><div class="tiny muted">overall</div></div>
          <div><div class="big">{pct(r.retrieval)}</div><div class="tiny muted">found the memory</div></div>
          <div><div class="big">{pct(r.answers)}</div><div class="tiny muted">answered right</div></div>
        </div>
        <div class="quiz">
          {#each r.questions as qq (qq.id)}
            <div class="qrow">
              <span class="mark" class:ok={qq.correct} class:bad={qq.correct === false}>{qq.correct ? "✓" : qq.correct === false ? "✗" : "·"}</span>
              <div class="grow"><div class="small">{qq.question}</div><div class="tiny muted">expected “{qq.answer}”{qq.given ? ` · got “${qq.given.slice(0, 120)}”` : ""} · {qq.retrieved ? `found (rank ${qq.rank ?? "pinned"})` : "not found"}</div></div>
            </div>
          {/each}
        </div>
        {#if runs.length > 1}
          <div class="tiny faint">Earlier: {runs.slice(1, 6).map((x) => `${pct(x.score)} (${String(x.settings.profile ?? "")})`).join(" · ")}</div>
        {/if}
      {/if}
    </section>
    <section class="card check">
      <div class="row between"><h2><RefreshCw size={16} /> Tidy memory (sleep)</h2><button class="btn small" onclick={sleepNow}>Run now</button></div>
      <p class="tiny muted">Merges near-duplicate memories, folds old trivia nobody used, refreshes descriptions, and lets chapters catch up. It also runs by itself when the chat goes quiet. Your edits are never touched.</p>
      {#if sleepReport}<div class="tiny">Last run: {sleepReport.merged} merged · {sleepReport.compressed} folded into {sleepReport.digests} digests · {sleepReport.entities} descriptions refreshed · {sleepReport.aliases} names joined</div>{/if}
    </section>
    <section class="card check">
      <h2><ShieldCheck size={16} /> Records vs the story clock</h2>
      {#each reconcile as s (s.id)}
        {#each s.issues as i, k (k)}<div class="small"><a href="/chat/{id}?at={s.startSeq}">{s.title || "Scene"}</a>: {i.message}</div>{/each}
      {:else}
        <p class="tiny muted">Every scene record agrees with the trackers.</p>
      {/each}
    </section>
    <section class="card check">
      <h2><Merge size={16} /> Maybe the same</h2>
      {#each dupes as d (d.merge.id)}
        <div class="row small"><span class="grow"><b>{d.merge.name}</b> and <b>{d.keep.name}</b> <span class="tiny muted">· {d.reason}</span></span><button class="btn small" onclick={() => mergePair(d.keep.id, d.merge.id)}>Merge</button></div>
      {:else}
        <p class="tiny muted">No likely duplicates.</p>
      {/each}
      {#if dupes.length}<button class="btn ghost small" onclick={askAboutDupes}><MessagesSquare size={14} /> Ask Meus to sort these out</button>{/if}
    </section>
  {/if}
</div>

<OffpageEditor chatId={id} />

<EntityPage chatId={id} bind:entityId={open} others={everyone} onchange={load} />

<Modal open={Boolean(revealing)} onclose={() => (revealing = null)} title="Who learned it?" size="sm">
  {#if revealing}
    <div class="stack">
      <p class="small">{revealing.statement}</p>
      <label class="field"><span class="label">Revealed to</span><input class="input" bind:value={revealTo} placeholder="Name" /></label>
      <label class="field"><span class="label">How (optional)</span><input class="input" bind:value={revealHow} placeholder="She confessed by the fire" /></label>
    </div>
  {/if}
  {#snippet footer()}
    <button class="btn ghost" onclick={() => (revealing = null)}>Cancel</button>
    <button class="btn primary" onclick={reveal} disabled={!revealTo.trim()}>Save</button>
  {/snippet}
</Modal>

<Modal open={Boolean(editingProp)} onclose={() => (editingProp = null)} title="Edit before adding" size="md">
  {#if editingProp}
    <div class="stack">
      <label class="field"><span class="label">Title</span><input class="input" bind:value={editingProp.entry.comment} /></label>
      <label class="field"><span class="label">Keys (comma-separated)</span><input class="input" value={editingProp.entry.keys.join(", ")} onchange={(e) => (editingProp!.entry.keys = e.currentTarget.value.split(/\s*,\s*/).filter(Boolean))} /></label>
      <label class="field"><span class="label">Entry</span><textarea class="textarea" rows="8" bind:value={editingProp.entry.content}></textarea></label>
    </div>
  {/if}
  {#snippet footer()}
    <button class="btn ghost" onclick={() => (editingProp = null)}>Cancel</button>
    <button class="btn primary" onclick={() => editingProp && accept(editingProp)}>Add to the Chronicle</button>
  {/snippet}
</Modal>

<style>
  .page {
    max-width: 68rem;
    margin: 0 auto;
    padding: 1.2rem clamp(1rem, 3vw, 2rem) 5rem;
    display: grid;
    gap: 1rem;
  }
  .head {
    gap: 0.6rem;
  }
  .search {
    width: min(16rem, 40vw);
  }
  .tabs {
    overflow-x: auto;
    scrollbar-width: none;
    margin: 0 -0.2rem;
    padding: 0 0.2rem;
  }
  .story {
    padding: 0.7rem 0.9rem;
  }
  .story p {
    margin: 0.3rem 0 0;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.6rem;
  }
  .cards.wide {
    grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
  }
  .ent {
    text-align: left;
    padding: 0.65rem 0.75rem;
    display: grid;
    gap: 0.3rem;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .ent:hover {
    border-color: var(--accent);
  }
  .ent.dead {
    opacity: 0.65;
  }
  .ent-head {
    align-items: flex-start;
  }
  .ent-head :global(svg) {
    margin-top: 0.2em;
  }
  /* A long name wraps to two lines inside its card, then ends in an ellipsis. */
  .ent-name {
    flex: 1;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .clamp {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .chapter,
  .thread,
  .ledger,
  .journal,
  .prop,
  .check {
    padding: 0.7rem 0.85rem;
    display: grid;
    gap: 0.35rem;
  }
  .scene {
    display: block;
    color: inherit;
    padding: 0.15rem 0;
    border-top: 1px solid var(--border);
  }
  .ledger {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .ledger.done {
    opacity: 0.7;
  }
  .mini {
    width: auto;
    padding: 0.2rem 1.6rem 0.2rem 0.4rem;
    font-size: var(--fs-sm);
  }
  .pre {
    white-space: pre-wrap;
    margin: 0;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    font-size: var(--fs-lg, 1.05rem);
  }
  .scores {
    display: flex;
    gap: 1.6rem;
    flex-wrap: wrap;
  }
  .big {
    font-size: 1.6rem;
    font-weight: 600;
  }
  .quiz {
    display: grid;
    gap: 0.25rem;
  }
  .qrow {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    border-top: 1px solid var(--border);
    padding-top: 0.25rem;
  }
  .mark {
    width: 1rem;
    text-align: center;
    color: var(--text-muted);
  }
  .mark.ok {
    color: var(--mint-text, green);
  }
  .mark.bad {
    color: var(--danger);
  }
</style>
