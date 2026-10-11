<script lang="ts">
  import Modal from "../Modal.svelte";
  import Segmented from "../Segmented.svelte";
  import TagInput from "../TagInput.svelte";
  import { offpageAction, offpageEditor, offpageState, revealText, saveOffpage, type OffpageDraft, type RevealPlan } from "../../lib/offpage.svelte";

  /**
   * B1: keep a secret off the page. What it is, the words never to use yet, how the story may
   * hint at it (and how often), and when it may come out.
   */
  let { chatId }: { chatId: string } = $props();

  let draft = $state<OffpageDraft | null>(null);
  $effect(() => {
    if (offpageEditor.open && offpageEditor.draft) draft = structuredClone($state.snapshot(offpageEditor.draft)) as OffpageDraft;
  });
  const existing = $derived(offpageEditor.id ? offpageState.list.find((o) => o.id === offpageEditor.id) : null);
  let afterKind = $state<"messages" | "time">("messages");

  async function save() {
    if (!draft?.label.trim()) return;
    const d = $state.snapshot(draft) as OffpageDraft;
    if (d.reveal.when === "after") d.reveal = afterKind === "messages" ? { when: "after", messages: Number(d.reveal.messages) || 30 } : { when: "after", at: d.reveal.at ?? "" };
    else d.reveal = { when: d.reveal.when };
    // An unchanged "after" on an existing secret keeps its plan.
    if (existing && existing.reveal.when === "after" && d.reveal.when === "after" && !d.reveal.messages && !d.reveal.at) delete (d as Partial<OffpageDraft>).reveal;
    if (await saveOffpage(chatId, d, offpageEditor.id ?? undefined)) offpageEditor.open = false;
  }
  async function act(a: "reveal" | "hold" | "delete") {
    if (!existing) return;
    await offpageAction(existing, a);
    offpageEditor.open = false;
  }
  const WHEN: { value: RevealPlan["when"]; label: string }[] = [
    { value: "say", label: "When I say" },
    { value: "after", label: "After…" },
    { value: "exposure", label: "Clock fills" },
    { value: "never", label: "Never" },
  ];
</script>

<Modal bind:open={offpageEditor.open} title={existing ? "Kept off the page" : "Keep a secret off the page"} size="md">
  {#if draft}
    <div class="stack">
      <p class="tiny muted">The narration won't state it or use these words yet. Memory and lore that do are reworded before the prompt, and any reply that slips is flagged with a one-tap fix.</p>
      <label class="field"><span class="label">The secret</span><textarea class="textarea" rows="2" bind:value={draft.label} maxlength="300" placeholder="Willow is the one who opened the Hellmouth."></textarea></label>
      <div class="field">
        <span class="label">Never say</span>
        <TagInput bind:value={draft.neverSay} placeholder="A word or name, then Enter" />
        <span class="hint">Words the story mustn't use yet. Leave empty to keep only the idea back.</span>
      </div>
      <label class="field"><span class="label">May hint as</span><input class="input" bind:value={draft.hintAs} maxlength="300" placeholder="the smell of sulphur when she's angry" /></label>
      <div class="field">
        <span class="label">Hints</span>
        <Segmented
          small
          value={draft.hints}
          options={[
            { value: "never", label: "Never" },
            { value: "rarely", label: "Rarely" },
            { value: "building", label: "Slowly building" },
          ]}
          onchange={(v) => draft && (draft.hints = v)}
        />
        <span class="hint">{draft.hints === "never" ? "No hints at all." : draft.hints === "rarely" ? "One allowed hint every fifteen messages or so." : "Hints come more often as the story goes on: dramatic irony on purpose."}{draft.hints !== "never" && !draft.hintAs.trim() ? " Write how it may be hinted, above." : ""}</span>
      </div>
      <div class="field">
        <span class="label">Reveal</span>
        <Segmented small value={draft.reveal.when} options={WHEN} onchange={(v) => draft && (draft.reveal = { ...draft.reveal, when: v })} />
        {#if draft.reveal.when === "after"}
          <div class="row wrap after">
            <Segmented
              small
              value={afterKind}
              options={[
                { value: "messages", label: "Messages" },
                { value: "time", label: "Story time" },
              ]}
              onchange={(v) => (afterKind = v)}
            />
            {#if afterKind === "messages"}
              <input class="input num" type="number" min="1" max="100000" bind:value={draft.reveal.messages} placeholder="40" aria-label="Messages from now" />
              <span class="tiny muted">messages from now</span>
            {:else}
              <input class="input" bind:value={draft.reveal.at} placeholder="Day 12, or 2026-03-20 18:00" aria-label="Story time" />
            {/if}
          </div>
          {#if existing?.reveal.when === "after"}<span class="hint">Now: {revealText(existing.reveal)}. Leave the box empty to keep it.</span>{/if}
        {/if}
        <span class="hint">When it comes due, a card asks: Reveal now, or Hold.</span>
      </div>
    </div>
  {/if}
  {#snippet footer()}
    {#if existing}
      <button class="btn ghost danger" onclick={() => act("delete")}>Stop keeping it</button>
      {#if existing.status === "kept"}<button class="btn ghost" onclick={() => act("reveal")}>Reveal now</button>{/if}
    {/if}
    <button class="btn ghost" onclick={() => (offpageEditor.open = false)}>Cancel</button>
    <button class="btn primary" onclick={save} disabled={!draft?.label.trim()}>{existing ? "Save" : "Keep it off the page"}</button>
  {/snippet}
</Modal>

<style>
  .after {
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.4rem;
  }
  .num {
    width: 6rem;
  }
</style>
