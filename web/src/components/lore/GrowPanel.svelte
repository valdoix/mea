<script lang="ts">
  import ExtendButton from "../studio/ExtendButton.svelte";
  import { post } from "../../lib/api";
  import { autosize } from "../../lib/gestures";
  import { Check, Compass, MessageQuestion, SkipForward, Sprout, X } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";
  import type { Direction, FactSource } from "../../lib/types";

  /**
   * "Add lore": one pointed question at a time about this book's world; each answer, in your own
   * words, becomes one new triggered entry. Only ever adds: nothing already in the book is touched.
   */
  let { bookId, onadded }: { bookId: string; onadded: (entryId: string) => void } = $props();
  let q = $state<{ q: string; why: string } | null>(null);
  let answer = $state("");
  let source = $state<FactSource>("typed");
  let dirs = $state<Direction[]>([]);
  let shown = $state<string[]>([]);
  let skipped = $state<string[]>([]);
  let steer = $state("");
  let busy = $state("");

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

  async function ask(skip = false) {
    if (skip && q) skipped = [...skipped, q.q];
    const next = await run("ask", () => post<{ q: string; why: string }>(`/api/lorebooks/${bookId}/grow/question`, { steer, avoid: skipped }));
    if (!next) return;
    q = next;
    answer = "";
    source = "typed";
    dirs = [];
    shown = [];
    steer = "";
  }

  async function directions() {
    if (!q) return;
    const r = await run("dirs", () => post<{ directions: Direction[] }>(`/api/lorebooks/${bookId}/grow/directions`, { question: q!.q, why: q!.why, steer, avoid: shown }));
    if (!r) return;
    dirs = r.directions;
    shown = [...shown, ...r.directions.map((d) => d.text)];
  }

  async function use() {
    if (!q || !answer.trim()) return;
    const r = await run("use", () => post<{ entry: { id: string; comment: string } }>(`/api/lorebooks/${bookId}/grow/answer`, { question: q!.q, answer: answer.trim(), source }));
    if (!r) return;
    toast(`Added “${r.entry.comment}”`, { kind: "ok" });
    onadded(r.entry.id);
    await ask();
  }
</script>

<section class="panel stack">
  <div class="row between wrap">
    <h3><Sprout size={16} /> Add lore</h3>
    {#if q}<button class="btn ghost small" onclick={() => (q = null)}><X size={13} /> Done</button>{/if}
  </div>
  {#if !q}
    <p class="tiny muted">Mea asks one pointed question at a time about this world, grounded in what's already here. Each answer becomes one new entry; nothing already in the book is changed.</p>
    <div class="row"><button class="btn" onclick={() => ask()} disabled={Boolean(busy)}><MessageQuestion size={15} /> {busy === "ask" ? "Thinking…" : "Ask me something"}</button></div>
  {:else}
    <b>{q.q}</b>
    {#if q.why}<span class="tiny muted">Why I'm asking: {q.why}</span>{/if}
    <textarea class="textarea" use:autosize={{ max: 300, value: answer }} rows="3" bind:value={answer} oninput={() => (source = source === "picked" && !dirs.some((d) => answer.includes(d.text.slice(0, 20))) ? "typed" : source)} placeholder="In your own words"></textarea>
    {#if dirs.length}
      <div class="dirs">{#each dirs as d (d.text)}<button class="dir" onclick={() => { answer = d.text; source = "picked"; }}><b class="tiny">{d.caption}</b><span class="small">{d.text}</span></button>{/each}</div>
    {/if}
    <div class="row wrap tools">
      <button class="btn ghost small" onclick={directions} disabled={Boolean(busy)}><Compass size={13} /> {busy === "dirs" ? "Thinking…" : dirs.length ? "Other directions" : "Show me directions"}</button>
      <ExtendButton text={answer} question={q.q} onresult={(t) => { answer = t; source = "extended"; }} />
      <span class="grow"></span>
      <button class="btn primary small" onclick={use} disabled={Boolean(busy) || !answer.trim()}><Check size={14} /> {busy === "use" ? "Writing the entry…" : "Use my answer"}</button>
    </div>
    <div class="row wrap tools">
      <input class="input slim grow" bind:value={steer} placeholder="Steer: ask about the harbour, the old war…" aria-label="Steer the next question or directions" />
      <button class="btn ghost small" onclick={() => ask(true)} disabled={Boolean(busy)}><SkipForward size={13} /> Ask something else</button>
    </div>
  {/if}
</section>

<style>
  h3 {
    margin: 0;
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .dirs {
    display: grid;
    gap: 0.35rem;
  }
  .dir {
    display: grid;
    gap: 0.15rem;
    text-align: left;
    border: 1px dashed var(--border);
    border-radius: 8px;
    background: none;
    color: var(--text);
    padding: 0.45rem 0.6rem;
    cursor: pointer;
    font: inherit;
  }
  .dir:hover {
    border-style: solid;
    border-color: var(--accent);
  }
  .tools {
    gap: 0.35rem;
    align-items: center;
  }
  .slim {
    padding: 0.3rem 0.5rem;
    font-size: var(--fs-sm);
  }
  .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
</style>
