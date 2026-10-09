<script lang="ts">
  import Modal from "../Modal.svelte";
  import type { TrackerChange } from "../../lib/types";

  let { changes: all, max = 6 }: { changes: TrackerChange[]; max?: number } = $props();
  let open = $state(false);
  // Private thoughts and hidden feelings live in the drawer under the reply, never in the chips.
  const changes = $derived(all.filter((c) => c.kind !== "thought" && c.kind !== "mask"));

  // The most telling first; the clock goes last (it's in the HUD).
  const RANK = ["death", "romance", "bond", "secret", "knowledge", "promise", "owe", "deadline", "thread", "item", "body", "mood", "place", "cast", "custom", "gauge", "faction", "trait", "look", "weather", "clock"];
  const sorted = $derived([...changes].sort((a, b) => (RANK.indexOf(a.kind) + 100) % 100 - (RANK.indexOf(b.kind) + 100) % 100));
  const shown = $derived(sorted.slice(0, max));
  const icon: Record<string, string> = { clock: "🕰", weather: "🌦", place: "📍", cast: "👥", mood: "🎭", body: "🩹", look: "👗", trait: "✨", bond: "💞", romance: "💗", knowledge: "🧠", secret: "🤫", item: "🎒", thread: "🧵", promise: "🤝", owe: "⚖", deadline: "⏰", plant: "🌱", clue: "🔎", gauge: "📊", faction: "🏛", reputation: "🏷", calendar: "📅", motif: "🔁", milestone: "🌟", death: "🕯", custom: "📌", journal: "📓", scene: "🎬", drive: "🎯" };
  const sourceLabel: Record<string, string> = { model: "the tracker model", inline: "the story model", user: "you", init: "the card", timeskip: "a time skip", engine: "the world off the page" };
</script>

{#if changes.length}
  <button class="chips" onclick={() => (open = true)} title="What this reply changed">
    {#each shown as c, i (i)}
      <span class="tchip {c.tone ?? ''}" class:flagged={Boolean(c.flag)}><span aria-hidden="true">{icon[c.kind] ?? "•"}</span> {c.text}</span>
    {/each}
    {#if changes.length > max}<span class="tchip more">+{changes.length - max}</span>{/if}
  </button>
{/if}

<Modal bind:open title="What changed" size="sm">
  <div class="stack tight">
    {#each sorted as c, i (i)}
      <div class="row-c">
        <div><span aria-hidden="true">{icon[c.kind] ?? "•"}</span> <b>{c.text}</b></div>
        {#if c.reason}<div class="tiny muted">{c.reason}</div>{/if}
        {#if c.flag}<div class="tiny warn-t">{c.flag}</div>{/if}
        <div class="tiny faint">from {sourceLabel[c.source] ?? c.source}{c.memory ? " · remembered" : ""}</div>
      </div>
    {/each}
  </div>
</Modal>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    border: 0;
    background: none;
    padding: 0.45rem 0 0;
    cursor: pointer;
    text-align: left;
  }
  .tchip {
    font: 600 var(--fs-xs) / 1.2 var(--font-ui);
    padding: 0.22rem 0.55rem;
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--surface) 70%, transparent);
    border: 1px solid var(--border);
    color: var(--text-muted);
    white-space: nowrap;
    max-width: 22rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tchip.up {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 40%, var(--border));
  }
  .tchip.down {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
  }
  .tchip.due,
  .tchip.warn,
  .tchip.flagged {
    color: var(--warn, #b7791f);
    border-color: color-mix(in srgb, var(--warn, #b7791f) 40%, var(--border));
  }
  .row-c {
    padding: 0.4rem 0;
    border-top: 1px solid var(--border);
  }
  .warn-t {
    color: var(--warn, #b7791f);
  }
</style>
