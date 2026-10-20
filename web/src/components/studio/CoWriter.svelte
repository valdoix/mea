<script lang="ts">
  import { opened } from "../../lib/gestures";
  import DOMPurify from "dompurify";
  import { marked } from "marked";
  import { tick } from "svelte";
  import Modal from "../Modal.svelte";
  import { cowriter } from "../../lib/cowriter.svelte";
  import { wordDiff } from "../../lib/diff";
  import { Check, ExternalLink, Loader, MessagesSquare, Send, Trash } from "../../lib/icons";
  import type { ChatTurn, Proposal, ProposedChange } from "../../lib/types";

  /**
   * The co-writer, in both studios: tell it what you want in plain words; it answers and proposes
   * exact changes, each shown as a diff you tick or untick. Nothing changes until you apply.
   */
  let {
    chat,
    proposal,
    busy,
    examples = [],
    onsend,
    onapply,
    ondismiss,
    onclear,
  }: {
    chat: ChatTurn[];
    proposal: Proposal | null;
    busy: boolean;
    examples?: string[];
    onsend: (message: string) => Promise<boolean>;
    onapply: (ids: string[]) => Promise<unknown>;
    ondismiss: () => Promise<unknown>;
    onclear: () => Promise<unknown>;
  } = $props();

  let composer = $state<HTMLTextAreaElement | null>(null);
  let picked = $state(new Set<string>());
  let log = $state<HTMLDivElement | null>(null);

  // A new proposal starts with every change ticked.
  let seen = "";
  $effect(() => {
    if (proposal && proposal.id !== seen) {
      seen = proposal.id;
      picked = new Set(proposal.changes.map((c) => c.id));
    }
  });
  $effect(() => {
    void chat.length;
    void proposal;
    if (cowriter.open) void tick().then(() => log?.scrollTo({ top: log.scrollHeight, behavior: "smooth" }));
  });

  // Leaving the studio closes the panel (the next studio opens fresh).
  $effect(() => () => {
    cowriter.open = false;
    cowriter.draft = "";
  });
  // A brainstorm started elsewhere ("Expand my idea") lands in the box with the cursor at its end.
  $effect(() => {
    if (cowriter.open && cowriter.draft)
      void tick().then(() => {
        composer?.focus();
        composer?.setSelectionRange(cowriter.draft.length, cowriter.draft.length);
      });
  });

  async function send(text = cowriter.draft) {
    const t = text.trim();
    if (!t || busy) return;
    cowriter.draft = "";
    if (!(await onsend(t))) cowriter.draft = t;
  }
  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    picked = next;
  }
  const KIND: Record<string, string> = { idea: "your idea", section: "concept", bible: "bible", field: "field", rewrite: "rewrite", name: "name", overview: "overview", entry: "edit", plan: "plan", add: "new", remove: "leave out", answer: "answer", option: "shape", basedOn: "canon", write: "write" };
  const long = (c: ProposedChange) => c.before.length + c.after.length > 1400;
  // Meus's replies can brainstorm in lists and bold; rendered safely.
  const md = (t: string) => DOMPurify.sanitize(marked.parse(t, { async: false, breaks: true }) as string, { FORBID_TAGS: ["style", "script", "img", "iframe", "form", "input"] });
  const lastIsMea = $derived(chat.at(-1)?.role === "mea");
</script>

