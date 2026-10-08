<script lang="ts">
  import { del, get, post } from "../../lib/api";
  import { autosize } from "../../lib/gestures";
  import { BookmarkPlus, Library, MessageQuestion, Send, Trash } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { ArchiveAnswer, ArchiveCitation } from "../../lib/types";

  /** Ask the Archivist (CON-07): questions about your story, answered from memory with citations. */
  let { chatId, onjump }: { chatId: string; onjump: (c: ArchiveCitation) => void } = $props();

  let answers = $state<ArchiveAnswer[]>([]);
  let question = $state("");
  let busy = $state(false);
  let openSources = $state<string | null>(null);

  async function load() {
    try {
      answers = (await get<{ answers: ArchiveAnswer[] }>(`/api/chats/${chatId}/archivist`)).answers;
    } catch (e) {
      errorToast(e);
    }
  }
  $effect(() => {
    void load();
  });

  async function ask() {
    const q = question.trim();
    if (q.length < 2 || busy) return;
    busy = true;
    try {
      const a = await post<ArchiveAnswer>(`/api/chats/${chatId}/archivist`, { question: q });
      answers = [a, ...answers];
      question = "";
    } catch (e) {
      errorToast(e);
    } finally {
      busy = false;
    }
  }
  async function push(a: ArchiveAnswer, as: "ooc" | "memory") {
    try {
      await post(`/api/archivist/${a.id}/push`, { as });
      toast(as === "ooc" ? "Added as a standing note to the model" : "Pinned as a memory", { kind: "ok" });
    } catch (e) {
      errorToast(e);
    }
  }
  async function remove(a: ArchiveAnswer) {
    try {
      await del(`/api/archivist/${a.id}`);
      answers = answers.filter((x) => x.id !== a.id);
    } catch (e) {
      errorToast(e);
    }
  }
  /** "[2]" in an answer becomes a tappable reference. */
  function parts(text: string) {
    return text.split(/(\[\d+\])/g).map((p) => {
      const m = p.match(/^\[(\d+)\]$/);
      return m ? { n: Number(m[1]) } : { text: p };
    });
  }
</script>

<div class="panel-body stack">
  <div class="intro tiny muted"><Library size={14} /> Ask anything about your story, out of character. Answers come from memory with sources, and stay out of the roleplay unless you add them.</div>
  <div class="askbox card">
    <textarea class="textarea" use:autosize={160} rows="1" bind:value={question} placeholder="What did Mira promise in chapter 3?" onkeydown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void ask())} aria-label="Your question"></textarea>
    <button class="btn primary icon" onclick={ask} disabled={busy || question.trim().length < 2} aria-label="Ask"><Send size={16} /></button>
  </div>
  {#if busy}<p class="tiny muted">Looking through the archive…</p>{/if}

  {#each answers as a (a.id)}
    <article class="answer card">
      <div class="q small"><MessageQuestion size={14} /> {a.question}</div>
      <p class="small a">
        {#each parts(a.answer) as p, i (i)}
          {#if "n" in p}
            {@const c = a.sources.find((s) => s.n === p.n)}
            <button class="ref" onclick={() => c && onjump(c)} title={c ? `${c.type}: ${c.excerpt.slice(0, 160)}` : "source"}>[{p.n}]</button>
          {:else}{p.text}{/if}
        {/each}
      </p>
      {#if a.confidence === "unknown"}<div class="tiny warn">The archive doesn't establish this.</div>{/if}
      {#if a.citations.length}
        <button class="tiny link" onclick={() => (openSources = openSources === a.id ? null : a.id)}>{openSources === a.id ? "Hide" : "Show"} {a.citations.length} source{a.citations.length === 1 ? "" : "s"}</button>
        {#if openSources === a.id}
          <div class="sources">
            {#each a.citations as c (c.n)}
              <button class="src" onclick={() => onjump(c)}>
                <span class="tiny faint">[{c.n}] {c.type}{c.seq != null ? ` · #${c.seq}` : ""}</span>
                <span class="tiny">{c.excerpt.slice(0, 220)}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/if}
      <div class="row wrap actions">
        <button class="btn ghost small" onclick={() => push(a, "ooc")} title="Tell the model this, as a standing out-of-character note">Add as a note</button>
        <button class="btn ghost small" onclick={() => push(a, "memory")}><BookmarkPlus size={13} /> Pin as memory</button>
        <span class="grow"></span>
        <button class="btn ghost icon small" onclick={() => remove(a)} aria-label="Delete"><Trash size={13} /></button>
      </div>
    </article>
  {:else}
    {#if !busy}<p class="tiny faint">Try: “Who knows about the letter?”, “When did we first meet Joss?”, “What's still unresolved?”</p>{/if}
  {/each}
</div>

<style>
  .panel-body {
    gap: 0.8rem;
  }
  .intro {
    display: flex;
    gap: 0.4rem;
    align-items: flex-start;
  }
  .askbox {
    display: flex;
    gap: 0.4rem;
    align-items: flex-end;
    padding: 0.35rem;
  }
  .askbox textarea {
    border: 0;
    background: none;
    resize: none;
    flex: 1;
    min-width: 0;
  }
  .answer {
    padding: 0.65rem 0.75rem;
    display: grid;
    gap: 0.35rem;
  }
  .q {
    display: flex;
    gap: 0.35rem;
    align-items: center;
    color: var(--text-muted);
  }
  .a {
    margin: 0;
    line-height: 1.55;
  }
  .ref {
    border: 0;
    background: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0 0.1rem;
    font: inherit;
    font-size: 0.8em;
    vertical-align: super;
  }
  .link {
    border: 0;
    background: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    text-align: left;
  }
  .sources {
    display: grid;
    gap: 0.3rem;
  }
  .src {
    display: grid;
    gap: 0.1rem;
    text-align: left;
    border: 1px solid var(--border);
    border-radius: var(--r-sm, 8px);
    background: var(--surface);
    padding: 0.35rem 0.5rem;
    cursor: pointer;
    color: inherit;
  }
  .warn {
    color: var(--danger);
  }
  .actions {
    gap: 0.2rem;
  }
</style>
