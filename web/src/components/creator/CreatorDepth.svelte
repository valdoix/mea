<script lang="ts">
  import type { CreatorSession } from "../../lib/creator.svelte";
  import { autosize } from "../../lib/gestures";
  import { Layers, Plus, Sparkles, TriangleAlert, X } from "../../lib/icons";

  /**
   * Depth: detail that surfaces when it's relevant instead of riding every turn. Deepening answers are
   * composed into entries; more can be drafted from the bible or added by hand. On save they go into a
   * triggered lorebook bound to the card or persona.
   */
  let { session }: { session: CreatorSession } = $props();
  const draft = $derived(session.draft!);
  const isChar = $derived(draft.kind === "character");
  const pending = $derived(draft.questions.filter((q) => q.section === "depth" && q.answer.trim() && !draft.depth.some((e) => e.qid === q.id)).length);
  const FROM: Record<string, string> = { answer: "from your answer", bible: "from the bible", you: "yours" };

  function edit(id: string, patch: { title?: string; content?: string; keys?: string[] }) {
    const e = session.draft!.depth.find((x) => x.id === id);
    if (e) Object.assign(e, patch);
    session.save({ depth: [{ id, ...patch }] }, `depth:${id}`);
  }
  function remove(id: string) {
    session.draft!.depth = draft.depth.filter((e) => e.id !== id);
    session.save({ depth: [{ id, remove: true }] }, `depth-rm:${id}`, 0);
  }
  async function add() {
    session.save({ depth: [{ title: "Detail", content: "", keys: [] }] }, "depth-add", 0);
    await session.flush();
    await session.load();
  }
</script>

<div class="panel stack tight">
  <div class="row between wrap">
    <span class="small"><Layers size={14} /> <b>Depth</b> <span class="muted">· surfaces on relevance{draft.options.depthBook ? `, saved into ${isChar ? "a depth book bound to the card" : "a depth book bound to the persona"}` : " (the depth book is off in the shape options)"}</span></span>
    <div class="row wrap">
      {#if pending}<button class="btn small" onclick={() => session.act("depth", "/depth")} disabled={Boolean(session.busy)}><Sparkles size={13} /> {session.busy === "depth" ? "Composing…" : `Compose ${pending} answer${pending === 1 ? "" : "s"}`}</button>{/if}
      <button class="btn small ghost" onclick={() => session.act("depth", "/depth", { fromBible: true })} disabled={Boolean(session.busy) || !draft.bible.length} title="Past events, people and secrets that shouldn't ride every turn"><Sparkles size={13} /> Draft from the bible</button>
      <button class="btn small ghost" onclick={add}><Plus size={13} /> Add</button>
    </div>
  </div>
  {#each draft.depth as e (e.id)}
    <div class="entry stack tight">
      <div class="row">
        <input class="input slim grow" value={e.title} oninput={(ev) => edit(e.id, { title: ev.currentTarget.value })} aria-label="Title" />
        <span class="tiny faint">{FROM[e.from]}{e.entryId ? " · in the book" : ""}</span>
        <button class="btn ghost icon small" onclick={() => remove(e.id)} aria-label="Remove"><X size={13} /></button>
      </div>
      <textarea class="textarea small" use:autosize={{ max: 200, value: e.content }} value={e.content} placeholder="What surfaces…" oninput={(ev) => edit(e.id, { content: ev.currentTarget.value })}></textarea>
      <input class="input slim" value={e.keys.join(", ")} placeholder="Trigger words, comma-separated" oninput={(ev) => edit(e.id, { keys: ev.currentTarget.value.split(",").map((k) => k.trim()).filter(Boolean) })} aria-label="Trigger words" />
      {#if e.gate && !e.gate.passed}<span class="tiny warn"><TriangleAlert size={11} /> {e.gate.criteria.filter((c) => !c.passed).map((c) => `${c.label}: ${c.note}`).join(" ")}</span>{/if}
    </div>
  {:else}
    <span class="tiny muted">No depth entries yet. Answer deepening questions, or draft some from the bible.</span>
  {/each}
</div>

<style>
  .entry {
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
  }
  .slim {
    padding: 0.3rem 0.5rem;
    font-size: var(--fs-sm);
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .warn {
    color: var(--danger);
  }
</style>