<button class="fab btn" class:pending={Boolean(proposal)} onclick={() => (cowriter.open = true)} aria-label="Co-writer">
  <MessagesSquare size={16} /> Brainstorm with Meus{#if proposal}<span class="badge">{proposal.changes.length}</span>{/if}
</button>

<Modal bind:open={cowriter.open} title="Meus, your co-writer" side="right" size="lg">
  <div class="cw">
    <div class="log" bind:this={log}>
      {#if !chat.length}
        <p class="small muted">Think out loud with me: brainstorm twists, ask what canon says (I can look things up on the wiki), or tell me what to change. I only touch the draft when you say so, and you see every change first.</p>
        {#if examples.length}
          <div class="examples">{#each examples as e (e)}<button class="chip toggle" onclick={() => send(e)} disabled={busy}>{e}</button>{/each}</div>
        {/if}
      {/if}
      {#each chat as t, k (k)}
        <div class="turn {t.role}">
          {#if t.role === "mea"}
            <div class="small bubble md">{@html md(t.text)}</div>
          {:else}
            <p class="small bubble">{t.text}</p>
          {/if}
          {#if t.sources?.length}
            <div class="row wrap srcs">{#each t.sources as s (s.url)}<a class="chip tiny" href={s.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={10} /> {s.title}</a>{/each}</div>
          {/if}
        </div>
      {/each}
      {#if lastIsMea && !proposal && !busy}
        <div class="row wrap quick">
          <button class="chip toggle" onclick={() => send("Yes, do that: make the changes.")}><Check size={11} /> Do it</button>
          <button class="chip toggle" onclick={() => send("Give me three wilder options.")}>Wilder options</button>
          <button class="chip toggle" onclick={() => send("What would canon or the fandom say about this?")}>What would canon say?</button>
        </div>
      {/if}
      {#if busy}<div class="turn mea"><p class="small muted"><span class="spin"><Loader size={13} /></span> Reading the draft…</p></div>{/if}

      {#if proposal}
        <div class="proposal stack tight">
          <span class="tiny muted">{proposal.changes.length} change{proposal.changes.length === 1 ? "" : "s"}. Untick any you don't want.</span>
          {#each proposal.changes as c (c.id)}
            <label class="change card" class:off={!picked.has(c.id)}>
              <span class="row head">
                <input type="checkbox" checked={picked.has(c.id)} onchange={() => toggle(c.id)} aria-label="Use this change" />
                <b class="small grow">{c.label}</b>
                <span class="chip tiny">{KIND[c.kind] ?? c.kind}</span>
              </span>
              {#if c.kind === "rewrite"}
                <span class="small">Rewritten in the background: <i>{c.steer}</i></span>
              {:else if c.kind === "write"}
                <span class="small">Written in the background from the bible: <i>{c.after}</i></span>
              {:else if c.kind === "remove"}
                <span class="small muted">Left out of the lorebook (you can tick it back in).</span>
              {:else if c.kind === "add"}
                <span class="small diff"><span class="add">{c.after}</span></span>
              {:else}
                <details use:opened={!long(c)}>
                  <summary class="tiny muted">{long(c) ? "Show the changes" : "Changes"}</summary>
                  <p class="small diff">{#each wordDiff(c.before, c.after) as part, k (k)}<span class={part.type}>{part.text}</span>{/each}</p>
                </details>
              {/if}
            </label>
          {/each}
          <div class="row end">
            <button class="btn ghost small" onclick={ondismiss} disabled={busy}>Dismiss</button>
            <button class="btn primary small" onclick={() => onapply([...picked])} disabled={busy || !picked.size}>Apply {picked.size}</button>
          </div>
        </div>
      {/if}
    </div>
  </div>
  {#snippet footer()}
    <div class="composer">
      <textarea
        class="textarea"
        rows="2"
        bind:this={composer}
        bind:value={cowriter.draft}
        placeholder="What if Laura Lee survived the lake? · Make her five years older · What does canon say about Lottie's visions?"
        onkeydown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      ></textarea>
      <div class="row between">
        {#if chat.length}<button class="btn ghost small" onclick={onclear} disabled={busy}><Trash size={13} /> Clear</button>{:else}<span></span>{/if}
        <button class="btn primary small" onclick={() => send()} disabled={busy || !cowriter.draft.trim()}><Send size={14} /> Send</button>
      </div>
    </div>
  {/snippet}
</Modal>

<style>
  .fab {
    position: sticky;
    bottom: 1rem;
    justify-self: end;
    z-index: 5;
    box-shadow: var(--shadow-lg, 0 6px 24px rgb(0 0 0 / 0.25));
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  /* On the phone, above the floating dock. */
  @media (max-width: 768px) {
    .fab {
      bottom: calc(76px + var(--safe-bottom, 0px));
    }
  }
  .fab.pending {
    border-color: var(--accent);
  }
  .badge {
    background: var(--accent);
    color: var(--on-accent);
    border-radius: var(--r-pill);
    font-size: var(--fs-xs);
    padding: 0 0.4rem;
    min-width: 1.2rem;
    text-align: center;
  }
  .cw {
    display: grid;
    min-height: 0;
  }
  .log {
    display: grid;
    gap: 0.5rem;
    align-content: start;
  }
  .examples {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .toggle {
    cursor: pointer;
    border: 1px solid var(--border);
    font: inherit;
    font-size: var(--fs-xs);
    text-align: left;
  }
  .turn {
    display: grid;
    gap: 0.25rem;
    justify-items: start;
  }
  .bubble {
    margin: 0;
    padding: 0.45rem 0.65rem;
    border-radius: 12px;
    max-width: 92%;
    overflow-wrap: anywhere;
  }
  p.bubble {
    white-space: pre-wrap;
  }
  .md :global(p) {
    margin: 0 0 0.45rem;
  }
  .md :global(p:last-child),
  .md :global(ul:last-child),
  .md :global(ol:last-child) {
    margin-bottom: 0;
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 0.2rem 0 0.45rem;
    padding-left: 1.2rem;
  }
  .turn.user {
    justify-items: end;
  }
  .turn.user .bubble {
    background: color-mix(in srgb, var(--accent) 22%, var(--surface));
  }
  .turn.mea .bubble {
    background: var(--surface-2);
  }
  .srcs,
  .quick {
    gap: 0.3rem;
  }
  .srcs a {
    text-decoration: none;
    display: inline-flex;
    gap: 0.2rem;
    align-items: center;
  }
  .proposal {
    border-top: 1px solid var(--border);
    padding-top: 0.6rem;
  }
  .change {
    display: grid;
    gap: 0.35rem;
    padding: 0.5rem 0.6rem;
    cursor: pointer;
  }
  .change.off {
    opacity: 0.5;
  }
  .head {
    gap: 0.5rem;
    align-items: center;
  }
  .diff {
    margin: 0.3rem 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 18rem;
    overflow: auto;
  }
  .diff :global(.del) {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--danger) 60%, transparent);
  }
  .diff :global(.add) {
    background: color-mix(in srgb, var(--mint) 35%, transparent);
  }
  .end {
    justify-content: flex-end;
    gap: 0.4rem;
  }
  .composer {
    display: grid;
    gap: 0.4rem;
    width: 100%;
  }
</style>
