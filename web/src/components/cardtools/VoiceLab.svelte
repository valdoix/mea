<script lang="ts">
  import { post, put } from "../../lib/api";
  import { Loader, Plus, Star, Trash, X } from "../../lib/icons";
  import { errorToast, toast } from "../../lib/state.svelte";

  /**
   * Voice lab (CHAR-14): sample lines across situations, keep the ones that sound right. Kept lines
   * are saved with the character (the voice fingerprint) and become example dialogue on request.
   */
  type Line = { id: string; situation: string; cue: string; line: string };
  let {
    characterId,
    card,
    kept: initial = [],
    onexamples,
  }: { characterId: string; card: () => Record<string, unknown>; kept?: Line[]; onexamples: (text: string) => void } = $props();

  const SITUATIONS = ["calm", "angry", "flirting", "scared", "lying", "grieving", "joking", "cornered"];
  let chosen = $state<string[]>(["calm", "angry", "scared", "lying"]);
  let custom = $state("");
  let count = $state(1);
  let lines = $state<Line[]>([]);
  // svelte-ignore state_referenced_locally
  let kept = $state<Line[]>([...initial]);
  let working = $state(false);

  async function generate() {
    working = true;
    try {
      const situations = [...chosen, ...custom.split(",").map((s) => s.trim()).filter(Boolean)];
      lines = (await post<{ lines: Line[] }>("/api/card-tools/voice", { card: card(), situations, count, kept: kept.map((k) => ({ situation: k.situation, line: k.line })) })).lines;
    } catch (e) {
      errorToast(e);
    } finally {
      working = false;
    }
  }

  async function save(next: Line[]) {
    kept = next;
    try {
      await put(`/api/characters/${characterId}`, { settings: { voice: { kept: next } } });
    } catch (e) {
      errorToast(e);
    }
  }

  function keep(l: Line) {
    lines = lines.filter((x) => x.id !== l.id);
    void save([...kept, l]);
  }

  function toExamples() {
    const text = kept.map((k) => `<START>\n{{user}}: ${k.cue}\n{{char}}: ${k.line}`).join("\n");
    onexamples(text);
    toast("Added to the example dialogue. Save the card to keep it.", { kind: "ok" });
  }

  const toggle = (s: string) => (chosen = chosen.includes(s) ? chosen.filter((x) => x !== s) : [...chosen, s]);
</script>

<div class="stack">
  <p class="small muted">Hear how they sound before you play. Pick situations, generate lines, and keep the ones that are unmistakably them. Kept lines are their voice fingerprint, and can become example dialogue.</p>
  <div class="row wrap">
    {#each SITUATIONS as s (s)}<button class="chip toggle" class:on={chosen.includes(s)} onclick={() => toggle(s)} aria-pressed={chosen.includes(s)}>{s}</button>{/each}
  </div>
  <div class="row wrap">
    <input class="input grow" bind:value={custom} placeholder="Your own situations, comma-separated: drunk, at a funeral, bargaining" aria-label="Your own situations" />
    <label class="row tiny muted">Per situation <select class="select mini" bind:value={count}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
    <button class="btn primary" onclick={generate} disabled={working || (!chosen.length && !custom.trim())}>{#if working}<span class="spin"><Loader size={14} /></span> Listening…{:else}Generate lines{/if}</button>
  </div>

  {#each lines as l (l.id)}
    <div class="line card">
      <span class="chip tiny">{l.situation}</span>
      <div class="grow">
        <span class="tiny muted">{"{{user}}"}: {l.cue}</span>
        <p class="story">{l.line}</p>
      </div>
      <button class="btn small" onclick={() => keep(l)}><Star size={13} /> Keep</button>
      <button class="btn ghost icon small" onclick={() => (lines = lines.filter((x) => x.id !== l.id))} aria-label="Discard"><X size={13} /></button>
    </div>
  {/each}

  <section class="panel stack tight">
    <div class="row between wrap">
      <b class="small"><Star size={14} /> Kept ({kept.length})</b>
      <button class="btn small" onclick={toExamples} disabled={!kept.length}><Plus size={13} /> Add to example dialogue</button>
    </div>
    {#each kept as k (k.id)}
      <div class="kept small">
        <span class="chip tiny">{k.situation}</span>
        <span class="grow">{k.line}</span>
        <button class="btn ghost icon small" onclick={() => save(kept.filter((x) => x.id !== k.id))} aria-label="Remove"><Trash size={13} /></button>
      </div>
    {:else}
      <span class="tiny muted">Nothing kept yet.</span>
    {/each}
  </section>
</div>

<style>
  .toggle {
    cursor: pointer;
    border: 1px solid var(--border);
    font: inherit;
    font-size: var(--fs-xs);
    opacity: 0.7;
  }
  .toggle.on {
    opacity: 1;
    background: color-mix(in srgb, var(--lavender) 45%, var(--surface));
    font-weight: 700;
  }
  .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .mini {
    width: auto;
    padding-top: 0.25rem;
    padding-bottom: 0.25rem;
  }
  .line {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    padding: 0.7rem 0.8rem;
    flex-wrap: wrap;
  }
  .line p {
    margin: 0.2rem 0 0;
  }
  .kept {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    border-top: 1px solid var(--border);
    padding-top: 0.4rem;
  }
  .spin {
    display: inline-grid;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
