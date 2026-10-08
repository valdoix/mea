<script lang="ts">
  import type { Moment } from "../../lib/types";
  import Modal from "../Modal.svelte";
  import { get, post, put } from "../../lib/api";
  import { confirm, promptText } from "../../lib/dialogs.svelte";
  import { autosize } from "../../lib/gestures";
  import { compact, timeAgo } from "../../lib/format";
  import { Check, ChevronDown, ChevronRight, History, Merge, Pencil, RefreshCw, TriangleAlert, X } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { Atom, Summary, UsageRef } from "../../lib/types";
  import AtomItem from "./AtomItem.svelte";

  let { summary, chatId, open = false, onchange }: { summary: Summary; chatId: string; open?: boolean; onchange: () => void } = $props();

  // svelte-ignore state_referenced_locally
  let expanded = $state(open);
  let editing = $state(false);
  let draftTitle = $state("");
  let draftContent = $state("");
  let detailOpen = $state(false);
  let detail = $state<{ versions: { id: string; title: string; content: string; source: string; note: string | null; createdAt: number }[]; usage: UsageRef[]; atoms: Atom[] } | null>(null);

  const LEVEL = { scene: "Scene", chapter: "Chapter", arc: "Arc", story: "Story so far" } as const;
  const STATE: Record<string, { label: string; chip: string }> = {
    pending: { label: "waiting", chip: "butter" },
    building: { label: "writing…", chip: "sky" },
    ready: { label: "summarized", chip: "mint" },
    stale: { label: "needs update", chip: "peach" },
    review: { label: "update to review", chip: "peach" },
    error: { label: "failed", chip: "rose" },
  };
  const st = $derived(summary.level !== "story" && !summary.closed ? { label: "still open", chip: "sky" } : (STATE[summary.state] ?? STATE.pending!));
  const range = $derived(`#${summary.startSeq}–#${summary.endSeq ?? "…"}`);
  const v = $derived(summary.verification);
  // SUM-11: the dramatic moments this part keeps (carried up from every scene below it).
  const moments = $derived(((summary.data?.moments as Moment[] | undefined) ?? []).filter((m) => m.text));

  function startEdit() {
    draftTitle = summary.title;
    draftContent = summary.content;
    editing = true;
    expanded = true;
  }

  async function save() {
    try {
      await put(`/api/summaries/${summary.id}`, { title: draftTitle, content: draftContent });
      editing = false;
      toast("Saved. Your version is locked against automatic rebuilds.", { kind: "ok" });
      onchange();
    } catch (e) {
      errorToast(e);
    }
  }

  async function rebuild() {
    const instruction = await promptText({
      title: `Rebuild this ${summary.level === "story" ? "Story So Far" : summary.level}`,
      label: "Optional instruction for the summarizer",
      placeholder: "e.g. include the argument about the ring",
      multiline: true,
      confirmLabel: "Rebuild",
    });
    if (instruction === null) return;
    try {
      await post(`/api/summaries/${summary.id}/rebuild`, { instruction: instruction.trim() || undefined, propose: summary.userEdited || undefined });
      toast(summary.userEdited ? "Rebuilding. You'll get to compare before anything changes." : "Rebuilding in the background…");
      onchange();
    } catch (e) {
      errorToast(e);
    }
  }

  async function accept() {
    await post(`/api/summaries/${summary.id}/accept`).catch(errorToast);
    toast("Updated. The old version is in the history.", { kind: "ok" });
    onchange();
  }
  async function reject() {
    await post(`/api/summaries/${summary.id}/reject`).catch(errorToast);
    onchange();
  }

  async function mergeNext() {
    if (!(await confirm({ title: `Merge with the next ${summary.level}?`, message: "Both become one and are summarized again.", confirmLabel: "Merge" }))) return;
    try {
      await post(`/api/summaries/${summary.id}/merge-next`);
      onchange();
    } catch (e) {
      errorToast(e);
    }
  }

  async function openDetail() {
    detailOpen = true;
    detail = null;
    try {
      detail = await get(`/api/summaries/${summary.id}`);
    } catch (e) {
      errorToast(e);
    }
  }

  async function restore(vid: string) {
    try {
      await post(`/api/summaries/${summary.id}/versions/${vid}/restore`);
      detailOpen = false;
      toast("Restored", { kind: "ok" });
      onchange();
    } catch (e) {
      errorToast(e);
    }
  }
