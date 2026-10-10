<script lang="ts">
  import "../../styles/studio.css";
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
  // A tapped reference also lights its source in the list below.
  let flash = $state<string | null>(null);
  let flashTimer: ReturnType<typeof setTimeout>;
  function jump(a: ArchiveAnswer, c: ArchiveCitation | undefined, n: number) {
    if (c) onjump(c);
    openSources = a.id;
    flash = `${a.id}:${n}`;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flash = null), 1400);
  }
  const SUGGEST = ["Who knows about the letter?", "When did we first meet Joss?", "What's still unresolved?"];
  function suggest(q: string) {
    question = q;
    void ask();
  }

  /** "[2]" in an answer becomes a tappable reference. */
  function parts(text: string) {
    return text.split(/(\[\d+\])/g).map((p) => {
      const m = p.match(/^\[(\d+)\]$/);
      return m ? { n: Number(m[1]) } : { text: p };
    });
  }
</script>

<div class="studio st-stack">
  <section class="desk-mic">
    <p class="intro"><Library size={15} /><span>Ask anything about your story, out of character. Answers come from memory with sources, and stay out of the roleplay unless you add them.</span></p>
    <div class="mic" class:busy>
      <textarea use:autosize={160} rows="1" bind:value={question} placeholder="What did Mira promise in chapter 3?" onkeydown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void ask())} aria-label="Your question"></textarea>
      <button class="send" type="button" onclick={ask} disabled={busy || question.trim().length < 2} aria-label="Ask"><Send size={16} /></button>
    </div>
    {#if busy}
      <p class="st-lcd seeking" aria-live="polite"><span class="st-led warm pulse"></span> LOOKING THROUGH THE ARCHIVE…</p>
    {:else if !answers.length}
      <div class="st-tags sugg">{#each SUGGEST as q (q)}<button class="st-chip" type="button" onclick={() => suggest(q)}>{q}</button>{/each}</div>
    {/if}
  </section>

  {#each answers as a (a.id)}
    <article class="answer">
      <div class="q"><MessageQuestion size={14} /><span>{a.question}</span></div>
      <p class="a">
        {#each parts(a.answer) as p, i (i)}
          {#if "n" in p}
            {@const c = a.sources.find((s) => s.n === p.n)}
            <button class="ref" type="button" onclick={() => jump(a, c, p.n ?? 0)} title={c ? `${c.type}: ${c.excerpt.slice(0, 160)}` : "source"}>{p.n}</button>
          {:else}{p.text}{/if}
        {/each}
      </p>
      {#if a.confidence === "unknown"}<p class="unknown"><span class="st-led warm"></span> The archive doesn't establish this.</p>{/if}
      {#if a.citations.length}
        <button class="st-link" type="button" onclick={() => (openSources = openSources === a.id ? null : a.id)}>{openSources === a.id ? "Hide" : "Show"} {a.citations.length} source{a.citations.length === 1 ? "" : "s"}</button>
        {#if openSources === a.id}
          <div class="sources">
            {#each a.citations as c (c.n)}
              <button class="src" class:lit={flash === `${a.id}:${c.n}`} type="button" onclick={() => onjump(c)}>
                <span class="src-h"><b>{c.n}</b> {c.type}{c.seq != null ? ` · #${c.seq}` : ""}</span>
                <span class="src-x">{c.excerpt.slice(0, 220)}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/if}
      <div class="st-keys acts">
        <button class="st-key small ghost" type="button" onclick={() => push(a, "ooc")} title="Tell the model this, as a standing out-of-character note">Add as a note</button>
        <button class="st-key small ghost" type="button" onclick={() => push(a, "memory")}><BookmarkPlus size={13} /> Pin as memory</button>
        <span class="st-grow"></span>
        <button class="st-key small sq ghost" type="button" onclick={() => remove(a)} aria-label="Delete" title="Delete"><Trash size={13} /></button>
      </div>
    </article>
  {:else}
    {#if !busy}
      <div class="st-empty">
        <p>No questions yet. The archivist reads the memory, the codex and the chat, then cites where it found the answer.</p>
      </div>
    {/if}
  {/each}
</div>

<style>
  .desk-mic {
    display: grid;
    gap: 10px;
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
  .mic {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 6px 6px 6px 14px;
    border-radius: 24px;
    background: var(--st-well);
    box-shadow:
      var(--st-inset),
      0 0 0 var(--st-bw) var(--st-edge);
    transition: box-shadow 0.2s;
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
    box-shadow:
      0 2px 0 color-mix(in srgb, var(--accent) 50%, #000),
      var(--st-glow, 0 0 0 transparent);
    cursor: pointer;
    transition: transform 0.1s;
  }
  .send:active:not(:disabled) {
    transform: translateY(2px);
    box-shadow: none;
  }
  .send:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .seeking {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 8px 12px;
    border-radius: var(--r-sm);
    background: var(--st-well);
    box-shadow: var(--st-inset-sm);
    font-size: calc(11px * var(--st-lcd-k));
  }
  .sugg .st-chip {
    cursor: pointer;
  }

  .answer {
    display: grid;
    gap: 8px;
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: var(--surface);
    border: var(--st-bw) solid var(--st-edge);
    box-shadow: var(--st-card);
  }
  .q {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding-bottom: 8px;
    border-bottom: 1px dashed var(--st-edge);
    font: 700 9.5px/1.4 var(--st-meta);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .q :global(svg) {
    flex: 0 0 auto;
    color: var(--accent-ink);
  }
  .a {
    margin: 0;
    font: 14px/1.6 var(--st-story);
    overflow-wrap: anywhere;
  }
  .ref {
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
  .ref:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .unknown {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
  }
  .sources {
    display: grid;
    gap: 6px;
  }
  .src {
    display: grid;
    gap: 3px;
    padding: 8px 10px;
    border: 0;
    border-left: 3px solid var(--st-edge);
    border-radius: 4px;
    background: var(--st-well);
    color: var(--text);
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.2s,
      background 0.2s;
  }
  .src:hover,
  .src.lit {
    border-left-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--st-well));
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
  .acts {
    margin-top: 2px;
  }
</style>
