<script lang="ts">
  import "../../styles/studio.css";
  import DOMPurify from "dompurify";
  import { marked } from "marked";
  import { tick } from "svelte";
  import { del, get, post } from "../../lib/api";
  import { wordDiff } from "../../lib/diff";
  import { onEvent } from "../../lib/events";
  import { autosize } from "../../lib/gestures";
  import { Check, Loader, MessagesSquare, Send, Trash, Undo } from "../../lib/icons";
  import { meus } from "../../lib/meus.svelte";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { ArchiveCitation, MeusTurn, MeusView, ProposedChange } from "../../lib/types";

  /**
   * Meus in a chat (docs/13-meus.md): out of character, it answers from the story with sources,
   * brainstorms, and fixes things. Every change shows on a card you tick; applied sets can be undone.
   */
  let { chatId, onjump }: { chatId: string; onjump: (c: ArchiveCitation) => void } = $props();

  let view = $state<MeusView | null>(null);
  let busy = $state(false);
  let picked = $state(new Set<string>());
  let log = $state<HTMLDivElement | null>(null);
  let composer = $state<HTMLTextAreaElement | null>(null);
  let showSets = $state(false);

  async function load() {
    try {
      view = await get<MeusView>(`/api/chats/${chatId}/meus`);
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void chatId;
    void load();
  });
  // Another device (or the server after an undo elsewhere) changed it.
  $effect(() => onEvent((e) => (e.type === "meus.changed" && e.chatId === chatId && !busy ? void load() : undefined)));

  // A new card starts with every change ticked, except the ones the story can't redo by itself.
  let seen = "";
  $effect(() => {
    const p = view?.proposal;
    if (p && p.id !== seen) {
      seen = p.id;
      picked = new Set(p.changes.filter((c) => !c.data?.risky).map((c) => c.id));
    }
  });
  $effect(() => {
    void view?.turns.length;
    void view?.proposal;
    void busy;
    void tick().then(() => log?.scrollTo({ top: log.scrollHeight, behavior: "smooth" }));
  });
  // A message started elsewhere ("Ask Meus" on a selection, "Fix with Meus" on a message) lands here.
  $effect(() => {
    if (meus.draft)
      void tick().then(() => {
        composer?.focus();
        composer?.setSelectionRange(meus.draft.length, meus.draft.length);
      });
  });

  // A message sent from the composer ("/meus …") goes out once the panel has loaded.
  $effect(() => {
    if (meus.queued && view && !busy) {
      const t = meus.queued;
      meus.queued = "";
      void send(t, false);
    }
  });

  async function send(text = meus.draft, fromBox = true) {
    const t = text.trim();
    if (!t || busy) return;
    if (fromBox) meus.draft = "";
    busy = true;
    // Show the message right away; the answer replaces the view.
    if (view) view.turns = [...view.turns, { role: "user", text: t, at: Date.now() }];
    try {
      view = await post<MeusView>(`/api/chats/${chatId}/meus`, { message: t });
    } catch (e) {
      meus.draft = t;
      errorToast(e);
      void load();
    } finally {
      busy = false;
    }
  }
  async function apply() {
    if (!view?.proposal || busy) return;
    busy = true;
    try {
      const r = await post<MeusView & { applied: number; setId: string | null }>(`/api/chats/${chatId}/meus/apply`, { accept: [...picked] });
      view = r;
      if (r.setId) {
        const setId = r.setId;
        toast(`Applied ${r.applied} change${r.applied === 1 ? "" : "s"}`, { kind: "ok", action: { label: "Undo", run: () => void undo(setId) } });
      }
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
  async function dismiss() {
    try {
      view = await post<MeusView>(`/api/chats/${chatId}/meus/dismiss`);
    } catch (e) {
      errorToast(e);
    }
  }
  async function undo(setId: string) {
    try {
      view = await post<MeusView>(`/api/chats/${chatId}/meus/undo/${setId}`);
      toast("Undone", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }
  async function clear() {
    try {
      view = await del<MeusView>(`/api/chats/${chatId}/meus`);
    } catch (e) {
      errorToast(e);
    }
  }
  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    picked = next;
  }

  const md = (t: string) => DOMPurify.sanitize(marked.parse(t, { async: false, breaks: true }) as string, { FORBID_TAGS: ["style", "script", "img", "iframe", "form", "input"] });
  /** "[2]" in an answer becomes a tappable reference to its source. */
  function withRefs(t: MeusTurn) {
    // The references go in before sanitizing, so nothing is spliced into the cleaned HTML.
    const text = t.cites?.length ? t.text.replace(/\[(\d+)\](?!\()/g, (m, n) => (t.cites!.some((c) => c.n === Number(n)) ? `<button type="button" class="ref" data-n="${n}">${n}</button>` : m)) : t.text;
    return md(text);
  }
  function onRef(e: MouseEvent, t: MeusTurn) {
    const b = (e.target as HTMLElement).closest<HTMLElement>("button.ref");
    if (!b) return;
    const c = t.cites?.find((x) => x.n === Number(b.dataset.n));
    if (c) onjump(c);
  }

  const KIND: Record<string, string> = {
    ledger: "records",
    merge: "cast",
    codex: "codex",
    codex_add: "codex",
    codex_merge: "codex",
    codex_unmerge: "codex",
    codex_delete: "codex",
    memory_fix: "memory",
    memory_add: "memory",
    memory_pin: "memory",
    memory_forget: "memory",
    message: "message",
    cue: "next reply",
    ooc: "note",
    truth: "truth",
    timeskip: "time",
  };
  const long = (c: ProposedChange) => c.before.length + c.after.length > 1400;
  const showsDiff = (c: ProposedChange) => ["codex", "memory_fix", "message", "cue"].includes(c.kind) && c.before;
  const lastIsMeus = $derived(view?.turns.at(-1)?.role === "mea");
  const START = ["Catch me up", "What's inconsistent right now?", "Three ways the next scene could go", "Who's in the scene, and what do they want?"];
</script>

<div class="studio st-stack meus">
  {#if view?.header}
    <p class="st-lcd where" title="What Meus is looking at">
      <span class="st-led"></span> READING TO #{view.header.seq}{view.header.time ? ` · ${view.header.time}` : ""}{view.header.place ? ` · ${view.header.place}` : ""}
    </p>
  {/if}

  <div class="log" bind:this={log}>
    {#if view && !view.turns.length}
      <p class="intro"><MessagesSquare size={15} /><span>I'm Meus. Ask me anything about your story, brainstorm with me, or tell me what to fix: merge two people, correct the time, change a Codex page, fix a message. You see every change before it happens, and you can undo it. Nothing here goes into the roleplay.</span></p>
      <div class="st-tags">{#each START as q (q)}<button class="st-chip" type="button" onclick={() => send(q, false)} disabled={busy}>{q}</button>{/each}</div>
    {/if}
    {#each view?.turns ?? [] as t, k (k)}
      <div class="turn {t.role}">
        {#if t.role === "mea"}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div class="bubble md" onclick={(e) => onRef(e, t)}>{@html withRefs(t)}</div>
          {#if t.reads?.length}<div class="st-tags reads">{#each t.reads as r (r)}<span class="st-chip tiny">read · {r}</span>{/each}</div>{/if}
          {#if t.cites?.length}
            <details class="sources">
              <summary class="st-link">{t.cites.length} source{t.cites.length === 1 ? "" : "s"}</summary>
              {#each t.cites as c (c.n)}
                <button class="src" type="button" onclick={() => onjump(c)}>
                  <span class="src-h"><b>{c.n}</b> {c.type}{c.seq != null ? ` · #${c.seq}` : ""}</span>
                  <span class="src-x">{c.excerpt.slice(0, 220)}</span>
                </button>
              {/each}
            </details>
          {/if}
          {#if t.setId}
            {@const set = view?.sets.find((s) => s.id === t.setId)}
            {#if set && !set.undone && k === view!.turns.findLastIndex((x) => x.setId === t.setId)}
              <button class="st-key small ghost undo" type="button" onclick={() => undo(set.id)}><Undo size={13} /> Undo</button>
            {/if}
          {/if}
        {:else}
          <p class="bubble">{t.text}</p>
        {/if}
      </div>
    {/each}
    {#if busy}<p class="st-lcd seeking" aria-live="polite"><span class="spin"><Loader size={13} /></span> READING THE STORY…</p>{/if}
    {#if lastIsMeus && !view?.proposal && !busy}
      <div class="st-tags quick">
        <button class="st-chip" type="button" onclick={() => send("Yes, do that: make the changes.", false)}><Check size={11} /> Do it</button>
        <button class="st-chip" type="button" onclick={() => send("Give me three wilder options.", false)}>Wilder options</button>
        <button class="st-chip" type="button" onclick={() => send("What's inconsistent right now?", false)}>What's inconsistent?</button>
      </div>
    {/if}

    {#if view?.proposal}
      {@const p = view.proposal}
      <div class="card-changes">
        <span class="tiny muted">{p.changes.length} change{p.changes.length === 1 ? "" : "s"}. Untick any you don't want.</span>
        {#each p.changes as c (c.id)}
          <label class="change" class:off={!picked.has(c.id)} class:risky={Boolean(c.data?.risky)}>
            <span class="head">
              <input type="checkbox" checked={picked.has(c.id)} onchange={() => toggle(c.id)} aria-label="Use this change" />
              <b class="grow">{c.label}</b>
              <span class="st-chip tiny">{KIND[c.kind] ?? c.kind}</span>
            </span>
            {#if c.data?.risky}<span class="tiny warn">The story can't redo this by itself; Undo can.</span>{/if}
            {#if c.kind === "ledger"}
              <ul class="lines">{#each c.after.split("\n") as l, i (i)}<li>{l}</li>{/each}</ul>
            {:else if c.kind === "merge" || c.kind === "codex_merge" || c.kind === "codex_unmerge"}
              <span class="small">{c.before} → {c.after}</span>
            {:else if c.kind === "memory_forget" || c.kind === "codex_delete"}
              <span class="small diff"><span class="del">{c.before}</span></span>
            {:else if showsDiff(c)}
              <details open={!long(c)}>
                <summary class="tiny muted">{long(c) ? "Show the changes" : "Changes"}</summary>
                <p class="small diff">{#each wordDiff(c.before, c.after) as part, k (k)}<span class={part.type}>{part.text}</span>{/each}</p>
              </details>
            {:else}
              <span class="small diff"><span class="add">{c.after}</span></span>
            {/if}
            {#if c.data?.note}<span class="tiny muted">Note: {c.data.note}</span>{/if}
          </label>
        {/each}
        <div class="row end">
          <button class="st-key small ghost" type="button" onclick={dismiss} disabled={busy}>Dismiss</button>
          <button class="st-key small" type="button" onclick={apply} disabled={busy || !picked.size}>Apply {picked.size}</button>
        </div>
      </div>
    {/if}
  </div>

  {#if view?.sets.length}
    <div class="sets">
      <button class="st-link" type="button" onclick={() => (showSets = !showSets)}>{showSets ? "Hide" : "Show"} recent changes</button>
      {#if showSets}
        {#each view.sets as s (s.id)}
          <div class="set" class:undone={s.undone}>
            <span class="small grow">{s.labels.join(" · ")}</span>
            {#if s.undone}<span class="tiny muted">undone</span>{:else}<button class="st-key small sq ghost" type="button" onclick={() => undo(s.id)} aria-label="Undo" title="Undo"><Undo size={13} /></button>{/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}

  <div class="mic" class:busy>
    <textarea
      use:autosize={160}
      rows="1"
      bind:this={composer}
      bind:value={meus.draft}
      placeholder="Merge Jax into Jackie · It should be night, not morning · What did she promise?"
      onkeydown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void send())}
      aria-label="Message Meus"
    ></textarea>
    <button class="send" type="button" onclick={() => send()} disabled={busy || !meus.draft.trim()} aria-label="Send"><Send size={16} /></button>
  </div>
  {#if view?.turns.length}<button class="st-link clear" type="button" onclick={clear} disabled={busy}><Trash size={12} /> Clear the conversation</button>{/if}
</div>

<style>
  .meus {
    display: grid;
    gap: 10px;
  }
  .where {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 6px 10px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: var(--st-inset-sm);
    font-size: calc(10px * var(--st-lcd-k));
    overflow-wrap: anywhere;
  }
  .log {
    display: grid;
    gap: 10px;
    align-content: start;
  }
  .intro {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--text-muted);
  }
  .intro :global(svg) {
    flex: 0 0 auto;
    margin-top: 1px;
    color: var(--accent-ink);
  }
  .turn {
    display: grid;
    gap: 6px;
  }
  .turn.user {
    justify-items: end;
  }
  .bubble {
    max-width: 92%;
    margin: 0;
    padding: 9px 12px;
    border-radius: var(--r-md);
    font-size: 13.5px;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }
  .user .bubble {
    background: color-mix(in srgb, var(--accent) 16%, var(--surface));
    white-space: pre-wrap;
  }
  .mea .bubble {
    background: var(--surface);
    border: var(--st-bw) solid var(--st-edge);
    box-shadow: var(--st-card);
    font-family: var(--st-story);
  }
  .bubble :global(p) {
    margin: 0 0 0.5em;
  }
  .bubble :global(p:last-child) {
    margin: 0;
  }
  .bubble :global(.ref) {
    display: inline-grid;
    place-items: center;
    min-width: 17px;
    height: 17px;
    margin: 0 1px;
    padding: 0 4px;
    border: 1px solid var(--st-edge);
    border-radius: 4px;
    background: var(--st-fill-2);
    color: var(--accent-ink);
    font: 700 10px/1 var(--font-ui);
    vertical-align: 2px;
    cursor: pointer;
  }
  .reads .st-chip {
    font-size: 10.5px;
  }
  .sources {
    display: grid;
    gap: 6px;
  }
  .src {
    display: grid;
    gap: 3px;
    width: 100%;
    margin-top: 6px;
    padding: 8px 10px;
    border: 0;
    border-left: 3px solid var(--st-edge);
    border-radius: 4px;
    background: var(--st-well);
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .src:hover {
    border-left-color: var(--accent);
  }
  .src-h {
    font: 700 9.5px/1.3 var(--st-meta);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-faint);
  }
  .src-h b {
    color: var(--accent-ink);
  }
  .src-x {
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-muted);
  }
  .undo {
    justify-self: start;
  }
  .seeking {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 8px 12px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    font-size: calc(11px * var(--st-lcd-k));
  }
  .st-chip {
    cursor: pointer;
  }
  .card-changes {
    display: grid;
    gap: 8px;
    padding: 10px;
    border-radius: var(--r-md);
    background: var(--st-well);
    box-shadow: var(--st-inset-sm);
  }
  .change {
    display: grid;
    gap: 6px;
    padding: 9px 11px;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: var(--st-bw) solid var(--st-edge);
    cursor: pointer;
  }
  .change.risky {
    border-color: color-mix(in srgb, var(--warn, #d08a3c) 60%, var(--st-edge));
  }
  .change.off {
    opacity: 0.55;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .warn {
    color: var(--warn-ink, var(--text-muted));
  }
  .lines {
    margin: 0;
    padding-left: 18px;
    font-size: 12.5px;
    line-height: 1.5;
  }
  .diff {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .diff :global(.del),
  .diff .del {
    background: color-mix(in srgb, var(--danger, #c0504d) 18%, transparent);
    text-decoration: line-through;
  }
  .diff :global(.add),
  .diff .add {
    background: color-mix(in srgb, var(--ok, #4d9a5a) 18%, transparent);
  }
  .row.end {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .sets {
    display: grid;
    gap: 6px;
  }
  .set {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: var(--r-sm);
    background: var(--st-well);
  }
  .set.undone {
    opacity: 0.6;
  }
  .mic {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 6px 6px 6px 14px;
    border-radius: 24px;
    background: var(--st-well);
    box-shadow:
      var(--st-inset),
      0 0 0 var(--st-bw) var(--st-edge);
  }
  .mic:focus-within {
    box-shadow:
      var(--st-inset),
      0 0 0 1.5px var(--accent);
  }
  .mic textarea {
    flex: 1;
    min-width: 0;
    padding: 8px 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font: 14px/1.45 var(--font-ui);
    resize: none;
  }
  .mic textarea:focus-visible {
    box-shadow: none;
  }
  .send {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 38px;
    height: 38px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--st-grad);
    color: var(--on-accent);
    cursor: pointer;
  }
  .send:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .clear {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
</style>
