<script lang="ts">
  import { autosize } from "../../../lib/gestures";
  import { Compass, ListTree, MessageQuestion, Plus } from "../../../lib/icons";
  import type { StudioSession } from "../../../lib/studio.svelte";
  import ExpandPanel from "../../studio/ExpandPanel.svelte";
  import StudioOptions from "./StudioOptions.svelte";

  let { session }: { session: StudioSession } = $props();
  const draft = $derived(session.draft!);
  let steer = $state("");

  const label = $derived(
    { idea: "Your idea, in your own words", character: "What the studio reads (the card, plus your notes)", persona: "What the studio reads (the persona, plus your notes)", document: "The document", book: "What the studio reads (the book's entries, plus your notes)" }[draft.source.kind],
  );

  function useDirection(d: { title: string; pitch: string }) {
    draft.source.text = `${draft.source.text.trim()}\n\nDirection: ${d.title}. ${d.pitch}`;
    session.save({ text: draft.source.text }, "text", 0);
  }
</script>

<section class="stack">
  <label class="field">
    <span class="label">{label}</span>
    <textarea class="textarea story" use:autosize={{ max: 520, value: draft.source.text }} bind:value={draft.source.text} oninput={() => session.save({ text: draft.source.text }, "text")}></textarea>
  </label>

  {#if draft.source.kind !== "document"}
    <ExpandPanel
      expansion={draft.expansion}
      busy={session.busy === "expand" || session.busy.startsWith("deepen:") ? session.busy : session.busy ? "other" : ""}
      what={draft.source.kind === "idea" ? "idea" : "world"}
      disabled={!draft.source.text.trim()}
      onexpand={(steer) => session.act("expand", "/expand", { steer })}
      ondeepen={(id, steer) => session.act(`deepen:${id}`, `/expand/${id}`, { steer })}
      onpatch={(patch, key, delay) => {
        if (!draft.expansion && patch.sections) draft.expansion = { sections: [], use: true, steer: "" };
        session.save({ expansion: patch }, key, delay);
      }}
    />

    <div class="panel stack tight">
      <div class="row between wrap">
        <span class="small"><Compass size={15} /> <b>Not sure where to take it?</b> <span class="muted">Three different directions to pick from.</span></span>
        <div class="row">
          <input class="input mini" bind:value={steer} placeholder="Lean: darker, cozier…" aria-label="Lean the directions" />
          <button class="btn small" onclick={() => session.act("directions", "/directions", { steer })} disabled={Boolean(session.busy)}>{session.busy === "directions" ? "Thinking…" : draft.directions.length ? "Others" : "Show me"}</button>
        </div>
      </div>
      {#each draft.directions as d, i (i)}
        <div class="direction">
          <div class="grow"><b class="small">{d.title}</b><p class="small muted">{d.pitch}</p></div>
          <button class="btn ghost small" onclick={() => useDirection(d)}><Plus size={13} /> Use</button>
        </div>
      {/each}
    </div>
  {/if}

  <StudioOptions {session} />

  <div class="row wrap actions">
    <button class="btn" onclick={() => session.act("readback", "/readback")} disabled={Boolean(session.busy) || !draft.source.text.trim()}>
      <MessageQuestion size={16} /> {session.busy === "readback" ? "Reading…" : "Ask me questions first"}
    </button>
    <button class="btn primary" onclick={() => session.act("outline", "/outline")} disabled={Boolean(session.busy) || !draft.source.text.trim()}>
      <ListTree size={16} /> {session.busy === "outline" ? "Planning…" : "Plan the lorebook"}
    </button>
  </div>
  <p class="tiny muted">Questions are optional, but your answers are the best defence against generic lore: they outrank anything the model would invent.</p>
</section>

<style>
  .mini {
    width: 11rem;
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
    font-size: var(--fs-xs);
  }
  .direction {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    border-top: 1px solid var(--border);
    padding-top: 0.4rem;
  }
  .direction p {
    margin: 0.15rem 0 0;
  }
  .actions {
    justify-content: flex-end;
  }
</style>