</script>

<article class="sum {summary.level}" class:editing>
  <header class="row">
    <button class="toggle" onclick={() => (expanded = !expanded)} aria-expanded={expanded} aria-label={expanded ? "Collapse" : "Expand"}>
      {#if expanded}<ChevronDown size={15} />{:else}<ChevronRight size={15} />{/if}
    </button>
    <div class="grow head">
      <div class="row wrap tight">
        <span class="kind tiny">{LEVEL[summary.level]}</span>
        <b class="title">{summary.title || (summary.level === "story" ? "" : "Untitled")}</b>
      </div>
      <div class="row wrap tiny muted meta">
        {#if summary.level !== "story" || summary.endSeq}<a href="/chat/{chatId}?at={summary.startSeq}">{range}</a>{/if}
        {#if summary.storyTime}<span>· {summary.storyTime}</span>{/if}
        {#if summary.tokens}<span>· {compact(summary.tokens)} tokens{summary.sourceTokens ? ` from ${compact(summary.sourceTokens)}` : ""}</span>{/if}
        {#if summary.userEdited}<span class="chip lavender">edited by you</span>{/if}
        {#if summary.manual}<span class="chip">manual break</span>{/if}
      </div>
    </div>
    <span class="chip {st.chip}">{st.label}</span>
  </header>

  {#if expanded}
    <div class="body">
      {#if editing}
        <input class="input" bind:value={draftTitle} aria-label="Title" />
        <textarea class="textarea" use:autosize={500} bind:value={draftContent} aria-label="Summary"></textarea>
        <div class="row end">
          <button class="btn ghost small" onclick={() => (editing = false)}>Cancel</button>
          <button class="btn primary small" onclick={save}>Save</button>
        </div>
      {:else if summary.content}
        <p class="content">{summary.content}</p>
        {#if moments.length}
          <div class="row wrap moments">{#each moments as m, i (i)}<span class="chip tiny lavender" title={m.text}>✦ {m.tag}</span>{/each}</div>
        {/if}
      {:else if summary.state === "error"}
        <div class="notice error tiny">{summary.error ?? "The summary couldn't be written."}</div>
      {:else}
        <p class="tiny muted">{summary.closed || summary.level === "story" ? "Not summarized yet. It's written in the background, between replies." : "This part of the story is still being written. It's summarized once it closes."}</p>
      {/if}

      {#if summary.proposal}
        <div class="proposal">
          <div class="tiny"><b>An updated version is ready.</b> {summary.userEdited ? "You edited this one, so nothing changed until you choose." : "Compare before it replaces the current one."}</div>
          <div class="diff">
            <div><span class="tiny muted">Current</span><p>{summary.content}</p></div>
            <div><span class="tiny muted">New{summary.proposal.title ? `: ${summary.proposal.title}` : ""}</span><p>{summary.proposal.content}</p></div>
          </div>
          <div class="row end">
            <button class="btn ghost small" onclick={reject}><X size={14} /> Keep current</button>
            <button class="btn primary small" onclick={accept}><Check size={14} /> Use the new one</button>
          </div>
        </div>
      {/if}

      {#if v && (v.unsupported.length || v.omissions.length || v.skipped)}
        <div class="notice warn tiny verify">
          <div class="row"><TriangleAlert size={14} /><b>Checker {v.repaired ? "found problems, and the summary was rewritten once" : v.skipped ? "skipped (saving quota)" : "notes"}</b></div>
          {#each v.unsupported as u, i (i)}<div>• Not in the messages: “{u.claim}”{u.reason ? ` (${u.reason})` : ""}</div>{/each}
          {#each v.omissions as o, i (i)}<div>• Left out: {o.what}{o.seq ? ` (#${o.seq})` : ""}</div>{/each}
        </div>
      {/if}

      <div class="row wrap actions">
        <button class="btn ghost small" onclick={startEdit} disabled={!summary.content && !summary.closed}><Pencil size={14} /> Edit</button>
        <button class="btn ghost small" onclick={rebuild} disabled={summary.level !== "story" && !summary.closed}><RefreshCw size={14} /> Rebuild…</button>
        <button class="btn ghost small" onclick={openDetail}><History size={14} /> History{summary.level === "scene" ? " & memories" : ""}</button>
        {#if summary.level === "scene" || summary.level === "chapter"}<button class="btn ghost small" onclick={mergeNext}><Merge size={14} /> Merge with next</button>{/if}
        {#if summary.builtAt}<span class="tiny faint grow right">written {timeAgo(summary.builtAt)}</span>{/if}
      </div>
    </div>
  {/if}
</article>

<Modal bind:open={detailOpen} title={summary.title || LEVEL[summary.level]} size="lg">
  {#if !detail}
    <p class="muted">Loading…</p>
  {:else}
    <div class="stack">
      {#if detail.atoms.length}
        <section class="stack tight">
          <h3>Memories from this scene</h3>
          {#each detail.atoms as a (a.id)}<AtomItem atom={a} {chatId} onchange={() => (openDetail(), onchange())} />{/each}
        </section>
      {/if}
      <section class="stack tight">
        <h3>Used in replies</h3>
        {#if detail.usage.length}
          <div class="row wrap">
            {#each detail.usage as u (u.generationId)}<a class="chip" href="/chat/{chatId}?at={u.seq ?? ''}">#{u.seq ?? "?"} · {timeAgo(u.at)}</a>{/each}
          </div>
        {:else}<p class="tiny muted">Not used in a reply yet.</p>{/if}
      </section>
      <section class="stack tight">
        <h3>Earlier versions</h3>
        {#each detail.versions as ver (ver.id)}
          <div class="ver card">
            <div class="row between tiny muted"><span>{ver.source === "user" ? "Your edit" : "Written by Mea"} · {timeAgo(ver.createdAt)}{ver.note ? ` · ${ver.note}` : ""}</span><button class="btn ghost small" onclick={() => restore(ver.id)}>Restore</button></div>
            <p class="small">{ver.content}</p>
          </div>
        {:else}
          <p class="tiny muted">No earlier versions.</p>
        {/each}
      </section>
    </div>
  {/if}
</Modal>

<style>
  .sum {
    border: 1px solid var(--border);
    border-radius: var(--r-md, 12px);
    background: var(--surface);
    padding: 0.55rem 0.75rem;
  }
  .sum.story {
    background: color-mix(in srgb, var(--lavender) 18%, var(--surface));
  }
  .sum.chapter {
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  }
  .toggle {
    border: 0;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.1rem;
    align-self: flex-start;
    margin-top: 0.15rem;
  }
  .head {
    min-width: 0;
  }
  .tight {
    gap: 0.4rem;
  }
  .kind {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 800;
    color: var(--text-faint);
  }
  .title {
    font-family: var(--font-display);
    font-variation-settings: "SOFT" 100;
  }
  .meta {
    gap: 0.3rem;
  }
  .body {
    display: grid;
    gap: 0.5rem;
    padding: 0.5rem 0 0.1rem 1.6rem;
  }
  .content {
    white-space: pre-wrap;
    font-family: var(--font-story);
    font-size: var(--fs-sm);
    line-height: 1.6;
    margin: 0;
  }
  .proposal {
    border: 1px dashed var(--accent);
    border-radius: var(--r-sm);
    padding: 0.6rem;
    display: grid;
    gap: 0.5rem;
  }
  .diff {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.6rem;
  }
  .diff p {
    white-space: pre-wrap;
    font-size: var(--fs-sm);
    margin: 0.2rem 0 0;
  }
  .verify {
    display: grid;
    gap: 0.2rem;
  }
  .actions {
    gap: 0.2rem;
    margin-left: -0.4rem;
  }
  .end {
    justify-content: flex-end;
  }
  .right {
    text-align: right;
  }
  .ver {
    padding: 0.5rem 0.7rem;
  }
  .ver p {
    white-space: pre-wrap;
    margin: 0.3rem 0 0;
  }
  @media (max-width: 760px) {
    .body {
      padding-left: 0;
    }
  }
</style>
